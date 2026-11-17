/**
 * End-to-end check of "Offline and updates" (docs/ARCHITECTURE.md) in a real
 * Chromium, against the built site:
 *
 *   node scripts/e2e-offline.ts <cdp-websocket-url> [--dist dist] [--port 4321] [--patience 1] [--only 7] [--shots <directory>]
 *
 * `--patience` multiplies every wait, for a machine that is busy with other work.
 * `--only` runs the scenarios whose number starts with what is given.
 * `--shots` saves pictures, in both themes, of the screens only this script
 * reaches (a window that has been left behind), to be looked at.
 *
 * It serves the build from a small static server of its own, so it can go
 * "offline" (every connection is dropped), publish a second catalog, serve a
 * damaged one, or serve a newer worker, and it drives a browser over the
 * DevTools protocol. Each scenario runs in a browser context of its own, with
 * its own storage and service worker.
 *
 *  1. First load online, then a launch with the site unreachable.
 *  2. A second catalog is published: stored during a session, shown only at
 *     the next launch.
 *  3. A catalog with a damaged part, and one whose manifest belongs to
 *     another build: nothing on the device changes.
 *  4. A catalog in a newer format: refused, with the reload prompt.
 *     A first visit to a site that never answers gives up within ten
 *     seconds, and one that answers slowly is waited for.
 *  5. A newer worker: waits through the session and takes over at the next
 *     load of the page, with one reload at most. Another window that is open
 *     does not hold it back and is left as it was, with its shell's files.
 *  7. A deploy under a single window that is never closed: nothing changes
 *     while the session goes on, and loading the page again (a reload, or
 *     the same address opened again) runs the new shell, which then also
 *     opens with the site unreachable. And a waiting worker whose stored
 *     shell was deleted before it took over stores it again.
 *  8. Two deploys with a window left open on the first version: nothing it
 *     uses is deleted while it is open; when a file its catalog never stored
 *     is gone from the site it says a newer catalog is ready and offers a
 *     reload; once it is the only window, a launch leaves one build and one
 *     shell stored, and no icon the current build does not use.
 *  9. What does not hold the purge: a window that shows a file of the site
 *     and not the app, and, after a day, a window of the app that never said
 *     what it shows.
 *
 * Exits 0 when every check passes, 1 otherwise. What it cannot show is what
 * only a phone shows: the installed app, the system Back gesture, a process
 * that Android killed.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  options: { dist: { type: "string", default: "dist" }, port: { type: "string", default: "4321" }, patience: { type: "string", default: "1" }, only: { type: "string" }, shots: { type: "string" } },
  allowPositionals: true,
});
const endpoint = positionals[0];
if (!endpoint) {
  console.error("usage: node scripts/e2e-offline.ts <cdp-websocket-url> [--dist dist] [--port 4321] [--patience 1]");
  process.exit(2);
}
const dist = resolve(values.dist);
const port = Number(values.port);
const patience = Math.max(1, Number(values.patience) || 1);
const origin = `http://127.0.0.1:${port}`;
if (!existsSync(join(dist, "sw.js")) || !existsSync(join(dist, "data/version.json"))) {
  console.error(`${dist} is not a built site with data: run the pipeline, then the app build.`);
  process.exit(2);
}

// ---------- the site ----------

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
};

/** Files served instead of the build's own: a path maps to its bytes, or to null for "not found". */
const overlay = new Map<string, Buffer | null>();
let unreachable = false;
/** Path prefixes the site no longer has: a build directory removed by a later deploy. */
const withdrawn = new Set<string>();
/** Paths the server answers only after this many milliseconds, as a slow connection would. */
const delays = new Map<string, number>();
const requested: string[] = [];

function startServer(): Promise<Server> {
  const server = createServer((request, response) => {
    if (unreachable) {
      request.socket.destroy();
      return;
    }
    const path = decodeURIComponent((request.url ?? "/").split("?")[0] ?? "/");
    requested.push(path);
    const local = path.endsWith("/") ? `${path}index.html` : path;
    let body: Buffer | null | undefined = [...withdrawn].some((prefix) => local.startsWith(prefix)) ? null : overlay.get(local);
    if (body === undefined) {
      const file = normalize(join(dist, local));
      body = file.startsWith(dist) && existsSync(file) && statSync(file).isFile() ? readFileSync(file) : null;
    }
    if (body === null) {
      response.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const answer = (): void => {
      response.writeHead(200, { "Content-Type": TYPES[extname(local)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : body);
    };
    const delay = delays.get(local);
    if (delay) setTimeout(answer, delay);
    else answer();
  });
  return new Promise((done) => server.listen(port, "127.0.0.1", () => done(server)));
}

const sha = (bytes: Buffer | string): string => createHash("sha256").update(bytes).digest("hex");
const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

interface Version { schema: number; generatedAt: string; hash: string; manifest: string }
interface Manifest { schema: number; generatedAt: string; hash: string; files: { path: string; role: string; sha256: string; bytes: number }[] }

const liveVersion = JSON.parse(readFileSync(join(dist, "data/version.json"), "utf8")) as Version;
const liveDir = liveVersion.manifest.split("/")[1] ?? "";
const liveManifest = JSON.parse(readFileSync(join(dist, "data", liveVersion.manifest), "utf8")) as Manifest;

/**
 * Publishes another catalog beside the built one: the same parts under a new
 * hash and date. `damage` alters it after the manifest is written, the way a
 * broken deploy or a tampering proxy would.
 */
function publish(seed: string, generatedAt: string, options: { schema?: number; damage?: "part" | "foreign-manifest" } = {}): Version {
  const hash = sha(`${seed}:${liveVersion.hash}`);
  const dir = hash.slice(0, 16);
  const version: Version = { schema: options.schema ?? liveVersion.schema, generatedAt, hash, manifest: `c/${dir}/manifest.json` };
  const atlas = JSON.parse(readFileSync(join(dist, "data/c", liveDir, "atlas.json"), "utf8")) as Record<string, unknown>;
  const atlasBytes = json({ ...atlas, schema: version.schema, hash, generatedAt });
  const manifest: Manifest = {
    ...liveManifest,
    schema: version.schema,
    hash,
    generatedAt,
    files: liveManifest.files.map((file) => (file.path === "atlas.json" ? { ...file, sha256: sha(atlasBytes), bytes: atlasBytes.length } : file)),
  };
  for (const file of liveManifest.files) {
    if (file.path.startsWith("..") || file.role === "details") continue;
    overlay.set(`/data/c/${dir}/${file.path}`, file.path === "atlas.json" ? atlasBytes : readFileSync(join(dist, "data/c", liveDir, file.path)));
  }
  overlay.set(`/data/${version.manifest}`, json(options.damage === "foreign-manifest" ? liveManifest : manifest));
  if (options.damage === "part") {
    const victim = `/data/c/${dir}/sources/github.json`;
    overlay.set(victim, Buffer.concat([overlay.get(victim) ?? Buffer.alloc(0), Buffer.from(" ")]));
  }
  overlay.set("/data/version.json", json(version));
  return version;
}

// ---------- the browser ----------

interface Reply { id?: number; result?: Record<string, unknown>; error?: { message: string } }
const socket = new WebSocket(endpoint);
const waiting = new Map<number, (reply: Reply) => void>();
let nextId = 1;
socket.addEventListener("message", (event) => {
  const reply = JSON.parse(String(event.data)) as Reply;
  if (reply.id === undefined) return;
  waiting.get(reply.id)?.(reply);
  waiting.delete(reply.id);
});

function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
  const id = nextId++;
  return new Promise((done, fail) => {
    waiting.set(id, (reply) => (reply.error ? fail(new Error(`${method}: ${reply.error.message}`)) : done(reply.result ?? {})));
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms * patience));

/** What a page that did not get where it was expected looks like, for the failure message. */
const PAGE_STATE = `(async () => {
  const within = (promise) => Promise.race([promise, new Promise((done) => setTimeout(() => done("NO ANSWER"), 2000))]);
  const state = (worker) => (worker ? worker.state : "none");
  const registration = await within(navigator.serviceWorker.getRegistration().then((r) => (r ? "waiting " + state(r.waiting) + ", active " + state(r.active) : "none")));
  return [
    location.href,
    "shows: " + (document.body ? document.body.innerText : "").replace(/\\s+/g, " ").slice(0, 80),
    "controller: " + state(navigator.serviceWorker.controller),
    "registration: " + registration,
    Math.round(performance.now()) + " ms after its navigation started",
  ].join(" | ");
})()`;

class Window {
  readonly targetId: string;
  readonly sessionId: string;

  constructor(targetId: string, sessionId: string) {
    this.targetId = targetId;
    this.sessionId = sessionId;
  }

  /** Evaluates in the page; undefined while the page is between documents. */
  async evaluate(expression: string): Promise<unknown> {
    try {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, this.sessionId);
      return (result.result as { value?: unknown } | undefined)?.value;
    } catch {
      return undefined;
    }
  }

  async until(expression: string, what: string, timeoutMs = 20_000): Promise<unknown> {
    const deadline = Date.now() + timeoutMs * patience;
    while (Date.now() < deadline) {
      const value = await this.evaluate(expression);
      if (value) return value;
      await pause(100);
    }
    /* A page that is waiting on a navigation does not answer either, so the report has its own limit. */
    const shown = await Promise.race([this.evaluate(PAGE_STATE), new Promise<string>((done) => setTimeout(() => done("gave no answer within 5 s"), 5000))]);
    throw new Error(`timed out waiting for ${what}; the page: ${typeof shown === "string" ? shown : "nothing that can be read"}`);
  }

  /** A launch: a fresh document at the given address, waited for until the app has rendered or said why it cannot. */
  async launch(path = "/"): Promise<void> {
    await this.evaluate("window.__launched = true");
    await send("Page.navigate", { url: `${origin}/?launch=${nextId}#${path}` }, this.sessionId);
    await this.until("!window.__launched && document.readyState === 'complete' && (document.querySelector('.nav') || document.querySelector('.status-title')) !== null && document.querySelector('div.main[aria-busy]') === null", "the app to render");
    await pause(150);
  }

  /** The reload button: the same address loaded again in the same window, waited for like a launch. */
  async reload(): Promise<void> {
    await this.evaluate("window.__launched = true");
    await send("Page.reload", {}, this.sessionId);
    await this.until("!window.__launched && document.readyState === 'complete' && (document.querySelector('.nav') || document.querySelector('.status-title')) !== null && document.querySelector('div.main[aria-busy]') === null", "the app to render after a reload");
    await pause(150);
  }

  async close(): Promise<void> {
    await send("Target.closeTarget", { targetId: this.targetId });
  }

  /** Saves a picture of the window in each theme, when pictures were asked for. */
  async shoot(name: string): Promise<void> {
    if (values.shots === undefined) return;
    const directory = resolve(values.shots);
    mkdirSync(directory, { recursive: true });
    for (const theme of ["light", "dark"]) {
      await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] }, this.sessionId);
      await pause(250);
      const { data } = (await send("Page.captureScreenshot", { format: "png" }, this.sessionId)) as { data: string };
      writeFileSync(join(directory, `${name}-${theme}.png`), Buffer.from(data, "base64"));
    }
    await send("Emulation.setEmulatedMedia", { features: [] }, this.sessionId);
  }
}

async function openWindow(browserContextId: string): Promise<Window> {
  const { targetId } = (await send("Target.createTarget", { url: "about:blank", browserContextId })) as { targetId: string };
  const { sessionId } = (await send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
  await send("Page.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride", { width: 384, height: 688, deviceScaleFactor: 1, mobile: true }, sessionId);
  return new Window(targetId, sessionId);
}

// ---------- what the page is asked ----------

const SHOWN_DATE = "document.querySelector('.caption-link')?.textContent ?? null";
const CONTROLLED = "navigator.serviceWorker.controller !== null";
/** Whether the page's own navigation was answered by a service worker. Unlike CONTROLLED it cannot change after the load: a first worker claims the open page as soon as it activates. */
const LOADED_THROUGH_WORKER = "performance.getEntriesByType('navigation')[0].workerStart > 0";
const WORKER_ACTIVE = "navigator.serviceWorker.getRegistration().then((r) => Boolean(r && r.active && !r.installing))";
const WORKER_WAITING = "navigator.serviceWorker.getRegistration().then((r) => Boolean(r && r.waiting))";
const POINTER = (key: string): string => `caches.open('droid-atlas:pointer').then((c) => c.match(new URL('./data/pointer/${key}.json', document.baseURI).href)).then((r) => (r ? r.json() : null)).then((v) => (v ? v.hash : null))`;
const CACHE_NAMES = "caches.keys().then((names) => names.sort().join(' '))";
/** The stored builds and shells, by cache name. */
const STORED = (kind: "build" | "shell"): string => `caches.keys().then((names) => names.filter((name) => name.startsWith('droid-atlas:${kind}:')).sort().join(' '))`;
const ICON_URL = (name: string): string => `new URL('./data/icons/${name}.webp', document.baseURI).href`;
const STORED_ICONS = "caches.open('droid-atlas:icons').then((cache) => cache.keys()).then((requests) => requests.map((request) => request.url))";
const ROWS = "document.querySelectorAll('.rows > .row').length";
const SHEET_ICON = "(() => { const img = document.querySelector('.sheet-head .ico img'); return Boolean(img && img.complete && img.naturalWidth > 0); })()";
const TILES = "document.querySelectorAll('.mosaic .tile').length";

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function sheetRoutes(): [string, string] {
  const atlas = JSON.parse(readFileSync(join(dist, "data/c", liveDir, "atlas.json"), "utf8")) as { apps: { id: string; region: string; icon: string | null; facets: { onFdroid: boolean } }[] };
  const shardCount = (JSON.parse(readFileSync(join(dist, "data", liveVersion.manifest), "utf8")) as { detailsShards: number }).detailsShards;
  const shardOf = (id: string): number => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < id.length; i += 1) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) % shardCount;
  };
  const described = (id: string): boolean => {
    const file = join(dist, "data/c", liveDir, "details/fdroid", `${shardOf(id)}.json`);
    return existsSync(file) && Object.hasOwn(JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>, id);
  };
  const candidates = atlas.apps.filter((app) => app.icon && app.facets.onFdroid && /^[A-Za-z0-9._-]+$/.test(app.id) && described(app.id));
  const first = candidates[0];
  const second = candidates.find((app) => first && shardOf(app.id) !== shardOf(first.id));
  if (!first || !second) throw new Error("the build has no two described apps in different shards to test with");
  return [`/region/${first.region}?app=${first.id}`, `/region/${second.region}?app=${second.id}`];
}

// ---------- the checks ----------

let failures = 0;
function check(condition: unknown, what: string, detail?: unknown): void {
  if (condition) {
    console.log(`  ok    ${what}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${what}${detail === undefined ? "" : `  (got ${JSON.stringify(detail)})`}`);
}

async function scenario(title: string, run: (first: Window, context: string) => Promise<void>): Promise<void> {
  if (values.only !== undefined && !title.startsWith(values.only)) return;
  console.log(`\n${title}`);
  overlay.clear();
  delays.clear();
  withdrawn.clear();
  unreachable = false;
  const { browserContextId } = (await send("Target.createBrowserContext")) as { browserContextId: string };
  try {
    await run(await openWindow(browserContextId), browserContextId);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL  ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await send("Target.disposeBrowserContext", { browserContextId }).catch(() => undefined);
  }
}

/** Two launches: the first installs the worker and stores the catalog, the second runs under the worker from what is stored and has finished tidying. */
async function settled(window: Window): Promise<void> {
  await window.launch("/");
  await window.until(WORKER_ACTIVE, "the service worker to install and activate", 40_000);
  await window.until(POINTER("current"), "the catalog to be stored");
  await window.launch("/");
  await window.until(CONTROLLED, "the worker to control the page");
  await window.until(POINTER("icons-for"), "the worker to finish tidying after the launch");
}

const liveLabel = dateLabel(liveVersion.generatedAt);
/** Two entries with an icon and a repository description that land in different description shards: one is opened while online, the other never. */
const [VIEWED, NOT_VIEWED] = sheetRoutes();
const server = await startServer();
await new Promise<void>((done, fail) => {
  socket.addEventListener("open", () => done());
  socket.addEventListener("error", () => fail(new Error(`cannot connect to ${endpoint}`)));
});

try {
  await scenario("1. First load online, then launches with the site unreachable", async (window) => {
    await window.launch("/");
    check((await window.evaluate(TILES)) as number > 5, "the first load renders the map from the network");
    check(await window.evaluate(LOADED_THROUGH_WORKER) === false, "no worker answered the first load");
    await window.until(WORKER_ACTIVE, "the service worker to install and activate", 40_000);
    check(await window.until(POINTER("current"), "the catalog to be stored") === liveVersion.hash, "install stored the catalog version.json names");
    const names = String(await window.evaluate(CACHE_NAMES));
    check(names.includes("droid-atlas:shell:") && names.includes(`droid-atlas:build:${liveDir}`), "install stored the shell and the build", names);

    await window.launch(VIEWED);
    await window.until("document.querySelector('.desc')?.textContent", "an app's description to load");
    await window.until(SHEET_ICON, "the app's icon to load");
    await pause(600);

    unreachable = true;
    const launchedAt = Date.now();
    await window.launch("/");
    check(await window.evaluate(CONTROLLED) && await window.evaluate(LOADED_THROUGH_WORKER), "the offline launch is served by the worker");
    check((await window.evaluate(TILES)) as number > 5, "the offline launch renders the map");
    check(await window.evaluate(SHOWN_DATE) === liveLabel, "it shows the stored catalog's date", await window.evaluate(SHOWN_DATE));
    const lastLine = String(await window.until("[...document.querySelectorAll('.colophon p')].map((line) => line.textContent ?? '').find((text) => text.startsWith('Offline · catalog of ')) ?? null", "Explore's last line to say the copy is stored", 10_000 / patience));
    check(Date.now() - launchedAt <= 10_000 * patience, "within 10 seconds of launch, Explore's last line says it is showing a stored copy", lastLine);
    await window.launch("/region/media");
    check((await window.evaluate(ROWS)) as number >= 5, "a list opens offline", await window.evaluate(ROWS));
    await window.launch(VIEWED);
    await window.until("document.querySelector('#sheet-title')?.textContent", "the app sheet offline");
    check(await window.until("document.querySelector('.desc')?.textContent", "the description offline").catch(() => null), "a description viewed online is there offline");
    check(await window.until(SHEET_ICON, "the icon offline").catch(() => null), "an icon viewed online is there offline");
    await window.launch(NOT_VIEWED);
    await window.until("/The description did not load/.test(document.querySelector('.sheet-body')?.textContent ?? '')", "the description that was never fetched to be reported missing");
    check(true, "a description never viewed says it did not load, and the rest of the sheet is there");
    await send("Page.navigate", { url: `${origin}/?utm_source=share&x=1#/search` }, window.sessionId);
    await window.until("document.querySelector('#search-input') !== null", "a launch with a query string to render offline");
    check(true, "a page load with a query string resolves to the shell offline");
    await send("Page.navigate", { url: `${origin}/index.html#/saved` }, window.sessionId);
    await window.until("document.title.startsWith('Saved')", "a launch by /index.html to render offline");
    check(true, "a page load of /index.html resolves to the shell offline");
    await window.launch("/about/health");
    const status = String(await window.until("document.querySelector('#health-offline')?.parentElement?.textContent", "the offline status"));
    check(/^Offline copyReady(?! from)/.test(status), "Data health says the offline copy is ready", status.slice(0, 120));
    await window.until("/site not reachable/.test(document.querySelector('#health-offline')?.parentElement?.textContent ?? '')", "the failed check to be reported");
    check(true, "the check for a newer catalog reports that the site could not be reached");
    check(await window.evaluate(POINTER("current")) === liveVersion.hash, "being offline changed nothing that is stored");
  });

  await scenario("2. A second catalog is stored during a session and shown at the next launch", async (window) => {
    await settled(window);
    check(await window.evaluate(SHOWN_DATE) === liveLabel, "the session starts on the first catalog");
    const next = publish("second", "2026-12-25T06:00:00.000Z");
    check(await window.evaluate(POINTER("current")) === liveVersion.hash, "publishing alone changes nothing on the device");

    await window.launch("/");
    check(await window.evaluate(SHOWN_DATE) === liveLabel, "the launch after publishing still renders the stored catalog");
    await window.until(`${POINTER("current")}.then((hash) => hash === '${next.hash}')`, "the new catalog to be stored in the background", 30_000);
    check(await window.evaluate(POINTER("previous")) === liveVersion.hash, "the catalog that was current is kept as the previous one");
    check(await window.evaluate(SHOWN_DATE) === liveLabel, "the open session still shows the first catalog after the new one is stored");
    await window.evaluate("location.hash = '#/region/media'");
    await window.until(`${ROWS} > 0`, "the region list");
    await window.evaluate("history.back()");
    await window.until(TILES, "the map again");
    check(await window.evaluate(SHOWN_DATE) === liveLabel, "moving around inside the session does not switch catalogs");
    await window.evaluate("location.hash = '#/about/health'");
    await window.until("/shows on the next launch/.test(document.body.textContent)", "the pending-catalog notice");
    check(true, "Data health says a newer catalog is stored for the next launch");

    await window.launch("/");
    check(await window.evaluate(SHOWN_DATE) === dateLabel(next.generatedAt), "the next launch shows the new catalog", await window.evaluate(SHOWN_DATE));
    unreachable = true;
    await window.launch("/");
    check(await window.evaluate(SHOWN_DATE) === dateLabel(next.generatedAt), "and the new catalog opens offline");
  });

  await scenario("3. A damaged catalog changes nothing", async (window) => {
    await settled(window);
    const before = String(await window.evaluate(CACHE_NAMES));

    const damaged = publish("damaged", "2026-12-26T06:00:00.000Z", { damage: "part" });
    await window.launch("/about/health");
    await window.until("/new catalog refused: a file did not match its checksum/.test(document.body.textContent)", "the refusal of the damaged catalog", 30_000);
    check(true, "a part that does not match its SHA-256 is refused, and the page says why");
    check(await window.evaluate(POINTER("current")) === liveVersion.hash, "the stored catalog is still the current one");
    check(String(await window.evaluate(CACHE_NAMES)) === before, "no cache was created or removed", await window.evaluate(CACHE_NAMES));
    check(!String(await window.evaluate(CACHE_NAMES)).includes(damaged.hash.slice(0, 16)), "nothing of the damaged build was stored");

    publish("foreign", "2026-12-27T06:00:00.000Z", { damage: "foreign-manifest" });
    await window.launch("/about/health");
    await window.until("/new catalog refused: /.test(document.body.textContent)", "the refusal of the mismatched manifest", 30_000);
    check(true, "a manifest whose hash is not the version's is refused");
    check(await window.evaluate(POINTER("current")) === liveVersion.hash, "the stored catalog is still the current one");
    check(String(await window.evaluate(CACHE_NAMES)) === before, "no cache was created or removed");

    await window.launch("/");
    check(await window.evaluate(SHOWN_DATE) === liveLabel, "the next launch still shows the catalog that was stored");
  });

  await scenario("4. A catalog in a newer format is refused with the reload prompt", async (window) => {
    await settled(window);
    const before = String(await window.evaluate(CACHE_NAMES));
    publish("future", "2027-01-01T06:00:00.000Z", { schema: liveVersion.schema + 1 });
    requested.length = 0;
    await window.launch("/");
    await window.until("document.querySelector('.reload-prompt') !== null", "the reload prompt", 30_000);
    check(true, "the reload prompt appears");
    check(await window.evaluate(SHOWN_DATE) === liveLabel, "the stored catalog is still shown");
    check(await window.evaluate(POINTER("current")) === liveVersion.hash, "the stored catalog is still the current one");
    check(String(await window.evaluate(CACHE_NAMES)) === before, "no cache was created or removed");
    check(!requested.some((path) => path.includes("/manifest.json")), "nothing of the newer catalog was fetched beyond version.json", requested.filter((path) => path.startsWith("/data/")));
    check(await window.evaluate("document.querySelector('.reload-prompt button')?.textContent") === "Reload", "the prompt offers a reload");
  });

  await scenario("4b. A first visit that meets a newer format says so instead of rendering", async (window) => {
    publish("future", "2027-01-01T06:00:00.000Z", { schema: liveVersion.schema + 1 });
    await window.launch("/");
    check(await window.evaluate("document.querySelector('.status-title')?.textContent") === "The app needs an update", "the out-of-date screen is shown", await window.evaluate("document.querySelector('.status-title')?.textContent"));
    check(await window.evaluate("[...document.querySelectorAll('.status-actions button')].map((b) => b.textContent).join()") === "Reload", "it offers a reload");
    await pause(1500);
    check(await window.evaluate("navigator.serviceWorker.getRegistration().then((r) => !r || !r.active)"), "no worker is left in control without a catalog");
  });

  await scenario("4c. A first visit to a site that never answers gives up within ten seconds, and one that answers slowly is waited for", async (window) => {
    delays.set("/data/version.json", 60_000);
    const began = Date.now();
    await window.launch("/");
    const waited = Date.now() - began;
    check(await window.evaluate("document.querySelector('.status-title')?.textContent") === "The catalog did not load", "the failure screen is shown", await window.evaluate("document.querySelector('.status-title')?.textContent"));
    check(waited < 10_000 * patience, "within ten seconds of the launch", `${(waited / 1000).toFixed(1)} s`);
    delays.set("/data/version.json", 6_000);
    await window.launch("/");
    check((await window.evaluate(TILES)) as number > 5, "a catalog that answers after six seconds is waited for and renders the map");
  });

  /** Publishes a worker that differs from the built one only in the shell version it is compiled with, and returns both versions. */
  const publishNewerWorker = async (window: Window, newVersion: string): Promise<{ oldShell: string; newShell: string }> => {
    const oldShell = String(await window.evaluate(CACHE_NAMES)).split(" ").find((name) => name.startsWith("droid-atlas:shell:")) ?? "";
    const worker = readFileSync(join(dist, "sw.js"), "utf8");
    const oldVersion = oldShell.slice("droid-atlas:shell:".length);
    check(worker.includes(oldVersion), "the built worker carries the shell version its cache is named for", oldVersion);
    overlay.set("/sw.js", Buffer.from(worker.replaceAll(oldVersion, newVersion)));
    await window.launch("/");
    await window.until(WORKER_WAITING, "the newer worker to install and wait", 40_000);
    return { oldShell, newShell: `droid-atlas:shell:${newVersion}` };
  };
  const COUNT_LOADS = "try { sessionStorage.setItem('e2e-loads', String((Number(sessionStorage.getItem('e2e-loads')) || 0) + 1)); } catch (e) {}";
  /** Serves a document that says which deploy it belongs to, so a page can be asked which shell it is running. */
  const deploySecondShell = (): void => {
    const html = readFileSync(join(dist, "index.html"), "utf8");
    overlay.set("/index.html", Buffer.from(html.replace("<head>", '<head>\n  <meta name="e2e-shell" content="second">')));
  };
  const SHELL = "document.querySelector('meta[name=\"e2e-shell\"]')?.getAttribute('content') ?? 'first'";
  const RENDERED = "document.querySelector('.nav') !== null && sessionStorage.getItem('e2e-loads') !== '0'";

  await scenario("5. A newer worker waits through the session and takes over at the next launch when alone", async (window) => {
    await settled(window);
    const { oldShell, newShell } = await publishNewerWorker(window, "feedc0de00000001");
    await pause(2500);
    check(await window.evaluate(WORKER_WAITING), "the newer worker is still waiting: it did not activate during the session");
    check(String(await window.evaluate(CACHE_NAMES)).includes(oldShell), "the old shell's files are still stored for the open session");

    await send("Page.addScriptToEvaluateOnNewDocument", { source: COUNT_LOADS }, window.sessionId);
    const tookOver = `Promise.all([${CACHE_NAMES}, ${WORKER_WAITING}]).then(([names, waiting]) => names.includes('${newShell}') && !waiting)`;
    const oldShellGone = `${CACHE_NAMES}.then((names) => !names.includes('${oldShell}'))`;
    /*
     * A worker that is slow to wake answers too late for that launch, and the
     * page goes on with the old shell: the takeover is then the next launch's.
     * And the browser may hold the handover back after it was asked for, in
     * which case the launch stops waiting, renders with the shell it has and
     * is not loaded again when the worker changes under it.
     */
    let loads: unknown = null;
    let slowest = 0;
    for (let attempt = 1; attempt <= 4 && loads === null; attempt += 1) {
      await window.evaluate("sessionStorage.setItem('e2e-loads', '0')");
      const started = Date.now();
      await send("Page.navigate", { url: `${origin}/?takeover=${attempt}#/` }, window.sessionId);
      await window.until(RENDERED, "the launch to render");
      slowest = Math.max(slowest, Date.now() - started);
      await pause(2500);
      if (await window.evaluate(tookOver)) loads = await window.evaluate("sessionStorage.getItem('e2e-loads')");
      else check(await window.evaluate(WORKER_WAITING), `launch ${attempt} went on without a takeover and the newer worker is still waiting`);
    }
    check(loads !== null, "alone, a launch lets the newer worker take over");
    check(await window.evaluate(WORKER_WAITING) === false, "no worker is left waiting");
    /* A launch that stopped waiting for the handover is still on the old shell, whose files are then kept until the next launch. */
    let gone = await window.until(oldShellGone, "the old shell to be removed", 4000).then(() => true, () => false);
    if (!gone && loads === "1") {
      await window.launch("/");
      gone = await window.until(oldShellGone, "the old shell to be removed", 4000).then(() => true, () => false);
    }
    check(gone, "the old shell is removed by the first launch that runs the new one", await window.evaluate(CACHE_NAMES));
    check(slowest < 9000 * patience, "no launch waited on the handover for longer than it is prepared to", `${slowest} ms`);
    check(loads === "2" || loads === "1", "that launch loaded the page twice (the launch, and one reload under the new worker), or once when the handover came after it had stopped waiting", loads);
    console.log(`  note  the takeover launch loaded ${String(loads)} document(s); the slowest launch took ${slowest} ms to render`);
    check((await window.evaluate(TILES)) as number > 5, "and it rendered");
  });

  await scenario("5b. With a second window open, a launch still gets the new shell, and the other window is left as it was", async (window, context) => {
    await settled(window);
    const second = await openWindow(context);
    await second.launch("/");
    deploySecondShell();
    const { oldShell, newShell } = await publishNewerWorker(window, "feedc0de00000002");
    await second.evaluate("window.__session = 'the one that was open'");

    const shells: unknown[] = [];
    for (let load = 1; load <= 2; load += 1) {
      await window.launch("/");
      await pause(1200);
      shells.push(await window.evaluate(SHELL));
    }
    check(shells[1] === "second", "by its second load after the deploy the launching window runs the new shell", shells);
    check(await window.evaluate(WORKER_WAITING) === false, "no worker is left waiting");
    check(await second.evaluate("window.__session") === "the one that was open", "the other window's document was not replaced");
    check(await second.evaluate(SHELL) === "first", "the other window still runs the shell it started with", await second.evaluate(SHELL));
    await pause(1500);
    const kept = String(await window.evaluate(CACHE_NAMES));
    check(kept.includes(oldShell) && kept.includes(newShell), "the old shell stays stored while a window may still be running it", kept);

    unreachable = true;
    await second.evaluate("location.hash = '#/region/media'");
    await second.until(`${ROWS} > 0`, "a list in the other window, with the site unreachable");
    check(await second.evaluate("fetch(document.querySelector('script[type=\"module\"]').src).then((r) => r.ok, () => false)"), "the other window can still load its own shell's script, from the device");
    unreachable = false;

    await second.reload();
    check(await second.evaluate(SHELL) === "second", "when the other window is loaded again, it runs the new shell too", await second.evaluate(SHELL));
    await second.close();
    await window.launch("/");
    await window.until(`${CACHE_NAMES}.then((names) => !names.includes('${oldShell}'))`, "the old shell to be removed once no other window is open");
    check(true, "the old shell is removed once the launching window is the only one");
    check((await window.evaluate(TILES)) as number > 5, "and the app is on screen");
  });

  await scenario("6. A takeover asked while the old worker is still answering a slow request does not hold up the launch", async (window) => {
    await settled(window);
    await publishNewerWorker(window, "feedc0de00000003");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: COUNT_LOADS }, window.sessionId);

    /* A file the worker fetches from the network before it answers, held back by the server for longer than any launch should take. */
    delays.set("/third-party-licenses.txt", 120_000);
    await window.evaluate("void fetch('./third-party-licenses.txt').catch(() => undefined)");
    await pause(400);
    await window.evaluate("sessionStorage.setItem('e2e-loads', '0')");
    const started = Date.now();
    await send("Page.navigate", { url: `${origin}/?busy=1#/` }, window.sessionId);
    await window.until(RENDERED, "the launch to render while the old worker is busy", 30_000);
    const took = Date.now() - started;
    const loads = await window.evaluate("sessionStorage.getItem('e2e-loads')");
    console.log(`  note  rendered after ${took} ms, from document ${String(loads)}`);
    check(took < 8000 * patience, "the launch rendered without waiting for the old worker to finish", `${took} ms`);
    check((await window.evaluate(TILES)) as number > 5, "with the map on screen");
  });


  for (const [how, again] of [["reloads", (window: Window) => window.reload()], ["opens the same address again", (window: Window) => window.launch("/")]] as const) {
    await scenario(`7. A deploy under one window that is never closed: the page ${how} and runs the new shell`, async (window) => {
      await settled(window);
      deploySecondShell();
      const { oldShell, newShell } = await publishNewerWorker(window, how === "reloads" ? "feedc0de00000004" : "feedc0de00000005");
      await window.evaluate("window.__session = 'the one that was open'");
      await window.evaluate("location.hash = '#/region/media'");
      await window.until(`${ROWS} > 0`, "the region list");
      await pause(3000);
      check(await window.evaluate("window.__session") === "the one that was open", "the open session's document was not replaced");
      check(await window.evaluate(SHELL) === "first", "the open session still runs the shell it started with", await window.evaluate(SHELL));
      check(await window.evaluate(WORKER_WAITING), "the newer worker is waiting, not active");
      check(String(await window.evaluate(CACHE_NAMES)).includes(oldShell), "the old shell is still stored for the open session");

      const shells: unknown[] = [];
      for (let load = 1; load <= 2; load += 1) {
        await again(window);
        await pause(1200);
        shells.push(await window.evaluate(SHELL));
      }
      check(shells[1] === "second", "by the second load after the deploy the page runs the new shell", shells);
      check(await window.evaluate(WORKER_WAITING) === false, "no worker is left waiting", String(await window.evaluate(PAGE_STATE)));
      await window.until(`${STORED("shell")}.then((names) => names === '${newShell}')`, "the old shell to be removed", 6000).catch(() => undefined);
      const names = String(await window.evaluate(CACHE_NAMES));
      check(names.includes(newShell) && !names.includes(oldShell), "the new shell is stored and the old one removed", names);
      check((await window.evaluate(TILES)) as number > 5 || (await window.evaluate(ROWS)) as number > 0, "and the app is on screen");
      console.log(`  note  the shell after each load following the deploy: ${shells.join(", ")}`);

      unreachable = true;
      await window.launch("/");
      check(await window.evaluate(LOADED_THROUGH_WORKER) && (await window.evaluate(TILES)) as number > 5, "the new shell opens with the site unreachable: its files are all on the device");
      check(await window.evaluate(SHELL) === "second", "and it is the new shell that opened", await window.evaluate(SHELL));
    });
  }

  await scenario("7c. A waiting worker whose stored shell was deleted before it took over stores it again", async (window) => {
    await settled(window);
    deploySecondShell();
    const { newShell } = await publishNewerWorker(window, "feedc0de00000007");
    const filesOf = `caches.open('${newShell}').then((cache) => cache.keys()).then((keys) => keys.length)`;
    const whole = (await window.evaluate(filesOf)) as number;
    check(whole > 3, "the waiting worker stored its shell at install", whole);
    await window.evaluate(`caches.delete('${newShell}')`);
    check(await window.evaluate(`caches.has('${newShell}')`) === false, "its shell cache is then deleted from under it, as the worker of an older version did");

    const shells: unknown[] = [];
    for (let load = 1; load <= 2; load += 1) {
      await window.launch("/");
      await pause(1200);
      shells.push(await window.evaluate(SHELL));
    }
    check(shells[1] === "second" && await window.evaluate(WORKER_WAITING) === false, "the page still reaches the new shell", shells);
    await window.until(`${filesOf}.then((count) => count === ${whole})`, "the new worker to store its shell again", 10_000).catch(() => undefined);
    check(await window.evaluate(filesOf) === whole, "and the new worker has stored every file of its shell again", await window.evaluate(filesOf));

    unreachable = true;
    await window.launch("/");
    check(await window.evaluate(LOADED_THROUGH_WORKER) && (await window.evaluate(TILES)) as number > 5, "so the next launch opens with the site unreachable");
    check(await window.evaluate(SHELL) === "second", "on the new shell", await window.evaluate(SHELL));
  });

  await scenario("8. Two deploys with a window left open on the first version: its files are kept while it is open, and purged once it is gone", async (window, context) => {
    await settled(window);
    const worker = readFileSync(join(dist, "sw.js"), "utf8");
    const firstShell = String(await window.evaluate(STORED("shell")));
    const builtVersion = firstShell.slice("droid-atlas:shell:".length);
    check(firstShell !== "" && !firstShell.includes(" ") && worker.includes(builtVersion), "one shell is stored, the one the built worker names", firstShell);
    /** A deploy of the app: a worker compiled with another shell version, and a document that says which deploy it is. */
    const deployShell = (name: string, version: string): void => {
      const html = readFileSync(join(dist, "index.html"), "utf8");
      overlay.set("/index.html", Buffer.from(html.replace("<head>", `<head>\n  <meta name="e2e-shell" content="${name}">`)));
      overlay.set("/sw.js", Buffer.from(worker.replaceAll(builtVersion, version)));
    };
    /** Loads the page until it runs the named deploy: the first load after a deploy finds the new worker still installing. */
    const loadUntilShell = async (name: string): Promise<boolean> => {
      for (let load = 1; load <= 4; load += 1) {
        await window.launch("/");
        await window.until(`${WORKER_ACTIVE}.then((active) => active || ${WORKER_WAITING})`, "the worker to settle", 40_000);
        await pause(1500);
        if (await window.evaluate(SHELL) === name && await window.evaluate(WORKER_WAITING) === false) return true;
      }
      return false;
    };

    await window.launch(VIEWED);
    await window.until("document.querySelector('.desc')?.textContent", "an app's description to load");
    await window.until(SHEET_ICON, "the app's icon to load");
    const viewedIcons = (await window.evaluate(STORED_ICONS)) as string[];
    check(viewedIcons.length > 0, "the icon that was viewed is stored", viewedIcons.length);
    const stale = "0123456789abcdef";
    await window.evaluate(`caches.open('droid-atlas:icons').then((cache) => cache.put(${ICON_URL(stale)}, new Response('an icon no entry uses any more')))`);

    const older = await openWindow(context);
    await older.launch("/");
    await older.evaluate("window.__session = 'the one that was open'");

    const second = publish("purge-one", "2026-12-25T06:00:00.000Z");
    deployShell("second", "feedc0de00000081");
    check(await loadUntilShell("second"), "after the first deploy the launching window runs the second shell");
    check(await window.evaluate(SHOWN_DATE) === dateLabel(second.generatedAt), "and shows the second catalog", await window.evaluate(SHOWN_DATE));

    /* A page that has just reloaded for a takeover does not do it again within seconds; in life the two deploys are a day apart. */
    await window.evaluate("sessionStorage.removeItem('droid-atlas:v1:takeover')");
    const third = publish("purge-two", "2026-12-26T06:00:00.000Z");
    deployShell("third", "feedc0de00000082");
    withdrawn.add(`/data/c/${liveDir}/`);
    check(await loadUntilShell("third"), "after the second deploy it runs the third shell");
    check(await window.evaluate(SHOWN_DATE) === dateLabel(third.generatedAt), "and shows the third catalog", await window.evaluate(SHOWN_DATE));

    const builds = String(await window.evaluate(STORED("build"))).split(" ");
    const shells = String(await window.evaluate(STORED("shell"))).split(" ");
    check(builds.length === 3 && shells.length === 3, "while the older window is open, nothing is deleted: three builds and three shells are stored", [...builds, ...shells]);
    const iconsWhileOpen = (await window.evaluate(STORED_ICONS)) as string[];
    check(iconsWhileOpen.some((url) => url.includes(stale)) && viewedIcons.every((url) => iconsWhileOpen.includes(url)), "and no icon is removed");

    check(await older.evaluate("window.__session") === "the one that was open" && await older.evaluate(SHELL) === "first", "the older window is still on the document and shell it started with");
    check(await older.evaluate(SHOWN_DATE) === liveLabel, "and still shows the first catalog");
    await older.evaluate(`location.hash = '#${VIEWED}'`);
    check(await older.until("document.querySelector('.desc')?.textContent", "the stored description in the older window").catch(() => null), "the older window reads what its catalog has stored, though the site no longer has that catalog");
    await older.evaluate(`location.hash = '#${NOT_VIEWED}'`);
    const said = await older.until("/A newer catalog is out/.test(document.querySelector('.sheet-body')?.textContent ?? '') && document.querySelector('.sheet-body')?.textContent", "the older window to say a newer catalog is ready", 15_000).catch(() => null);
    check(said, "a description its catalog never stored says a newer catalog is out, not that it merely failed", await older.evaluate("document.querySelector('.sheet-body .credit-note')?.textContent"));
    check(await older.evaluate("document.querySelector('.sheet-body .retry-btn')?.textContent") === "Reload", "and offers a reload there");
    check(await older.evaluate("document.querySelector('.reload-prompt button')?.textContent") === "Reload", "and every view offers it from then on", await older.evaluate("document.querySelector('.reload-prompt')?.textContent"));
    await older.shoot("left-behind-sheet");
    await older.evaluate("location.hash = '#/region/media'");
    await older.until(`${ROWS} > 0`, "the list");
    await pause(700);
    await older.shoot("left-behind-list");
    await older.evaluate("window.__launched = true; document.querySelector('.reload-prompt button').click()");
    await older.until("!window.__launched && document.querySelector('.nav') !== null", "the older window to load again");
    await older.evaluate("location.hash = '#/'");
    await older.until(SHOWN_DATE, "the map in the older window");
    check(await older.evaluate(SHELL) === "third" && await older.evaluate(SHOWN_DATE) === dateLabel(third.generatedAt), "one reload puts it on the third shell and the third catalog", [await older.evaluate(SHELL), await older.evaluate(SHOWN_DATE)]);
    const onlyBuild = `droid-atlas:build:${third.hash.slice(0, 16)}`;
    await window.until(`Promise.all([${STORED("build")}, ${STORED("shell")}]).then(([builds, shells]) => builds === '${onlyBuild}' && shells === 'droid-atlas:shell:feedc0de00000082')`, "everything but the current build and shell to be purged", 8000).catch(() => undefined);
    check(await window.evaluate(STORED("build")) === onlyBuild, "once every open window is on the current catalog, only the current build stays stored, with both windows still open", await window.evaluate(STORED("build")));
    check(await window.evaluate(STORED("shell")) === "droid-atlas:shell:feedc0de00000082", "and only the current shell", await window.evaluate(STORED("shell")));
    check((await older.evaluate(TILES)) as number > 5 && (await window.evaluate(TILES)) as number > 5, "and both windows go on working");

    await older.close();
    await pause(300);
    await window.launch("/");
    await pause(1200);
    check(await window.evaluate(STORED("build")) === onlyBuild && await window.evaluate(STORED("shell")) === "droid-atlas:shell:feedc0de00000082", "alone again, a launch changes nothing more", await window.evaluate(CACHE_NAMES));
    await window.until(`${POINTER("icons-for")}.then((hash) => hash === '${third.hash}')`, "the icon cache to be cleared for the current build", 8000).catch(() => undefined);
    const icons = (await window.evaluate(STORED_ICONS)) as string[];
    check(!icons.some((url) => url.includes(stale)) && viewedIcons.every((url) => icons.includes(url)), "the icon no entry uses is removed, and the icons in use are kept", icons.length);
    check(await window.evaluate(POINTER("previous")) === null && await window.evaluate(POINTER("current")) === third.hash, "the device remembers one build, the current one");
    check(await window.evaluate(SHOWN_DATE) === dateLabel(third.generatedAt) && (await window.evaluate(TILES)) as number > 5, "and the app is on screen with the third catalog");

    unreachable = true;
    await window.launch("/");
    check(await window.evaluate(LOADED_THROUGH_WORKER) && (await window.evaluate(TILES)) as number > 5, "what is left opens with the site unreachable");
    check(await window.evaluate(SHELL) === "third" && await window.evaluate(SHOWN_DATE) === dateLabel(third.generatedAt), "on the third shell and the third catalog");
  });

  await scenario("9. A window that shows a file of the site does not hold the purge, and one of the app that says nothing holds it for a day at most", async (window, context) => {
    await settled(window);
    const firstBuild = `droid-atlas:build:${liveDir}`;

    const text = await openWindow(context);
    await send("Page.navigate", { url: `${origin}/third-party-licenses.txt` }, text.sessionId);
    await text.until("document.contentType === 'text/plain' && document.readyState === 'complete'", "the license text to open in its own window");
    check(await text.evaluate(CONTROLLED), "the window on a text file of the site is one of the worker's windows");

    deploySecondShell();
    const second = publish("silent-one", "2026-12-25T06:00:00.000Z");
    const { oldShell, newShell } = await publishNewerWorker(window, "feedc0de00000091");
    const shells: unknown[] = [];
    for (let load = 1; load <= 2; load += 1) {
      await window.launch("/");
      await pause(1200);
      shells.push(await window.evaluate(SHELL));
    }
    check(shells[1] === "second" && await window.evaluate(SHOWN_DATE) === dateLabel(second.generatedAt), "after a deploy the app window runs the new shell and shows the new catalog", [shells, await window.evaluate(SHOWN_DATE)]);
    const secondBuild = `droid-atlas:build:${second.hash.slice(0, 16)}`;
    await window.until(`Promise.all([${STORED("build")}, ${STORED("shell")}]).then(([builds, shells]) => builds === '${secondBuild}' && shells === '${newShell}')`, "the leftovers to be purged", 8000).catch(() => undefined);
    check(await window.evaluate(STORED("build")) === secondBuild, "with a text file of the site open in another window, the older build is purged all the same", await window.evaluate(STORED("build")));
    check(await window.evaluate(STORED("shell")) === newShell && !String(await window.evaluate(CACHE_NAMES)).includes(oldShell), "and the older shell", await window.evaluate(STORED("shell")));
    check(firstBuild !== secondBuild && await text.evaluate("document.contentType") === "text/plain", "the text is still what that window shows");

    /* A document of the app that never runs its script: the worker knows which shell it got and nothing of what it shows. */
    const silent = await openWindow(context);
    await send("Emulation.setScriptExecutionDisabled", { value: true }, silent.sessionId);
    await send("Page.navigate", { url: `${origin}/?silent=1` }, silent.sessionId);
    await pause(1500);
    const third = publish("silent-two", "2026-12-26T06:00:00.000Z");
    await window.launch("/");
    await window.until(`${POINTER("current")}.then((hash) => hash === '${third.hash}')`, "the third catalog to be stored during the session", 30_000);
    await window.launch("/");
    await pause(2000);
    check(await window.evaluate(SHOWN_DATE) === dateLabel(third.generatedAt), "the next launch shows the third catalog");
    check(String(await window.evaluate(STORED("build"))).split(" ").length === 2, "a window of the app that has not said what it shows holds the older build for now", await window.evaluate(STORED("build")));

    const backdated = await window.evaluate(`caches.open('droid-atlas:pointer').then(async (cache) => {
      let changed = 0;
      for (const request of await cache.keys()) {
        if (!request.url.includes('/pointer/window/')) continue;
        const record = await (await cache.match(request)).json();
        if (record.build !== null) continue;
        await cache.put(request, new Response(JSON.stringify({ ...record, seen: Date.now() - 25 * 60 * 60 * 1000 }), { headers: { 'content-type': 'application/json' } }));
        changed += 1;
      }
      return changed;
    })`);
    check(backdated === 1, "the worker keeps one entry for that window, with no build in it", backdated);
    await window.launch("/");
    const thirdBuild = `droid-atlas:build:${third.hash.slice(0, 16)}`;
    await window.until(`${STORED("build")}.then((builds) => builds === '${thirdBuild}')`, "the older build to be purged", 8000).catch(() => undefined);
    check(await window.evaluate(STORED("build")) === thirdBuild, "a day after it was first seen, the silent window no longer holds anything", await window.evaluate(STORED("build")));
    const entries = await window.evaluate("caches.open('droid-atlas:pointer').then((cache) => cache.keys()).then((keys) => keys.filter((request) => request.url.includes('/pointer/window/')).length)");
    check(entries === 2, "the worker keeps an entry for each open window of the app and none for the text file or for windows that are gone", entries);
  });
} finally {
  socket.close();
  server.close();
  server.closeAllConnections();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
