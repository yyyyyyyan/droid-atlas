/**
 * Self-hosted icons, following docs/LICENSING.md §1.3:
 *
 *  1. Candidates, most trustworthy first: the F-Droid, then the IzzyOnDroid
 *     index icon; then what `icon-discovery.ts` found for apps no index gives
 *     an icon (repository files, README logo, website or store listing, a
 *     forge avatar that is the project's own).
 *  2. The deny list in `pipeline/icon-policy.json` wins over every source:
 *     an app or package on it gets no icon, and a source rule or host on it
 *     is never used.
 *  3. Integrity: where the source states a hash (an index's SHA-256, a
 *     forge's git blob id) the downloaded bytes must match it.
 *  4. Quality gates (`icon-image.ts`): decodes, big enough, near-square, not
 *     blank; SVG only from READMEs and websites, and only when safe.
 *  5. Files: a 192 px and, from originals big enough, a 384 px WebP, each
 *     named by its own content hash; never hot-linked.
 *  6. Record: one `IconRecord` per app with an icon (icons.json).
 *  7. A lookup or download that fails or is rate-limited never fails the
 *     build, and never removes an icon the previous build had: that icon is
 *     kept unless the app or its source is now denied or its original was
 *     refused by a gate in this run.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { App } from "../schema/catalog.ts";
import { ICON_PIXELS } from "../schema/catalog.ts";
import type { IconRecord, IconRule } from "../schema/parts.ts";
import type { GithubRepo } from "./enrich/github.ts";
import type { IndexRecord } from "./enrich/index-v2.ts";
import {
  basisOf,
  discover,
  DISCOVERY_RULES,
  dueReason,
  Net,
  RateLimited,
  readDiscoveryCache,
  writeDiscoveryCache,
  type DiscoveryTarget,
  type DueReason,
  type IconCandidate,
  type NetBudgets,
} from "./icon-discovery.ts";
import { checkImage, encodeIcon, MAX_SOURCE_BYTES, MIN_SOURCE_PX } from "./icon-image.ts";
import { composeAdaptiveIcon } from "./android-icon.ts";
import { fetchableUrl, safeRepoPath } from "./icon-sources.ts";

export const ICON_RULES: readonly IconRule[] = [
  "fdroid-index",
  "izzy-index",
  "repo-fastlane",
  "repo-metadata",
  "repo-launcher",
  "readme-logo",
  "site-icon",
  "store-listing",
  "forge-avatar",
];

const INDEX_RULES: ReadonlySet<IconRule> = new Set(["fdroid-index", "izzy-index"]);
/** Index icons are the app's own choice, so any shape within this is padded rather than refused. */
const INDEX_SQUARE_TOLERANCE = 0.35;
const ICON_NAME_RE = /^[0-9a-f]{16}\.webp$/;
const INDEX_HOSTS: Record<"fdroid" | "izzy", string> = {
  fdroid: "https://f-droid.org/repo/",
  izzy: "https://apt.izzysoft.de/fdroid/repo/",
};

/** Per-run request budgets of a normal build; the GitHub API one stays well under the workflow token's hourly limit. */
export const DEFAULT_BUDGETS: NetBudgets = { githubApi: 400, web: 2500 };

export interface IconPolicyFile {
  /** Apps (by id) or packages that get no icon: removal requests and known wrong images. */
  deny: { app?: string; package?: string; reason: string; date: string }[];
  /** Source rules or hosts that are never used. */
  denySources: { rule?: IconRule; host?: string; reason: string; date: string }[];
  /**
   * Icon files found and inspected by hand for apps whose sources the
   * automatic rules cannot read: the rule names the kind of source, `sha256`
   * the reviewed bytes (a changed file is refused until reviewed again), and
   * `revision` the commit for a repository file.
   */
  sources: ReviewedSource[];
}

export interface ReviewedSource {
  app: string;
  rule: Exclude<IconRule, "fdroid-index" | "izzy-index">;
  url: string;
  sha256: string;
  revision?: string;
  reason: string;
  date: string;
}

export function readIconPolicy(path: string): IconPolicyFile {
  if (!existsSync(path)) return { deny: [], denySources: [], sources: [] };
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<IconPolicyFile>;
  const deny = Array.isArray(parsed.deny) ? parsed.deny : [];
  const denySources = Array.isArray(parsed.denySources) ? parsed.denySources : [];
  const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
  for (const [i, entry] of sources.entries()) {
    const ok =
      typeof entry?.app === "string" &&
      ICON_RULES.includes(entry.rule) &&
      !INDEX_RULES.has(entry.rule) &&
      typeof entry.url === "string" &&
      fetchableUrl(entry.url) !== null &&
      typeof entry.sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(entry.sha256) &&
      (entry.rule.startsWith("repo-") ? typeof entry.revision === "string" && /^[0-9a-f]{40}$/.test(entry.revision) : entry.revision === undefined) &&
      typeof entry.reason === "string" &&
      entry.reason.trim() !== "" &&
      typeof entry.date === "string";
    if (!ok) throw new Error(`${path}: sources[${i}] needs an app, a non-index rule, an https url, the sha256 of the reviewed file, a commit for a repository file, a reason and a date`);
  }
  for (const entry of deny) {
    if (typeof entry?.reason !== "string" || (typeof entry.app !== "string" && typeof entry.package !== "string")) {
      throw new Error(`${path}: every deny entry needs an app or a package, and a reason`);
    }
  }
  for (const entry of denySources) {
    if (typeof entry?.reason !== "string" || (typeof entry.host !== "string" && !ICON_RULES.includes(entry.rule as IconRule))) {
      throw new Error(`${path}: every denySources entry needs a known rule or a host, and a reason`);
    }
  }
  return { deny, denySources, sources };
}

/** An app's reviewed sources as candidates, in the order the policy lists them. */
export function reviewedCandidates(app: string, policy: IconPolicyFile): IconCandidate[] {
  return policy.sources
    .filter((source) => source.app === app)
    .map((source) => ({
      rule: source.rule,
      url: source.url,
      expect: { kind: "sha256" as const, value: source.sha256 },
      revision: source.revision ?? null,
      allowSvg: source.rule === "site-icon" || source.rule === "readme-logo",
      minPx: MIN_SOURCE_PX,
    }));
}

/** Why the app may get no icon, or null when it may. */
export function deniedApp(app: Pick<App, "id" | "packages" | "channels">, policy: IconPolicyFile): string | null {
  const packages = new Set([...app.packages, ...app.channels.map((c) => c.pkg)]);
  const hit = policy.deny.find((d) => d.app === app.id || (d.package !== undefined && packages.has(d.package)));
  return hit ? hit.reason : null;
}

/** Why a candidate may not be used, or null when it may. */
export function deniedSource(candidate: Pick<IconCandidate, "rule" | "url">, policy: IconPolicyFile): string | null {
  let host = "";
  try {
    host = new URL(candidate.url).hostname.toLowerCase();
  } catch {
    return "not a URL";
  }
  const hit = policy.denySources.find((d) => d.rule === candidate.rule || (d.host !== undefined && (host === d.host.toLowerCase() || host.endsWith(`.${d.host.toLowerCase()}`))));
  return hit ? hit.reason : null;
}

/** The index icons of an app as candidates, F-Droid first; icons outside the repository's own address are not candidates. */
export function indexCandidates(records: readonly IndexRecord[]): IconCandidate[] {
  return records
    .filter((r) => r.iconUrl !== null && r.iconSha256 !== null && r.iconUrl.startsWith(INDEX_HOSTS[r.origin]))
    .map((r) => ({
      rule: r.origin === "fdroid" ? ("fdroid-index" as const) : ("izzy-index" as const),
      url: r.iconUrl ?? "",
      expect: { kind: "sha256" as const, value: r.iconSha256 ?? "" },
      revision: r.indexAt,
      allowSvg: false,
      minPx: 0,
    }));
}

/** The project an app belongs to for template detection: the repository a fork was forked from, else its repository, else the app. */
export function projectOf(app: Pick<App, "id" | "repo" | "github">): string {
  return (app.github?.forkOf ?? app.repo?.slug ?? app.id).toLowerCase();
}

/** What discovery looks up for an app. Resources (guides and links) are looked up only by their own site. */
export function discoveryTarget(app: App, githubRepo: GithubRepo | null): DiscoveryTarget {
  const resource = app.listings.every((l) => l.kind === "resource");
  const firstUrl = app.listings[0]?.url ?? null;
  if (resource) return { app: app.id, name: app.name, github: null, gitlab: null, codeberg: null, website: firstUrl, play: null };
  const repo = app.repo;
  return {
    app: app.id,
    name: app.name,
    github: repo?.host === "github" && githubRepo ? { slug: githubRepo.fullName, head: githubRepo.head, owner: githubRepo.owner } : null,
    gitlab: repo?.host === "gitlab" ? repo.slug : null,
    codeberg: repo?.host === "codeberg" ? repo.slug : null,
    website: app.website,
    play: app.channels.find((c) => c.type === "play")?.pkg ?? null,
  };
}

export interface IconReport {
  enabled: boolean;
  written: number;
  byRule: Record<IconRule, number>;
  /** Apps with no icon, each with the reason. */
  missing: { app: string; name: string; reason: string }[];
  /** Candidates a gate refused. */
  rejected: { app: string; rule: IconRule; url: string; reason: string }[];
  /** Downloads that failed for a reason other than a gate. */
  failed: { app: string; url: string; error: string }[];
  denied: { app: string; reason: string }[];
  /** Icons kept from the previous build because this run could not look the app up or download its icon. */
  kept: { app: string; rule: IconRule }[];
  discovery: {
    due: number;
    byReason: Record<DueReason, number>;
    looked: number;
    /** Lookups left for a later run: offline, budget spent, or rate-limited. */
    deferred: number;
    errors: { app: string; error: string }[];
    requests: { githubApi: number; web: number };
    rateLimited: string[];
  };
  /** Files encoded below the first quality step to fit their budget. */
  reduced: { app: string; size: number; quality: number }[];
}

export interface IconResult {
  /** App id → list-size icon path. */
  paths: Map<string, string>;
  /** App id → sheet-size icon path. */
  largePaths: Map<string, string>;
  records: IconRecord[];
  report: IconReport;
  /** Writes the icon files and removes ones no catalog in `keep` refers to. */
  write: (outDir: string, keep: Set<string>) => void;
}

export interface PreviousIcons {
  records: IconRecord[];
  /** The previous build's data directory, where its icon files are; null when it is remote. */
  dataDir: string | null;
}

export interface IconOptions {
  cacheDir: string;
  offline: boolean;
  enabled: boolean;
  policy: IconPolicyFile;
  log: (text: string) => void;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  /** For tests: every address a host resolves to (see `NetOptions.resolveHost`). */
  resolveHost?: (host: string) => Promise<string[]>;
  githubToken?: () => string | null;
  budgets?: NetBudgets;
  previous?: PreviousIcons | null;
}

export interface IconInput {
  app: App;
  index: IndexRecord[];
  target: DiscoveryTarget;
  /** The project the app belongs to, forks counted with the repository they were forked from; for telling a template from a shared icon. */
  project: string;
}

/** An icon chosen for an app, before its files are named. */
interface Chosen {
  list: Buffer;
  large: Buffer | null;
  record: IconRecord;
}

/** Projects that must share an image before it counts as a template rather than an icon. */
export const TEMPLATE_PROJECTS = 3;

/** A 16 × 16 color thumbnail on white, for telling identical images apart from merely similar ones; remembered per file in `cacheDir` when one is given. */
async function fingerprint(webp: Buffer, cacheDir: string | null): Promise<Buffer> {
  const path = cacheDir ? join(cacheDir, `print-v1-${sha256Hex(webp).slice(0, 32)}.raw`) : null;
  if (path && existsSync(path)) {
    const cached = readFileSync(path);
    if (cached.length === 16 * 16 * 3) return cached;
  }
  const print = await sharp(webp).flatten({ background: "#ffffff" }).resize(16, 16, { fit: "fill" }).removeAlpha().raw().toBuffer();
  if (path) writeFileSync(path, print);
  return print;
}

/** True when the mean difference per channel is at most 3; stops at the first byte that proves otherwise, which keeps the all-pairs comparison fast. */
function sameImage(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  const limit = 3 * a.length;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    if (total > limit) return false;
  }
  return true;
}

/**
 * Apps whose chosen image is, to the pixel, the same as that of apps from at
 * least `minProjects` different projects in all; with the default
 * `TEMPLATE_PROJECTS`, Android Studio's and Flutter's default launcher icons,
 * which say nothing about the app. Returns app id → the number of projects
 * sharing the image.
 */
export async function templateApps(chosen: ReadonlyMap<string, { list: Buffer }>, projectOf: (app: string) => string, cacheDir: string | null = null, minProjects = TEMPLATE_PROJECTS): Promise<Map<string, number>> {
  const ids = [...chosen.keys()].sort();
  const prints = await Promise.all(ids.map(async (id) => fingerprint(chosen.get(id)?.list ?? Buffer.alloc(0), cacheDir)));
  const parent = ids.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i] ?? i)));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = prints[i];
      const b = prints[j];
      if (a && b && root(i) !== root(j) && sameImage(a, b)) parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, string[]>();
  ids.forEach((id, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), id]));
  const result = new Map<string, number>();
  for (const members of groups.values()) {
    const projects = new Set(members.map(projectOf)).size;
    if (projects >= minProjects) for (const id of members) result.set(id, projects);
  }
  return result;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Git's blob id for these bytes. */
export function gitBlobId(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

export function matchesExpectation(bytes: Uint8Array, expect: IconCandidate["expect"]): boolean {
  if (!expect) return true;
  return expect.kind === "sha256" ? sha256Hex(bytes) === expect.value : gitBlobId(bytes) === expect.value;
}

async function pool<T>(items: readonly T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item !== undefined) await run(item);
      }
    }),
  );
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function emptyByRule(): Record<IconRule, number> {
  return Object.fromEntries(ICON_RULES.map((r) => [r, 0])) as Record<IconRule, number>;
}

const RULE_TEXT: Record<IconRule, string> = {
  "fdroid-index": "F-Droid's icon for the app",
  "izzy-index": "IzzyOnDroid's icon for the app",
  "repo-fastlane": "the fastlane icon in the project's repository",
  "repo-metadata": "the metadata icon in the project's repository",
  "repo-launcher": "the launcher icon in the project's repository",
  "readme-logo": "the logo in the project's README",
  "site-icon": "the icon the project's website declares",
  "store-listing": "the icon of the app's store listing",
  "forge-avatar": "the avatar of the project's own organization or repository",
};

export async function buildIcons(inputs: readonly IconInput[], options: IconOptions): Promise<IconResult> {
  const now = options.now ?? (() => new Date());
  const report: IconReport = {
    enabled: options.enabled,
    written: 0,
    byRule: emptyByRule(),
    missing: [],
    rejected: [],
    failed: [],
    denied: [],
    kept: [],
    discovery: { due: 0, byReason: { new: 0, changed: 0, rules: 0, miss: 0, rotation: 0 }, looked: 0, deferred: 0, errors: [], requests: { githubApi: 0, web: 0 }, rateLimited: [] },
    reduced: [],
  };
  const paths = new Map<string, string>();
  const largePaths = new Map<string, string>();
  const records = new Map<string, IconRecord>();
  const outputs = new Map<string, Buffer>();
  const result = (): IconResult => ({
    paths,
    largePaths,
    get records() {
      return [...records.values()].sort((a, b) => byText(a.app, b.app));
    },
    report,
    write: (outDir, keep) => {
      const dir = join(outDir, "icons");
      mkdirSync(dir, { recursive: true });
      const shipped = new Set([...paths.values(), ...largePaths.values()]);
      for (const [name, bytes] of outputs) {
        const target = join(dir, name);
        if (shipped.has(`icons/${name}`) && !existsSync(target)) writeFileSync(target, bytes);
      }
      for (const name of readdirSync(dir)) {
        if (ICON_NAME_RE.test(name) && !shipped.has(`icons/${name}`) && !keep.has(`icons/${name}`)) rmSync(join(dir, name), { force: true });
      }
    },
  });
  if (!options.enabled) {
    for (const { app } of inputs) report.missing.push({ app: app.id, name: app.name, reason: "icons disabled for this build" });
    return result();
  }

  const originals = join(options.cacheDir, "originals");
  const encodedDir = join(options.cacheDir, "encoded");
  mkdirSync(originals, { recursive: true });
  mkdirSync(encodedDir, { recursive: true });
  const cachePath = join(options.cacheDir, "discovery.json");
  const cache = readDiscoveryCache(cachePath);
  const net = new Net({
    fetchImpl: options.fetchImpl ?? fetch,
    ...(options.resolveHost ? { resolveHost: options.resolveHost } : {}),
    githubToken: options.githubToken ?? (() => null),
    budgets: options.budgets ?? DEFAULT_BUDGETS,
    log: options.log,
  });

  const indexed = new Map(inputs.map((input) => [input.app.id, indexCandidates(input.index)]));
  const due = inputs
    .filter((input) => !deniedApp(input.app, options.policy) && !indexed.get(input.app.id)?.length)
    .map((input) => ({ input, reason: dueReason(input.target, cache.entries[input.app.id], now()) }))
    .filter((x): x is { input: IconInput; reason: DueReason } => x.reason !== null);
  const order: DueReason[] = ["new", "changed", "rules", "miss", "rotation"];
  due.sort((a, b) => order.indexOf(a.reason) - order.indexOf(b.reason) || byText(a.input.app.id, b.input.app.id));
  report.discovery.due = due.length;
  for (const { reason } of due) report.discovery.byReason[reason]++;
  if (options.offline) {
    report.discovery.deferred = due.length;
  } else {
    let stopped = false;
    await pool(due, 6, async ({ input }) => {
      if (stopped) {
        report.discovery.deferred++;
        return;
      }
      const previous = cache.entries[input.app.id];
      try {
        const candidates = await discover(input.target, net);
        report.discovery.looked++;
        cache.entries[input.app.id] = {
          basis: basisOf(input.target),
          checkedAt: now().toISOString(),
          misses: candidates.length ? 0 : (previous?.misses ?? 0) + 1,
          rules: DISCOVERY_RULES,
          candidates,
        };
      } catch (error) {
        if (error instanceof RateLimited) {
          stopped = net.webLeft <= 0;
          report.discovery.deferred++;
          return;
        }
        report.discovery.errors.push({ app: input.app.id, error: error instanceof Error ? error.message : String(error) });
      }
    });
    writeDiscoveryCache(cachePath, cache);
  }

  const fetchOriginal = async (candidate: Pick<IconCandidate, "url" | "expect">): Promise<Uint8Array | null> => {
    const key = sha256Hex(new TextEncoder().encode(candidate.url)).slice(0, 32);
    const path = join(originals, key);
    if (existsSync(path)) {
      const bytes = readFileSync(path);
      if (matchesExpectation(bytes, candidate.expect)) return bytes;
    }
    if (options.offline) throw new Error("not in the cache and --offline");
    const got = await net.get(candidate.url, MAX_SOURCE_BYTES, "image/*,application/xml,text/xml");
    if (!got) return null;
    writeFileSync(path, got.bytes);
    writeFileSync(`${path}.retrieved`, now().toISOString());
    return got.bytes;
  };
  const retrievedOn = (candidate: IconCandidate): string => {
    const key = sha256Hex(new TextEncoder().encode(candidate.url)).slice(0, 32);
    const sidecar = join(originals, `${key}.retrieved`);
    return (existsSync(sidecar) ? readFileSync(sidecar, "utf8").trim() : now().toISOString()).slice(0, 10);
  };

  const refusedUrls = new Set<string>();
  const outcomes = new Map<string, string[]>();
  const note = (app: string, text: string): void => {
    outcomes.set(app, [...(outcomes.get(app) ?? []), text]);
  };

  const chosen = new Map<string, Chosen>();
  const select = async ({ app }: IconInput, skip: ReadonlySet<string>): Promise<void> => {
    const discovered = cache.entries[app.id]?.candidates ?? [];
    const candidates = [...(indexed.get(app.id) ?? []), ...reviewedCandidates(app.id, options.policy), ...discovered];
    for (const candidate of candidates) {
      if (skip.has(candidate.url)) continue;
      const veto = deniedSource(candidate, options.policy);
      if (veto) {
        note(app.id, `${candidate.rule} vetoed: ${veto}`);
        continue;
      }
      if (!fetchableUrl(candidate.url)) {
        report.rejected.push({ app: app.id, rule: candidate.rule, url: candidate.url, reason: "URL refused" });
        continue;
      }
      let bytes: Uint8Array | null;
      try {
        bytes = await fetchOriginal(candidate);
      } catch (error) {
        report.failed.push({ app: app.id, url: candidate.url, error: error instanceof Error ? error.message : String(error) });
        note(app.id, `${candidate.rule} could not be downloaded`);
        continue;
      }
      const refuse = (reason: string): void => {
        refusedUrls.add(candidate.url);
        report.rejected.push({ app: app.id, rule: candidate.rule, url: candidate.url, reason });
        note(app.id, `${candidate.rule} refused: ${reason}`);
      };
      if (!bytes) {
        refuse("not found at the source");
        continue;
      }
      if (!matchesExpectation(bytes, candidate.expect)) {
        refuse(`bytes do not match the ${candidate.expect?.kind === "sha256" ? "SHA-256 the index states" : "blob id the repository states"}`);
        continue;
      }
      const originalSha = sha256Hex(bytes);
      if (candidate.compose) {
        let composed: Buffer | null;
        try {
          composed = await composeFromParts(candidate.compose, fetchOriginal);
        } catch (error) {
          report.failed.push({ app: app.id, url: candidate.url, error: error instanceof Error ? error.message : String(error) });
          note(app.id, `${candidate.rule} could not be composed`);
          continue;
        }
        if (!composed) {
          refuse("the adaptive icon's layers could not be composed");
          continue;
        }
        bytes = composed;
      }
      const check = await cachedCheck(encodedDir, bytes, { minPx: candidate.minPx, allowSvg: candidate.allowSvg, squareTolerance: INDEX_RULES.has(candidate.rule) ? INDEX_SQUARE_TOLERANCE : undefined });
      if (!check.ok) {
        refuse(check.reason);
        continue;
      }
      const encoded = await cachedEncode(encodedDir, sha256Hex(bytes), bytes, check);
      for (const [size, quality] of [[ICON_PIXELS.list, encoded.quality.list], [ICON_PIXELS.large, encoded.quality.large]] as const) {
        if (quality !== null && quality !== 82) report.reduced.push({ app: app.id, size, quality });
      }
      const padded = check.width !== check.height;
      chosen.set(app.id, {
        list: encoded.list,
        large: encoded.large,
        record: {
          file: "",
          fileLarge: "",
          app: app.id,
          name: app.name,
          rule: candidate.rule,
          original: { url: candidate.url, sha256: originalSha },
          revision: candidate.revision,
          retrieved: retrievedOn(candidate),
          author: authorOf(app),
          license: app.license?.value ?? "not stated",
          project: app.repo?.url ?? app.website ?? null,
          changes: [
            candidate.compose ? `composed from the adaptive icon's layers (${candidate.compose.files.length} files at that commit), showing the 72 dp a launcher shows` : null,
            check.format === "svg" ? "rendered from SVG" : null,
            padded ? "padded to a square with transparency" : null,
            encoded.large ? `resized to ${ICON_PIXELS.list} and ${ICON_PIXELS.large} px WebP` : `resized to ${ICON_PIXELS.list} px WebP`,
            "metadata removed",
          ]
            .filter((part): part is string => part !== null)
            .join("; "),
        },
      });
      return;
    }
  };

  const skips = new Map<string, Set<string>>(inputs.map((input) => [input.app.id, new Set<string>()]));
  const eligible = inputs.filter(({ app }) => {
    const denied = deniedApp(app, options.policy);
    if (denied) report.denied.push({ app: app.id, reason: denied });
    return !denied;
  });
  await pool(eligible, 8, (input) => select(input, skips.get(input.app.id) ?? new Set()));
  const byId = new Map(inputs.map((input) => [input.app.id, input]));
  for (let round = 0; round < 3; round++) {
    const templates = await templateApps(chosen, (id) => byId.get(id)?.project ?? id, encodedDir);
    if (!templates.size) break;
    for (const [id, projects] of templates) {
      const pick = chosen.get(id);
      if (!pick) continue;
      const reason = `the same image as the icons of ${projects - 1} other projects: a template, not this app's own`;
      refusedUrls.add(pick.record.original.url);
      skips.get(id)?.add(pick.record.original.url);
      if (pick.record.rule === "repo-launcher") {
        // The other launcher candidates are the same resource at another density or as its round variant: the same template.
        for (const candidate of cache.entries[id]?.candidates ?? []) if (candidate.rule === "repo-launcher") skips.get(id)?.add(candidate.url);
      }
      report.rejected.push({ app: id, rule: pick.record.rule, url: pick.record.original.url, reason });
      note(id, `${pick.record.rule} refused: ${reason}`);
      chosen.delete(id);
    }
    await pool(eligible.filter((input) => templates.has(input.app.id)), 8, (input) => select(input, skips.get(input.app.id) ?? new Set()));
  }
  await preferOwnImages(chosen, byId, skips, select, encodedDir, report, note);
  for (const [id, pick] of chosen) {
    const listName = `${sha256Hex(pick.list).slice(0, 16)}.webp`;
    const largeName = pick.large ? `${sha256Hex(pick.large).slice(0, 16)}.webp` : listName;
    outputs.set(listName, pick.list);
    if (pick.large) outputs.set(largeName, pick.large);
    paths.set(id, `icons/${listName}`);
    largePaths.set(id, `icons/${largeName}`);
    records.set(id, { ...pick.record, file: `icons/${listName}`, fileLarge: `icons/${largeName}` });
  }

  const previous = new Map((options.previous?.records ?? []).map((r) => [r.app, r]));
  for (const { app } of inputs) {
    if (records.has(app.id) || deniedApp(app, options.policy)) continue;
    const before = previous.get(app.id);
    const dataDir = options.previous?.dataDir ?? null;
    if (before && dataDir && !refusedUrls.has(before.original.url) && !deniedSource({ rule: before.rule, url: before.original.url }, options.policy)) {
      const files = [before.file, before.fileLarge].map((file) => ({ file, path: join(dataDir, file) }));
      if (files.every(({ file, path }) => /^icons\/[0-9a-f]{16}\.webp$/.test(file) && existsSync(path) && sha256Hex(readFileSync(path)).startsWith(file.slice(6, 22)))) {
        for (const { file, path } of files) outputs.set(file.slice(6), readFileSync(path));
        paths.set(app.id, before.file);
        largePaths.set(app.id, before.fileLarge);
        records.set(app.id, { ...before, name: app.name, license: app.license?.value ?? "not stated", project: app.repo?.url ?? app.website ?? null });
        report.kept.push({ app: app.id, rule: before.rule });
      }
    }
  }

  for (const { app } of inputs) {
    const record = records.get(app.id);
    if (record) {
      report.byRule[record.rule]++;
      continue;
    }
    const denied = deniedApp(app, options.policy);
    report.missing.push({ app: app.id, name: app.name, reason: denied ? `denied: ${denied}` : missingReason(app, indexed.get(app.id) ?? [], cache.entries[app.id], outcomes.get(app.id) ?? []) });
  }
  report.written = records.size;
  report.discovery.requests = { ...net.used };
  report.discovery.rateLimited = [...net.limited].sort();
  report.missing.sort((a, b) => byText(a.app, b.app));
  report.rejected.sort((a, b) => byText(a.app, b.app) || byText(a.url, b.url));
  report.failed.sort((a, b) => byText(a.app, b.app) || byText(a.url, b.url));
  report.denied.sort((a, b) => byText(a.app, b.app));
  report.kept.sort((a, b) => byText(a.app, b.app));
  report.reduced.sort((a, b) => byText(a.app, b.app) || a.size - b.size);
  report.discovery.errors.sort((a, b) => byText(a.app, b.app));
  const failures = report.failed.length + report.discovery.errors.length;
  if (failures) options.log(`icons: ${report.failed.length} downloads and ${report.discovery.errors.length} lookups failed; the previous build's icons were kept where there were any`);
  return result();
}

/**
 * An image that an app of another project also shows is often not this app's
 * own: a copied metadata directory, a vendored project's files. For a pick
 * that is not an index icon (an index states its icon per package), the app's
 * remaining candidates are tried; the first whose image no other project shows
 * replaces the shared one. When there is none, the shared image stays: a fork
 * that kept its parent's art still shows what its own source states.
 */
async function preferOwnImages(
  chosen: Map<string, Chosen>,
  byId: ReadonlyMap<string, IconInput>,
  skips: Map<string, Set<string>>,
  select: (input: IconInput, skip: ReadonlySet<string>) => Promise<void>,
  cacheDir: string,
  report: IconReport,
  note: (app: string, text: string) => void,
): Promise<void> {
  const projectOfId = (id: string): string => byId.get(id)?.project ?? id;
  const shared = await templateApps(chosen, projectOfId, cacheDir, 2);
  const tried = new Map<string, Chosen>();
  for (const id of [...shared.keys()].sort()) {
    const pick = chosen.get(id);
    const input = byId.get(id);
    if (!pick || !input || INDEX_RULES.has(pick.record.rule)) continue;
    tried.set(id, pick);
    chosen.delete(id);
    await select(input, new Set([...(skips.get(id) ?? []), pick.record.original.url]));
  }
  if (!tried.size) return;
  const stillShared = await templateApps(chosen, projectOfId, cacheDir, 2);
  for (const [id, original] of tried) {
    const alternative = chosen.get(id);
    if (!alternative || stillShared.has(id)) {
      chosen.set(id, original);
      continue;
    }
    const reason = "the same image as another project's icon; the app's own icon was found among its other candidates";
    report.rejected.push({ app: id, rule: original.record.rule, url: original.record.original.url, reason });
    note(id, `${original.record.rule} set aside: ${reason}`);
  }
}

/** Composes an adaptive icon from its listed files, each fetched and checked against its blob id; null when it cannot be drawn. */
async function composeFromParts(
  compose: NonNullable<IconCandidate["compose"]>,
  fetchOriginal: (candidate: Pick<IconCandidate, "url" | "expect">) => Promise<Uint8Array | null>,
): Promise<Buffer | null> {
  const files = new Map(compose.files.filter((f) => safeRepoPath(f.path) && fetchableUrl(f.url) !== null).map((f) => [f.path, f]));
  const read = async (path: string): Promise<Uint8Array | null> => {
    const file = files.get(path);
    if (!file) return null;
    const bytes = await fetchOriginal({ url: file.url, expect: { kind: "git-blob", value: file.sha } });
    return bytes && matchesExpectation(bytes, { kind: "git-blob", value: file.sha }) ? bytes : null;
  };
  return composeAdaptiveIcon({ tree: [...files.values()], module: compose.module, read }, compose.type, compose.name, new Map());
}

function missingReason(app: App, index: IconCandidate[], entry: ReturnType<typeof readDiscoveryCache>["entries"][string] | undefined, outcomes: string[]): string {
  if (outcomes.length) return outcomes.join("; ");
  if (index.length) return "the index icon could not be used";
  if (!entry) return "not looked up yet";
  const looked = [
    app.repo?.host === "github" || app.repo?.host === "gitlab" || app.repo?.host === "codeberg" ? "repository files and README" : null,
    app.website ? "website" : null,
    app.channels.some((c) => c.type === "play") ? "store listing" : null,
  ].filter((x): x is string => x !== null);
  if (!looked.length) return app.repo ? `no icon source for a repository on ${app.repo.host === "other" ? new URL(app.repo.url).hostname : app.repo.host}, and no website or store listing` : "no index entry, repository, website or store listing to take an icon from";
  return `nothing found in the ${looked.join(", ")} (looked up ${entry.checkedAt.slice(0, 10)})`;
}

function authorOf(app: App): string {
  const indexAuthor = app.index.find((f) => f.author)?.author;
  if (indexAuthor) return indexAuthor;
  if (app.repo?.slug) return `the ${app.repo.slug} project`;
  return `the ${app.name} developers`;
}

/** `checkImage`, remembered per original and gate options: its result depends on nothing else, and decoding every original on every build is most of an offline build's time. */
async function cachedCheck(dir: string, bytes: Uint8Array, options: Parameters<typeof checkImage>[1]): Promise<Awaited<ReturnType<typeof checkImage>>> {
  const key = sha256Hex(new TextEncoder().encode(`${sha256Hex(bytes)} ${options.minPx} ${options.allowSvg} ${options.squareTolerance ?? "default"}`)).slice(0, 32);
  const path = join(dir, `check-v1-${key}.json`);
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Awaited<ReturnType<typeof checkImage>>;
    } catch {
      rmSync(path, { force: true });
    }
  }
  const check = await checkImage(bytes, options);
  writeFileSync(path, JSON.stringify(check));
  return check;
}

async function cachedEncode(dir: string, originalSha: string, bytes: Uint8Array, check: Parameters<typeof encodeIcon>[1]): Promise<Awaited<ReturnType<typeof encodeIcon>>> {
  const base = join(dir, `${originalSha}-v1`);
  const listPath = `${base}-${ICON_PIXELS.list}.webp`;
  const largePath = `${base}-${ICON_PIXELS.large}.webp`;
  const metaPath = `${base}.json`;
  if (existsSync(listPath) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { quality: { list: number; large: number | null } };
    const large = meta.quality.large !== null && existsSync(largePath) ? readFileSync(largePath) : null;
    if (meta.quality.large === null || large) return { list: readFileSync(listPath), large, quality: meta.quality };
  }
  const encoded = await encodeIcon(bytes, check);
  writeFileSync(listPath, encoded.list);
  if (encoded.large) writeFileSync(largePath, encoded.large);
  writeFileSync(metaPath, JSON.stringify({ quality: encoded.quality }));
  return encoded;
}

/** The text a report or credit uses for a rule. */
export function ruleText(rule: IconRule): string {
  return RULE_TEXT[rule];
}
