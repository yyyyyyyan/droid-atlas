import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeBrowser, type FakeBrowser, type FakeBrowserOptions } from "./fake-browser.ts";
import {
  RESUME_MAX_AGE_MS,
  Router,
  STATE_WRITE_INTERVAL_MS,
  lastPlaceKey,
  recoveredScroll,
  type EntryState,
  type Navigation,
} from "./router.ts";
import { EXPLORE, buildHash, categoryRoute, parseHash, placeOf, regionRoute, withParams, type Route } from "./route.ts";

const SEARCH: Route = { path: ["search"], params: {} };
const SETTINGS: Route = { path: ["settings"], params: {} };
const REGION = regionRoute("media");
const CATEGORY = categoryRoute("launchers");
const OTHER_CATEGORY = categoryRoute("keyboards");

interface Session {
  browser: FakeBrowser;
  router: Router;
  seen: Navigation[];
}

function open(options: FakeBrowserOptions = {}): Session {
  const browser = fakeBrowser(options);
  const router = new Router(browser.env);
  const seen: Navigation[] = [];
  router.start();
  router.subscribe((navigation) => seen.push(navigation));
  return { browser, router, seen };
}

/** A warm session: Explore is on screen and the user has already touched the page. */
function warm(options: FakeBrowserOptions = {}): Session {
  const session = open(options);
  session.browser.gesture();
  return session;
}

/** A page load in the same tab: listeners and memory are gone; history entries and storage remain. */
function reload(previous: FakeBrowser, options: FakeBrowserOptions = {}): Session {
  return open({ history: previous.history, session: previous.session, local: previous.local, now: previous.clock.now, ...options });
}

function here(router: Router): string {
  return buildHash(router.current.route);
}

function stateAt(browser: FakeBrowser, index: number): EntryState {
  return browser.history.stateAt(index) as EntryState;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rule 1: a deeper level and the sheet push", () => {
  test("each adds exactly one entry", () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.push(CATEGORY);
    router.openApp("org.example");
    expect(browser.history.stack).toEqual(["#/", "#/region/media", "#/cat/launchers", "#/cat/launchers?app=org.example"]);
    expect(browser.history.pushes).toBe(3);
  });

  test("a repeated tap on the same target adds nothing and renders nothing", () => {
    const { browser, router, seen } = warm();
    router.push(REGION);
    router.push(REGION);
    router.openApp("a");
    router.openApp("a");
    expect(browser.history.length).toBe(3);
    expect(seen).toHaveLength(2);
  });

  test("every entry carries a unique id, its depth, and for a sheet the list beneath it", () => {
    const { browser, router } = warm();
    router.push(withParams(REGION, { f: "shizuku" }));
    router.openApp("a");
    const states = [0, 1, 2].map((index) => stateAt(browser, index));
    expect(states.map((state) => state.idx)).toEqual([0, 1, 2]);
    expect(new Set(states.map((state) => state.id)).size).toBe(3);
    expect(states.map((state) => state.under)).toEqual([null, null, "#/region/media?f=shizuku"]);
  });
});

describe("rule 2: query, filter, sort and stepping replace within the same entry", () => {
  test("typing a query adds no entry, renders every keystroke and writes the URL once", () => {
    const { browser, router, seen } = open({ hash: "#/search" });
    const id = router.current.entryId;
    const before = { length: browser.history.length, replaces: browser.history.urlReplaces };
    for (const q of ["l", "la", "lau", "laun", "launcher"]) {
      router.replace(withParams(SEARCH, { q }), { settle: true });
    }
    expect(seen.map((navigation) => navigation.route.params.q)).toEqual(["l", "la", "lau", "laun", "launcher"]);
    expect(browser.history.hash).toBe("#/search");
    vi.runAllTimers();
    expect(browser.history.hash).toBe("#/search?q=launcher");
    expect(browser.history.length).toBe(before.length);
    expect(browser.history.urlReplaces).toBe(before.replaces + 1);
    expect(router.current.entryId).toBe(id);
    expect(browser.history.pushes).toBe(0);
  });

  test("filters and sort rewrite the entry in place and keep its scroll", () => {
    const { browser, router, seen } = warm();
    router.push(REGION);
    const id = router.current.entryId;
    router.replace(withParams(REGION, { f: "shizuku,no-internet" }));
    router.replace(withParams(REGION, { f: "shizuku,no-internet", sort: "stars" }));
    expect(browser.history.stack).toEqual(["#/", "#/region/media?f=shizuku,no-internet&sort=stars"]);
    expect(router.current.entryId).toBe(id);
    expect(seen.at(-1)?.scroll).toEqual({ kind: "keep" });
  });

  test("stepping to the next result keeps one sheet entry and the list beneath it", () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.openApp("a");
    const id = router.current.entryId;
    router.openApp("b");
    router.openApp("c");
    expect(browser.history.stack).toEqual(["#/", "#/region/media", "#/region/media?app=c"]);
    expect(router.current.entryId).toBe(id);
    expect(stateAt(browser, 2).under).toBe("#/region/media");
  });
});

describe("rules 3 and 4: a replace that changes the view gets a new entry id", () => {
  test("a sibling category replaces, and starts at the top with no inherited scroll", async () => {
    const { browser, router, seen } = warm();
    router.push(REGION);
    router.push(CATEGORY);
    const id = router.current.entryId;
    browser.view.y = 1200;
    browser.view.anchor = { key: "x", offset: 4 };
    router.replace(OTHER_CATEGORY);
    expect(browser.history.stack).toEqual(["#/", "#/region/media", "#/cat/keyboards"]);
    expect(router.current.entryId).not.toBe(id);
    expect(seen.at(-1)?.scroll).toEqual({ kind: "top" });
    expect(stateAt(browser, 2).scroll).toBeNull();
    await browser.history.back();
    expect(here(router)).toBe("#/region/media");
  });
});

describe("rule 5: the bottom bar", () => {
  test("from the Explore root, Search and Saved push, so Back returns to Explore", async () => {
    const { browser, router } = warm();
    expect(router.selectDestination("search")).toBe(true);
    expect(browser.history.stack).toEqual(["#/", "#/search"]);
    await browser.history.back();
    expect(here(router)).toBe("#/");
  });

  test("between the roots of Search and Saved, the entry is replaced and gets a new id", async () => {
    const { browser, router } = warm();
    router.selectDestination("search");
    const searchId = router.current.entryId;
    router.selectDestination("saved");
    expect(browser.history.stack).toEqual(["#/", "#/saved"]);
    expect(router.current.entryId).not.toBe(searchId);
    router.selectDestination("search");
    expect(browser.history.stack).toEqual(["#/", "#/search"]);
    expect(browser.history.pushes).toBe(1);
    await browser.history.back();
    expect(here(router)).toBe("#/");
  });

  test("from a level inside Explore, Search and Saved push", async () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.selectDestination("search");
    expect(browser.history.stack).toEqual(["#/", "#/region/media", "#/search"]);
    await browser.history.back();
    expect(here(router)).toBe("#/region/media");
  });

  test("Explore is reached by going back to its root entry and never by pushing", async () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.push(CATEGORY);
    router.selectDestination("saved");
    const pushes = browser.history.pushes;
    router.selectDestination("explore");
    await browser.history.settled();
    expect(browser.history.log.at(-1)).toBe("go -3");
    expect(here(router)).toBe("#/");
    expect(browser.history.index).toBe(0);
    expect(browser.history.pushes).toBe(pushes);
  });

  test("Explore from deeper inside Explore returns to the root entry the same way", async () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.push(CATEGORY);
    router.selectDestination("explore");
    await browser.history.settled();
    expect(here(router)).toBe("#/");
    expect(browser.history.index).toBe(0);
  });

  test("with no Explore entry in the stack, Explore replaces", () => {
    const { browser, router } = open({ hash: "#/saved" });
    router.selectDestination("explore");
    expect(browser.history.stack).toEqual(["#/"]);
    expect(browser.history.pushes).toBe(0);
  });

  test("the destination already on screen is not navigated to again", () => {
    const { browser, router, seen } = warm();
    expect(router.selectDestination("explore")).toBe(false);
    router.selectDestination("search");
    router.replace(withParams(SEARCH, { q: "maps" }));
    expect(router.selectDestination("search")).toBe(false);
    expect(browser.history.length).toBe(2);
    expect(seen).toHaveLength(2);
  });

  test("selecting the current destination with its sheet open closes the sheet", async () => {
    const { browser, router } = warm({ hash: "#/saved" });
    router.openApp("a");
    expect(router.selectDestination("saved")).toBe(true);
    await browser.history.settled();
    expect(here(router)).toBe("#/saved");
    expect(browser.history.index).toBe(1);
  });

  test("a place outside the bar is left by pushing, and Explore still goes back to the root", async () => {
    const { browser, router } = warm();
    router.push(SETTINGS);
    router.selectDestination("search");
    expect(browser.history.stack).toEqual(["#/", "#/settings", "#/search"]);
    router.selectDestination("explore");
    await browser.history.settled();
    expect(browser.history.index).toBe(0);
  });

  test("a stack mirror that does not match the entry on screen is not trusted", async () => {
    const first = warm();
    first.router.push(REGION);
    first.browser.session.setItem("droid-atlas:v1:stack", JSON.stringify([{ id: "stale", hash: "#/" }, { id: "stale-2", hash: "#/region/media" }]));
    const { browser, router } = reload(first.browser);
    router.selectDestination("explore");
    await browser.history.settled();
    expect(browser.history.log.at(-1)).not.toMatch(/^go /);
    expect(here(router)).toBe("#/");
    expect(browser.history.index).toBe(1);
  });
});

describe("rule 6: the sheet's close control", () => {
  test("goes back when the list it was opened from lies beneath, so Forward reopens it", async () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.openApp("a");
    router.openApp("b");
    router.closeSheet();
    await browser.history.settled();
    expect(browser.history.log.at(-1)).toBe("go -1");
    expect(here(router)).toBe("#/region/media");
    expect(browser.history.index).toBe(1);
    await browser.history.forward();
    expect(here(router)).toBe("#/region/media?app=b");
  });

  test("replaces when the list changed while the sheet was open", () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.openApp("a");
    router.replace(withParams(router.current.route, { f: "shizuku" }));
    router.closeSheet();
    expect(browser.history.stack).toEqual(["#/", "#/region/media", "#/region/media?f=shizuku"]);
    expect(browser.history.index).toBe(2);
    expect(browser.history.log.filter((line) => line.startsWith("go "))).toEqual([]);
  });

  test("replaces when nothing of ours lies beneath", () => {
    const { browser, router } = open({ hash: "#/region/media?app=a" });
    router.closeSheet();
    expect(browser.history.stack).toEqual(["#/region/media"]);
    expect(browser.history.log.filter((line) => line.startsWith("go "))).toEqual([]);
  });

  test("the browser's Back closes the sheet before it leaves the level", async () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.openApp("a");
    await browser.history.back();
    expect(here(router)).toBe("#/region/media");
    await browser.history.back();
    expect(here(router)).toBe("#/");
  });
});

describe("rule 7: navigations the router did not make", () => {
  test("a typed hash is adopted as a new entry above the current one", async () => {
    const { browser, router } = warm();
    router.push(REGION);
    await browser.history.navigateByHash("#/saved");
    expect(here(router)).toBe("#/saved");
    expect(stateAt(browser, 2)).toMatchObject({ idx: 2, under: null });
    await browser.history.back();
    expect(here(router)).toBe("#/region/media");
  });

  test("a share link delivered to the running app is normalized by replace, not by another entry", async () => {
    const { browser, router } = warm({
      places: { normalize: (route) => (placeOf(route).kind === "share" ? withParams(CATEGORY, { app: route.path[1] }) : route) },
    });
    router.push(REGION);
    await browser.history.navigateByHash("#/app/org.example");
    expect(browser.history.stack).toEqual(["#/", "#/region/media", "#/cat/launchers?app=org.example"]);
    router.closeSheet();
    expect(browser.history.stack).toEqual(["#/", "#/region/media", "#/cat/launchers"]);
  });
});

describe("rule 8: nothing else touches history", () => {
  test("remembering scroll never adds an entry or changes the URL", () => {
    const { browser, router } = warm({ hash: "#/region/media" });
    const before = { pushes: browser.history.pushes, replaces: browser.history.urlReplaces, length: browser.history.length };
    for (let y = 0; y < 5000; y += 100) router.remember({ y, anchor: { key: "a", offset: 3 } });
    vi.advanceTimersByTime(5 * STATE_WRITE_INTERVAL_MS);
    browser.hide();
    expect({ pushes: browser.history.pushes, replaces: browser.history.urlReplaces, length: browser.history.length }).toEqual(before);
  });

  test("the scroll anchor reaches history.state at most once a second", () => {
    const { browser, router } = warm({ hash: "#/region/media" });
    const writes = (): number => browser.history.log.filter((line) => line.startsWith("state ")).length;
    const before = writes();
    for (let y = 0; y < 3000; y += 100) router.remember({ y, anchor: null });
    expect(writes()).toBe(before);
    vi.advanceTimersByTime(STATE_WRITE_INTERVAL_MS);
    expect(writes()).toBe(before + 1);
    expect(stateAt(browser, browser.history.index).scroll).toEqual({ y: 2900, anchor: null });
  });

  test("a pending query edit is flushed before a push", () => {
    const { browser, router } = warm({ hash: "#/search" });
    router.replace(withParams(SEARCH, { q: "maps" }), { settle: true });
    router.openApp("org.example");
    expect(browser.history.stack.slice(-2)).toEqual(["#/search?q=maps", "#/search?q=maps&app=org.example"]);
  });

  test("a pending query edit is flushed when the page is hidden", () => {
    const { browser, router } = open({ hash: "#/search" });
    router.replace(withParams(SEARCH, { q: "term" }), { settle: true });
    browser.hide();
    expect(browser.history.hash).toBe("#/search?q=term");
  });

  test("a query edit still pending at Back is on the entry when the user returns to it", async () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.selectDestination("search");
    router.replace(withParams(SEARCH, { q: "ter" }), { settle: true });
    await browser.history.back();
    expect(here(router)).toBe("#/region/media");
    await browser.history.forward();
    expect(here(router)).toBe("#/search?q=ter");
    expect(browser.history.hash).toBe("#/search?q=ter");
  });

  test("a reload keeps the entry stack exactly as it was", () => {
    const first = warm();
    first.router.push(REGION);
    first.router.openApp("a");
    first.browser.hide();
    const stack = [...first.browser.history.stack];
    const log = first.browser.history.log.length;
    const { browser, router } = reload(first.browser);
    expect(browser.history.stack).toEqual(stack);
    expect(browser.history.log.slice(log)).toEqual([]);
    expect(here(router)).toBe("#/region/media?app=a");
  });
});

describe("cold start", () => {
  const share: FakeBrowserOptions["places"] = {
    normalize: (route) => (placeOf(route).kind === "share" ? withParams(CATEGORY, { app: route.path[1] }) : route),
  };

  test("nothing is pushed before the first gesture", () => {
    for (const hash of ["", "#/", "#/region/media", "#/cat/launchers?app=x", "#/app/org.example", "#/search?q=maps"]) {
      const { browser } = open({ hash, places: share });
      expect(browser.history.pushes, hash).toBe(0);
      expect(browser.history.length, hash).toBe(1);
    }
  });

  test("the share form is replaced on arrival by the app's category with the sheet open", () => {
    const { browser, router } = open({ hash: "#/app/org.example", places: share });
    expect(browser.history.stack).toEqual(["#/cat/launchers?app=org.example"]);
    expect(here(router)).toBe("#/cat/launchers?app=org.example");
    expect(stateAt(browser, 0)).toMatchObject({ idx: 0, under: null });
  });

  test("the first gesture seeds the list beneath a cold sheet, and Back then closes the sheet", async () => {
    const { browser, router, seen } = open({ hash: "#/app/org.example", places: share });
    const id = router.current.entryId;
    browser.gesture();
    expect(browser.history.stack).toEqual(["#/", "#/cat/launchers", "#/cat/launchers?app=org.example"]);
    expect(browser.history.index).toBe(2);
    expect(stateAt(browser, 2)).toMatchObject({ id, idx: 2, under: "#/cat/launchers" });
    expect(seen).toEqual([]);
    await browser.history.back();
    expect(here(router)).toBe("#/cat/launchers");
  });

  test("the first gesture puts every level above a cold sheet beneath it, and Back climbs them one by one", async () => {
    const inRegion: FakeBrowserOptions["places"] = { ...share, fallback: (route) => (placeOf(route).kind === "category" ? REGION : null) };
    const { browser, router } = open({ hash: "#/app/org.example", places: inRegion });
    const id = router.current.entryId;
    browser.gesture();
    expect(browser.history.stack).toEqual(["#/", buildHash(REGION), "#/cat/launchers", "#/cat/launchers?app=org.example"]);
    expect(browser.history.index).toBe(3);
    expect(stateAt(browser, 3)).toMatchObject({ id, idx: 3, under: "#/cat/launchers" });
    expect([0, 1, 2].map((index) => stateAt(browser, index)?.idx)).toEqual([0, 1, 2]);
    await browser.history.back();
    expect(here(router)).toBe("#/cat/launchers");
    await browser.history.back();
    expect(here(router)).toBe(buildHash(REGION));
    await browser.history.back();
    expect(here(router)).toBe("#/");
    expect(router.depth).toBe(0);
  });

  test("a cold category list gets its region and the map beneath it; Up from it leads to the region", async () => {
    const inRegion: FakeBrowserOptions["places"] = { fallback: (route) => (placeOf(route).kind === "category" ? REGION : null) };
    const seeded = open({ hash: "#/cat/launchers?sort=stars", places: inRegion });
    seeded.browser.gesture();
    expect(seeded.browser.history.stack).toEqual(["#/", buildHash(REGION), "#/cat/launchers?sort=stars"]);

    const cold = open({ hash: "#/cat/launchers", places: inRegion });
    cold.router.up();
    expect(here(cold.router)).toBe(buildHash(REGION));
    expect(cold.browser.history.length).toBe(1);
  });

  test("the first gesture seeds Explore beneath a cold level", async () => {
    const { browser, router } = open({ hash: "#/region/media?f=shizuku" });
    browser.gesture();
    expect(browser.history.stack).toEqual(["#/", "#/region/media?f=shizuku"]);
    await browser.history.back();
    expect(here(router)).toBe("#/");
  });

  test("Explore has nothing to seed; a cold Search or Saved gets Explore beneath it", () => {
    const explore = open({ hash: "#/" });
    explore.browser.gesture();
    expect(explore.browser.history.length).toBe(1);
    expect(explore.browser.history.pushes).toBe(0);
    for (const hash of ["#/search?q=maps", "#/saved"]) {
      const { browser } = open({ hash });
      browser.gesture();
      expect(browser.history.stack, hash).toEqual(["#/", hash]);
    }
  });

  test("the stack is seeded once: a later gesture changes nothing", () => {
    const { browser } = open({ hash: "#/region/media" });
    browser.gesture();
    const log = browser.history.log.length;
    browser.gesture();
    expect(browser.history.log.length).toBe(log);
  });

  test("seeding keeps the position scrolled to before the gesture", () => {
    const { browser } = open({ hash: "#/region/media" });
    browser.view.y = 640;
    browser.view.anchor = { key: "row", offset: 9 };
    browser.gesture();
    expect(stateAt(browser, 1).scroll).toEqual({ y: 640, anchor: { key: "row", offset: 9 } });
  });

  test("closing a cold sheet before any gesture replaces it with its list", () => {
    const { browser, router } = open({ hash: "#/app/org.example", places: share });
    router.closeSheet();
    expect(browser.history.stack).toEqual(["#/cat/launchers"]);
    expect(browser.history.pushes).toBe(0);
  });

  test("a second document opened in the same tab starts its own stack", async () => {
    const first = warm();
    first.router.push(REGION);
    await first.browser.history.navigateByHash("#/elsewhere");
    first.browser.history.entries[first.browser.history.index] = { state: null, hash: "#/saved" };
    const { browser, router } = reload(first.browser);
    expect(here(router)).toBe("#/saved");
    expect(stateAt(browser, browser.history.index).idx).toBe(0);
  });
});

describe("launch and resume", () => {
  function leaveAt(route: Route, options: FakeBrowserOptions = {}): FakeBrowser {
    const { browser, router } = warm(options);
    router.push(route);
    browser.view.y = 1840;
    browser.view.anchor = { key: "org.example", offset: 12 };
    browser.hide();
    return browser;
  }

  test("a launch with no route resumes a recent place as the single entry, then seeds Explore beneath it", async () => {
    const left = leaveAt(withParams(REGION, { f: "no-internet" }));
    const { browser, router } = open({ local: left.local, now: left.clock.now + 60_000 });
    expect(browser.history.stack).toEqual(["#/region/media?f=no-internet"]);
    expect(router.current.scroll).toEqual({ kind: "restore", memo: { y: 1840, anchor: { key: "org.example", offset: 12 } } });
    browser.gesture();
    await browser.history.back();
    expect(here(router)).toBe("#/");
  });

  test("with resuming switched off a launch opens Explore, and the last place is still recorded for when it is switched back on", () => {
    const left = leaveAt(REGION);
    const { browser } = open({ local: left.local, now: left.clock.now + 60_000, resume: false });
    expect(browser.history.stack).toEqual(["#/"]);
    const again = leaveAt(REGION, { local: left.local, resume: false });
    expect(JSON.parse(again.local.getItem(lastPlaceKey("browser")) ?? "{}")).toMatchObject({ hash: "#/region/media" });
    const back = open({ local: again.local, now: again.clock.now + 60_000, resume: true });
    expect(back.browser.history.stack).toEqual(["#/region/media"]);
  });

  test("a place older than seven days is not resumed", () => {
    const left = leaveAt(REGION);
    const { browser } = open({ local: left.local, now: left.clock.now + RESUME_MAX_AGE_MS + 1 });
    expect(browser.history.stack).toEqual(["#/"]);
  });

  test("an explicit route wins over the last place, including an explicit Explore", () => {
    const left = leaveAt(REGION);
    const saved = open({ hash: "#/saved", local: left.local, now: left.clock.now + 1000 });
    expect(saved.browser.history.stack).toEqual(["#/saved"]);
    const explore = open({ hash: "#/", local: left.local, now: left.clock.now + 1000 });
    expect(explore.browser.history.stack).toEqual(["#/"]);
    const empty = open({ hash: "#", local: left.local, now: left.clock.now + 1000 });
    expect(empty.browser.history.stack).toEqual(["#/region/media"]);
  });

  test("a discarded tab is not a launch", () => {
    const left = leaveAt(REGION);
    const { browser } = open({ local: left.local, now: left.clock.now + 1000, wasDiscarded: true });
    expect(browser.history.stack).toEqual(["#/"]);
  });

  test("the last place is kept per display mode", () => {
    const left = leaveAt(REGION, { displayMode: "browser" });
    expect(left.local.getItem(lastPlaceKey("browser"))).not.toBeNull();
    expect(left.local.getItem(lastPlaceKey("standalone"))).toBeNull();
    const installed = open({ local: left.local, now: left.clock.now + 1000, displayMode: "standalone" });
    expect(installed.browser.history.stack).toEqual(["#/"]);
    const tab = open({ local: left.local, now: left.clock.now + 1000, displayMode: "browser" });
    expect(tab.browser.history.stack).toEqual(["#/region/media"]);
  });

  test("a last place whose category is gone falls back to its region, then to Explore", () => {
    const places: FakeBrowserOptions["places"] = { fallback: () => REGION };
    const left = leaveAt(CATEGORY, { places });
    const gone = (route: Route): boolean => buildHash(route) !== buildHash(CATEGORY);
    const toRegion = open({ local: left.local, now: left.clock.now + 1000, places: { exists: gone } });
    expect(toRegion.browser.history.stack).toEqual(["#/region/media"]);
    expect(toRegion.router.current.scroll).toEqual({ kind: "top" });
    const toExplore = open({ local: left.local, now: left.clock.now + 1000, places: { exists: () => false } });
    expect(toExplore.browser.history.stack).toEqual(["#/"]);
  });

  test("a last place whose app is gone resumes the list it was open over", () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.openApp("gone");
    browser.hide();
    const next = open({
      local: browser.local,
      now: browser.clock.now + 1000,
      places: { exists: (route) => route.params.app !== "gone" },
    });
    expect(next.browser.history.stack).toEqual(["#/region/media"]);
  });

  test("a retired app id in the last place is resolved to its successor", () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.openApp("old-id");
    browser.hide();
    const next = open({
      local: browser.local,
      now: browser.clock.now + 1000,
      places: { normalize: (route) => (route.params.app === "old-id" ? withParams(route, { app: "new-id" }) : route) },
    });
    expect(next.browser.history.stack).toEqual(["#/region/media?app=new-id"]);
  });

  test.each([
    ["not JSON", "{oops"],
    ["of the wrong shape", JSON.stringify({ hash: 42, at: "yesterday" })],
    ["from the future", JSON.stringify({ hash: "#/saved", at: 9_999_999_999_999 })],
    ["an unknown place", JSON.stringify({ hash: "#/nowhere/at/all", at: 1_800_000_000_000 })],
  ])("a stored last place that is %s is ignored", (_label, stored) => {
    const browser = fakeBrowser();
    browser.local.setItem(lastPlaceKey("browser"), stored);
    new Router(browser.env).start();
    expect(browser.history.stack).toEqual(["#/"]);
  });
});

describe("restoration", () => {
  test("Back to a list restores the scroll position and anchor it was left with", async () => {
    const { browser, router, seen } = warm();
    router.push(REGION);
    browser.view.y = 2400;
    browser.view.anchor = { key: "org.fossify.gallery", offset: 18 };
    router.push(CATEGORY);
    browser.view.y = 0;
    browser.view.anchor = null;
    await browser.history.back();
    expect(seen.at(-1)?.nav).toBe("pop");
    expect(seen.at(-1)?.scroll).toEqual({ kind: "restore", memo: { y: 2400, anchor: { key: "org.fossify.gallery", offset: 18 } } });
  });

  test("the position left behind is in history.state itself, not only in the session mirror", () => {
    const { browser, router } = warm();
    router.push(REGION);
    browser.view.y = 2400;
    browser.view.anchor = { key: "row", offset: 18 };
    router.push(CATEGORY);
    expect(stateAt(browser, 1).scroll).toEqual({ y: 2400, anchor: { key: "row", offset: 18 } });
  });

  test("Forward restores the position of the entry that Back left", async () => {
    const { browser, router, seen } = warm();
    router.push(REGION);
    router.push(CATEGORY);
    browser.view.y = 700;
    browser.view.anchor = { key: "mid", offset: 2 };
    await browser.history.back();
    browser.view.y = 0;
    browser.view.anchor = null;
    await browser.history.forward();
    expect(seen.at(-1)?.scroll).toEqual({ kind: "restore", memo: { y: 700, anchor: { key: "mid", offset: 2 } } });
  });

  test("a new level starts at the top; opening, stepping and closing the sheet leave the list where it is", async () => {
    const { browser, router, seen } = warm();
    router.push(REGION);
    expect(seen.at(-1)?.scroll).toEqual({ kind: "top" });
    router.openApp("a");
    expect(seen.at(-1)?.scroll).toEqual({ kind: "keep" });
    router.openApp("b");
    expect(seen.at(-1)?.scroll).toEqual({ kind: "keep" });
    await browser.history.back();
    expect(seen.at(-1)?.scroll).toEqual({ kind: "keep" });
  });

  test("a reload restores the entry on screen from history.state", () => {
    const first = warm();
    first.router.push(REGION);
    first.browser.view.y = 900;
    first.browser.view.anchor = { key: "x", offset: 40 };
    first.router.openApp("a");
    first.browser.hide();
    const { router } = reload(first.browser);
    expect(router.current.nav).toBe("load");
    expect(router.current.scroll).toEqual({ kind: "restore", memo: { y: 900, anchor: { key: "x", offset: 40 } } });
  });

  test("a reload that arrives without history.state restores the position last stored for that URL", () => {
    const first = warm();
    first.router.push(REGION);
    first.browser.view.y = 1200;
    first.browser.view.anchor = { key: "row", offset: 12 };
    first.browser.hide();
    first.browser.history.entries[first.browser.history.index] = { state: null, hash: "#/region/media" };

    const reloaded = reload(first.browser, { loadType: "reload", ids: { next: 100 } });
    expect(reloaded.router.current.scroll).toEqual({ kind: "restore", memo: { y: 1200, anchor: { key: "row", offset: 12 } } });
    expect((reloaded.browser.history.state as EntryState).scroll).toEqual({ y: 1200, anchor: { key: "row", offset: 12 } });

    first.browser.history.entries[first.browser.history.index] = { state: null, hash: "#/region/media" };
    const returned = reload(first.browser, { loadType: "back_forward", ids: { next: 200 } });
    expect(returned.router.current.scroll).toMatchObject({ kind: "restore", memo: { y: 1200 } });
  });

  test("an ordinary navigation to a URL the session has shown starts at the top", () => {
    const first = warm();
    first.router.push(REGION);
    first.browser.view.y = 1200;
    first.browser.hide();
    first.browser.history.entries[first.browser.history.index] = { state: null, hash: "#/region/media" };
    const { router } = reload(first.browser, { loadType: "navigate", ids: { next: 100 } });
    expect(router.current.scroll).toEqual({ kind: "top" });
  });

  test("the session mirror follows scrolling, so a page killed without being hidden comes back where it was", () => {
    const first = warm();
    first.router.push(REGION);
    first.router.remember({ y: 700, anchor: { key: "row", offset: 3 } });
    vi.advanceTimersByTime(STATE_WRITE_INTERVAL_MS);
    first.browser.history.entries[first.browser.history.index] = { state: null, hash: "#/region/media" };
    const { router } = reload(first.browser, { wasDiscarded: true, ids: { next: 100 } });
    expect(router.current.scroll).toEqual({ kind: "restore", memo: { y: 700, anchor: { key: "row", offset: 3 } } });
  });

  test("a discarded tab restores every entry, not only the one on screen", async () => {
    const first = warm();
    first.router.push(REGION);
    first.browser.view.y = 3100;
    first.browser.view.anchor = { key: "deep", offset: 5 };
    first.router.push(CATEGORY);
    first.browser.view.y = 640;
    first.browser.view.anchor = { key: "mid", offset: 0 };
    first.browser.hide();

    const { browser, router, seen } = reload(first.browser, { wasDiscarded: true });
    expect(router.current.scroll).toMatchObject({ kind: "restore", memo: { y: 640 } });
    await browser.history.back();
    expect(seen.at(-1)?.scroll).toEqual({ kind: "restore", memo: { y: 3100, anchor: { key: "deep", offset: 5 } } });
  });

  test("restoration survives the loss of sessionStorage", () => {
    const first = warm();
    first.router.push(REGION);
    first.browser.view.y = 500;
    first.browser.view.anchor = { key: "k", offset: 1 };
    first.browser.hide();
    first.browser.session.data.clear();
    const { router } = reload(first.browser);
    expect(router.current.scroll).toEqual({ kind: "restore", memo: { y: 500, anchor: { key: "k", offset: 1 } } });
  });

  test("the position reached by Back is restored from the session mirror when history.state is older", async () => {
    const { browser, router, seen } = warm();
    router.push(REGION);
    router.push(CATEGORY);
    browser.view.y = 80;
    browser.view.anchor = { key: "top", offset: 0 };
    await browser.history.back();
    await browser.history.forward();
    expect(stateAt(browser, 2).scroll).toBeNull();
    expect(seen.at(-1)?.scroll).toEqual({ kind: "restore", memo: { y: 80, anchor: { key: "top", offset: 0 } } });
  });

  test("state is written on every route change and when the page is hidden", () => {
    const { browser, router } = warm();
    const afterStart = browser.session.writes;
    router.push(REGION);
    expect(browser.session.writes).toBeGreaterThan(afterStart);
    expect(JSON.parse(browser.local.getItem(lastPlaceKey("browser")) ?? "{}")).toMatchObject({ hash: "#/region/media" });
    browser.view.y = 77;
    const beforeHide = browser.session.writes;
    browser.hide();
    expect(browser.session.writes).toBeGreaterThan(beforeHide);
    expect(JSON.parse(browser.local.getItem(lastPlaceKey("browser")) ?? "{}")).toMatchObject({ memo: { y: 77 } });
    expect(stateAt(browser, 1).scroll).toMatchObject({ y: 77 });
  });

  test("corrupt session state falls back to history.state and never throws", () => {
    const first = warm();
    first.router.push(REGION);
    first.browser.view.y = 500;
    first.browser.hide();
    first.browser.session.setItem("droid-atlas:v1:scroll", "][");
    first.browser.session.setItem("droid-atlas:v1:stack", "{\"not\":\"an array\"}");
    const { router } = reload(first.browser);
    expect(router.current.scroll).toMatchObject({ kind: "restore", memo: { y: 500 } });
    expect(here(router)).toBe("#/region/media");
  });

  test("history state from something else is treated as no state", () => {
    const browser = fakeBrowser({ hash: "#/region/media" });
    browser.history.entries[0] = { state: { id: 7, idx: "x" }, hash: "#/region/media" };
    const router = new Router(browser.env);
    router.start();
    expect(router.depth).toBe(0);
    expect(stateAt(browser, 0)).toMatchObject({ idx: 0, under: null });
  });

  test("storage that throws does not stop navigation", () => {
    const browser = fakeBrowser();
    browser.session.setItem = () => {
      throw new Error("quota");
    };
    browser.local.setItem = () => {
      throw new Error("blocked");
    };
    const router = new Router(browser.env);
    router.start();
    browser.gesture();
    router.push(REGION);
    router.openApp("a");
    expect(here(router)).toBe("#/region/media?app=a");
    expect(browser.history.length).toBe(3);
  });
});

describe("the header's back control", () => {
  test("goes back when an entry of ours lies beneath", async () => {
    const { browser, router } = warm();
    router.push(REGION);
    router.up();
    await browser.history.settled();
    expect(here(router)).toBe("#/");
    expect(browser.history.index).toBe(0);
  });

  test("puts the parent in place when nothing lies beneath", () => {
    const { browser, router } = open({ hash: "#/region/media" });
    router.up();
    expect(browser.history.stack).toEqual(["#/"]);
  });
});

describe("routes", () => {
  test("parse and build agree on one canonical form", () => {
    expect(buildHash(parseHash("#/search?app=x&sort=stars&f=a,b&q=two%20words"))).toBe("#/search?q=two%20words&f=a,b&sort=stars&app=x");
    expect(buildHash(parseHash(""))).toBe("#/");
    expect(buildHash(parseHash("#/cat/launchers?f="))).toBe("#/cat/launchers");
    expect(buildHash(parseHash("#/search?f=c:launchers,r:media"))).toBe("#/search?f=c:launchers,r:media");
    expect(buildHash(EXPLORE)).toBe("#/");
  });

  test("a query that needs escaping survives the round trip", () => {
    const route = withParams(SEARCH, { q: "c++ & 100% #1 ?", app: "a/b c" });
    expect(parseHash(buildHash(route))).toEqual(route);
  });

  test("malformed escapes do not throw", () => {
    expect(parseHash("#/region/%E0%A4%A").path).toEqual(["region", "%E0%A4%A"]);
  });

  test("places are recognized from the path alone", () => {
    expect(placeOf(parseHash("#/"))).toEqual({ kind: "explore" });
    expect(placeOf(parseHash("#/cat/launchers?app=x"))).toEqual({ kind: "category", id: "launchers" });
    expect(placeOf(parseHash("#/app/org.example"))).toEqual({ kind: "share", id: "org.example" });
    expect(placeOf(parseHash("#/search/extra"))).toEqual({ kind: "unknown" });
    expect(placeOf(parseHash("#/cat/android-foss/launcher"))).toEqual({ kind: "unknown" });
  });
});

describe("the position for a load without history.state", () => {
  const memo = (y: number) => ({ y, anchor: null });
  const stack = [{ id: "a", hash: "#/" }, { id: "b", hash: "#/region/media" }, undefined, { id: "d", hash: "#/region/media" }];
  const memos = new Map([["a", memo(10)], ["d", memo(40)], ["b", memo(20)], ["gone", memo(99)]]);

  test("a reload and a return through history restore the most recently stored position for the URL", () => {
    expect(recoveredScroll({ type: "reload", wasDiscarded: false }, "#/region/media", stack, memos)).toEqual(memo(20));
    expect(recoveredScroll({ type: "back_forward", wasDiscarded: false }, "#/region/media", stack, memos)).toEqual(memo(20));
    expect(recoveredScroll({ type: "reload", wasDiscarded: false }, "#/", stack, memos)).toEqual(memo(10));
  });

  test("the reload of a discarded tab restores too, whatever the load is called", () => {
    expect(recoveredScroll({ type: "navigate", wasDiscarded: true }, "#/region/media", stack, memos)).toEqual(memo(20));
  });

  test("an ordinary navigation or a prerender restores nothing", () => {
    expect(recoveredScroll({ type: "navigate", wasDiscarded: false }, "#/region/media", stack, memos)).toBeNull();
    expect(recoveredScroll({ type: "prerender", wasDiscarded: false }, "#/region/media", stack, memos)).toBeNull();
  });

  test("a URL the session never showed, or showed without storing a position, restores nothing", () => {
    expect(recoveredScroll({ type: "reload", wasDiscarded: false }, "#/search", stack, memos)).toBeNull();
    expect(recoveredScroll({ type: "reload", wasDiscarded: false }, "#/region/media", [{ id: "z", hash: "#/region/media" }], memos)).toBeNull();
    expect(recoveredScroll({ type: "reload", wasDiscarded: false }, "#/region/media", [], memos)).toBeNull();
  });

  test("the same path with a different query is a different URL", () => {
    expect(recoveredScroll({ type: "reload", wasDiscarded: false }, "#/region/media?f=foss", stack, memos)).toBeNull();
  });
});

describe("a layer without a URL holds Back where the browser needs it to", () => {
  /** A region opened in a new tab and touched once: its own entry sits on the map the first touch put beneath it. */
  function onRegion(layerEntries: boolean): Session {
    const session = open({ hash: buildHash(REGION), layerEntries, places: { fallback: () => null } });
    session.browser.gesture();
    session.seen.length = 0;
    return session;
  }

  test("where Back reaches the dialog first, opening a layer adds nothing to history", () => {
    const { browser, router } = onRegion(false);
    const before = browser.history.length;
    const release = router.holdBack(() => undefined);
    expect(browser.history.length).toBe(before);
    release();
    expect(browser.history.log.at(-1)).not.toMatch(/^go/);
  });

  test("elsewhere it adds one entry with the same URL, and Back closes the layer and moves nothing else", async () => {
    const { browser, router, seen } = onRegion(true);
    const base = browser.history.index;
    let closed = 0;
    router.holdBack(() => {
      closed += 1;
    });
    expect(browser.history.index).toBe(base + 1);
    expect(browser.history.hash).toBe("#/region/media");
    await browser.history.back();
    expect(closed).toBe(1);
    expect(browser.history.index).toBe(base);
    expect(here(router)).toBe("#/region/media");
    expect(seen).toEqual([]);
  });

  test("closed another way, it takes its entry back without a navigation", async () => {
    const { browser, router, seen } = onRegion(true);
    const base = browser.history.index;
    let closed = 0;
    const release = router.holdBack(() => {
      closed += 1;
    });
    release();
    await browser.history.settled();
    expect(closed).toBe(0);
    expect(browser.history.index).toBe(base);
    expect(seen).toEqual([]);
    release();
    await browser.history.settled();
    expect(browser.history.index).toBe(base);
  });

  test("a sort chosen in the layer is what the entry beneath shows, closed by Back or otherwise", async () => {
    const sorted = withParams(REGION, { sort: "stars" });
    for (const how of ["back", "release"] as const) {
      const { browser, router, seen } = onRegion(true);
      const base = browser.history.index;
      const release = router.holdBack(() => undefined);
      router.replace(sorted);
      if (how === "back") await browser.history.back();
      else {
        release();
        await browser.history.settled();
      }
      expect(browser.history.index, how).toBe(base);
      expect(browser.history.hash, how).toBe(buildHash(sorted));
      expect(here(router), how).toBe(buildHash(sorted));
      expect(seen.map((navigation) => navigation.nav), how).toEqual(["replace"]);
    }
  });

  test("a push while the layer is open closes it and takes its entry, so Back returns to the place beneath", async () => {
    const { browser, router } = onRegion(true);
    const base = browser.history.index;
    let closed = 0;
    const release = router.holdBack(() => {
      closed += 1;
    });
    router.push(CATEGORY);
    expect(closed).toBe(1);
    expect(browser.history.index).toBe(base + 1);
    expect(browser.history.length).toBe(base + 2);
    release();
    await browser.history.settled();
    expect(here(router)).toBe("#/cat/launchers");
    await browser.history.back();
    expect(here(router)).toBe("#/region/media");
  });

  test("a push made while the layer's entry is being taken back lands after it", async () => {
    const { browser, router } = onRegion(true);
    const base = browser.history.index;
    const release = router.holdBack(() => undefined);
    release();
    router.push(CATEGORY);
    await browser.history.settled();
    expect(browser.history.index).toBe(base + 1);
    expect(browser.history.stack.slice(base)).toEqual(["#/region/media", "#/cat/launchers"]);
    expect(here(router)).toBe("#/cat/launchers");
  });

  test("going up from under a layer counts the layer's entry and closes the layer", async () => {
    const { browser, router } = onRegion(true);
    let closed = 0;
    router.holdBack(() => {
      closed += 1;
    });
    router.up();
    await browser.history.settled();
    expect(closed).toBe(1);
    expect(here(router)).toBe("#/");
    expect(browser.history.index).toBe(0);
  });

  test("one layer at a time: a second asks for nothing while the first is open", () => {
    const { browser, router } = onRegion(true);
    router.holdBack(() => undefined);
    const length = browser.history.length;
    router.holdBack(() => undefined);
    expect(browser.history.length).toBe(length);
  });
});
