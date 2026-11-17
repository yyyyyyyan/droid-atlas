/**
 * The router: the only code that touches `history`.
 *
 * It implements the history rules, the cold-start rule and the restoration
 * rules of docs/ARCHITECTURE.md ("What is a history entry" to "State and
 * restoration"); the rule numbers in the comments below are that document's.
 *
 * Every entry this app creates carries `{ id, idx, under, scroll }` in
 * `history.state`: a random id, its position in the app's own stack, the
 * canonical URL of the list beneath a sheet entry, and the scroll anchor. The
 * anchor is mirrored in `sessionStorage` under the entry id, together with a
 * mirror of the stack (`id` and URL per position) that answers "is there an
 * Explore entry beneath this one, and how far down".
 *
 * The environment is injected so every rule can be tested against a recording
 * history fake.
 */

import {
  EXPLORE,
  buildHash,
  destinationOf,
  destinationRoot,
  isDestinationRoot,
  levelKey,
  parentOf,
  parseHash,
  placeOf,
  sameRoute,
  sheetOf,
  withParams,
  withoutSheet,
  type Destination,
  type Route,
} from "./route.ts";

export interface HistoryLike {
  readonly state: unknown;
  scrollRestoration: "auto" | "manual";
  pushState(state: unknown, unused: string, url: string): void;
  replaceState(state: unknown, unused: string, url: string): void;
  go(delta: number): void;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** What the router needs to know about the catalog, kept behind an interface so it never imports it. */
export interface PlaceResolver {
  /** Rewrites a route into the form the app shows: the share form becomes a list with the sheet open, retired app ids become their successors. */
  normalize(route: Route): Route;
  /** False when the route names a region, category, lens or app the catalog does not have. */
  exists(route: Route): boolean;
  /** The region a place belongs to, stored beside the last place so a vanished place can fall back to it. */
  fallback(route: Route): Route | null;
}

export interface RouterEnv {
  history: HistoryLike;
  getHash(): string;
  session: StorageLike;
  local: StorageLike;
  now(): number;
  newId(): string;
  onPop(listener: () => void): void;
  /** Called when the page is hidden: the last moment at which state can reliably be written. */
  onHide(listener: () => void): void;
  /** Called once, in the capture phase of the first `pointerdown` or `keydown`. */
  onFirstGesture(listener: () => void): void;
  /** `document.wasDiscarded`: the document is a reload of a tab the browser threw away, not a launch. */
  wasDiscarded: boolean;
  /** How this document came to be loaded, as its navigation timing entry reports it. */
  loadType: LoadType;
  /** "standalone" for the installed app, "browser" for a tab. The last place is kept per mode. */
  displayMode: string;
  /** The reader's choice in Settings: false makes every launch with no route open Explore. */
  resume: boolean;
  places: PlaceResolver;
  /** Reads the scroll position and list anchor of the view on screen, or null when there is nothing to read. */
  capture(): ScrollMemo | null;
  /**
   * Whether a layer without a URL (a sort or filter sheet) needs a history
   * entry of its own for the browser's Back to close it (`holdBack`). False
   * where Back always reaches the open dialog first.
   */
  layerEntries: boolean;
}

/** Where the user was within an entry: the first visible list row and its distance from the top of the viewport. */
export interface ScrollMemo {
  y: number;
  anchor: { key: string; offset: number } | null;
}

export interface EntryState {
  id: string;
  idx: number;
  under: string | null;
  scroll: ScrollMemo | null;
}

/** `PerformanceNavigationTiming.type`: an ordinary navigation, a reload, or a return through the browser's history. */
export type LoadType = "navigate" | "reload" | "back_forward" | "prerender";

export type NavKind = "load" | "push" | "replace" | "pop";

/** How the scroll position should be treated after a navigation. */
export type ScrollPlan = { kind: "top" } | { kind: "keep" } | { kind: "restore"; memo: ScrollMemo };

export interface Navigation {
  route: Route;
  nav: NavKind;
  entryId: string;
  scroll: ScrollPlan;
  /** Increases with every navigation, so identical routes can still be told apart. */
  seq: number;
}

export interface StackSlot {
  id: string;
  hash: string;
}

const PREFIX = "droid-atlas:v1:";
const SCROLL_KEY = `${PREFIX}scroll`;
const STACK_KEY = `${PREFIX}stack`;
const MAX_MEMOS = 60;
const URL_SETTLE_MS = 250;
export const STATE_WRITE_INTERVAL_MS = 1000;
export const RESUME_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function lastPlaceKey(displayMode: string): string {
  return `${PREFIX}lastPlace:${displayMode}`;
}

function isScrollMemo(value: unknown): value is ScrollMemo {
  if (typeof value !== "object" || value === null) return false;
  const memo = value as Record<string, unknown>;
  if (typeof memo.y !== "number" || !Number.isFinite(memo.y)) return false;
  if (memo.anchor === null) return true;
  const anchor = memo.anchor as Record<string, unknown> | undefined;
  return typeof anchor === "object" && typeof anchor.key === "string" && typeof anchor.offset === "number";
}

/**
 * The scroll position for a load that arrived without `history.state`, and so
 * without the entry id the stored positions are keyed by. Only a reload, a
 * return through the browser's history, or the reload of a tab the browser
 * discarded is a return to a place the reader left, so only those restore:
 * the most recently stored position among the session's entries that showed
 * this URL. An ordinary navigation to the same URL is a new visit and starts
 * at the top.
 *
 * `memos` is read oldest first, as the router keeps it.
 */
export function recoveredScroll(
  load: { type: LoadType; wasDiscarded: boolean },
  hash: string,
  stack: readonly (StackSlot | undefined)[],
  memos: ReadonlyMap<string, ScrollMemo>,
): ScrollMemo | null {
  if (load.type !== "reload" && load.type !== "back_forward" && !load.wasDiscarded) return null;
  const ids = new Set<string>();
  for (const slot of stack) {
    if (slot?.hash === hash) ids.add(slot.id);
  }
  let latest: ScrollMemo | null = null;
  for (const [id, memo] of memos) {
    if (ids.has(id)) latest = memo;
  }
  return latest;
}

function isEntryState(value: unknown): value is EntryState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return typeof state.id === "string" && typeof state.idx === "number" && Number.isInteger(state.idx) && state.idx >= 0
    && (state.under === null || typeof state.under === "string")
    && (state.scroll === null || isScrollMemo(state.scroll));
}

export class Router {
  private readonly env: RouterEnv;
  private readonly listeners = new Set<(navigation: Navigation) => void>();
  private memos = new Map<string, ScrollMemo>();
  /** Entries whose memo was taken during this run, and is therefore newer than whatever their `history.state` holds. */
  private readonly touched = new Set<string>();
  /** Sparse: a missing slot is an entry this run knows nothing about. */
  private stack: (StackSlot | undefined)[] = [];
  private route: Route = EXPLORE;
  private state: EntryState = { id: "", idx: 0, under: null, scroll: null };
  private seq = 0;
  private started = false;
  private urlTimer: ReturnType<typeof setTimeout> | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private last: Navigation | null = null;
  /** The open layer holding a history entry of its own (`holdBack`), and how to close it. */
  private layer: { close(): void } | null = null;
  /** The browser is on the layer's entry: one above `state.idx`, with the same URL. */
  private onLayerEntry = false;
  /** The router asked to leave the layer's entry; the pop that answers is not a navigation. */
  private droppingLayer = false;
  /** A push that arrived while that pop was on its way, made once it has landed. */
  private afterDrop: (() => void) | null = null;

  constructor(env: RouterEnv) {
    this.env = env;
  }

  get current(): Navigation {
    if (!this.last) throw new Error("Router.start() has not run");
    return this.last;
  }

  /** Position of the current entry in the app's own stack. Zero means Back leaves the app. */
  get depth(): number {
    return this.state.idx;
  }

  subscribe(listener: (navigation: Navigation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): Navigation {
    if (this.started) return this.current;
    this.started = true;
    this.env.history.scrollRestoration = "manual";
    this.loadSession();
    this.env.onPop(() => this.handlePop());
    this.env.onHide(() => this.flush());
    this.env.onFirstGesture(() => this.seed());

    const existing = this.env.history.state;
    if (isEntryState(existing)) {
      this.state = existing;
      this.route = parseHash(this.env.getHash());
      this.reconcileStack();
    } else {
      this.coldStart(parseHash(this.env.getHash()));
    }
    const memo = this.state.scroll ?? this.memos.get(this.state.id) ?? null;
    return this.emit("load", memo ? { kind: "restore", memo } : { kind: "top" });
  }

  /** Rule 1: a deeper level, or the sheet opened from a list. Adds one entry; a no-op when already there. */
  push(route: Route): void {
    if (sameRoute(route, this.route)) return;
    if (this.droppingLayer) {
      this.afterDrop = () => this.push(route);
      return;
    }
    /* A layer's entry sits where the new one goes: the layer closes and its entry becomes the new one. */
    const reuse = this.leaveLayer();
    this.settle();
    const previous = this.route;
    const opensSheet = sheetOf(route) !== null && sheetOf(previous) === null && sameRoute(withoutSheet(route), previous);
    this.state = {
      id: this.env.newId(),
      idx: this.state.idx + 1,
      under: opensSheet ? buildHash(previous) : null,
      scroll: null,
    };
    this.route = route;
    if (reuse) this.env.history.replaceState(this.state, "", buildHash(route));
    else this.env.history.pushState(this.state, "", buildHash(route));
    this.stack.length = this.state.idx;
    this.stack[this.state.idx] = { id: this.state.id, hash: buildHash(route) };
    this.emit("push", levelKey(previous) === levelKey(route) ? { kind: "keep" } : { kind: "top" });
  }

  /**
   * Rules 2 to 4: rewrites the current entry. The entry keeps its id while the
   * view (the path) stays the same and gets a new one when it changes, so one
   * view never restores another's scroll. With `settle`, the view updates at
   * once and the URL follows after a pause, so typing costs neither an entry
   * nor a `replaceState` per keystroke.
   */
  replace(route: Route, options: { settle?: boolean } = {}): void {
    if (sameRoute(route, this.route)) return;
    const previous = this.route;
    const viewChanged = levelKey(previous) !== levelKey(route);
    if (!viewChanged) this.snapshot();
    this.route = route;
    this.state = {
      id: viewChanged ? this.env.newId() : this.state.id,
      idx: this.state.idx,
      under: sheetOf(route) !== null && !viewChanged ? this.state.under : null,
      scroll: viewChanged ? null : this.state.scroll,
    };
    this.stack[this.state.idx] = { id: this.state.id, hash: buildHash(route) };
    if (options.settle && !viewChanged) {
      if (this.urlTimer !== null) clearTimeout(this.urlTimer);
      this.urlTimer = setTimeout(() => this.writeState(), URL_SETTLE_MS);
    } else {
      this.writeState();
    }
    this.emit("replace", viewChanged ? { kind: "top" } : { kind: "keep" });
  }

  /** Opens the sheet over the current list (push), or changes the app shown in an open sheet (replace, same entry). */
  openApp(appId: string): void {
    const next = withParams(this.route, { app: appId });
    if (sheetOf(this.route) === null) this.push(next);
    else this.replace(next);
  }

  /**
   * Rule 6, the sheet's close control: `history.back()` when the list this
   * sheet was opened from is still what lies beneath, otherwise the list takes
   * the sheet entry's place.
   */
  closeSheet(): void {
    if (sheetOf(this.route) === null) return;
    const list = withoutSheet(this.route);
    if (this.state.idx > 0 && this.state.under === buildHash(list)) {
      this.settle();
      this.go(-1);
      return;
    }
    this.replace(list);
  }

  /**
   * Gives a layer without a URL an entry of its own while it is open, where
   * the browser needs one for Back to close it (`RouterEnv.layerEntries`): a
   * copy of the current entry pushed on top. Back then lands on the entry
   * beneath, and the router calls `close` instead of treating it as a
   * navigation. Returns what the layer calls when it closes in any other way,
   * which takes the entry back off.
   *
   * Opened by a tap, so the entry beneath is one the reader has touched,
   * which is what a browser that skips untouched entries asks for.
   */
  holdBack(close: () => void): () => void {
    if (!this.env.layerEntries || this.layer || this.droppingLayer) return () => undefined;
    this.settle();
    const layer = { close };
    this.layer = layer;
    this.onLayerEntry = true;
    this.env.history.pushState(this.state, "", buildHash(this.route));
    return () => {
      if (this.layer !== layer) return;
      this.layer = null;
      if (!this.onLayerEntry) return;
      this.onLayerEntry = false;
      this.droppingLayer = true;
      this.env.history.go(-1);
    };
  }

  /** Closes the open layer, if any; true when the browser was on its entry. */
  private leaveLayer(): boolean {
    const layer = this.layer;
    const wasOn = this.onLayerEntry;
    this.layer = null;
    this.onLayerEntry = false;
    layer?.close();
    return wasOn;
  }

  /** A traversal by entries of the app's own stack, counting the layer's entry when the browser is on it. */
  private go(delta: number): void {
    this.env.history.go(delta - (this.onLayerEntry ? 1 : 0));
  }

  /** The back control in a level's header: Back when an entry of ours lies beneath, otherwise the parent takes this entry's place. */
  up(): void {
    if (this.state.idx > 0) {
      this.settle();
      this.go(-1);
      return;
    }
    this.replace(this.above(this.route) ?? EXPLORE);
  }

  /**
   * The level above a place. The catalog knows one thing the route alone
   * does not: a category's list sits inside its region, so that is where Up
   * and Back lead from it, and the map only from there.
   */
  private above(route: Route): Route | null {
    if (sheetOf(route) === null && placeOf(route).kind === "category") {
      const region = this.env.places.fallback(route);
      if (region) return region;
    }
    return parentOf(route);
  }

  /**
   * Rule 5, the bottom bar. Returns false when the destination's root is
   * already on screen, so the caller can scroll to the top or focus the search
   * field instead.
   */
  selectDestination(destination: Destination): boolean {
    const target = destinationRoot(destination);
    if (levelKey(this.route) === levelKey(target)) {
      if (sheetOf(this.route) === null) return false;
      this.closeSheet();
      return true;
    }
    if (destination === "explore" || destinationOf(this.route) === destination) {
      this.settle();
      const root = this.findBeneath(target);
      if (root !== null) this.go(root - this.state.idx);
      else this.replace(target);
      return true;
    }
    const fromOtherRoot = isDestinationRoot(this.route) && destinationOf(this.route) !== "explore";
    if (fromOtherRoot) this.replace(target);
    else this.push(target);
    return true;
  }

  /**
   * Records where the user is within the current entry. Reaches `history.state`
   * and the session mirror at most once a second: a page that is killed without
   * being hidden first still comes back within a second of where it was.
   */
  remember(memo: ScrollMemo): void {
    this.state = { ...this.state, scroll: memo };
    this.rememberMemo(this.state.id, memo);
    if (this.stateTimer === null) {
      this.stateTimer = setTimeout(() => {
        this.stateTimer = null;
        this.writeState();
        this.persist();
      }, STATE_WRITE_INTERVAL_MS);
    }
  }

  /** Writes everything that is pending: the settling URL, the scroll anchor, the session mirror and the last place. */
  flush(): void {
    this.snapshot();
    this.writeState();
    this.persist();
  }

  /**
   * Cold start. Nothing is pushed here: an entry created before the first user
   * gesture is skipped by the browser's Back. The target becomes the single
   * existing entry, and `seed` gives it a parent once the user touches the page.
   */
  private coldStart(requested: Route): void {
    let target = requested;
    let memo: ScrollMemo | null = null;
    /* "No route" is no hash at all, as the installed app's start URL has; an explicit `#/` asks for Explore. */
    const bare = /^#?$/.test(this.env.getHash());
    if (bare && !this.env.wasDiscarded && this.env.resume) {
      const resumed = this.readLastPlace();
      if (resumed) {
        target = resumed.route;
        memo = resumed.memo;
      }
    }
    target = this.env.places.normalize(target);
    memo ??= recoveredScroll({ type: this.env.loadType, wasDiscarded: this.env.wasDiscarded }, buildHash(target), this.stack, this.memos);
    this.route = target;
    this.state = { id: this.env.newId(), idx: 0, under: null, scroll: memo };
    this.stack = [{ id: this.state.id, hash: buildHash(target) }];
    this.env.history.replaceState(this.state, "", buildHash(target));
  }

  /**
   * First gesture: when the entry on screen is at depth with nothing of ours
   * beneath it, every level above it is put beneath it, the map first, and
   * the entry itself is pushed again on top. Back then climbs level by level,
   * as if the user had navigated there: from a sheet to its list, to the
   * region, to the map.
   */
  private seed(): void {
    if (this.state.idx !== 0) return;
    const levels: Route[] = [];
    for (let level = this.above(this.route); level; level = this.above(level)) levels.unshift(level);
    if (levels.length === 0) return;
    this.snapshot();
    const target = this.state;
    const stack: { id: string; hash: string }[] = [];
    levels.forEach((level, idx) => {
      const state: EntryState = { id: this.env.newId(), idx, under: null, scroll: null };
      if (idx === 0) this.env.history.replaceState(state, "", buildHash(level));
      else this.env.history.pushState(state, "", buildHash(level));
      stack.push({ id: state.id, hash: buildHash(level) });
    });
    const beneath = levels[levels.length - 1];
    this.state = { ...target, idx: levels.length, under: sheetOf(this.route) !== null && beneath ? buildHash(beneath) : null };
    this.env.history.pushState(this.state, "", buildHash(this.route));
    this.stack = [...stack, { id: this.state.id, hash: buildHash(this.route) }];
    if (this.urlTimer !== null) {
      clearTimeout(this.urlTimer);
      this.urlTimer = null;
    }
    this.persist();
  }

  private readLastPlace(): { route: Route; memo: ScrollMemo | null } | null {
    let stored: unknown;
    try {
      stored = JSON.parse(this.env.local.getItem(lastPlaceKey(this.env.displayMode)) ?? "null");
    } catch {
      return null;
    }
    if (typeof stored !== "object" || stored === null) return null;
    const { hash, at, memo, fallback } = stored as Record<string, unknown>;
    if (typeof hash !== "string" || typeof at !== "number") return null;
    const age = this.env.now() - at;
    if (age < 0 || age > RESUME_MAX_AGE_MS) return null;
    const usable = (candidate: Route): boolean => {
      const kind = placeOf(candidate).kind;
      return kind !== "unknown" && kind !== "share" && this.env.places.exists(candidate);
    };
    const route = this.env.places.normalize(parseHash(hash));
    if (usable(route)) return { route, memo: isScrollMemo(memo) ? memo : null };
    if (sheetOf(route) !== null && usable(withoutSheet(route))) return { route: withoutSheet(route), memo: isScrollMemo(memo) ? memo : null };
    if (typeof fallback === "string" && usable(parseHash(fallback))) return { route: parseHash(fallback), memo: null };
    return null;
  }

  private handlePop(): void {
    if (this.droppingLayer) {
      /* Back off a layer's entry that the layer asked for: the entry beneath takes whatever changed while the layer was open. */
      this.droppingLayer = false;
      this.writeState();
      const next = this.afterDrop;
      this.afterDrop = null;
      next?.();
      return;
    }
    if (this.onLayerEntry) {
      this.leaveLayer();
      const incoming = this.env.history.state;
      if (isEntryState(incoming) && incoming.id === this.state.id && incoming.idx === this.state.idx) {
        this.writeState();
        return;
      }
    }
    const previous = { route: this.route, state: this.state };
    if (this.urlTimer !== null) {
      /* The entry just left still shows its old URL; the stack mirror holds the edited one and restores it on return. */
      clearTimeout(this.urlTimer);
      this.urlTimer = null;
    }
    if (this.stateTimer !== null) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }
    const captured = this.env.capture();
    if (captured) this.rememberMemo(previous.state.id, captured);

    let route = parseHash(this.env.getHash());
    const incoming = this.env.history.state;
    if (isEntryState(incoming)) {
      this.state = incoming;
      const slot = this.stack[incoming.idx];
      if (slot && slot.id === incoming.id) {
        if (slot.hash !== buildHash(route)) {
          route = parseHash(slot.hash);
          this.env.history.replaceState(this.state, "", slot.hash);
        }
      } else {
        this.stack = [];
        this.stack[incoming.idx] = { id: incoming.id, hash: buildHash(route) };
      }
    } else {
      /* Rule 7: a navigation the router did not make is adopted as a new entry above the one it left. */
      route = this.env.places.normalize(route);
      this.state = { id: this.env.newId(), idx: previous.state.idx + 1, under: null, scroll: null };
      this.env.history.replaceState(this.state, "", buildHash(route));
      this.stack.length = this.state.idx;
      this.stack[this.state.idx] = { id: this.state.id, hash: buildHash(route) };
    }
    this.route = route;
    const memo = this.touched.has(this.state.id)
      ? this.memos.get(this.state.id) ?? null
      : this.state.scroll ?? this.memos.get(this.state.id) ?? null;
    const sameLevel = levelKey(previous.route) === levelKey(route);
    this.emit("pop", sameLevel ? { kind: "keep" } : memo ? { kind: "restore", memo } : { kind: "top" });
  }

  /** Depth of the nearest entry beneath the current one that shows `target`'s level with no sheet, or null. */
  private findBeneath(target: Route): number | null {
    for (let index = this.state.idx - 1; index >= 0; index -= 1) {
      const slot = this.stack[index];
      if (!slot) return null;
      const route = parseHash(slot.hash);
      if (levelKey(route) === levelKey(target) && sheetOf(route) === null) return index;
    }
    return null;
  }

  /** After a reload: trusts the stored stack only when it agrees with the entry the browser restored. */
  private reconcileStack(): void {
    const slot = this.stack[this.state.idx];
    if (slot && slot.id === this.state.id) return;
    this.stack = [];
    this.stack[this.state.idx] = { id: this.state.id, hash: buildHash(this.route) };
  }

  private emit(nav: NavKind, scroll: ScrollPlan): Navigation {
    this.seq += 1;
    const navigation: Navigation = { route: this.route, nav, entryId: this.state.id, scroll, seq: this.seq };
    this.last = navigation;
    if (nav !== "load") this.persist();
    for (const listener of this.listeners) listener(navigation);
    return navigation;
  }

  private snapshot(): void {
    const captured = this.env.capture();
    if (!captured) return;
    this.state = { ...this.state, scroll: captured };
    this.rememberMemo(this.state.id, captured);
  }

  private rememberMemo(id: string, memo: ScrollMemo): void {
    this.touched.add(id);
    this.memos.delete(id);
    this.memos.set(id, memo);
    if (this.memos.size > MAX_MEMOS) {
      for (const key of [...this.memos.keys()].slice(0, this.memos.size - MAX_MEMOS)) this.memos.delete(key);
    }
  }

  /**
   * Leaves the current entry in its final form before the router moves away
   * from it: the scroll anchor of the moment and, per rule 8, any query edit
   * whose URL was still pending.
   */
  private settle(): void {
    this.snapshot();
    this.writeState();
  }

  /** Writes the current entry's state and URL. */
  private writeState(): void {
    if (this.urlTimer !== null) {
      clearTimeout(this.urlTimer);
      this.urlTimer = null;
    }
    if (this.stateTimer !== null) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }
    this.env.history.replaceState(this.state, "", buildHash(this.route));
  }

  /** Mirrors scroll memos and the stack into `sessionStorage` and records the resumable place. */
  private persist(): void {
    try {
      this.env.session.setItem(SCROLL_KEY, JSON.stringify(Object.fromEntries(this.memos)));
      this.env.session.setItem(STACK_KEY, JSON.stringify(Array.from(this.stack, (slot) => slot ?? null)));
    } catch {
      /* Storage is full or blocked: restoration falls back to `history.state`, navigation still works. */
    }
    try {
      const fallback = this.env.places.fallback(this.route);
      this.env.local.setItem(lastPlaceKey(this.env.displayMode), JSON.stringify({
        hash: buildHash(this.route),
        at: this.env.now(),
        memo: this.state.scroll,
        fallback: fallback ? buildHash(fallback) : null,
      }));
    } catch {
      /* Without storage the next launch opens Explore. */
    }
  }

  private loadSession(): void {
    try {
      const memos: unknown = JSON.parse(this.env.session.getItem(SCROLL_KEY) ?? "{}");
      if (typeof memos === "object" && memos !== null) {
        for (const [id, memo] of Object.entries(memos)) {
          if (isScrollMemo(memo)) this.memos.set(id, memo);
        }
      }
    } catch {
      this.memos = new Map();
    }
    try {
      const stack: unknown = JSON.parse(this.env.session.getItem(STACK_KEY) ?? "[]");
      if (!Array.isArray(stack)) return;
      this.stack = stack.map((slot: unknown) => {
        if (typeof slot !== "object" || slot === null) return undefined;
        const { id, hash } = slot as Record<string, unknown>;
        return typeof id === "string" && typeof hash === "string" ? { id, hash } : undefined;
      });
    } catch {
      this.stack = [];
    }
  }
}
