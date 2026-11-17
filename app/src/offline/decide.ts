/**
 * The decisions behind "Offline and updates" in docs/ARCHITECTURE.md, as pure
 * functions: which build a launch renders, what to do when the site names a
 * different one, when a waiting service worker may take over, how a request
 * is answered, and which caches are left over. The service worker and the
 * page both act on these and on nothing else, so every rule can be tested
 * without a browser.
 *
 * Cache names are identifiers on users' devices. They do not contain the
 * product's display name and must not change with it.
 */

import type { CatalogVersion } from "../catalog/schema.ts";

export const CACHE_PREFIX = "droid-atlas:";
/** Holds two entries: the build to render at the next launch, and the one before it. */
export const POINTER_CACHE = `${CACHE_PREFIX}pointer`;
/** Self-hosted app icons. Their names are content hashes, shared between builds. */
export const ICON_CACHE = `${CACHE_PREFIX}icons`;
/** License texts and the third-party notice, kept as they are read. */
export const VIEWED_CACHE = `${CACHE_PREFIX}viewed`;

export function shellCacheName(shellVersion: string): string {
  return `${CACHE_PREFIX}shell:${shellVersion}`;
}

export function buildCacheName(hash: string): string {
  return `${CACHE_PREFIX}build:${hash}`;
}

/** Keys of the two pointer entries, relative to the data root. They are never fetched: they only name cache entries. */
export const CURRENT_KEY = "pointer/current.json";
export const PREVIOUS_KEY = "pointer/previous.json";
/** Which build the icon cache was last cleared of unused icons for. */
export const ICONS_FOR_KEY = "pointer/icons-for.json";

export function isVersion(value: unknown): value is CatalogVersion {
  if (typeof value !== "object" || value === null) return false;
  const version = value as Record<string, unknown>;
  return typeof version.schema === "number" && Number.isInteger(version.schema) && version.schema >= 1
    && typeof version.hash === "string" && /^[0-9a-f]{8,128}$/.test(version.hash)
    && typeof version.manifest === "string" && /^c\/[0-9a-f]{8,128}\/manifest\.json$/.test(version.manifest)
    && typeof version.generatedAt === "string";
}

export interface LaunchChoice {
  /** The stored build to render, or null when none is usable and the launch must go to the network. */
  use: CatalogVersion | null;
  /** True when the newest stored catalog is in a format this shell cannot read: the shell is the old part and needs replacing. */
  needsReload: boolean;
}

/**
 * Which stored build a launch renders. The current one, unless it was written
 * in a newer format than this shell reads (a newer shell stored it while this
 * one was still open); then the one before it, which this shell stored itself.
 */
export function chooseLaunchBuild(current: CatalogVersion | null, previous: CatalogVersion | null, supportedSchema: number): LaunchChoice {
  if (current && current.schema <= supportedSchema) return { use: current, needsReload: false };
  const fallback = previous && previous.schema <= supportedSchema ? previous : null;
  return { use: fallback, needsReload: current !== null };
}

export type UpdateDecision =
  /** The site serves the build already stored. */
  | { action: "none" }
  /** The site serves another build in a format this shell reads: fetch it, verify it, and make it current for the next launch. */
  | { action: "download"; version: CatalogVersion }
  /** The site serves a format newer than this shell reads: keep what is stored and ask for a reload. */
  | { action: "newer-schema" }
  /** What came back is not a version file. Nothing changes. */
  | { action: "invalid" };

export function decideUpdate(stored: CatalogVersion | null, fetched: unknown, supportedSchema: number): UpdateDecision {
  if (typeof fetched === "object" && fetched !== null && typeof (fetched as { schema?: unknown }).schema === "number"
    && (fetched as { schema: number }).schema > supportedSchema) {
    return { action: "newer-schema" };
  }
  if (!isVersion(fetched)) return { action: "invalid" };
  if (stored && stored.hash === fetched.hash) return { action: "none" };
  return { action: "download", version: fetched };
}

/** The two messages of a takeover: a page asks, and a page that got "yes" before it rendered tells the worker to go ahead. */
export const TAKEOVER_QUESTION = "CAN_TAKE_OVER";
export const TAKEOVER_COMMAND = "TAKE_OVER";

/** What a page tells its worker once it has rendered: which script it runs and which build it shows. The worker answers when it has finished tidying. */
export const LAUNCHED_MESSAGE = "LAUNCHED";

/** Where the worker keeps what it knows of each open window of the app, one entry per window, beside the pointers. */
export const WINDOW_KEY_PREFIX = "pointer/window/";

/** How long an open window of the app that has not said what it runs and shows holds the files a purge would delete. */
export const SILENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * What the worker knows of one open window of the app: the shell version its
 * document was answered with, the build it said it shows once it had
 * rendered, and when the worker first knew of it. Null is "not known": a
 * document answered by another version's worker or by the network, a window
 * that has not rendered yet or never will.
 */
export interface WindowRecord {
  shell: string | null;
  build: string | null;
  seen: number;
}

/**
 * Whether an open window still needs files a purge would delete. One that
 * is known to be on another shell or another build does, for as long as it
 * is open. One known to be on this shell and the current build does not: a
 * purge takes nothing it uses. One the worker cannot place is given the
 * benefit of the doubt, but only for `SILENT_WINDOW_MS` after it was first
 * seen, so a window that never says anything cannot hold files forever.
 */
export function holdsFiles(record: WindowRecord, shellVersion: string, currentBuild: string | null, now: number): boolean {
  if (record.shell !== null && record.shell !== shellVersion) return true;
  if (record.build !== null && record.build !== currentBuild) return true;
  if (record.shell !== null && record.build !== null) return false;
  return now - record.seen < SILENT_WINDOW_MS;
}

/** What the worker knows when a page has just launched. */
export interface PurgeFacts {
  /** Other open windows of the app that still need files a purge would delete (`holdsFiles`). */
  windowsHoldingFiles: number;
  /** A newer worker is installing or waiting. */
  newerWorkerPending: boolean;
  /** The window that launched runs this worker's shell. */
  runsThisShell: boolean;
  /** The window that launched shows the current build. */
  showsCurrentBuild: boolean;
}

/**
 * Whether what is left over may be purged now. A page load is always given
 * the newest version, so the takeover itself never waits for other windows;
 * but a window that is open on an older shell or an older catalog is in the
 * middle of a session with those files. So the purge waits for a launch that
 * can prove nothing else needs them: no other window of the app holds them,
 * the window that launched is itself on this worker's shell and the current
 * build, and no newer worker is installing or waiting, because the files
 * such a worker has just stored are not the active worker's to judge.
 */
export function mayPurge(facts: PurgeFacts): boolean {
  return facts.windowsHoldingFiles === 0 && !facts.newerWorkerPending && facts.runsThisShell && facts.showsCurrentBuild;
}

/** The paths, relative to the scope, at which the app itself is served. */
function isAppPath(path: string): boolean {
  return path === "" || path === "index.html";
}

/**
 * Whether an address is the app's own document. Any other address in scope
 * is a file (a license text, a data file): a window showing one runs no
 * shell and reads no catalog, so it has no say in what is kept.
 */
export function isAppAddress(address: string, scope: string): boolean {
  try {
    const url = new URL(address);
    const base = new URL(scope);
    return url.origin === base.origin && url.pathname.startsWith(base.pathname) && isAppPath(url.pathname.slice(base.pathname.length));
  } catch {
    return false;
  }
}

export type RequestKind =
  /** A page load inside the scope: answered with the shell's `index.html`, whatever the query. */
  | { kind: "navigate" }
  /** A file of the shell this worker was built with. */
  | { kind: "shell"; file: string }
  /** A built asset this worker's shell does not have: a window still open on another version's shell is asking for one of its own files. */
  | { kind: "other-shell" }
  /** A file of one build. Immutable, so the cache is always right; kept once fetched. */
  | { kind: "build-file"; hash: string }
  | { kind: "icon" }
  /** License texts and notices: fetched fresh when possible, kept for when it is not. */
  | { kind: "viewed" }
  /** Everything else, `version.json` first of all: straight to the network, never from a cache. */
  | { kind: "pass" };

export interface RequestFacts {
  method: string;
  /** `Request.mode`; "navigate" for a page load. */
  mode: string;
  url: string;
}

/** `scope` is the worker's scope URL, ending in a slash. `shellFiles` are paths relative to it. */
export function classifyRequest(request: RequestFacts, scope: string, shellFiles: readonly string[]): RequestKind {
  if (request.method !== "GET") return { kind: "pass" };
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { kind: "pass" };
  }
  const base = new URL(scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return { kind: "pass" };
  const path = url.pathname.slice(base.pathname.length);
  /*
   * Only the app's own address is answered with the app. Every other path in
   * scope is a file (a license text, a data file) or nothing at all, and a
   * navigation to it gets that file or the host's own answer, never the app
   * under the file's address.
   */
  if (request.mode === "navigate" && isAppPath(path)) return { kind: "navigate" };
  if (shellFiles.includes(path)) return { kind: "shell", file: path };
  if (/^assets\/[A-Za-z0-9._-]+$/.test(path)) return { kind: "other-shell" };
  const build = /^data\/c\/([0-9a-f]{8,128})\/./.exec(path);
  if (build?.[1]) return { kind: "build-file", hash: build[1] };
  if (/^data\/icons\/[A-Za-z0-9._-]+$/.test(path)) return { kind: "icon" };
  if (/^data\/licenses\/[A-Za-z0-9.+_-]+\.txt$/.test(path) || path === "third-party-licenses.txt") return { kind: "viewed" };
  return { kind: "pass" };
}

/**
 * The SHA-256 a build's manifest lists for one of its files, by the path relative to the build directory.
 * Null when the manifest does not list the file: such a file is served but never kept.
 */
export function listedDigest(manifest: unknown, path: string): string | null {
  if (typeof manifest !== "object" || manifest === null) return null;
  const files = (manifest as { files?: unknown }).files;
  if (!Array.isArray(files)) return null;
  for (const file of files) {
    if (typeof file !== "object" || file === null) continue;
    const entry = file as { path?: unknown; sha256?: unknown };
    if (entry.path === path && typeof entry.sha256 === "string" && /^[0-9a-fA-F]{64}$/.test(entry.sha256)) return entry.sha256.toLowerCase();
  }
  return null;
}

/**
 * An icon's file name is the start of the SHA-256 of its bytes (`icons/<16 hex>.webp`), so the name itself says
 * whether the bytes are right. Returns that prefix, or null for a name that is not one.
 */
export function iconDigestPrefix(url: string): string | null {
  return /\/data\/icons\/([0-9a-f]{16,64})\.[a-z0-9]+(?:[?#].*)?$/.exec(url)?.[1] ?? null;
}

/** The directory name a build's files live under, read from its manifest path (`c/<dir>/manifest.json`). */
export function buildDirectory(version: Pick<CatalogVersion, "manifest">): string | null {
  return /^c\/([0-9a-f]{8,128})\/manifest\.json$/.exec(version.manifest)?.[1] ?? null;
}

/**
 * The caches to delete: shells other than this worker's, and builds other
 * than those in `keep`, which holds build directory names. Caches that are
 * not ours are never touched.
 */
export function staleCaches(names: readonly string[], shellVersion: string | null, keep: readonly string[]): string[] {
  const kept = new Set(keep.map(buildCacheName));
  return names.filter((name) => {
    if (!name.startsWith(CACHE_PREFIX)) return false;
    if (name.startsWith(`${CACHE_PREFIX}shell:`)) return shellVersion !== null && name !== shellCacheName(shellVersion);
    if (name.startsWith(`${CACHE_PREFIX}build:`)) return !kept.has(name);
    return false;
  });
}
