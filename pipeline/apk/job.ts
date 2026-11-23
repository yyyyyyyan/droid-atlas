/**
 * The package readings job: reads the package files of the catalog's apps
 * that no earlier run has read, keeps the readings in the store, and counts
 * what it did. It never touches the catalog.
 *
 * Which file an app is read from: its F-Droid package (the latest version the
 * F-Droid index lists); else, only with the IzzyOnDroid switch on, its
 * IzzyOnDroid package; else the APK `chooseApk` picks from its repository's
 * latest GitHub release. Apps whose openness facet is not "open-source" are
 * skipped unless the closed-source switch is on. Both switches are off by
 * default.
 *
 * An app keeps its last reading until a newer file of it is read. A reading
 * is dropped when its app is no longer one the job may read.
 */
import type { App, Catalog } from "../../schema/catalog.ts";
import type { PackageReading } from "../../schema/package-reading.ts";
import { latestFiles } from "../enrich/index-v2.ts";
import { chooseApk, type ReleaseAsset } from "./choose.ts";
import { packageHost } from "./http.ts";
import { Pacer, type Clock } from "./pace.ts";
import { PackageReadError, readPackage } from "./read.ts";
import { dropInvalid, readingKey, readingProblems, type FailureKind, type ReadingStore, type RecordKind } from "./store.ts";

export type SkipRule =
  | "not-an-app"
  | "not-open-source"
  | "izzy-off"
  | "izzy-no-host"
  | "no-index"
  | "no-package"
  | "already-read"
  | "failed-recently"
  | "no-apk-by-rule"
  | "over-cap"
  | "time-limit"
  | "api-unavailable";

export const SKIP_RULES: readonly SkipRule[] = [
  "not-an-app",
  "not-open-source",
  "izzy-off",
  "izzy-no-host",
  "no-index",
  "no-package",
  "already-read",
  "failed-recently",
  "no-apk-by-rule",
  "over-cap",
  "time-limit",
  "api-unavailable",
];

export const FAILURE_KINDS: readonly FailureKind[] = ["address", "http", "zip", "manifest", "unexpected", "release-lookup", "not-stored"];

export interface JobCounts {
  read: number;
  skipped: Record<SkipRule, number>;
  failed: Record<FailureKind, number>;
  /** Readings kept from earlier runs. */
  carriedOver: number;
  /** Readings and failure records removed, including those that failed the store's check when it was loaded. */
  dropped: number;
}

export interface JobInput {
  catalog: Catalog;
  /** The F-Droid `index-v2.json`, parsed, or null when there is none to read. */
  fdroidIndex: unknown;
  izzyIndex: unknown;
}

export interface JobOptions {
  /** Most packages to read or look up in one run. */
  cap: number;
  /** Read IzzyOnDroid packages. Off by default; the reader also has no IzzyOnDroid host rule. */
  izzy: boolean;
  /** Read apps whose openness is not stated as open source. Off by default. */
  closed: boolean;
  fetch: typeof fetch;
  githubToken: string | null;
  clock: Clock;
  /** Least time between the starts of two requests to one host. */
  intervalMs: number;
  /** No package is started after this long. */
  stopAfterMs: number;
  /** A package whose reading failed is not tried again for this long. */
  retryAfterMs: number;
  /** Called after every package, so a run cut short keeps what it read. */
  onProgress?: (store: ReadingStore) => void;
}

export const JOB_DEFAULTS = {
  cap: 200,
  izzy: false,
  closed: false,
  intervalMs: 1000,
  stopAfterMs: 40 * 60_000,
  retryAfterMs: 7 * 86_400_000,
} as const;

const FDROID_REPO = "https://f-droid.org/repo";
const IZZY_REPO = "https://apt.izzysoft.de/fdroid/repo";
const SLUG_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const DIGEST_RE = /^sha256:([0-9a-f]{64})$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const MAX_RELEASE_JSON = 4 * 1024 * 1024;
const LOOKUP_TIMEOUT_MS = 20_000;

type Lane = "fdroid" | "izzy" | "github";

type Work =
  | { lane: "fdroid" | "izzy"; app: string; owner: string; workKey: string; url: string; sha256: string }
  | { lane: "github"; app: string; owner: string; workKey: string; slug: string };

export interface Plan {
  work: Work[];
  skipped: Record<SkipRule, number>;
  /** Owners (`ownerOf`) of the apps the job may read. */
  owners: Set<string>;
  /** Reading keys known to be an app's current file. */
  current: Set<string>;
}

function zeroSkips(): Record<SkipRule, number> {
  return Object.fromEntries(SKIP_RULES.map((rule) => [rule, 0])) as Record<SkipRule, number>;
}

function zeroFailures(): Record<FailureKind, number> {
  return Object.fromEntries(FAILURE_KINDS.map((kind) => [kind, 0])) as Record<FailureKind, number>;
}

/** The repository `owner/name` and tag of a GitHub release download address. A tag may span several segments. */
function releaseOf(url: string): { slug: string; tag: string } | null {
  const parts = new URL(url).pathname.split("/");
  if (parts.length < 7 || parts[3] !== "releases" || parts[4] !== "download") return null;
  try {
    return { slug: `${parts[1]}/${parts[2]}`.toLowerCase(), tag: parts.slice(5, -1).map(decodeURIComponent).join("/") };
  } catch {
    return null;
  }
}

/** Which app a reading belongs to: a repository package id per index, a repository for GitHub. */
export function ownerOf(reading: PackageReading): string {
  if (reading.source.host === "github") return `github:${releaseOf(reading.source.url)?.slug ?? ""}`;
  return `${reading.source.host}:${reading.package}`;
}

/** The kind of a record of `key` made within `retryAfterMs`, or null. */
function recentRecord(store: ReadingStore, key: string, now: number, retryAfterMs: number): RecordKind | null {
  const failure = store.failures[key];
  return failure !== undefined && now - Date.parse(failure.at) < retryAfterMs ? failure.kind : null;
}

function githubSlug(app: App): string | null {
  const slug = app.repo?.host === "github" ? (app.github?.movedTo ?? app.repo.slug) : null;
  return slug && SLUG_RE.test(slug) && slug.split("/").every((part) => part !== "." && part !== "..") ? slug.toLowerCase() : null;
}

/** Decides, for every app, what is read and which rule skips the rest. Makes no request. */
export function plan(input: JobInput, store: ReadingStore, options: Pick<JobOptions, "cap" | "izzy" | "closed" | "retryAfterMs">, now: number): Plan {
  const skipped = zeroSkips();
  const owners = new Set<string>();
  const current = new Set<string>();
  const candidates: Work[] = [];
  const apps = [...input.catalog.apps].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pkgsOf = (origin: "fdroid" | "izzy"): string[] => apps.flatMap((app) => app.index.filter((i) => i.origin === origin).map((i) => i.pkg));
  const fdroidFiles = input.fdroidIndex ? latestFiles(input.fdroidIndex, pkgsOf("fdroid")) : null;
  const izzyFiles = options.izzy && input.izzyIndex ? latestFiles(input.izzyIndex, pkgsOf("izzy")) : null;
  const readByRelease = new Map<string, string>();
  for (const [key, reading] of Object.entries(store.readings)) {
    if (reading.source.host !== "github") continue;
    const release = releaseOf(reading.source.url);
    if (release) readByRelease.set(`${release.slug}@${release.tag}`, key);
  }

  const fromIndex = (app: App, lane: "fdroid" | "izzy", files: Map<string, { name: string; sha256: string }> | null): void => {
    const pkg = app.index.find((i) => i.origin === lane)?.pkg as string;
    const owner = `${lane}:${pkg}`;
    owners.add(owner);
    if (!files) {
      skipped["no-index"]++;
      return;
    }
    const file = files.get(pkg);
    if (!file) {
      skipped["no-package"]++;
      return;
    }
    const url = `${lane === "fdroid" ? FDROID_REPO : IZZY_REPO}${file.name}`;
    if (!packageHost(url)) {
      skipped[lane === "izzy" ? "izzy-no-host" : "no-package"]++;
      return;
    }
    const key = readingKey({ sha256: file.sha256, url: "", size: 0 });
    current.add(key);
    if (store.readings[key]) skipped["already-read"]++;
    else if (recentRecord(store, key, now, options.retryAfterMs)) skipped["failed-recently"]++;
    else candidates.push({ lane, app: app.id, owner, workKey: key, url, sha256: file.sha256 });
  };

  for (const app of apps) {
    if (app.listings.every((listing) => listing.kind === "resource")) {
      skipped["not-an-app"]++;
      continue;
    }
    if (!options.closed && app.facets.openness !== "open-source") {
      skipped["not-open-source"]++;
      continue;
    }
    const onFdroid = app.index.some((i) => i.origin === "fdroid");
    const onIzzy = app.index.some((i) => i.origin === "izzy");
    const slug = githubSlug(app);
    const release = app.github?.release;
    if (onFdroid) {
      fromIndex(app, "fdroid", fdroidFiles);
    } else if (onIzzy && options.izzy) {
      fromIndex(app, "izzy", izzyFiles);
    } else if (slug && release?.hasApk) {
      const owner = `github:${slug}`;
      owners.add(owner);
      const workKey = `github:${slug}@${encodeURIComponent(release.tag)}`;
      const done = readByRelease.get(`${slug}@${release.tag}`);
      if (done) {
        current.add(done);
        skipped["already-read"]++;
      } else if (recentRecord(store, workKey, now, options.retryAfterMs) === "no-apk") {
        skipped["no-apk-by-rule"]++;
      } else if (recentRecord(store, workKey, now, options.retryAfterMs)) {
        skipped["failed-recently"]++;
      } else {
        candidates.push({ lane: "github", app: app.id, owner, workKey, slug });
      }
    } else if (onIzzy) {
      skipped["izzy-off"]++;
    } else {
      skipped["no-package"]++;
    }
  }
  skipped["over-cap"] += Math.max(0, candidates.length - options.cap);
  return { work: candidates.slice(0, Math.max(0, options.cap)), skipped, owners, current };
}

async function boundedText(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new LookupError(false);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** A release lookup that failed; `temporary` when trying again later may succeed (rate limits, server errors, the network). */
export class LookupError extends Error {
  readonly temporary: boolean;
  constructor(temporary: boolean) {
    super(temporary ? "release lookup failed for now" : "release lookup failed");
    this.temporary = temporary;
  }
}

/** The latest release's assets as GitHub's REST API lists them; throws a `LookupError` when the answer is not as expected. */
export async function latestReleaseAssets(slug: string, fetchFn: typeof fetch, token: string | null): Promise<ReleaseAsset[]> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "droid-atlas-pipeline" };
  if (token) headers["authorization"] = `bearer ${token}`;
  let response: Response;
  try {
    response = await fetchFn(`https://api.github.com/repos/${slug}/releases/latest`, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
  } catch {
    throw new LookupError(true);
  }
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    throw new LookupError(response.status === 403 || response.status === 429 || response.status >= 500);
  }
  try {
    return parseAssets(await boundedText(response, MAX_RELEASE_JSON));
  } catch (error) {
    if (error instanceof LookupError) throw error;
    throw new LookupError(!(error instanceof SyntaxError));
  }
}

function parseAssets(text: string): ReleaseAsset[] {
  const json: unknown = JSON.parse(text);
  const assets = typeof json === "object" && json !== null ? (json as Record<string, unknown>)["assets"] : null;
  if (!Array.isArray(assets)) throw new LookupError(false);
  return assets.flatMap((raw): ReleaseAsset[] => {
    if (typeof raw !== "object" || raw === null) return [];
    const asset = raw as Record<string, unknown>;
    const { name, size, browser_download_url: url, digest, updated_at: updatedAt } = asset;
    if (typeof name !== "string" || typeof url !== "string" || typeof updatedAt !== "string" || !ISO_RE.test(updatedAt)) return [];
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return [];
    const sha256 = typeof digest === "string" ? (DIGEST_RE.exec(digest)?.[1] ?? null) : null;
    return [{ name, size, url, sha256, updatedAt }];
  });
}

/** Keeps, per app, the readings of its current files, or else its newest reading; drops readings of apps the job may not read. */
function prune(store: ReadingStore, owners: Set<string>, current: Set<string>, now: number, retryAfterMs: number): number {
  let dropped = 0;
  const byOwner = new Map<string, [string, PackageReading][]>();
  for (const [key, reading] of Object.entries(store.readings)) {
    const owner = ownerOf(reading);
    if (!owners.has(owner)) {
      delete store.readings[key];
      dropped++;
      continue;
    }
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), [key, reading]]);
  }
  for (const entries of byOwner.values()) {
    const currentOnes = entries.filter(([key]) => current.has(key));
    const keep = currentOnes.length
      ? new Set(currentOnes.map(([key]) => key))
      : new Set([entries.reduce((a, b) => (Date.parse(b[1].readAt) > Date.parse(a[1].readAt) ? b : a))[0]]);
    for (const [key] of entries) {
      if (!keep.has(key)) {
        delete store.readings[key];
        dropped++;
      }
    }
  }
  for (const [key, failure] of Object.entries(store.failures)) {
    if (now - Date.parse(failure.at) >= retryAfterMs) {
      delete store.failures[key];
      dropped++;
    }
  }
  return dropped;
}

/** Runs the job over `store`, changing it in place, and returns the counts. */
export async function runJob(input: JobInput, store: ReadingStore, options: JobOptions): Promise<JobCounts> {
  const started = options.clock.now();
  const before = new Set(Object.keys(store.readings));
  const { work, skipped, owners, current } = plan(input, store, options, started);
  const failed = zeroFailures();
  let read = 0;
  const pacer = new Pacer(options.intervalMs, options.clock);
  const paced = pacer.fetch(options.fetch);
  const at = (): string => new Date(options.clock.now()).toISOString();

  const fail = (workKey: string, kind: FailureKind): void => {
    store.failures[workKey] = { at: at(), kind };
    failed[kind]++;
  };
  const record = (reading: PackageReading, key: string, workKey: string): void => {
    if (readingProblems(key, reading).length) return fail(workKey, "not-stored");
    store.readings[key] = reading;
    current.add(key);
    delete store.failures[workKey];
    read++;
  };
  const attempt = async (address: string, sha256: string | null, workKey: string): Promise<PackageReading | null> => {
    try {
      return await readPackage(address, { sha256, fetch: paced, now: () => new Date(options.clock.now()) });
    } catch (error) {
      fail(workKey, error instanceof PackageReadError ? error.stage : "unexpected");
      return null;
    }
  };
  const progress = (): void => {
    if (!options.onProgress) return;
    try {
      options.onProgress(store);
    } catch {
      failed["not-stored"] += dropInvalid(store, options.clock.now());
      options.onProgress(store);
    }
  };

  let githubUnavailable = false;
  const one = async (item: Work): Promise<void> => {
    if (item.lane !== "github") {
      const reading = await attempt(item.url, item.sha256, item.workKey);
      if (reading) record(reading, item.workKey, item.workKey);
      return;
    }
    if (githubUnavailable) {
      skipped["api-unavailable"]++;
      return;
    }
    let assets: ReleaseAsset[];
    try {
      assets = await latestReleaseAssets(item.slug, paced, options.githubToken);
    } catch (error) {
      if (error instanceof LookupError && error.temporary) {
        githubUnavailable = true;
        skipped["api-unavailable"]++;
        return;
      }
      return fail(item.workKey, "release-lookup");
    }
    const chosen = chooseApk(assets);
    if (!chosen) {
      store.failures[item.workKey] = { at: at(), kind: "no-apk" };
      skipped["no-apk-by-rule"]++;
      return;
    }
    const key = readingKey({ sha256: chosen.sha256, url: chosen.url, size: chosen.size, updatedAt: chosen.updatedAt });
    if (store.readings[key]) {
      current.add(key);
      skipped["already-read"]++;
      return;
    }
    const reading = await attempt(chosen.url, chosen.sha256, item.workKey);
    if (!reading) return;
    if (reading.file.sizeBytes !== chosen.size) return fail(item.workKey, "http");
    record(reading, key, item.workKey);
  };

  const lanes = new Map<Lane, Work[]>();
  for (const item of work) lanes.set(item.lane, [...(lanes.get(item.lane) ?? []), item]);
  await Promise.all(
    [...lanes.values()].map(async (items) => {
      for (const item of items) {
        if (options.clock.now() - started >= options.stopAfterMs) {
          skipped["time-limit"]++;
          continue;
        }
        await one(item);
        progress();
      }
    }),
  );

  const dropped = prune(store, owners, current, options.clock.now(), options.retryAfterMs);
  const carriedOver = Object.keys(store.readings).filter((key) => before.has(key)).length;
  return { read, skipped, failed, carriedOver, dropped };
}

/** The run's summary: counts only, never a package's name or interfaces. */
export function summary(counts: JobCounts, storeStatus: string): string {
  const rows: [string, number][] = [
    ["Read", counts.read],
    ...SKIP_RULES.map((rule): [string, number] => [`Skipped: ${rule}`, counts.skipped[rule]]),
    ...FAILURE_KINDS.map((kind): [string, number] => [`Failed: ${kind}`, counts.failed[kind]]),
    ["Carried over", counts.carriedOver],
    ["Dropped", counts.dropped],
  ];
  return [`## Package readings`, "", `Store at start: ${storeStatus}`, "", "| | Count |", "|---|---|", ...rows.map(([name, n]) => `| ${name} | ${n} |`), ""].join("\n");
}
