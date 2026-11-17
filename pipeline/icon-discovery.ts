/**
 * Finds icon candidates for apps no repository index gives an icon, in the
 * order of LICENSING.md §1.3: the project's repository (fastlane and
 * metadata icons, then launcher icons), the README's logo, the project's
 * website or its store listing, then a forge avatar that is the project's
 * own. Results are cached per app (`DiscoveryCache`) so a daily build looks
 * up only what is new, due again, or in its rotating slice.
 *
 * Every request goes through `Net`, which enforces the per-run budgets, stops
 * asking a host that rate-limits, and refuses any URL `fetchableUrl` refuses,
 * on every redirect hop.
 */
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IconRule } from "../schema/parts.ts";
import { MAX_SOURCE_BYTES, MIN_SOURCE_PX } from "./icon-image.ts";
import {
  attribute,
  encodePath,
  fastlaneIcons,
  fetchableUrl,
  launcherIcons,
  manifestIcons,
  manifestPaths,
  metadataIcons,
  modulesOf,
  nameKey,
  privateAddress,
  pageIcons,
  playIcon,
  readManifest,
  readmeImages,
  readmeLogo,
  readmePath,
  safeRepoPath,
  type ManifestIcon,
  type TreeEntry,
} from "./icon-sources.ts";
import { composeAdaptiveIcon, findResource } from "./android-icon.ts";
import { sharedSite } from "./forge.ts";

/** One file that may be the app's icon, with what the source states about it. */
export interface IconCandidate {
  rule: IconRule;
  url: string;
  /** Hash the source states for the bytes: an index's SHA-256 or a forge's git blob id. */
  expect: { kind: "sha256" | "git-blob"; value: string } | null;
  /** Commit the file was read at, or the index's timestamp. */
  revision: string | null;
  allowSvg: boolean;
  /** Smallest accepted short side; index icons are taken at whatever size the index has. */
  minPx: number;
  /**
   * For an adaptive icon the repository has only as XML: the resource and
   * every file composing it read, each fetched from its URL and checked
   * against its blob id. `url` is then the adaptive icon's own file.
   */
  compose?: { module: string; type: "mipmap" | "drawable"; name: string; files: (TreeEntry & { url: string })[] };
}

/** What one app's last lookup found. */
export interface DiscoveryEntry {
  /** The inputs the lookup used (repository, website, store package); a change makes the entry due. */
  basis: string;
  checkedAt: string;
  /** Consecutive lookups that found no candidate. */
  misses: number;
  /** `DISCOVERY_RULES` when the lookup ran; absent for entries written before rules were versioned. */
  rules?: number;
  candidates: IconCandidate[];
}

/**
 * Version of the rules that read candidates out of repositories, pages and
 * listings. Raised when a rule changes what a lookup finds, so that every app
 * last looked up under older rules is looked up again (reason `rules`) instead
 * of after its back-off or in its rotation slot. A daily run with the usual
 * budget catches up over a few runs, keeping the cached entries meanwhile.
 */
export const DISCOVERY_RULES = 4;

export interface DiscoveryCache {
  version: 3;
  entries: Record<string, DiscoveryEntry>;
}

const CACHE_VERSION = 3;

export function readDiscoveryCache(path: string): DiscoveryCache {
  if (!existsSync(path)) return { version: CACHE_VERSION, entries: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DiscoveryCache>;
    if (parsed.version !== CACHE_VERSION || !parsed.entries || typeof parsed.entries !== "object") return { version: CACHE_VERSION, entries: {} };
    return { version: CACHE_VERSION, entries: parsed.entries };
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
}

export function writeDiscoveryCache(path: string, cache: DiscoveryCache): void {
  const entries = Object.fromEntries(Object.entries(cache.entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(path, JSON.stringify({ version: CACHE_VERSION, entries }));
}

/** An app as discovery sees it. */
export interface DiscoveryTarget {
  app: string;
  name: string;
  github: { slug: string; head: string | null; owner: { login: string; organization: boolean; avatarUrl: string | null } } | null;
  gitlab: string | null;
  codeberg: string | null;
  website: string | null;
  /** Package id of a Google Play listing a source links. */
  play: string | null;
}

export function basisOf(target: DiscoveryTarget): string {
  return JSON.stringify([target.github?.slug.toLowerCase() ?? null, target.gitlab, target.codeberg, target.website, target.play]);
}

/** Days a miss waits before it is looked up again: 7, 14, 28, then 56. */
export function missBackoffDays(misses: number): number {
  return 7 * 2 ** Math.min(3, Math.max(0, misses - 1));
}

/** Days in the rotation: an app with candidates is looked up again about once in this many days. */
export const ROTATION_DAYS = 28;

function rotationSlot(app: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < app.length; i++) hash = Math.imul(hash ^ app.charCodeAt(i), 0x01000193);
  return (hash >>> 0) % ROTATION_DAYS;
}

export type DueReason = "new" | "changed" | "rules" | "miss" | "rotation";

/** Why the app's lookup is due on `now`, or null when its cached entry stands. */
export function dueReason(target: DiscoveryTarget, entry: DiscoveryEntry | undefined, now: Date): DueReason | null {
  if (!entry) return "new";
  if (entry.basis !== basisOf(target)) return "changed";
  const days = (now.getTime() - Date.parse(entry.checkedAt)) / 86_400_000;
  if ((entry.rules ?? 1) < DISCOVERY_RULES) return "rules";
  if (!entry.candidates.length) return days >= missBackoffDays(entry.misses) ? "miss" : null;
  const day = Math.floor(now.getTime() / 86_400_000);
  return days >= 1 && day % ROTATION_DAYS === rotationSlot(target.app) ? "rotation" : null;
}

export class RateLimited extends Error {}

export interface NetBudgets {
  /** GitHub REST API requests (the workflow token allows about 1,000 an hour). */
  githubApi: number;
  /** Every other request: raw files, other forges' APIs, web pages, store listings. */
  web: number;
}

export interface NetOptions {
  fetchImpl: typeof fetch;
  githubToken: () => string | null;
  budgets: NetBudgets;
  log: (text: string) => void;
  /** Every address a host name resolves to; `dns.lookup` unless a test supplies one. */
  resolveHost?: (host: string) => Promise<string[]>;
  /** Wait before the one retry after a 429 that names no `Retry-After`; 5 s unless a test sets it. */
  retryDelayMs?: number;
}

/** Milliseconds to wait after a 429: the `Retry-After` seconds when given and at most 30, else `fallback`. */
export function retryAfterMs(header: string | null, fallback: number): number {
  const seconds = header !== null && /^\d{1,4}$/.test(header.trim()) ? Number(header.trim()) : null;
  return seconds !== null && seconds <= 30 ? seconds * 1000 : fallback;
}

async function lookupAll(host: string): Promise<string[]> {
  return (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
}

const USER_AGENT = "droid-atlas-pipeline";
const MAX_REDIRECTS = 4;
/** Milliseconds between requests to hosts that rate-limit bursts from one address. */
const HOST_SPACING: Record<string, number> = { "gitlab.com": 400, "codeberg.org": 250 };

/** Every request discovery and the image stage make, counted against the run's budgets. */
export class Net {
  readonly used = { githubApi: 0, web: 0 };
  /** Hosts that answered with a rate limit this run; nothing more is asked of them. */
  readonly limited = new Set<string>();
  private readonly options: NetOptions;
  private readonly nextSlot = new Map<string, number>();
  /** Per host: null when every address it resolves to is public, else why it is refused. */
  private readonly hostChecks = new Map<string, Promise<string | null>>();

  constructor(options: NetOptions) {
    this.options = options;
  }

  /**
   * Refuses a host that resolves to any private, loopback, link-local or
   * otherwise internal address, so a README or page cannot point the build at
   * the runner's own network through a public name. The connection itself
   * resolves again, so a name that answers differently between the two
   * lookups is not caught; that needs a pinned connection.
   */
  private async publicHost(host: string): Promise<void> {
    const name = host.toLowerCase().replace(/\.$/, "");
    let check = this.hostChecks.get(name);
    if (!check) {
      check = (this.options.resolveHost ?? lookupAll)(name).then(
        (addresses) => (addresses.length === 0 ? "resolves to nothing" : addresses.some(privateAddress) ? `resolves to an internal address (${addresses.find(privateAddress)})` : null),
        (error: unknown) => `does not resolve: ${error instanceof Error ? error.message.slice(0, 80) : String(error)}`,
      );
      this.hostChecks.set(name, check);
    }
    const refusal = await check;
    if (refusal) throw new Error(`${name} ${refusal}`);
  }

  /** Requests left in the web budget. */
  get webLeft(): number {
    return this.options.budgets.web - this.used.web;
  }

  get githubApiLeft(): number {
    return this.options.budgets.githubApi - this.used.githubApi;
  }

  /** Waits for the host's next free slot when the host is one that needs spacing. */
  private async spaced(host: string): Promise<void> {
    const spacing = HOST_SPACING[host];
    if (!spacing) return;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(host) ?? 0);
    this.nextSlot.set(host, slot + spacing);
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  }

  /** A GitHub REST API GET; null on 404 or 409 (empty repository). */
  async githubApi(path: string): Promise<unknown> {
    if (this.limited.has("api.github.com")) throw new RateLimited("api.github.com rate-limited earlier in this run");
    if (this.githubApiLeft <= 0) throw new RateLimited("GitHub API budget for this run is spent");
    this.used.githubApi++;
    const token = this.options.githubToken();
    const response = await this.options.fetchImpl(`https://api.github.com${path}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": USER_AGENT, ...(token ? { authorization: `bearer ${token}` } : {}) },
      redirect: "error",
    });
    if (response.status === 404 || response.status === 409) return null;
    if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
      this.limited.add("api.github.com");
      throw new RateLimited(`GitHub API: HTTP ${response.status}`);
    }
    if (!response.ok) throw new Error(`GitHub API ${path}: HTTP ${response.status}`);
    return response.json();
  }

  /** GET of a public URL, following redirects only to URLs that may be fetched; null on 404 or 410. */
  async get(raw: string, maxBytes: number, accept = "*/*"): Promise<{ bytes: Uint8Array; url: string; type: string } | null> {
    const first = fetchableUrl(raw);
    if (!first) throw new Error(`refused URL ${raw.slice(0, 120)}`);
    let url: URL = first;
    let waited = false;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (this.limited.has(url.hostname)) throw new RateLimited(`${url.hostname} rate-limited earlier in this run`);
      if (this.webLeft <= 0) throw new RateLimited("request budget for this run is spent");
      this.used.web++;
      await this.publicHost(url.hostname);
      await this.spaced(url.hostname);
      const response = await this.options.fetchImpl(url.href, { headers: { accept, "user-agent": USER_AGENT, "accept-language": "en" }, redirect: "manual" });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        const target: URL | null = next ? fetchableUrl(next, url.href) : null;
        if (!target) throw new Error(`${url.href}: redirect to a refused URL`);
        url = target;
        continue;
      }
      if (response.status === 404 || response.status === 410) return null;
      if (response.status === 429 && !waited) {
        waited = true;
        hop--;
        await new Promise((resolve) => setTimeout(resolve, retryAfterMs(response.headers.get("retry-after"), this.options.retryDelayMs ?? 5000)));
        continue;
      }
      if (response.status === 429 || (response.status === 403 && url.hostname.endsWith("githubusercontent.com"))) {
        this.limited.add(url.hostname);
        throw new RateLimited(`${url.hostname}: HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(`${url.href}: HTTP ${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maxBytes) throw new Error(`${url.href}: ${declared} bytes is too large`);
      const bytes = await readLimited(response, maxBytes, url.href);
      return { bytes, url: url.href, type: response.headers.get("content-type") ?? "" };
    }
    throw new Error(`${raw}: too many redirects`);
  }

  async text(raw: string, maxBytes: number): Promise<string | null> {
    const got = await this.get(raw, maxBytes, "text/html,application/json,text/plain;q=0.9,*/*;q=0.5");
    return got ? new TextDecoder("utf-8", { fatal: false }).decode(got.bytes) : null;
  }
}

async function readLimited(response: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`${url}: more than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

const TEXT_LIMIT = 1024 * 1024;
const PAGE_LIMIT = 2 * 1024 * 1024;
const FORGE_SOFTWARE = /\b(GitLab|Gitea|Forgejo|Codeberg|GitHub|SourceForge|Gogs|cgit|Phabricator)\b/i;

/** True when a page says it is served by forge software, whose icon is the software's, not the project's. */
export function forgePage(html: string): boolean {
  for (const m of html.slice(0, 200_000).matchAll(/<meta\b[^>]{0,1000}>/gi)) {
    const tag = m[0];
    const key = (attribute(tag, "property") ?? attribute(tag, "name") ?? "").toLowerCase();
    if (["og:site_name", "application-name", "generator"].includes(key) && FORGE_SOFTWARE.test(attribute(tag, "content") ?? "")) return true;
  }
  return false;
}

interface Forge {
  label: string;
  /** Raw-content URL of a path at the commit. */
  raw: (path: string) => string;
  head: string;
  tree: TreeEntry[];
  avatar: { url: string; rule: IconRule } | null;
}

/** Looks up one app. Throws `RateLimited` when a budget or a host stops it; the caller then keeps the old entry. */
export async function discover(target: DiscoveryTarget, net: Net): Promise<IconCandidate[]> {
  const candidates: IconCandidate[] = [];
  const forge = await openForge(target, net);
  if (forge) candidates.push(...(await forgeCandidates(forge, net)));
  const hasRepoFile = candidates.some((c) => c.rule === "repo-fastlane" || c.rule === "repo-metadata" || c.rule === "repo-launcher");
  if (!hasRepoFile && target.website) candidates.push(...(await siteCandidates(target.website, net)));
  if (!hasRepoFile && target.play) {
    const icon = await playListingIcon(target.play, net);
    if (icon) candidates.push({ rule: "store-listing", url: icon, expect: null, revision: null, allowSvg: false, minPx: MIN_SOURCE_PX });
  }
  if (forge?.avatar) candidates.push({ rule: forge.avatar.rule, url: forge.avatar.url, expect: null, revision: null, allowSvg: false, minPx: MIN_SOURCE_PX });
  const seen = new Set<string>();
  return candidates.filter((c) => !seen.has(c.url) && seen.add(c.url)).slice(0, 8);
}

async function openForge(target: DiscoveryTarget, net: Net): Promise<Forge | null> {
  if (target.github?.head) return openGithub(target.github, target.name, net);
  if (target.gitlab) return openGitlab(target.gitlab, target.name, net);
  if (target.codeberg) return openCodeberg(target.codeberg, target.name, net);
  return null;
}

function blobs(list: unknown, pathKey: string, shaKey: string, typeKey: string, blobType: string): TreeEntry[] {
  if (!Array.isArray(list)) return [];
  const entries: TreeEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const path = record[pathKey];
    const sha = record[shaKey];
    if (record[typeKey] !== blobType || typeof path !== "string" || typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha) || !safeRepoPath(path)) continue;
    entries.push({ path, sha });
  }
  return entries;
}

const SLUG_RE = /^[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+$/;

async function openGithub(github: NonNullable<DiscoveryTarget["github"]>, name: string, net: Net): Promise<Forge | null> {
  if (!SLUG_RE.test(github.slug) || !github.head) return null;
  const [owner = "", repo = ""] = github.slug.split("/");
  const tree = (await net.githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${github.head}?recursive=1`)) as { tree?: unknown } | null;
  const ownerIsProject = github.owner.organization && nameKey(github.owner.login) !== "" && nameKey(github.owner.login) === nameKey(name);
  return {
    label: `github.com/${github.slug}`,
    raw: (path) => `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${github.head}/${encodePath(path)}`,
    head: github.head,
    tree: blobs(tree?.tree, "path", "sha", "type", "blob"),
    avatar: ownerIsProject && github.owner.avatarUrl ? { url: github.owner.avatarUrl, rule: "forge-avatar" } : null,
  };
}

async function forgeJson(net: Net, url: string): Promise<unknown> {
  const text = await net.text(url, 8 * 1024 * 1024);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url}: not JSON`);
  }
}

async function openGitlab(slug: string, name: string, net: Net): Promise<Forge | null> {
  if (!SLUG_RE.test(slug)) return null;
  const api = `https://gitlab.com/api/v4/projects/${encodeURIComponent(slug)}`;
  const project = (await forgeJson(net, api)) as { default_branch?: unknown; avatar_url?: unknown; name?: unknown } | null;
  const branch = typeof project?.default_branch === "string" ? project.default_branch : null;
  if (!branch) return null;
  const commit = (await forgeJson(net, `${api}/repository/commits/${encodeURIComponent(branch)}`)) as { id?: unknown } | null;
  const head = typeof commit?.id === "string" && /^[0-9a-f]{40}$/.test(commit.id) ? commit.id : null;
  if (!head) return null;
  const tree: TreeEntry[] = [];
  for (let page = 1; page <= 10; page++) {
    const list = await forgeJson(net, `${api}/repository/tree?recursive=true&per_page=100&page=${page}&ref=${head}`);
    const entries = blobs(list, "path", "id", "type", "blob");
    tree.push(...entries);
    if (!Array.isArray(list) || list.length < 100) break;
  }
  const avatar = typeof project?.avatar_url === "string" ? fetchableUrl(project.avatar_url) : null;
  return {
    label: `gitlab.com/${slug}`,
    raw: (path) => `${api}/repository/files/${encodeURIComponent(path)}/raw?ref=${head}`,
    head,
    tree,
    avatar: avatar && nameKey(String(project?.name ?? "")) === nameKey(name) ? { url: avatar.href, rule: "forge-avatar" } : null,
  };
}

async function openCodeberg(slug: string, name: string, net: Net): Promise<Forge | null> {
  if (!SLUG_RE.test(slug)) return null;
  const path = slug.split("/").map(encodeURIComponent).join("/");
  const api = `https://codeberg.org/api/v1/repos/${path}`;
  const repo = (await forgeJson(net, api)) as { default_branch?: unknown; avatar_url?: unknown; name?: unknown } | null;
  const branch = typeof repo?.default_branch === "string" ? repo.default_branch : null;
  if (!branch) return null;
  const info = (await forgeJson(net, `${api}/branches/${encodeURIComponent(branch)}`)) as { commit?: { id?: unknown } } | null;
  const head = typeof info?.commit?.id === "string" && /^[0-9a-f]{40}$/.test(info.commit.id) ? info.commit.id : null;
  if (!head) return null;
  const tree: TreeEntry[] = [];
  for (let page = 1; page <= 10; page++) {
    const list = (await forgeJson(net, `${api}/git/trees/${head}?recursive=true&per_page=1000&page=${page}`)) as { tree?: unknown; truncated?: unknown } | null;
    tree.push(...blobs(list?.tree, "path", "sha", "type", "blob"));
    if (!list || list.truncated !== true) break;
  }
  const avatar = typeof repo?.avatar_url === "string" && repo.avatar_url ? fetchableUrl(repo.avatar_url) : null;
  return {
    label: `codeberg.org/${slug}`,
    raw: (file) => `https://codeberg.org/${path}/raw/commit/${head}/${encodePath(file)}`,
    head,
    tree,
    avatar: avatar && nameKey(String(repo?.name ?? "")) === nameKey(name) ? { url: avatar.href, rule: "forge-avatar" } : null,
  };
}

async function forgeCandidates(forge: Forge, net: Net): Promise<IconCandidate[]> {
  const fromTree = (entry: TreeEntry, rule: IconRule): IconCandidate => ({
    rule,
    url: forge.raw(entry.path),
    expect: { kind: "git-blob", value: entry.sha },
    revision: forge.head,
    allowSvg: false,
    minPx: MIN_SOURCE_PX,
  });
  const read: ManifestIcon[] = [];
  for (const path of manifestPaths(forge.tree)) {
    const text = await optional(net.text(forge.raw(path), TEXT_LIMIT));
    if (text) read.push(readManifest(path, text));
  }
  const modules = read.length ? modulesOf(read) : [{ module: "app", launcher: false, resource: null }];
  const launchModule = read.length ? (modules[0]?.module ?? "") : "";
  const found: IconCandidate[] = [
    ...fastlaneIcons(forge.tree).filter((e) => ownsModule(e.path, /fastlane\/metadata\//i, launchModule)).slice(0, 2).map((e) => fromTree(e, "repo-fastlane")),
    ...metadataIcons(forge.tree).filter((e) => ownsModule(e.path, /metadata\//i, launchModule)).slice(0, 2).map((e) => fromTree(e, "repo-metadata")),
  ];
  let launcherFound = false;
  for (const manifest of modules) {
    const icons = launcherIcons(forge.tree, manifest.module, manifest.resource);
    if (icons.length) {
      found.push(...icons.slice(0, 2).map((e) => fromTree(e, "repo-launcher")));
      launcherFound = true;
      break;
    }
  }
  if (!launcherFound) {
    const composed = await adaptiveCandidate(forge, modules, net);
    if (composed) found.push(composed);
  }
  const readme = readmePath(forge.tree);
  if (readme) {
    const text = await optional(net.text(forge.raw(readme), TEXT_LIMIT));
    const byPath = new Map(forge.tree.map((e) => [e.path, e]));
    const resolve = (src: string): URL | null => {
      const absolute = fetchableUrl(src);
      if (absolute) return githubBlobToRaw(absolute) ?? absolute;
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) return null;
      const path = src.replace(/^\.?\//, "").split(/[?#]/)[0] ?? "";
      const decoded = safeDecode(path);
      return decoded && safeRepoPath(decoded) && byPath.has(decoded) ? fetchableUrl(forge.raw(decoded)) : null;
    };
    const logo = text ? readmeLogo(readmeImages(text), resolve) : null;
    if (logo) {
      const inTree = [...byPath.values()].find((e) => forge.raw(e.path) === logo.href);
      found.push({
        rule: "readme-logo",
        url: logo.href,
        expect: inTree ? { kind: "git-blob", value: inTree.sha } : null,
        revision: inTree ? forge.head : null,
        allowSvg: true,
        minPx: MIN_SOURCE_PX,
      });
    }
  }
  return found;
}

/**
 * True when a store-metadata file belongs to the app: its directory (the path
 * before `marker`) is the repository root or an ancestor of the launchable
 * module, as in a Flutter or React Native project's `android/`. A metadata
 * directory elsewhere belongs to another project kept in the repository.
 */
export function ownsModule(path: string, marker: RegExp, launchModule: string): boolean {
  const at = path.search(marker);
  if (at < 0) return false;
  const dir = path.slice(0, at).replace(/\/$/, "");
  return dir === "" || launchModule === dir || launchModule.startsWith(`${dir}/`);
}

/**
 * The launchable module's adaptive icon, composed once here so that only an
 * icon that can be drawn becomes a candidate; the files it needed are listed
 * so the image stage can compose it again from verified bytes.
 */
async function adaptiveCandidate(forge: Forge, modules: readonly ManifestIcon[], net: Net): Promise<IconCandidate | null> {
  for (const manifest of modules.slice(0, 2)) {
    const resource = manifest.resource ?? { type: "mipmap" as const, name: "ic_launcher" };
    const used = new Map<string, TreeEntry>();
    const read = async (path: string): Promise<Uint8Array | null> => (await optional(net.get(forge.raw(path), MAX_SOURCE_BYTES)))?.bytes ?? null;
    const png = await composeAdaptiveIcon({ tree: forge.tree, module: manifest.module, read }, resource.type, resource.name, used);
    const entry = findResource(forge.tree, manifest.module, resource.type, resource.name);
    if (!png || !entry) continue;
    return {
      rule: "repo-launcher",
      url: forge.raw(entry.path),
      expect: { kind: "git-blob", value: entry.sha },
      revision: forge.head,
      allowSvg: false,
      minPx: MIN_SOURCE_PX,
      compose: {
        module: manifest.module,
        type: resource.type,
        name: resource.name,
        files: [...used.values()].sort((a, b) => (a.path < b.path ? -1 : 1)).map((e) => ({ ...e, url: forge.raw(e.path) })),
      },
    };
  }
  return null;
}

/** The value, or null when the request failed for a reason other than a spent budget or a rate limit, which still stop the lookup. */
async function optional<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof RateLimited) throw error;
    return null;
  }
}

function safeDecode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}

/** `github.com/<o>/<r>/blob/<ref>/<path>` and `…/raw/…` as their raw-content URLs. */
function githubBlobToRaw(url: URL): URL | null {
  if (url.hostname !== "github.com") return null;
  const m = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/.exec(url.pathname);
  if (!m) return null;
  return fetchableUrl(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`);
}

async function siteCandidates(website: string, net: Net): Promise<IconCandidate[]> {
  const page = fetchableUrl(website.replace(/^http:\/\//i, "https://"));
  if (!page || sharedSite(page)) return [];
  const got = await net.get(page.href, PAGE_LIMIT, "text/html");
  if (!got || !/html/i.test(got.type)) return [];
  const finalUrl = fetchableUrl(got.url);
  if (!finalUrl || sharedSite(finalUrl)) return [];
  const html = new TextDecoder("utf-8", { fatal: false }).decode(got.bytes);
  if (forgePage(html)) return [];
  const declared = pageIcons(html, finalUrl.href, MIN_SOURCE_PX);
  const urls: URL[] = [];
  if (declared.manifest) {
    const text = await net.text(declared.manifest.href, 256 * 1024).catch((error: unknown) => {
      if (error instanceof RateLimited) throw error;
      return null;
    });
    const manifest = text ? parseJsonOrNull(text) : null;
    if (manifest) urls.push(...manifestIcons(manifest, declared.manifest.href, MIN_SOURCE_PX).slice(0, 2));
  }
  urls.push(...declared.icons.slice(0, 2));
  return urls.map((url) => ({ rule: "site-icon" as const, url: url.href, expect: null, revision: null, allowSvg: true, minPx: MIN_SOURCE_PX }));
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

async function playListingIcon(pkg: string, net: Net): Promise<string | null> {
  if (!PACKAGE_RE.test(pkg)) return null;
  const html = await net.text(`https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=US`, 4 * 1024 * 1024);
  return html ? (playIcon(html)?.href ?? null) : null;
}
