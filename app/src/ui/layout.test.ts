import { describe, expect, test } from "vitest";
import { MAX_GROWTH, evenRows, layoutMosaic, layoutTallEnough, squarify, tileBoxes } from "../lib/treemap.ts";
import { planTile, unbrokenWords } from "./tile-plan.ts";
import { positionOf } from "./results.ts";
import { shallowEqual } from "./memo.ts";
import {
  coversTravel,
  initialWindow,
  JUMP_SPEED,
  LOOKAHEAD_MS,
  MAX_AHEAD_SCREENS,
  QUICK_OVERSCAN,
  REST_SCREENS,
  sameWindow,
  scrollVelocity,
  TOP_SPEED,
  travelWindow,
  windowFor,
} from "./window.ts";

describe("the list window", () => {
  const ROW = 76;
  const VIEWPORT = 688;

  test("at the top of the list it starts at the first row and covers the viewport plus overscan", () => {
    expect(windowFor(200, VIEWPORT, ROW, 1500)).toEqual({ start: 0, end: 13 });
  });

  test("scrolled deep it holds only the rows near the viewport", () => {
    const range = windowFor(-76_000, VIEWPORT, ROW, 1500);
    expect(range).toEqual({ start: 994, end: 1016 });
    expect(range.end - range.start).toBeLessThan(30);
  });

  test("it never runs past either end, and an empty list has an empty window", () => {
    expect(windowFor(-200_000, VIEWPORT, ROW, 1500)).toEqual({ start: 1500, end: 1500 });
    expect(windowFor(5000, VIEWPORT, ROW, 1500)).toEqual({ start: 0, end: 0 });
    expect(windowFor(0, VIEWPORT, ROW, 0)).toEqual({ start: 0, end: 0 });
    expect(windowFor(-300, VIEWPORT, ROW, 3)).toEqual({ start: 0, end: 3 });
  });

  test("every row that intersects the viewport is inside the window", () => {
    for (const listTop of [0, -1, -75, -76, -77, -4000, -113_000]) {
      const { start, end } = windowFor(listTop, VIEWPORT, ROW, 1500, 0);
      const firstVisible = Math.max(0, Math.floor(-listTop / ROW));
      const lastVisible = Math.min(1499, Math.floor((VIEWPORT - 1 - listTop) / ROW));
      expect(start).toBeLessThanOrEqual(firstVisible);
      expect(end).toBeGreaterThan(lastVisible);
    }
  });

  test("the quick window after a query change still holds every visible row, and far fewer beyond them", () => {
    for (const listTop of [154, 44, -1, -76, -4000]) {
      const quick = windowFor(listTop, VIEWPORT, ROW, 1500, QUICK_OVERSCAN);
      const full = windowFor(listTop, VIEWPORT, ROW, 1500);
      const firstVisible = Math.max(0, Math.floor(-listTop / ROW));
      const lastVisible = Math.min(1499, Math.floor((VIEWPORT - 1 - listTop) / ROW));
      expect(quick.start).toBeLessThanOrEqual(firstVisible);
      expect(quick.end).toBeGreaterThan(lastVisible);
      expect(quick.end - quick.start).toBeLessThanOrEqual(lastVisible - firstVisible + 1 + 2 * QUICK_OVERSCAN + 1);
      expect(quick.end - quick.start).toBeLessThan(full.end - full.start);
    }
  });

  test("at rest the list keeps screens of rows ready on both sides", () => {
    const range = travelWindow(-40_000, VIEWPORT, ROW, 1500);
    const first = Math.floor(40_000 / ROW);
    const last = Math.ceil((40_000 + VIEWPORT) / ROW);
    expect(first - range.start).toBeGreaterThanOrEqual(Math.floor((REST_SCREENS * VIEWPORT) / ROW));
    expect(range.end - last).toBeGreaterThanOrEqual(Math.floor((REST_SCREENS * VIEWPORT) / ROW));
    expect(travelWindow(154, VIEWPORT, ROW, 1500).start).toBe(0);
    expect(travelWindow(-200_000, VIEWPORT, ROW, 1500)).toEqual({ start: 1500, end: 1500 });
    expect(travelWindow(0, VIEWPORT, ROW, 5)).toEqual({ start: 0, end: 5 });
  });

  test("a moving list keeps ready what it will reach, in the direction it moves, up to a ceiling", () => {
    const rest = travelWindow(-40_000, VIEWPORT, ROW, 1500);
    const down = travelWindow(-40_000, VIEWPORT, ROW, 1500, 8);
    const up = travelWindow(-40_000, VIEWPORT, ROW, 1500, -8);
    expect(down.start).toBe(rest.start);
    expect(up.end).toBe(rest.end);
    expect((down.end - rest.end) * ROW).toBeGreaterThanOrEqual(8 * LOOKAHEAD_MS - ROW);
    expect((rest.start - up.start) * ROW).toBeGreaterThanOrEqual(8 * LOOKAHEAD_MS - ROW);

    const fastest = travelWindow(-40_000, VIEWPORT, ROW, 1500, 39);
    const ceiling = Math.ceil((40_000 + VIEWPORT + MAX_AHEAD_SCREENS * VIEWPORT) / ROW);
    expect(fastest.end).toBe(ceiling);
    expect(fastest.end - fastest.start).toBeLessThan(((MAX_AHEAD_SCREENS + REST_SCREENS + 1) * VIEWPORT) / ROW + 3);
  });

  test("the rendered rows are left alone while the scroll has room, and replaced before it runs out", () => {
    const count = 1500;
    const velocity = 20;
    let listTop = -10_000;
    let range = travelWindow(listTop, VIEWPORT, ROW, count, velocity);
    let renders = 0;
    for (let frame = 0; frame < 120; frame += 1) {
      listTop -= velocity * 16;
      if (!coversTravel(range, listTop, VIEWPORT, ROW, count, velocity)) {
        range = travelWindow(listTop, VIEWPORT, ROW, count, velocity);
        renders += 1;
      }
      const lastVisible = Math.ceil((VIEWPORT - listTop) / ROW);
      const ahead = (Math.min(range.end, count) - lastVisible) * ROW;
      if (range.end < count) expect(ahead, `frame ${frame}`).toBeGreaterThan(5 * velocity * 16);
      expect(range.start).toBeLessThanOrEqual(Math.floor(-listTop / ROW));
    }
    expect(renders).toBeGreaterThan(0);
    expect(renders).toBeLessThan(20);
    expect(coversTravel(travelWindow(-5000, VIEWPORT, ROW, count), -5000, VIEWPORT, ROW, count)).toBe(true);
    expect(coversTravel(windowFor(-5000, VIEWPORT, ROW, count, QUICK_OVERSCAN), -5000, VIEWPORT, ROW, count)).toBe(false);
    expect(coversTravel({ start: 0, end: 3 }, 0, VIEWPORT, ROW, 3, 30)).toBe(true);
  });

  test("a fling harder than the list plans for still counts, in its direction, and gets the most rows ahead", () => {
    expect(scrollVelocity((TOP_SPEED + 20) * 16, 16)).toBe(TOP_SPEED);
    expect(scrollVelocity(-(TOP_SPEED + 20) * 16, 16)).toBe(-TOP_SPEED);
    expect(scrollVelocity(JUMP_SPEED * 16, 16)).toBe(TOP_SPEED);
    const hard = travelWindow(-20_000, VIEWPORT, ROW, 2000, scrollVelocity(70 * 16, 16));
    const visibleEnd = Math.ceil((20_000 + VIEWPORT) / ROW);
    expect(hard.end - visibleEnd).toBeGreaterThanOrEqual(Math.floor((MAX_AHEAD_SCREENS * VIEWPORT) / ROW) - 1);
  });

  test("the speed of a scroll comes from two positions; a jump or a pause counts as none", () => {
    expect(scrollVelocity(160, 16)).toBe(10);
    expect(scrollVelocity(-160, 16)).toBe(-10);
    expect(scrollVelocity(160, 0)).toBe(0);
    expect(scrollVelocity(160, 400)).toBe(0);
    expect(scrollVelocity((JUMP_SPEED + 1) * 16, 16)).toBe(0);
    expect(scrollVelocity(12_000, 16)).toBe(0);
  });

  test("two windows are the same only when both ends agree", () => {
    expect(sameWindow({ start: 3, end: 9 }, { start: 3, end: 9 })).toBe(true);
    expect(sameWindow({ start: 3, end: 9 }, { start: 3, end: 10 })).toBe(false);
    expect(sameWindow({ start: 2, end: 9 }, { start: 3, end: 9 })).toBe(false);
  });

  test("a memoized row is skipped only when every prop is the same value", () => {
    const entry = { id: "a" };
    const implied = new Set<string>();
    const props = { entry, index: 3, selected: false, implied };
    expect(shallowEqual(props, { entry, index: 3, selected: false, implied })).toBe(true);
    expect(shallowEqual(props, { entry, index: 3, selected: true, implied })).toBe(false);
    expect(shallowEqual(props, { entry: { id: "a" }, index: 3, selected: false, implied })).toBe(false);
    expect(shallowEqual(props, { entry, index: 3, selected: false, implied, meta: "new" })).toBe(false);
  });

  test("the first window is built around the row being returned to", () => {
    const range = initialWindow(640, VIEWPORT, ROW, 1500);
    expect(range.start).toBeLessThanOrEqual(640);
    expect(range.end).toBeGreaterThan(640 + Math.floor(VIEWPORT / ROW));
    expect(initialWindow(0, VIEWPORT, ROW, 1500).start).toBe(0);
    expect(initialWindow(1499, VIEWPORT, ROW, 1500).end).toBe(1500);
    expect(initialWindow(5, VIEWPORT, ROW, 3)).toEqual({ start: 0, end: 3 });
  });
});

describe("the region map", () => {
  const regions = [
    { id: "system", count: 160 }, { id: "work", count: 128 }, { id: "media", count: 124 }, { id: "world", count: 97 },
    { id: "games", count: 79 }, { id: "comms", count: 70 }, { id: "privacy", count: 61 }, { id: "personal", count: 57 }, { id: "guides", count: 13 },
  ];
  const WIDTH = 352;
  const HEIGHT = 358;

  test("tiles fill the map exactly and do not overlap", () => {
    const rects = squarify(regions.map((region) => ({ id: region.id, weight: region.count })), WIDTH, HEIGHT);
    const area = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
    expect(area).toBeCloseTo(WIDTH * HEIGHT, 3);
    for (const a of rects) {
      expect(a.x).toBeGreaterThanOrEqual(-0.001);
      expect(a.x + a.w).toBeLessThanOrEqual(WIDTH + 0.001);
      for (const b of rects) {
        if (a === b) continue;
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapX > 0.001 && overlapY > 0.001).toBe(false);
      }
    }
  });

  test("area follows entry count", () => {
    const total = regions.reduce((sum, region) => sum + region.count, 0);
    const rects = squarify(regions.map((region) => ({ id: region.id, weight: region.count })), WIDTH, HEIGHT);
    for (const region of regions) {
      const rect = rects.find((candidate) => candidate.id === region.id);
      expect((rect?.w ?? 0) * (rect?.h ?? 0)).toBeCloseTo((WIDTH * HEIGHT * region.count) / total, 3);
    }
  });

  test("a tile too small to tap is enlarged, and the map says which", () => {
    const { rects, enlarged } = layoutMosaic(regions, WIDTH, HEIGHT, 46);
    expect(enlarged).toEqual(["guides"]);
    expect(Math.min(...rects.map((rect) => Math.min(rect.w, rect.h)))).toBeGreaterThanOrEqual(46);
    expect(layoutMosaic(regions.slice(0, 4), WIDTH, HEIGHT, 46).enlarged).toEqual([]);
  });

  test("a map too short for every tile to be read grows until each is, and only as far as its limit", () => {
    const readable = (rect: { w: number; h: number }): boolean => Math.min(rect.w, rect.h) >= 46;
    expect(layoutTallEnough(regions, WIDTH, HEIGHT, readable).height).toBe(HEIGHT);
    /* Nine tiles of 5,000 px² cannot share 336 × 120 px. */
    const roomy = (rect: { w: number; h: number }): boolean => rect.w * rect.h >= 5000;
    const short = layoutTallEnough(regions, 336, 120, roomy);
    expect(short.height).toBeGreaterThan(120);
    expect(short.rects.every(roomy)).toBe(true);
    const tallerThanAllowed = layoutTallEnough(regions, 336, 120, () => false);
    expect(tallerThanAllowed.height).toBeLessThanOrEqual(120 * MAX_GROWTH);
  });

  test("nothing to lay out gives no tiles", () => {
    expect(squarify([], WIDTH, HEIGHT)).toEqual([]);
    expect(squarify([{ id: "a", weight: 0 }], WIDTH, HEIGHT)).toEqual([]);
    expect(layoutMosaic(regions, 0, 0, 46).rects).toEqual([]);
  });

  test("gaps are cut from the seams, and only the map's own corners are large", () => {
    const { rects } = layoutMosaic(regions, WIDTH, HEIGHT, 46);
    const boxes = tileBoxes(rects, WIDTH, HEIGHT, { gap: 3, outer: 26, inner: 8 });
    const large = boxes.flatMap((box) => box.radius.split(" ")).filter((radius) => radius === "26px");
    expect(large).toHaveLength(4);
    expect(Math.min(...boxes.map((box) => box.x))).toBe(0);
    expect(Math.max(...boxes.map((box) => box.x + box.w))).toBeCloseTo(WIDTH, 3);
  });
});

describe("the wide region map", () => {
  const GAP = 3;
  /* The map's box in a window of 1024 × 768, 1280 × 800, 1440 × 900, 1600 × 900 and 1920 × 1080. */
  const BOXES: [number, number][] = [[880, 518], [1136, 550], [1296, 650], [1456, 650], [1776, 760]];
  const NAMES = [
    "Productivity", "Media", "Personalization", "Privacy, Security & Network", "Automation & Dev Tools", "System & Tweaks", "Games",
    "Apps & Installers", "Files & Sync", "Web & World", "Communication", "Device-specific", "Guides & Further Reading",
  ];
  type Region = { id: string; count: number };
  const named = (counts: number[]): Region[] => counts.map((count, index) => ({ id: NAMES[index] ?? `Region ${index}`, count }));
  const REGROUPED = named([151, 148, 141, 138, 103, 103, 101, 86, 86, 83, 75, 66]);
  const BEFORE: Region[] = [
    { id: "Productivity", count: 151 }, { id: "Media", count: 147 }, { id: "Personalization", count: 138 }, { id: "Privacy, Security & Network", count: 138 },
    { id: "Automation & Dev Tools", count: 109 }, { id: "System & Tweaks", count: 108 }, { id: "Games", count: 101 }, { id: "Files & Sync", count: 86 },
    { id: "Web & World", count: 83 }, { id: "Apps & Installers", count: 78 }, { id: "Communication", count: 76 }, { id: "Device-specific", count: 66 },
  ];
  const ONE_SMALL = named([151, 148, 141, 138, 103, 103, 101, 86, 86, 83, 75, 9]);
  const TWO_SMALL = named([151, 148, 141, 138, 103, 103, 101, 86, 86, 83, 20, 20]);
  const THIRTEEN_EQUAL = named(new Array<number>(13).fill(100));
  const EVERY: [string, Region[]][] = [
    ["the regrouped catalog", REGROUPED], ["the catalog before it", BEFORE], ["one region much smaller than the rest", ONE_SMALL],
    ["two equal small regions", TWO_SMALL], ["thirteen equal regions", THIRTEEN_EQUAL],
  ];

  const weights = (regions: Region[]): { id: string; weight: number }[] => regions.map((region) => ({ id: region.id, weight: region.count }));
  const longest = (rects: { w: number; h: number }[]): number => Math.max(...rects.map((rect) => Math.max(rect.w / rect.h, rect.h / rect.w)));

  /** The map as `Mosaic` lays it out, with each tile's plan and how much larger than its share it is drawn. */
  function lay(regions: Region[], [width, height]: [number, number], rows = evenRows) {
    const counts = new Map(regions.map((region) => [region.id, region.count]));
    const total = regions.reduce((sum, region) => sum + region.count, 0);
    const plan = (rect: { id: string; w: number; h: number }) => planTile({ w: rect.w - GAP, h: rect.h - GAP }, rect.id, counts.get(rect.id) ?? 0, true);
    const fits = (rect: { id: string; w: number; h: number }): boolean => Math.min(rect.w, rect.h) - GAP >= 46 && plan(rect).legible;
    const { rects, height: used } = layoutTallEnough(regions, width, height, fits, rows);
    const enlarged = (rect: { id: string; w: number; h: number }): number => (rect.w * rect.h) / (width * used) / ((counts.get(rect.id) ?? 0) / total);
    return { rects, used, plan, fits, enlarged };
  }

  test("greedy rows leave the regrouped catalog's last region a sliver; rows cut all at once do not", () => {
    const device = (rects: { id: string; w: number; h: number }[]) => rects.find((rect) => rect.id === "Device-specific") ?? { w: 0, h: 1 };
    const greedy = device(squarify(weights(REGROUPED), 1296, 650));
    expect(greedy.h / greedy.w, "three times as tall as it is wide").toBeGreaterThan(3);
    expect(greedy.w, "too narrow for its name on one line").toBeLessThan(132);
    const even = evenRows(weights(REGROUPED), 1296, 650);
    expect(longest(even)).toBeLessThan(1.6);
    expect(device(even).w).toBeGreaterThan(200);
  });

  test.each(EVERY)("%s: the rows fill the map, areas follow the counts, and no tile is longer for its width than in greedy rows", (_label, regions) => {
    const total = regions.reduce((sum, region) => sum + region.count, 0);
    for (const [width, height] of BOXES) {
      const rects = evenRows(weights(regions), width, height);
      expect(rects.map((rect) => rect.id)).toEqual(regions.map((region) => region.id));
      for (const region of regions) {
        const rect = rects.find((candidate) => candidate.id === region.id);
        expect((rect?.w ?? 0) * (rect?.h ?? 0)).toBeCloseTo((width * height * region.count) / total, 3);
      }
      expect(Math.max(...rects.map((rect) => rect.x + rect.w))).toBeCloseTo(width, 3);
      expect(Math.max(...rects.map((rect) => rect.y + rect.h))).toBeCloseTo(height, 3);
      expect(longest(rects)).toBeLessThanOrEqual(longest(squarify(weights(regions), width, height)) + 1e-9);
    }
  });

  test.each(EVERY)("%s: at every wide size each name stands on one line or on lines of whole words, over its count", (_label, regions) => {
    for (const box of BOXES) {
      const { rects, used, fits } = lay(regions, box);
      expect(rects.filter((rect) => !fits(rect)).map((rect) => rect.id), `${box.join(" × ")}`).toEqual([]);
      expect(used, "the map did not have to grow").toBe(box[1]);
    }
  });

  test.each([["the regrouped catalog", REGROUPED], ["the catalog before it", BEFORE]] as [string, Region[]][])(
    "%s: no narrow tile at any wide size, and from 1280 up every tile lists categories at exactly its share",
    (_label, regions) => {
      for (const box of BOXES) {
        const { rects, plan, enlarged } = lay(regions, box);
        expect(rects.filter((rect) => plan(rect).narrow).map((rect) => rect.id), `${box.join(" × ")}`).toEqual([]);
        expect(longest(rects), `${box.join(" × ")}`).toBeLessThan(2);
        if (box[0] < 1136) {
          expect(Math.max(...rects.map(enlarged)), "at 1024 the tile of the one name that cannot break is widened by a quarter at most").toBeLessThan(1.25);
          continue;
        }
        expect(rects.filter((rect) => plan(rect).categories < 2).map((rect) => rect.id), `${box.join(" × ")}`).toEqual([]);
        for (const rect of rects) expect(enlarged(rect), `${rect.id} at ${box.join(" × ")}`).toBeCloseTo(1, 6);
      }
    },
  );

  test("thirteen equal regions are thirteen tiles of one size, none much longer than wide", () => {
    for (const box of BOXES) {
      const { rects, enlarged } = lay(THIRTEEN_EQUAL, box);
      expect(longest(rects), `${box.join(" × ")}`).toBeLessThan(1.7);
      for (const rect of rects) expect(enlarged(rect)).toBeCloseTo(1, 6);
    }
  });

  test("a region far smaller than the rest is drawn larger than its share, and only that region", () => {
    for (const box of BOXES) {
      const { rects, enlarged } = lay(ONE_SMALL, box);
      const larger = rects.filter((rect) => enlarged(rect) > 1.001).map((rect) => rect.id);
      expect(larger, `${box.join(" × ")}`).toEqual(["Device-specific"]);
      expect(Math.max(...rects.map(enlarged))).toBeLessThanOrEqual(10);
    }
  });

  test("on the wide map a name breaks only between words; on a phone also after a hyphen", () => {
    expect(planTile({ w: 117, h: 366 }, "Device-specific", 66, true).legible, "the sliver the regrouping produced").toBe(false);
    expect(planTile({ w: 150, h: 200 }, "Device-specific", 66, true).legible).toBe(false);
    expect(planTile({ w: 156, h: 200 }, "Device-specific", 66, true)).toMatchObject({ legible: true, nameSize: 15, narrow: false });
    expect(planTile({ w: 200, h: 200 }, "Device-specific", 66, true)).toMatchObject({ legible: true, nameSize: 19 });
    expect(planTile({ w: 132, h: 200 }, "Web & World", 83, true), "two lines of whole words").toMatchObject({ legible: true, nameSize: 19 });
    expect(planTile({ w: 80, h: 110 }, "Device-specific", 66, false).legible, "a phone tile breaks it after the hyphen").toBe(true);
    expect(unbrokenWords("Device-specific")).toBe("Device-⁠specific");
    expect(unbrokenWords("Web & World")).toBe("Web & World");
  });

  test("an item of no weight has no tile, and nothing to lay out gives none", () => {
    const items = [{ id: "a", weight: 3 }, { id: "b", weight: 0 }, { id: "c", weight: 1 }];
    const rects = evenRows(items, 400, 300);
    expect(rects.map((rect) => rect.id)).toEqual(["a", "c"]);
    expect(rects.reduce((sum, rect) => sum + rect.w * rect.h, 0)).toBeCloseTo(400 * 300, 3);
    expect(evenRows([], 400, 300)).toEqual([]);
    expect(evenRows(items, 0, 300)).toEqual([]);
  });
});

describe("stepping through results", () => {
  const results = { ids: ["a", "b", "c"], reveal: () => undefined };

  test("the position and its neighbors come from the list on screen", () => {
    expect(positionOf(results, "a")).toEqual({ index: 0, total: 3, previous: null, next: "b" });
    expect(positionOf(results, "b")).toEqual({ index: 1, total: 3, previous: "a", next: "c" });
    expect(positionOf(results, "c")).toEqual({ index: 2, total: 3, previous: "b", next: null });
  });

  test("an app that is not among the results has no position", () => {
    expect(positionOf(results, "z")).toBeNull();
    expect(positionOf(null, "a")).toBeNull();
  });
});
