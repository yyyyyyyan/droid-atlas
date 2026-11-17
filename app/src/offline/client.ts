/**
 * The page's side of "Offline and updates" (docs/ARCHITECTURE.md): what a
 * launch does before it renders, and what it does afterwards.
 *
 * Before rendering: a waiting service worker is told to take over, so a page
 * that is loaded again after a deploy runs the new version (rule 6), and the
 * build to render is the one stored on the device, not whatever the site
 * serves now (rule 3).
 * After rendering: the worker is registered, and the site is asked which
 * build is current; a different one is fetched, verified and stored for the
 * next launch (rules 1 and 2), and a format this shell cannot read raises the
 * reload prompt (rule 7). Nothing here changes what the open session shows.
 */

import { QUIET_MS, quietLimited } from "../lib/quiet.ts";
import { signal, type ReadonlySignal } from "@preact/signals";
import type { CatalogVersion } from "../catalog/schema.ts";
import { LAUNCHED_MESSAGE, TAKEOVER_COMMAND, TAKEOVER_QUESTION } from "./decide.ts";
import { checkForUpdate, launchChoice, readPointers, storedBuildFetch, SUPPORTED_SCHEMA, type OfflineEnv, type UpdateResult } from "./store.ts";

export interface OfflineStatus {
  /** False where the browser has no service workers or no Cache Storage (an insecure origin, some private modes), and in development. */
  supported: boolean;
  /** True when a service worker answered for this page load, so the shell itself came from the device. */
  controlled: boolean;
  /** The stored build this launch rendered, or null when it was loaded from the network. */
  rendered: CatalogVersion | null;
  /** A newer build stored during this session, to be shown at the next launch. */
  pending: CatalogVersion | null;
  lastCheck: { at: number; outcome: UpdateResult } | null;
  /** The published catalog, or the stored one, is in a newer format than this shell reads. */
  needsReload: boolean;
  /** A file of the build on screen could not be loaded, and the device holds a newer build: this window has to be loaded again to read on. */
  leftBehind: boolean;
}

const status = signal<OfflineStatus>({ supported: false, controlled: false, rendered: null, pending: null, lastCheck: null, needsReload: false, leftBehind: false });
export const offlineStatus: ReadonlySignal<OfflineStatus> = status;

const TAKEOVER_FLAG = "droid-atlas:v1:takeover";
/** How long a loading page waits for a waiting worker to wake and answer. It is spent only on the first load after a deploy. */
const TAKEOVER_ANSWER_MS = 3000;
/** How long a launch waits for the worker it told to take over. A worker that can, does it at once; one that cannot yet may need minutes, and the launch does not wait for that. */
const TAKEOVER_SWITCH_MS = 4000;
/** How long the page stays silent after it has loaded before it tells the worker to take over: time for the requests a browser makes by itself once a page has loaded (its icon, its manifest) to finish. */
const TAKEOVER_QUIET_MS = 800;
/** A second takeover inside this window after the first would be a reload loop, not an update. */
const TAKEOVER_COOLDOWN_MS = 15_000;
const CHECK_DELAY_MS = 1200;
/** How long a launch waits for the worker to finish tidying before it looks for a newer build anyway. */
const TIDY_ANSWER_MS = 8000;
/** A file that fails to load prompts a look for a newer build, but not more often than this. */
const RECHECK_AFTER_MS = 60_000;

function workers(): ServiceWorkerContainer | null {
  if (import.meta.env.DEV) return null;
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof caches !== "undefined" ? navigator.serviceWorker : null;
}

async function digest(bytes: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const hash = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The offline store as this page sees it, or null where it cannot exist. */
export function offlineEnv(dataRoot: string): OfflineEnv | null {
  if (!workers()) return null;
  return { caches, fetch: quietLimited((url, init) => fetch(url, init), QUIET_MS), digest, dataRoot, supportedSchema: SUPPORTED_SCHEMA };
}

function recentlyTookOver(now: number): boolean {
  try {
    const at = Number(sessionStorage.getItem(TAKEOVER_FLAG));
    return Number.isFinite(at) && at > 0 && now - at < TAKEOVER_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function ask(worker: ServiceWorker): Promise<boolean> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), TAKEOVER_ANSWER_MS);
    channel.port1.onmessage = (event: MessageEvent<{ takeOver?: unknown }>) => {
      clearTimeout(timer);
      resolve(event.data?.takeOver === true);
    };
    worker.postMessage({ type: TAKEOVER_QUESTION }, [channel.port2]);
  });
}

/** Resolves once the document has loaded and has then made no request of its own for a moment. */
function quiet(): Promise<void> {
  const loaded = document.readyState === "complete"
    ? Promise.resolve()
    : new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true }));
  return loaded.then(() => new Promise<void>((resolve) => setTimeout(resolve, TAKEOVER_QUIET_MS)));
}

/**
 * Rule 6. Every load of the page is a launch: the icon, a link, the reload
 * button, the same address opened again. When a newer service worker is
 * waiting, the load asks whether it is awake and tells it to take over only
 * when the answer came in time: the question alone activates nothing, so a
 * worker that is slow to wake cannot take over after this page has rendered.
 * Returns "reloading" when the page is about to load again under the new
 * worker, in which case the caller must not render. That second load finds
 * no worker waiting, so there is one reload at most.
 *
 * Other windows do not hold a takeover back. One that is open on the older
 * shell keeps its document and that shell's files, which the new worker
 * leaves stored and goes on serving until that window is loaded again.
 *
 * The browser lets the new worker take control only when the old one has no
 * request in hand, and a request that reaches the old worker while the
 * handover is pending is not answered until the handover happens, which can
 * take minutes. Two things follow. The page must be silent when it asks:
 * this runs before anything is rendered, and waits for the page to finish
 * loading and for the browser's own requests after that. And the page loads
 * again only once the new worker is in control: when the handover has not
 * happened within a few seconds, this launch goes on with the shell it has,
 * and the new worker takes control when the browser lets it.
 */
export async function takeOverIfWaiting(): Promise<"reloading" | "continue"> {
  const container = workers();
  if (!container?.controller) return "continue";
  let waiting: ServiceWorker | null | undefined;
  try {
    waiting = (await container.getRegistration())?.waiting;
  } catch {
    return "continue";
  }
  if (!waiting || recentlyTookOver(Date.now())) return "continue";
  if (!(await ask(waiting))) return "continue";
  await quiet();
  try {
    sessionStorage.setItem(TAKEOVER_FLAG, String(Date.now()));
  } catch {
    /* Without the flag a second takeover in a row is still prevented by there being no waiting worker. */
  }
  const switched = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), TAKEOVER_SWITCH_MS);
    container.addEventListener("controllerchange", () => {
      clearTimeout(timer);
      resolve(true);
    }, { once: true });
  });
  waiting.postMessage({ type: TAKEOVER_COMMAND });
  if (!(await switched)) return "continue";
  window.location.reload();
  return "reloading";
}

/** Rule 3. The stored build this launch should render, if there is one this shell can read. */
export async function prepareLaunch(dataRoot: string): Promise<CatalogVersion | null> {
  const env = offlineEnv(dataRoot);
  const controlled = workers()?.controller != null;
  if (!env) {
    status.value = { ...status.peek(), supported: false, controlled: false };
    return null;
  }
  let choice: Awaited<ReturnType<typeof launchChoice>> = { use: null, needsReload: false };
  try {
    choice = await launchChoice(env);
  } catch {
    /* Cache Storage that cannot be read is the same as an empty one: the launch goes to the network. */
  }
  status.value = { ...status.peek(), supported: true, controlled, rendered: choice.use, needsReload: choice.needsReload };
  return choice.use;
}

/** The fetch a launch reads its stored build with: Cache Storage first, the network for what is missing. Null where there is no offline store. */
export function storedFetch(dataRoot: string, version: CatalogVersion): OfflineEnv["fetch"] | null {
  const env = offlineEnv(dataRoot);
  return env ? storedBuildFetch(env, version) : null;
}

/** Called when the stored build could not be loaded after all and the launch fell back to the network. */
export function launchedFromNetwork(): void {
  status.value = { ...status.peek(), rendered: null };
}

/**
 * Tells the worker this page has launched, with the script it runs and the
 * build it shows, so the worker can delete what no window needs any more.
 * Resolves when the worker has finished, or has not answered in time.
 */
function reportLaunch(controller: ServiceWorker, build: string): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(resolve, TIDY_ANSWER_MS);
    channel.port1.onmessage = () => {
      clearTimeout(timer);
      resolve();
    };
    controller.postMessage({ type: LAUNCHED_MESSAGE, script: import.meta.url, build }, [channel.port2]);
  });
}

/**
 * After the first render: registers the worker, lets it tidy up, and then
 * looks for a newer build. The look waits for the tidying, so a build it
 * stores is never taken for one that is left over.
 * A launch that had nothing stored leaves the first download to the worker's
 * install step, which stores the same build; asking twice would fetch it twice.
 *
 * @param shown the hash of the build on screen, wherever it was loaded from
 */
export function afterLaunch(dataRoot: string, shown: string): void {
  const container = workers();
  const env = offlineEnv(dataRoot);
  if (!container || !env) return;
  const rendered = status.peek().rendered;
  void container.register(new URL("./sw.js", document.baseURI), { scope: new URL("./", document.baseURI).pathname, updateViaCache: "none" }).catch(() => undefined);
  const tidied = container.controller ? reportLaunch(container.controller, shown) : Promise.resolve();
  if (!rendered) return;
  const delayed = new Promise((resolve) => setTimeout(resolve, CHECK_DELAY_MS));
  void Promise.all([tidied, delayed]).then(() => runCheck(env));
}

async function runCheck(env: OfflineEnv): Promise<void> {
  let outcome: UpdateResult;
  try {
    outcome = await checkForUpdate(env);
  } catch {
    outcome = { result: "offline" };
  }
  const previous = status.peek();
  status.value = {
    ...previous,
    lastCheck: { at: Date.now(), outcome },
    pending: outcome.result === "updated" ? outcome.version : previous.pending,
    needsReload: previous.needsReload || outcome.result === "newer-schema",
  };
}

/**
 * Called when a file of the build on screen could not be loaded. A window
 * that stays open is not told about newer builds, and the site keeps the
 * files of older ones only for a while, so the reason may be that this
 * window has been left behind. This looks for a newer build if none is known
 * yet, and answers whether the device now holds a build other than `shown`,
 * the hash of the one on screen: if so, loading the page again is what
 * helps, and every view says so from then on.
 */
export async function leftBehind(dataRoot: string, shown: string): Promise<boolean> {
  const env = offlineEnv(dataRoot);
  if (!env) return false;
  try {
    let { current } = await readPointers(env);
    const lastCheck = status.peek().lastCheck;
    if (current?.hash === shown && (!lastCheck || Date.now() - lastCheck.at > RECHECK_AFTER_MS)) {
      await runCheck(env);
      ({ current } = await readPointers(env));
    }
    const behind = current !== null && current.hash !== shown;
    if (behind && !status.peek().leftBehind) status.value = { ...status.peek(), leftBehind: true };
    return behind;
  } catch {
    return false;
  }
}

/** Looks for a newer build now, at the reader's request. */
export async function checkNow(dataRoot: string): Promise<void> {
  const env = offlineEnv(dataRoot);
  if (env) await runCheck(env);
}

/** Rule 7's prompt: fetch the newest shell, then load it. */
export async function reloadForNewShell(): Promise<void> {
  try {
    await (await workers()?.getRegistration())?.update();
  } catch {
    /* Offline or no worker: the reload below still gets whatever shell is available. */
  }
  window.location.reload();
}
