/**
 * The service worker. It implements "Offline and updates" in
 * docs/ARCHITECTURE.md; the rule numbers below are that section's. Every
 * decision it makes is a pure function in `../offline/decide.ts`, and the
 * catalog handling is `../offline/store.ts`, shared with the page.
 *
 * - Install (rule 4): the shell's files, `version.json` and the catalog it
 *   names are stored, each verified; if anything is missing the install
 *   fails, so a worker never controls a page it cannot serve offline.
 * - It never takes over on its own (rule 6). A page asks as it loads, before
 *   it renders, and the worker then takes over at once, so a page that is
 *   loaded again after a deploy runs the new version. A window still open on
 *   an older shell is not disturbed: its shell's and its catalog's files stay
 *   stored until a page launches with no other window open, and are purged
 *   then.
 * - Fetch: page loads get the shell whatever the query (rule 8); a build's
 *   files and icons are immutable and answered from the cache once seen,
 *   and kept only when their bytes verify (rule 5); `version.json` is never answered from a cache (rule 1).
 *
 * `__SHELL_FILES__` and `__SHELL_VERSION__` are filled in by the build
 * (`build/shell.ts`) from the files it has just written.
 */

import { fetchAnswering, QUIET_MS } from "../lib/quiet.ts";
import {
  buildCacheName,
  classifyRequest,
  holdsFiles,
  ICON_CACHE,
  iconDigestPrefix,
  isAppAddress,
  LAUNCHED_MESSAGE,
  listedDigest,
  mayPurge,
  shellCacheName,
  TAKEOVER_COMMAND,
  TAKEOVER_QUESTION,
  VIEWED_CACHE,
} from "../offline/decide.ts";
import { ensureCatalog, noteWindow, openWindows, purge, readPointers, SUPPORTED_SCHEMA, type OfflineEnv } from "../offline/store.ts";

declare const self: ServiceWorkerGlobalScope;
declare const __SHELL_FILES__: readonly string[];
declare const __SHELL_VERSION__: string;

const SHELL_FILES = __SHELL_FILES__;
const SHELL_CACHE = shellCacheName(__SHELL_VERSION__);
const scope = self.registration.scope;
const DOCUMENT = "index.html";

const env: OfflineEnv = {
  caches: self.caches,
  fetch: (url, init) => fetch(url, init),
  dataRoot: `${scope}data/`,
  supportedSchema: SUPPORTED_SCHEMA,
  digest: async (bytes) => {
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
  },
};

/** A copy without the `redirected` flag a host's "/index.html → /" redirect leaves, which a page load refuses. */
async function plain(response: Response): Promise<Response> {
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Whether every file of this worker's shell is stored. */
async function shellStored(): Promise<boolean> {
  const cache = await caches.open(SHELL_CACHE);
  const stored = await Promise.all(SHELL_FILES.map((file) => cache.match(scope + file)));
  return stored.every((response) => response !== undefined);
}

async function storeShell(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.all(SHELL_FILES.map(async (file) => {
    /* The document is asked for by its directory, the form every host serves without redirecting. */
    const url = file === DOCUMENT ? scope : scope + file;
    const response = await fetch(url, { cache: "reload" });
    if (!response.ok) throw new Error(`${file} answered ${response.status}`);
    await cache.put(scope + file, await plain(response));
  }));
  if (!(await shellStored())) throw new Error("the shell was not stored whole");
}

/**
 * Stores the shell again when it is not all there. What install stored can
 * be gone by the time this worker is in control: the worker of another
 * version that was active while this one waited may have deleted it as a
 * leftover, and a browser short of space evicts caches. Without this the app
 * would go on working from the network and fail at the first launch without
 * a connection.
 */
async function restoreShell(): Promise<void> {
  if (!(await shellStored())) await storeShell();
}

self.addEventListener("install", (event) => {
  event.waitUntil(Promise.all([storeShell(), ensureCatalog(env)]));
});

const withoutQuery = (url: string): string => url.split(/[?#]/)[0] ?? url;

/**
 * Deletes what nothing needs any more, when that can be known: the shells of
 * other versions, every build but the current one, and icons the current
 * build no longer uses. It runs when a page says it has launched, which is
 * the one moment the worker knows what that window runs and shows. Another
 * open window of the app may be on an older shell or an older catalog
 * (`holdsFiles`), and a worker that is installing or waiting has just stored
 * files this one knows nothing about; in either case nothing is touched, and
 * the next launch asks again. A window that shows a file of the site and not
 * the app is not asked: it uses nothing of this.
 *
 * The shell of the window that launched is the one its document was
 * answered with, when this worker answered it. A document some other
 * worker answered, which this one then took control of, is on this shell
 * only if the script it runs is one of this shell's files.
 */
async function tidy(launched: Client, script: unknown, build: unknown): Promise<void> {
  const now = Date.now();
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const others = windows.filter((client) => client.id !== launched.id && isAppAddress(client.url, scope)).map((client) => client.id);
  const records = await openWindows(env, [launched.id, ...others], now);
  const file = typeof script === "string" && script.startsWith(scope) ? withoutQuery(script).slice(scope.length) : null;
  const answered = records.get(launched.id)?.shell ?? null;
  const own = await noteWindow(env, launched.id, {
    ...(answered === null && file !== null && SHELL_FILES.includes(file) ? { shell: __SHELL_VERSION__ } : {}),
    ...(typeof build === "string" ? { build } : {}),
  }, now);
  const { current } = await readPointers(env);
  const holding = others.filter((id) => {
    const record = records.get(id);
    return record !== undefined && holdsFiles(record, __SHELL_VERSION__, current?.hash ?? null, now);
  });
  const facts = {
    windowsHoldingFiles: holding.length,
    newerWorkerPending: self.registration.waiting !== null || self.registration.installing !== null,
    runsThisShell: own.shell === __SHELL_VERSION__,
    showsCurrentBuild: current !== null && own.build === current.hash,
  };
  if (mayPurge(facts)) await purge(env, __SHELL_VERSION__);
}

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await restoreShell().catch(() => undefined);
    await self.clients.claim();
  })());
});

/**
 * Rule 6, in two steps. A page that is loading asks this waiting worker
 * whether it is there to take over, and only a page that received the answer
 * in time, before it rendered, sends the instruction to do it. An answer
 * that arrives after the page gave up waiting therefore activates nothing:
 * no page has its worker changed after it has rendered because of a question
 * it asked.
 */
self.addEventListener("message", (event) => {
  const data: unknown = event.data;
  const type = typeof data === "object" && data !== null ? (data as { type?: unknown }).type : null;
  if (type === TAKEOVER_QUESTION) event.ports[0]?.postMessage({ takeOver: true });
  else if (type === TAKEOVER_COMMAND) event.waitUntil(self.skipWaiting());
  else if (type === LAUNCHED_MESSAGE && event.source instanceof Client) {
    const { script, build } = data as { script?: unknown; build?: unknown };
    const reply = event.ports[0];
    const launched = event.source;
    event.waitUntil((async () => {
      await restoreShell().catch(() => undefined);
      await tidy(launched, script, build).catch(() => undefined);
      reply?.postMessage({ tidied: true });
    })());
  }
});

function cacheable(response: Response): boolean {
  return response.status === 200 && response.type === "basic";
}

async function shellFile(request: Request, file: string): Promise<Response> {
  const cached = await (await caches.open(SHELL_CACHE)).match(scope + file);
  return cached ?? fetch(request);
}

/** A file of another version's shell, for a window still open on it: from wherever it is stored, else the network. Built assets are named by their content, so a stored one is always right. */
async function otherShellFile(request: Request): Promise<Response> {
  return (await caches.match(request.url.split(/[?#]/)[0] ?? request.url)) ?? fetch(request);
}

/** Keeps a copy of a response only when its bytes hash to what is expected of them. Returns the response either way. */
async function keepIfVerified(cache: Cache, key: string, response: Response, verify: (digest: string) => boolean): Promise<Response> {
  if (!cacheable(response)) return response;
  const copy = response.clone();
  const digest = await env.digest(await response.clone().arrayBuffer());
  if (digest !== null && verify(digest)) await cache.put(key, copy);
  return response;
}

/**
 * A file of one build (rule 5). Builds are stored whole and verified by the
 * install step or an update; this handler only serves what is stored, and
 * adds the files fetched as they are viewed (description shards, icon
 * credits) once each matches the SHA-256 the stored manifest lists for it.
 * A build that is not stored is not touched: its files go to the network and
 * nothing of them is kept, so a download that fails verification leaves no trace.
 */
async function buildFile(request: Request, directory: string): Promise<Response> {
  const name = buildCacheName(directory);
  if (!(await caches.has(name))) return fetch(request);
  const cache = await caches.open(name);
  const key = withoutQuery(request.url);
  const cached = await cache.match(key);
  if (cached) return cached;
  const response = await fetchAnswering(request, QUIET_MS);
  const base = `${env.dataRoot}c/${directory}/`;
  const manifest: unknown = await (await cache.match(`${base}manifest.json`))?.json().catch(() => null);
  const expected = key.startsWith(base) ? listedDigest(manifest, key.slice(base.length)) : null;
  return expected ? keepIfVerified(cache, key, response, (digest) => digest === expected) : response;
}

/** An icon (rule 5): from the cache once seen, kept when its bytes hash to its own name. */
async function iconFile(request: Request): Promise<Response> {
  const cache = await caches.open(ICON_CACHE);
  const key = withoutQuery(request.url);
  const cached = await cache.match(key);
  if (cached) return cached;
  const response = await fetchAnswering(request, QUIET_MS);
  const prefix = iconDigestPrefix(key);
  return prefix ? keepIfVerified(cache, key, response, (digest) => digest.startsWith(prefix)) : response;
}

/** Files that can change in place: the network when it answers, otherwise the copy kept from last time. */
async function networkFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (cacheable(response)) await cache.put(request.url, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request.url);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const kind = classifyRequest({ method: request.method, mode: request.mode, url: request.url }, scope, SHELL_FILES);
  switch (kind.kind) {
    case "navigate":
      event.respondWith(shellFile(request, DOCUMENT));
      /* Which shell this document gets is known here and nowhere else: the page cannot tell one shell from another that has the same script. */
      if (event.resultingClientId) event.waitUntil(noteWindow(env, event.resultingClientId, { shell: __SHELL_VERSION__ }, Date.now()).catch(() => undefined));
      break;
    case "shell":
      event.respondWith(shellFile(request, kind.file));
      break;
    case "other-shell":
      event.respondWith(otherShellFile(request));
      break;
    case "build-file":
      event.respondWith(buildFile(request, kind.hash));
      break;
    case "icon":
      event.respondWith(iconFile(request));
      break;
    case "viewed":
      event.respondWith(networkFirst(request, VIEWED_CACHE));
      break;
    default:
      break;
  }
});
