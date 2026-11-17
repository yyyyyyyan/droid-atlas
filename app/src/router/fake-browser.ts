/**
 * A recording browser stand-in for router tests: a real entry stack with
 * per-entry state, forward entries cut off by a push, `popstate` delivered
 * asynchronously as browsers do, and a log of every call the router makes.
 * Storage and the clock are plain objects, so a test can reload the page (a
 * new Router over the same history and storage) or open a second document.
 *
 * It does not model Chrome's skippable-entry intervention; the tests assert
 * the rule that makes the intervention irrelevant (nothing is pushed before a
 * gesture), and the behavior itself is a device check.
 */

import type { HistoryLike, LoadType, PlaceResolver, RouterEnv, ScrollMemo, StorageLike } from "./router.ts";
import type { Route } from "./route.ts";

interface Entry {
  state: unknown;
  hash: string;
}

export class FakeStorage implements StorageLike {
  readonly data = new Map<string, string>();
  writes = 0;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes += 1;
    this.data.set(key, value);
  }
}

export class FakeHistory implements HistoryLike {
  entries: Entry[];
  index = 0;
  scrollRestoration: "auto" | "manual" = "auto";
  /** Every call made on the history, in order: `push #/x`, `replace #/x`, `go -1`. */
  log: string[] = [];
  private popListeners: (() => void)[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(initialHash = "") {
    this.entries = [{ state: null, hash: initialHash }];
  }

  get state(): unknown {
    return this.current.state;
  }

  get hash(): string {
    return this.current.hash;
  }

  get length(): number {
    return this.entries.length;
  }

  /** The hashes of every entry, oldest first: what the user would walk through with Back. */
  get stack(): string[] {
    return this.entries.map((entry) => entry.hash);
  }

  get pushes(): number {
    return this.log.filter((line) => line.startsWith("push ")).length;
  }

  /** `replaceState` calls that changed the URL, as opposed to ones that only refreshed the entry's state. */
  get urlReplaces(): number {
    return this.log.filter((line) => line.startsWith("replace ")).length;
  }

  pushState(state: unknown, _unused: string, url: string): void {
    this.log.push(`push ${url}`);
    this.entries = [...this.entries.slice(0, this.index + 1), { state: structuredClone(state), hash: url }];
    this.index += 1;
  }

  replaceState(state: unknown, _unused: string, url: string): void {
    this.log.push(url === this.current.hash ? `state ${url}` : `replace ${url}`);
    this.entries[this.index] = { state: structuredClone(state), hash: url };
  }

  go(delta: number): void {
    this.log.push(`go ${delta}`);
    this.traverse(delta);
  }

  /** Resolves once every queued traversal has been delivered. */
  async settled(): Promise<void> {
    await this.queue;
    await Promise.resolve();
  }

  /** The browser's own Back, which the router did not ask for. */
  async back(): Promise<void> {
    this.traverse(-1);
    await this.settled();
  }

  async forward(): Promise<void> {
    this.traverse(1);
    await this.settled();
  }

  /** What the browser does when the user types a new hash or another app delivers a link to the running page. */
  async navigateByHash(hash: string): Promise<void> {
    this.entries = [...this.entries.slice(0, this.index + 1), { state: null, hash }];
    this.index += 1;
    for (const listener of this.popListeners) listener();
    await this.settled();
  }

  onPop(listener: () => void): void {
    this.popListeners.push(listener);
  }

  /** Drops listeners, as a page load does, keeping entries and their state. */
  detach(): void {
    this.popListeners = [];
  }

  stateAt(index: number): unknown {
    return this.entries[index]?.state;
  }

  private traverse(delta: number): void {
    this.queue = this.queue.then(() => {
      const next = this.index + delta;
      if (next < 0 || next >= this.entries.length) return;
      this.index = next;
      for (const listener of this.popListeners) listener();
    });
  }

  private get current(): Entry {
    const entry = this.entries[this.index];
    if (!entry) throw new Error("FakeHistory index out of range");
    return entry;
  }
}

export interface FakeBrowser {
  history: FakeHistory;
  session: FakeStorage;
  local: FakeStorage;
  clock: { now: number };
  /** What the view would report as its scroll position and anchor row. */
  view: ScrollMemo;
  hide(): void;
  /** The first `pointerdown` or `keydown` on the page. */
  gesture(): void;
  env: RouterEnv;
}

export interface FakeBrowserOptions {
  hash?: string;
  history?: FakeHistory;
  session?: FakeStorage;
  local?: FakeStorage;
  now?: number;
  wasDiscarded?: boolean;
  loadType?: LoadType;
  displayMode?: string;
  resume?: boolean;
  places?: Partial<PlaceResolver>;
  ids?: { next: number };
  layerEntries?: boolean;
}

export function fakeBrowser(options: FakeBrowserOptions = {}): FakeBrowser {
  const history = options.history ?? new FakeHistory(options.hash ?? "");
  const session = options.session ?? new FakeStorage();
  const local = options.local ?? new FakeStorage();
  const clock = { now: options.now ?? 1_800_000_000_000 };
  const ids = options.ids ?? { next: 1 };
  const view: ScrollMemo = { y: 0, anchor: null };
  const hideListeners: (() => void)[] = [];
  let gestureListeners: (() => void)[] = [];
  history.detach();
  return {
    history,
    session,
    local,
    clock,
    view,
    hide: () => {
      for (const listener of hideListeners) listener();
    },
    gesture: () => {
      const listeners = gestureListeners;
      gestureListeners = [];
      for (const listener of listeners) listener();
    },
    env: {
      history,
      getHash: () => history.hash,
      session,
      local,
      now: () => clock.now,
      newId: () => `e${ids.next++}`,
      onPop: (listener) => history.onPop(listener),
      onHide: (listener) => hideListeners.push(listener),
      onFirstGesture: (listener) => gestureListeners.push(listener),
      wasDiscarded: options.wasDiscarded ?? false,
      loadType: options.loadType ?? "navigate",
      displayMode: options.displayMode ?? "browser",
      resume: options.resume ?? true,
      places: {
        normalize: options.places?.normalize ?? ((route: Route) => route),
        exists: options.places?.exists ?? (() => true),
        fallback: options.places?.fallback ?? (() => null),
      },
      capture: () => ({ y: view.y, anchor: view.anchor }),
      layerEntries: options.layerEntries ?? false,
    },
  };
}
