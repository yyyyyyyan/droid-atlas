import { describe, expect, test } from "vitest";
import type { CatalogVersion } from "../catalog/schema.ts";
import { DRAG_RATE, IDLE, PULL_THRESHOLD, TOUCH_SLOP, indicatorOffset, isArmed, nextPull, pullResult, type PullEvent, type PullState } from "./pull.ts";

function run(events: PullEvent[], from: PullState = IDLE): PullState {
  return events.reduce(nextPull, from);
}

const start = (overrides: Partial<Extract<PullEvent, { type: "start" }>> = {}): PullEvent => ({ type: "start", id: 1, x: 190, y: 100, touches: 1, eligible: true, ...overrides });
const move = (y: number, x = 190, atTop = true): PullEvent => ({ type: "move", id: 1, x, y, atTop });
const end: PullEvent = { type: "end", id: 1 };

/** The finger travel, after the slop, at which a release refreshes. */
const ARMING = PULL_THRESHOLD / DRAG_RATE;

describe("how far the indicator comes down", () => {
  test("it travels half as far as the finger up to the threshold", () => {
    expect(indicatorOffset(0)).toBe(0);
    expect(indicatorOffset(40)).toBe(20);
    expect(indicatorOffset(ARMING)).toBe(PULL_THRESHOLD);
  });

  test("past the threshold it follows ever more reluctantly and stops at twice the threshold", () => {
    const steps = [ARMING, ARMING + 60, ARMING + 120, ARMING + 180, ARMING + 240].map(indicatorOffset);
    for (let index = 1; index < steps.length; index += 1) {
      const gain = (steps[index] ?? 0) - (steps[index - 1] ?? 0);
      expect(gain).toBeGreaterThan(0);
      if (index > 1) expect(gain).toBeLessThan((steps[index - 1] ?? 0) - (steps[index - 2] ?? 0));
    }
    expect(indicatorOffset(ARMING * 3)).toBe(PULL_THRESHOLD * 2);
    expect(indicatorOffset(5000)).toBe(PULL_THRESHOLD * 2);
  });

  test("a finger that has gone back up past where it began moves nothing", () => {
    expect(indicatorOffset(-30)).toBe(0);
  });

  test("a release refreshes from the threshold on, and not a pixel before", () => {
    expect(isArmed(ARMING - 1)).toBe(false);
    expect(isArmed(ARMING)).toBe(true);
  });
});

describe("what a finished check means for the page", () => {
  const version = (hash: string): CatalogVersion => ({ schema: 2 as CatalogVersion["schema"], hash, manifest: `c/${hash}/manifest.json`, generatedAt: "2026-11-16T00:00:00Z" });

  test("the catalog on screen is the one the site serves: nothing new", () => {
    expect(pullResult({ result: "current", version: version("aaa") }, "aaa")).toBe("current");
  });

  test("a first visit that has just stored the catalog it was served found nothing new either", () => {
    expect(pullResult({ result: "updated", version: version("aaa") }, "aaa")).toBe("current");
  });

  test("a newer catalog, stored now or by an earlier check, is shown", () => {
    expect(pullResult({ result: "updated", version: version("bbb") }, "aaa")).toBe("show");
    expect(pullResult({ result: "current", version: version("bbb") }, "aaa")).toBe("show");
  });

  test("a site out of reach is offline, and anything it refused is said in its own words", () => {
    expect(pullResult({ result: "offline" }, "aaa")).toBe("offline");
    expect(pullResult({ result: "newer-schema" }, "aaa")).toBe("other");
    expect(pullResult({ result: "rejected", reason: "mismatch" }, "aaa")).toBe("other");
  });

  test("with no offline copy to compare with, loading the page again is the look", () => {
    expect(pullResult(null, "aaa")).toBe("show");
  });
});

describe("what a touch becomes", () => {
  test("a pull past the threshold, let go, refreshes; the check's end brings it to rest", () => {
    const state = run([start(), move(100 + TOUCH_SLOP), move(100 + TOUCH_SLOP + ARMING), end]);
    expect(state).toEqual({ phase: "refreshing" });
    expect(nextPull(state, { type: "rest" })).toEqual(IDLE);
  });

  test("the pull is measured from where the touch was taken for one, so the indicator starts from nothing", () => {
    expect(run([start(), move(100 + TOUCH_SLOP + 3)])).toEqual({ phase: "pulling", id: 1, from: 113, distance: 0 });
    expect(run([start(), move(113), move(153)])).toMatchObject({ phase: "pulling", distance: 40 });
  });

  test("a short pull, let go, goes back and checks nothing", () => {
    const state = run([start(), move(112), move(112 + ARMING - 2), end]);
    expect(state).toEqual({ phase: "settling" });
    expect(nextPull(state, { type: "rest" })).toEqual(IDLE);
  });

  test("a pull taken back above the threshold before letting go checks nothing", () => {
    expect(run([start(), move(112), move(112 + ARMING + 40), move(112 + 20), end])).toEqual({ phase: "settling" });
  });

  test("a touch that does not start where a pull may start is never one", () => {
    expect(run([start({ eligible: false }), move(300), end])).toEqual(IDLE);
  });

  test("two fingers are not a pull, and a second finger ends one without a check", () => {
    expect(run([start({ touches: 2 }), move(300)])).toEqual(IDLE);
    expect(run([start(), move(112), move(112 + ARMING + 10), start({ id: 2, touches: 2 })])).toEqual({ phase: "settling" });
  });

  test("a sideways swipe is left to what it is on", () => {
    expect(run([start(), move(104, 190 + TOUCH_SLOP + 2)])).toEqual(IDLE);
    expect(run([start(), move(100 + TOUCH_SLOP + 2, 190 + TOUCH_SLOP + 2)])).toEqual(IDLE);
  });

  test("an upward swipe is a scroll", () => {
    expect(run([start(), move(100 - TOUCH_SLOP - 2)])).toEqual(IDLE);
  });

  test("a touch still inside the slop is undecided, and lifting it is a tap", () => {
    expect(run([start(), move(104)])).toMatchObject({ phase: "watching" });
    expect(run([start(), move(104), end])).toEqual(IDLE);
  });

  test("a page that has scrolled since the touch began is being scrolled", () => {
    expect(run([start(), move(104, 190, false), move(300)])).toEqual(IDLE);
  });

  test("once decided, a pull stays a pull however the finger wanders sideways", () => {
    expect(run([start(), move(115), move(160, 60)])).toMatchObject({ phase: "pulling", distance: 45 });
  });

  test("a touch taken away mid-pull goes back without a check; before the pull it is forgotten", () => {
    expect(run([start(), move(112), move(112 + ARMING + 10), { type: "cancel" }])).toEqual({ phase: "settling" });
    expect(run([start(), { type: "cancel" }])).toEqual(IDLE);
  });

  test("while a check runs or the indicator goes back, touches are not watched", () => {
    for (const phase of ["refreshing", "settling"] as const) {
      expect(run([start(), move(300), end, { type: "cancel" }], { phase })).toEqual({ phase });
    }
  });

  test("another finger's movement does not move the pull", () => {
    expect(run([start(), move(112), move(150), { type: "move", id: 7, x: 0, y: 600, atTop: true }, { type: "end", id: 7 }])).toMatchObject({ phase: "pulling", distance: 38 });
  });
});
