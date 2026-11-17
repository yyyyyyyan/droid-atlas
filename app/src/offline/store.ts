/**
 * The catalog kept on the device: which build is current, fetching a new one,
 * and making it current only once every part of it is present and correct.
 *
 * A build is fetched into memory first. Each file is checked against the
 * SHA-256 its manifest lists, and the format is checked for support, before a
 * single byte is written to Cache Storage; the pointer to the current build
 * moves last. A download that is partial, altered or in a newer format
 * therefore changes nothing. The build that was current stays stored as the
 * previous one, and nothing is deleted when a new one arrives: a window that
 * is open on an older build or an older shell keeps the files it is using.
 * `purge` deletes what is left over, and the service worker calls it only
 * when no other window is open and no newer worker is pending.
 *
 * The service worker (at install) and the page (after each launch) both call
 * this module; neither has logic of its own for it.
 */

import { CATALOG_SCHEMA_VERSION, type CatalogVersion } from "../catalog/schema.ts";
import {
  buildCacheName,
  buildDirectory,
  chooseLaunchBuild,
  CURRENT_KEY,
  decideUpdate,
  ICON_CACHE,
  ICONS_FOR_KEY,
  isVersion,
  POINTER_CACHE,
  PREVIOUS_KEY,
  staleCaches,
  WINDOW_KEY_PREFIX,
  type LaunchChoice,
  type WindowRecord,
} from "./decide.ts";

/** The roles of the files a launch needs before it can render. Details shards, icon credits and upstream snapshots are fetched when viewed. */
const START_ROLES = new Set(["atlas", "source", "index", "github"]);

export interface CacheLike {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
  /** What is stored, by address. */
  keys(): Promise<readonly { url: string }[]>;
  delete(url: string): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export interface OfflineEnv {
  caches: CacheStorageLike;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** SHA-256 as lower-case hex, or null where the platform cannot compute one. */
  digest(bytes: ArrayBuffer): Promise<string | null>;
  /** Absolute URL of the data root, ending in a slash. */
  dataRoot: string;
  /** The newest catalog format this shell reads. */
  supportedSchema: number;
}

export type DownloadFailure = "unreachable" | "missing" | "mismatch" | "malformed" | "newer-schema" | "unverifiable";

export class DownloadError extends Error {
  readonly reason: DownloadFailure;

  constructor(reason: DownloadFailure, message: string) {
    super(message);
    this.name = "DownloadError";
    this.reason = reason;
  }
}

interface FetchedFile {
  url: string;
  bytes: ArrayBuffer;
}

export interface FetchedBuild {
  version: CatalogVersion;
  directory: string;
  files: FetchedFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parse(bytes: ArrayBuffer, what: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new DownloadError("malformed", `${what} is not valid JSON.`);
  }
}

async function fetchBytes(env: OfflineEnv, url: string, init?: RequestInit): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await env.fetch(url, init);
  } catch {
    throw new DownloadError("unreachable", `${url} could not be reached.`);
  }
  if (!response.ok) throw new DownloadError("missing", `${url} answered ${response.status}.`);
  try {
    return await response.arrayBuffer();
  } catch {
    throw new DownloadError("unreachable", `The connection dropped while ${url} was loading.`);
  }
}

/** A plain relative path below the build directory: no scheme, no host, no climbing out. */
function partUrl(base: string, path: unknown): string | null {
  if (typeof path !== "string" || !/^[A-Za-z0-9._~\-/%@+]+$/.test(path) || path.startsWith("/")) return null;
  if (path.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) return null;
  return base + path;
}

async function readPointer(env: OfflineEnv, key: string): Promise<CatalogVersion | null> {
  try {
    const cache = await env.caches.open(POINTER_CACHE);
    const stored = await cache.match(env.dataRoot + key);
    if (!stored) return null;
    const value: unknown = await stored.json();
    return isVersion(value) ? value : null;
  } catch {
    return null;
  }
}

export async function readPointers(env: OfflineEnv): Promise<{ current: CatalogVersion | null; previous: CatalogVersion | null }> {
  return { current: await readPointer(env, CURRENT_KEY), previous: await readPointer(env, PREVIOUS_KEY) };
}

function windowKey(env: OfflineEnv, id: string): string {
  return `${env.dataRoot}${WINDOW_KEY_PREFIX}${encodeURIComponent(id)}.json`;
}

async function readWindow(pointers: CacheLike, key: string): Promise<WindowRecord | null> {
  const value: unknown = await (await pointers.match(key))?.json().catch(() => null);
  if (!isRecord(value) || typeof value.seen !== "number") return null;
  return { shell: typeof value.shell === "string" ? value.shell : null, build: typeof value.build === "string" ? value.build : null, seen: value.seen };
}

/**
 * Adds to what is known of one open window: the shell its document was
 * answered with, or the build it says it shows. What was known before and is
 * not given again is kept, and so is the time the window was first seen.
 */
export async function noteWindow(env: OfflineEnv, id: string, known: { shell?: string; build?: string }, now: number): Promise<WindowRecord> {
  const pointers = await env.caches.open(POINTER_CACHE);
  const key = windowKey(env, id);
  const before = await readWindow(pointers, key);
  const record: WindowRecord = { shell: known.shell ?? before?.shell ?? null, build: known.build ?? before?.build ?? null, seen: before?.seen ?? now };
  await pointers.put(key, jsonResponse(JSON.stringify(record)));
  return record;
}

/**
 * What is known of each of the windows that are open now, by id. A window
 * nothing is known of is noted as first seen now; what was kept of windows
 * that are gone is forgotten, so the entries never outnumber the open
 * windows.
 */
export async function openWindows(env: OfflineEnv, ids: readonly string[], now: number): Promise<Map<string, WindowRecord>> {
  const pointers = await env.caches.open(POINTER_CACHE);
  const live = new Set(ids.map((id) => windowKey(env, id)));
  for (const { url } of await pointers.keys()) {
    if (url.startsWith(env.dataRoot + WINDOW_KEY_PREFIX) && !live.has(url)) await pointers.delete(url);
  }
  const records = new Map<string, WindowRecord>();
  for (const id of ids) records.set(id, (await readWindow(pointers, windowKey(env, id))) ?? (await noteWindow(env, id, {}, now)));
  return records;
}

/** Which stored build this launch renders, if any. */
export async function launchChoice(env: OfflineEnv): Promise<LaunchChoice> {
  const { current, previous } = await readPointers(env);
  return chooseLaunchBuild(current, previous, env.supportedSchema);
}

/**
 * A fetch for the launch that renders a stored build: each file comes straight
 * from the build's cache, and only a file that is not there goes to the
 * network. The page could ask the service worker for the same files, but a
 * launch must not depend on a worker answering: one that is being replaced
 * can keep a request waiting for minutes.
 */
export function storedBuildFetch(env: OfflineEnv, version: CatalogVersion): OfflineEnv["fetch"] {
  const directory = buildDirectory(version);
  let opened: Promise<CacheLike | null> | null = null;
  const open = (): Promise<CacheLike | null> => {
    opened ??= (async () => {
      if (!directory) return null;
      const name = buildCacheName(directory);
      /* `open` would create the cache; a build that is not stored must leave no trace. */
      return (await env.caches.keys()).includes(name) ? env.caches.open(name) : null;
    })().catch(() => null);
    return opened;
  };
  return async (url, init) => {
    const stored = await (await open())?.match(url).catch(() => undefined);
    return stored ?? env.fetch(url, init);
  };
}

/**
 * Fetches a build into memory and verifies all of it: the manifest names the
 * version that led to it, every start file matches its SHA-256, and the atlas
 * is in a supported format and belongs to this build. Throws a `DownloadError`
 * on the first thing that is not right; nothing is stored here.
 */
export async function downloadBuild(env: OfflineEnv, version: CatalogVersion): Promise<FetchedBuild> {
  const directory = buildDirectory(version);
  if (!directory) throw new DownloadError("malformed", "The version file names no build directory.");
  if (version.schema > env.supportedSchema) throw new DownloadError("newer-schema", "The catalog is in a newer format than this app reads.");
  const base = `${env.dataRoot}c/${directory}/`;
  const manifestUrl = env.dataRoot + version.manifest;
  const manifestBytes = await fetchBytes(env, manifestUrl);
  const manifest = parse(manifestBytes, "The build manifest");
  if (isRecord(manifest) && typeof manifest.schema === "number" && manifest.schema > env.supportedSchema) {
    throw new DownloadError("newer-schema", "The catalog is in a newer format than this app reads.");
  }
  if (!isRecord(manifest) || manifest.schema !== version.schema || manifest.hash !== version.hash || !Array.isArray(manifest.files)) {
    throw new DownloadError("mismatch", "The build manifest does not belong to the version that names it.");
  }
  const wanted = manifest.files.filter((file): file is Record<string, unknown> => isRecord(file) && typeof file.role === "string" && START_ROLES.has(file.role));
  if (!wanted.some((file) => file.role === "atlas") || !wanted.some((file) => file.role === "source") || !wanted.some((file) => file.role === "github")) {
    throw new DownloadError("malformed", "The build manifest does not list the parts a catalog is made of.");
  }
  const files: FetchedFile[] = [{ url: manifestUrl, bytes: manifestBytes }];
  await Promise.all(wanted.map(async (file) => {
    const url = partUrl(base, file.path);
    if (!url || typeof file.sha256 !== "string") throw new DownloadError("malformed", "The build manifest lists a file outside its directory.");
    const bytes = await fetchBytes(env, url);
    const actual = await env.digest(bytes);
    if (actual === null) throw new DownloadError("unverifiable", "This browser cannot compute SHA-256 here, so the build cannot be verified.");
    if (actual !== file.sha256.toLowerCase()) throw new DownloadError("mismatch", `${String(file.path)} does not match the build manifest.`);
    const content = parse(bytes, String(file.path));
    if (file.role === "atlas") {
      if (isRecord(content) && typeof content.schema === "number" && content.schema > env.supportedSchema) {
        throw new DownloadError("newer-schema", "The catalog is in a newer format than this app reads.");
      }
      if (!isRecord(content) || content.hash !== version.hash) throw new DownloadError("mismatch", "The catalog does not belong to the version that names it.");
    }
    files.push({ url, bytes });
  }));
  return { version, directory, files };
}

/** True when the manifest and every start file of a build are in its cache. */
export async function hasCompleteBuild(env: OfflineEnv, version: CatalogVersion): Promise<boolean> {
  const directory = buildDirectory(version);
  if (!directory) return false;
  try {
    const cache = await env.caches.open(buildCacheName(directory));
    const stored = await cache.match(env.dataRoot + version.manifest);
    if (!stored) return false;
    const manifest: unknown = await stored.json();
    if (!isRecord(manifest) || manifest.hash !== version.hash || !Array.isArray(manifest.files)) return false;
    const base = `${env.dataRoot}c/${directory}/`;
    for (const file of manifest.files) {
      if (!isRecord(file) || typeof file.role !== "string" || !START_ROLES.has(file.role)) continue;
      const url = partUrl(base, file.path);
      if (!url || !(await cache.match(url))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function jsonResponse(bytes: ArrayBuffer | string): Response {
  return new Response(bytes, { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * Writes a verified build to its cache and, once all of it is confirmed to be
 * there, makes it the current one. The build that was current becomes the
 * previous one. Nothing is deleted here.
 */
export async function storeBuild(env: OfflineEnv, build: FetchedBuild): Promise<void> {
  const cache = await env.caches.open(buildCacheName(build.directory));
  await Promise.all(build.files.map((file) => cache.put(file.url, jsonResponse(file.bytes))));
  if (!(await hasCompleteBuild(env, build.version))) throw new DownloadError("missing", "The build could not be stored completely on this device.");

  const pointers = await env.caches.open(POINTER_CACHE);
  const { current } = await readPointers(env);
  if (current && current.hash !== build.version.hash) await pointers.put(env.dataRoot + PREVIOUS_KEY, jsonResponse(JSON.stringify(current)));
  await pointers.put(env.dataRoot + CURRENT_KEY, jsonResponse(JSON.stringify(build.version)));
}

/**
 * The caches nothing can need once the only window open is the one being
 * loaded: the shells of every version but `shellVersion`, and every build but
 * the current one. With no readable pointer there is no telling which build
 * is in use, so no build is named.
 */
export async function leftoverCaches(env: OfflineEnv, shellVersion: string): Promise<string[]> {
  const { current } = await readPointers(env);
  const names = await env.caches.keys();
  const prefix = buildCacheName("");
  const stored = names.filter((name) => name.startsWith(prefix)).map((name) => name.slice(prefix.length));
  const directory = current ? buildDirectory(current) : null;
  return staleCaches(names, shellVersion, directory ? [directory] : stored);
}

/** The icon files the current build's entries use, as addresses; null when the stored build cannot be read. */
async function iconsInUse(env: OfflineEnv, current: CatalogVersion): Promise<Set<string> | null> {
  const directory = buildDirectory(current);
  if (!directory) return null;
  try {
    const cache = await env.caches.open(buildCacheName(directory));
    const base = `${env.dataRoot}c/${directory}/`;
    const manifest: unknown = await (await cache.match(env.dataRoot + current.manifest))?.json();
    if (!isRecord(manifest) || !Array.isArray(manifest.files)) return null;
    const listed = manifest.files.find((file) => isRecord(file) && file.role === "atlas");
    const url = isRecord(listed) ? partUrl(base, listed.path) : null;
    const atlas: unknown = url ? await (await cache.match(url))?.json() : null;
    if (!isRecord(atlas) || !Array.isArray(atlas.apps)) return null;
    const used = new Set<string>();
    for (const app of atlas.apps) {
      if (!isRecord(app)) continue;
      for (const path of [app.icon, app.iconLarge]) {
        if (typeof path === "string") used.add(env.dataRoot + path);
      }
    }
    return used;
  } catch {
    return null;
  }
}

/**
 * Removes from the icon cache every icon the current build's entries do not
 * use, so the cache never holds more than two files per entry. Icons are
 * named by their content, so one that changed leaves its old file behind;
 * this is what collects those. It reads the whole atlas, so it runs once per
 * build: the build it last ran for is remembered beside the pointers.
 * Returns how many were removed. Nothing is removed when the build cannot be
 * read.
 */
export async function pruneIcons(env: OfflineEnv): Promise<number> {
  const { current } = await readPointers(env);
  if (!current) return 0;
  const pointers = await env.caches.open(POINTER_CACHE);
  const marker = env.dataRoot + ICONS_FOR_KEY;
  const doneFor: unknown = await (await pointers.match(marker))?.json().catch(() => null);
  if (isRecord(doneFor) && doneFor.hash === current.hash) return 0;
  let removed = 0;
  if ((await env.caches.keys()).includes(ICON_CACHE)) {
    const used = await iconsInUse(env, current);
    if (!used) return 0;
    const icons = await env.caches.open(ICON_CACHE);
    for (const { url } of await icons.keys()) {
      if (used.has(url.split(/[?#]/)[0] ?? url)) continue;
      if (await icons.delete(url)) removed += 1;
    }
  }
  await pointers.put(marker, jsonResponse(JSON.stringify({ hash: current.hash })));
  return removed;
}

/**
 * Deletes everything `leftoverCaches` names, forgets the previous build when
 * its files went with them, and clears the icon cache of icons no longer in
 * use. For a moment when no window can need any of it: the caller decides
 * that (`mayPurge`). Returns the names of the caches deleted.
 */
export async function purge(env: OfflineEnv, shellVersion: string): Promise<string[]> {
  const names = await leftoverCaches(env, shellVersion);
  for (const name of names) await env.caches.delete(name);
  const { previous } = await readPointers(env);
  const previousDirectory = previous ? buildDirectory(previous) : null;
  if (previousDirectory && names.includes(buildCacheName(previousDirectory))) {
    await (await env.caches.open(POINTER_CACHE)).delete(env.dataRoot + PREVIOUS_KEY);
  }
  await pruneIcons(env);
  return names;
}

async function fetchVersion(env: OfflineEnv): Promise<unknown> {
  return parse(await fetchBytes(env, `${env.dataRoot}version.json`, { cache: "no-cache" }), "version.json");
}

export type UpdateResult =
  /** The site serves the build this device already has. */
  | { result: "current"; version: CatalogVersion }
  /** A newer build was fetched, verified and stored; the next launch uses it. */
  | { result: "updated"; version: CatalogVersion }
  /** The site serves a format this shell cannot read. The stored catalog is untouched. */
  | { result: "newer-schema" }
  /** The site could not be reached. */
  | { result: "offline" }
  /** The site answered, but what it served was incomplete or did not verify. The stored catalog is untouched. */
  | { result: "rejected"; reason: DownloadFailure };

/**
 * Asks the site which build is current and, when it is not the stored one,
 * fetches, verifies and stores it for the next launch. Never throws: every
 * failure is a result, and every failure leaves the stored catalog as it was.
 */
export async function checkForUpdate(env: OfflineEnv): Promise<UpdateResult> {
  let fetched: unknown;
  try {
    fetched = await fetchVersion(env);
  } catch (error) {
    return error instanceof DownloadError && error.reason !== "unreachable" ? { result: "rejected", reason: error.reason } : { result: "offline" };
  }
  const { current } = await readPointers(env);
  const decision = decideUpdate(current, fetched, env.supportedSchema);
  if (decision.action === "newer-schema") return { result: "newer-schema" };
  if (decision.action === "invalid") return { result: "rejected", reason: "malformed" };
  const version = decision.action === "none" ? current : decision.version;
  if (!version) return { result: "rejected", reason: "malformed" };
  /* "None" still repairs: a pointer whose build has been evicted in part is fetched again. */
  if (decision.action === "none" && (await hasCompleteBuild(env, version))) return { result: "current", version };
  try {
    await storeBuild(env, await downloadBuild(env, version));
  } catch (error) {
    if (!(error instanceof DownloadError)) throw error;
    if (error.reason === "newer-schema") return { result: "newer-schema" };
    return error.reason === "unreachable" ? { result: "offline" } : { result: "rejected", reason: error.reason };
  }
  return decision.action === "none" ? { result: "current", version } : { result: "updated", version };
}

/**
 * What the service worker's install step requires: after it, a complete,
 * readable catalog is stored. It takes the one the site serves when it can;
 * when it cannot (offline, a refused download, a newer format), a complete
 * catalog stored earlier still satisfies it. With neither, it throws and the
 * install fails, so a worker never controls a page it cannot give data to.
 */
export async function ensureCatalog(env: OfflineEnv): Promise<CatalogVersion> {
  const outcome = await checkForUpdate(env);
  if (outcome.result === "current" || outcome.result === "updated") return outcome.version;
  const { use } = await launchChoice(env);
  if (use && (await hasCompleteBuild(env, use))) return use;
  throw new DownloadError(outcome.result === "offline" ? "unreachable" : outcome.result === "newer-schema" ? "newer-schema" : outcome.reason, "No complete catalog could be stored.");
}

export const SUPPORTED_SCHEMA: number = CATALOG_SCHEMA_VERSION;
