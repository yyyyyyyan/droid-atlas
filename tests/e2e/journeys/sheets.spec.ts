/**
 * Bottom sheets under a finger: the app sheet, the filters and the sort
 * choices follow a downward drag and close on it, spring back from a short
 * one, never fight the scrolling inside them, and closing by drag is the same
 * navigation as Back.
 *
 * Every gesture is real touch input sent through the DevTools protocol
 * (lib/phone.ts), so the browser decides what a movement is, as it does for a
 * finger. Pull-to-refresh itself cannot be produced by an emulated touch; the
 * last test pins the property that turns it off and that a pull at the top of
 * a list leaves the document alone.
 */

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { TALL_LIST, build, regionTile, regionsBySize, requireShape } from "../lib/pick.ts";
import { sheetHash } from "../lib/catalog.ts";
import { entryOf, firstVisibleRowId, forward, launch, resultList, sheet, snapshot, visibleRow, type HistorySnapshot } from "../lib/app.ts";
import { PHONE_VIEWPORT, drag, dragAndHold, fling, release, tap, type Point } from "../lib/phone.ts";

const [BIG] = regionsBySize();
const MIDDLE = PHONE_VIEWPORT.width / 2;
/** The half-height sheet shows 64% of the window; fully open it covers the window. */
const HALF_TOP = Math.round(PHONE_VIEWPORT.height * 0.36);
const FULL_TOP = 0;

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "bottom sheets are the phone layout; a wide window shows a side panel");
  void page;
});
test.use({ viewport: { ...PHONE_VIEWPORT } });

async function center(target: Locator): Promise<Point> {
  const box = await target.boundingBox();
  if (!box) throw new Error(`not on screen: ${String(target)}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function topOf(target: Locator): Promise<number> {
  const box = await target.boundingBox();
  if (!box) throw new Error(`not on screen: ${String(target)}`);
  return Math.round(box.y);
}

/** How far the open sheet's own content is scrolled. */
async function contentScroll(page: Page): Promise<number> {
  return page.evaluate(() => Math.round(document.querySelector("dialog[open] [data-sheet-scroll]")?.scrollTop ?? -1));
}

async function resetContentScroll(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("dialog[open] [data-sheet-scroll]")?.scrollTo(0, 0));
}

/** Lets a release finish its spring or its close. */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(450);
}

/**
 * Taps a control of the open sheet where it rests. While the sheet still
 * rises into place its controls are lower than they will be when the tap
 * lands, so the point is taken only once the sheet has no motion running.
 */
async function tapInSheet(page: Page, control: Locator): Promise<void> {
  await page.waitForFunction(() => {
    const open = document.querySelector("dialog[open]");
    return open !== null && open.getAnimations().every((animation) => animation.playState !== "running");
  });
  await tap(page, await center(control));
}

interface Beneath { list: HistorySnapshot; firstRow: string | null }

/** Enters the largest region from Explore by taps, scrolls its list, and returns what the list looked like. */
async function scrolledList(page: Page): Promise<Beneath> {
  requireShape((BIG?.size ?? 0) >= TALL_LIST, `region with ${TALL_LIST} entries`);
  await launch(page, "#/");
  await tap(page, await center(regionTile(page, BIG?.id ?? "")));
  await expect(resultList(page)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.waitForTimeout(1300);
  return { list: await snapshot(page), firstRow: await firstVisibleRowId(page) };
}

async function openAppSheet(page: Page): Promise<Beneath & { opened: HistorySnapshot }> {
  const beneath = await scrolledList(page);
  await tap(page, await center(await visibleRow(page, 1)));
  await expect(sheet(page)).toBeVisible();
  await settle(page);
  expect(await topOf(sheet(page)), "the sheet opens at half height").toBe(HALF_TOP);
  return { ...beneath, opened: await snapshot(page) };
}

async function expectClosedLikeBack(page: Page, start: Beneath & { opened: HistorySnapshot }): Promise<void> {
  await expect(sheet(page)).toBeHidden();
  const closed = await snapshot(page);
  expect(closed.hash).toBe(start.list.hash);
  expect(closed.length, "closing adds no history entry").toBe(start.opened.length);
  expect(closed.state?.id, "the entry on show is the list's own").toBe(start.list.state?.id);
  expect(closed.state?.idx).toBe(start.list.state?.idx);
  expect(Math.abs(closed.scrollY - start.list.scrollY), `the list was at ${start.list.scrollY}, is at ${closed.scrollY}`).toBeLessThanOrEqual(2);
  expect(await firstVisibleRowId(page)).toBe(start.firstRow);
}

test.describe("the app sheet", () => {
  test("follows the finger while it is down, and springs back from a short drag", async ({ page }) => {
    const start = await openAppSheet(page);
    const title = await center(sheet(page).getByRole("heading", { level: 2 }));
    await dragAndHold(page, title, { x: title.x, y: title.y + 100 }, { duration: 300 });
    const held = await topOf(sheet(page));
    /* The sheet starts moving once the finger has traveled far enough to be a drag, and keeps that distance behind it. */
    expect(held - HALF_TOP, `the sheet's top is ${held} with the finger 100 px down`).toBeGreaterThanOrEqual(70);
    expect(held - HALF_TOP).toBeLessThanOrEqual(104);
    await release(page);
    await settle(page);
    await expect(sheet(page)).toBeVisible();
    expect(await topOf(sheet(page))).toBe(HALF_TOP);
    expect(entryOf(await snapshot(page))).toEqual(entryOf(start.opened));

    await drag(page, title, { x: title.x, y: title.y + 40 }, { duration: 300, hold: 200 });
    await settle(page);
    expect(await topOf(sheet(page))).toBe(HALF_TOP);
    expect(entryOf(await snapshot(page))).toEqual(entryOf(start.opened));
  });

  test("a slow drag well past halfway closes it: one entry back, the list beneath where it was, and Forward reopens it", async ({ page }) => {
    const start = await openAppSheet(page);
    await drag(page, { x: MIDDLE, y: 420 }, { x: MIDDLE, y: 640 }, { duration: 400, hold: 200 });
    await settle(page);
    await expectClosedLikeBack(page, start);
    await forward(page);
    await expect(sheet(page)).toBeVisible();
    expect((await snapshot(page)).hash).toBe(start.opened.hash);
  });

  test("a fling down from the top strip closes it over a short distance", async ({ page }) => {
    const start = await openAppSheet(page);
    await fling(page, { x: MIDDLE, y: HALF_TOP + 14 }, { x: MIDDLE, y: HALF_TOP + 110 });
    await settle(page);
    await expectClosedLikeBack(page, start);
  });

  test("a fling down on the content closes it while the content is at its top", async ({ page }) => {
    const start = await openAppSheet(page);
    const title = await center(sheet(page).getByRole("heading", { level: 2 }));
    await fling(page, title, { x: title.x, y: title.y + 90 });
    await settle(page);
    await expectClosedLikeBack(page, start);
  });

  test("a swipe up opens it fully; then its content scrolls under the finger and the sheet stays put", async ({ page }) => {
    const start = await openAppSheet(page);
    await drag(page, { x: MIDDLE, y: 500 }, { x: MIDDLE, y: 300 }, { duration: 250 });
    await settle(page);
    expect(await topOf(sheet(page))).toBe(FULL_TOP);
    expect(await contentScroll(page)).toBe(0);

    await drag(page, { x: MIDDLE, y: 500 }, { x: MIDDLE, y: 250 }, { duration: 250, hold: 150 });
    await settle(page);
    const scrolled = await contentScroll(page);
    expect(scrolled, "the content scrolled").toBeGreaterThan(100);
    expect(await topOf(sheet(page))).toBe(FULL_TOP);

    await drag(page, { x: MIDDLE, y: 300 }, { x: MIDDLE, y: 420 }, { duration: 250, hold: 150 });
    await settle(page);
    expect(await contentScroll(page), "a drag down scrolls the content back").toBeLessThan(scrolled);
    expect(await contentScroll(page)).toBeGreaterThan(0);
    expect(await topOf(sheet(page)), "the sheet did not move while its content scrolled").toBe(FULL_TOP);
    await expect(sheet(page)).toBeVisible();
    expect((await snapshot(page)).hash).toBe(start.opened.hash);

    await fling(page, { x: MIDDLE, y: FULL_TOP + 20 }, { x: MIDDLE, y: FULL_TOP + 230 });
    await settle(page);
    await expectClosedLikeBack(page, start);
  });

  test("with its content scrolled a little and the page hidden and shown again, the first drag down from the title closes the expanded sheet", async ({ page }) => {
    const start = await openAppSheet(page);
    /* What reaching a store link below the fold leaves behind: the content a little way down, the title still in view. */
    await page.locator("dialog[open] [data-sheet-scroll]").evaluate((body) => body.scrollBy(0, 8));
    await page.evaluate(() => {
      for (const state of ["hidden", "visible"]) {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
        document.dispatchEvent(new Event("visibilitychange"));
      }
    });
    await drag(page, { x: MIDDLE, y: 450 }, { x: MIDDLE, y: 120 }, { duration: 250 });
    await settle(page);
    expect(await topOf(sheet(page)), "a swipe up opens it fully").toBe(FULL_TOP);
    expect(await contentScroll(page), "and the content is still scrolled").toBeGreaterThan(0);
    /* A point of the title that is in view, under nothing pinned over it: what a finger on the title touches. */
    const grip = await sheet(page).getByRole("heading", { level: 2 }).evaluate((title) => {
      const box = title.getBoundingClientRect();
      for (let y = box.top + 2; y < box.bottom; y += 2) {
        const hit = document.elementFromPoint(box.left + 12, y);
        if (hit && title.contains(hit)) return { x: box.left + 12, y };
      }
      return null;
    });
    expect(grip, "part of the title is in view").not.toBeNull();
    if (!grip) return;
    await drag(page, grip, { x: grip.x, y: grip.y + 550 }, { duration: 300, hold: 100 });
    await settle(page);
    await expectClosedLikeBack(page, start);
  });

  for (const how of ["Back", "its close control", "a drag"] as const) {
    test(`closed by ${how} with its content flung down, the next app's sheet opens at its top`, async ({ page }) => {
      await openAppSheet(page);
      await drag(page, { x: MIDDLE, y: 500 }, { x: MIDDLE, y: 300 }, { duration: 250 });
      await settle(page);
      expect(await topOf(sheet(page)), "a swipe up opens it fully").toBe(FULL_TOP);
      for (let count = 0; count < 3; count += 1) {
        await fling(page, { x: MIDDLE, y: 600 }, { x: MIDDLE, y: 150 });
        await page.waitForTimeout(80);
      }
      expect(await contentScroll(page), "the content was scrolled").toBeGreaterThan(200);
      /* Closed while the last fling may still be moving the content. */
      if (how === "Back") await page.evaluate(() => history.back());
      else if (how === "its close control") await tap(page, await center(page.getByRole("button", { name: "Close details" })));
      else await drag(page, { x: MIDDLE, y: FULL_TOP + 14 }, { x: MIDDLE, y: FULL_TOP + 600 }, { duration: 300, hold: 100 });
      await expect(sheet(page)).toBeHidden();
      await settle(page);

      await tap(page, await center(await visibleRow(page, 2)));
      await expect(sheet(page)).toBeVisible();
      await page.waitForTimeout(700);
      expect(await contentScroll(page), "the new sheet's content is at its top").toBe(0);
      const title = await topOf(sheet(page).getByRole("heading", { level: 2 }));
      expect(title, "its name is in view at the top of the sheet").toBeGreaterThanOrEqual(HALF_TOP);
      expect(title).toBeLessThan(HALF_TOP + 140);
    });
  }

  test("stepping to the next result carries nothing over: not a failed icon, an opened Read more or the scroll", async ({ page }) => {
    const hasIcon = new Set(build.apps.filter((app) => app.atlas.icon).map((app) => app.id));
    const candidates = [...build.apps]
      .filter((app) => app.atlas.icon && app.listings.some((listing) => listing.kind === "app") && app.atlas.category)
      .sort((a, b) => a.id.localeCompare(b.id));
    let next: string | null = null;
    let start = "";
    for (const first of candidates.slice(0, 8)) {
      if (!first.atlas.icon) continue;
      await page.unrouteAll();
      await page.route(`**/${first.atlas.icon}`, (route) => route.abort("failed"));
      if (first.atlas.iconLarge) await page.route(`**/${first.atlas.iconLarge}`, (route) => route.abort("failed"));
      await launch(page, sheetHash(first));
      await expect(sheet(page)).toBeVisible();
      const ids = await page.locator("[data-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row") ?? ""));
      const after = ids[ids.indexOf(first.id) + 1];
      if (ids.includes(first.id) && after && hasIcon.has(after)) {
        next = after;
        start = first.id;
        break;
      }
    }
    requireShape(next !== null, "an app whose next result has an icon");
    if (next === null) return;
    await expect(sheet(page).locator(".sheet-head .ico"), "the first app's own icon cannot be had").toHaveClass(/is-mono/, { timeout: 8000 });
    await tapInSheet(page, sheet(page).getByRole("button", { name: "Next result" }));
    await expect.poll(() => new URL(page.url()).hash, { message: "the sheet steps to the next result" }).toContain(`app=${next}`);
    await expect(sheet(page).locator(".sheet-head .ico"), "the next app seen once, so its details are at hand on the way back").toHaveClass(/has-img/, { timeout: 8000 });
    await tapInSheet(page, sheet(page).getByRole("button", { name: "Previous result" }));
    await expect.poll(() => new URL(page.url()).hash, { message: "the sheet steps back to the first app" }).toContain(`app=${start}`);
    await expect(sheet(page).locator(".sheet-head .ico"), "the first app again, still without its icon").toHaveClass(/is-mono/, { timeout: 8000 });
    const more = sheet(page).getByRole("button", { name: "Read more" });
    if (await more.count()) await more.first().click();
    await page.evaluate(() => document.querySelector("dialog[open] [data-sheet-scroll]")?.scrollTo(0, 400));
    await page.waitForTimeout(100);

    await tapInSheet(page, sheet(page).getByRole("button", { name: "Next result" }));
    await expect.poll(() => new URL(page.url()).hash, { message: "the sheet steps to the next result again" }).toContain(`app=${next}`);
    await expect(sheet(page).locator(".sheet-head .ico"), "the next app's icon, not the last one's failure").toHaveClass(/has-img/, { timeout: 8000 });
    await expect(sheet(page).getByRole("button", { name: "Show less" }), "Read more starts closed").toHaveCount(0);
    expect(await contentScroll(page), "and the content at its top").toBe(0);
  });

  test("with reduced motion a drag still closes it, as the same navigation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const start = await openAppSheet(page);
    await drag(page, { x: MIDDLE, y: 420 }, { x: MIDDLE, y: 640 }, { duration: 400, hold: 200 });
    await expectClosedLikeBack(page, start);
  });
});

test.describe("the filters and the sort choices", () => {
  test("the filters scroll under the finger without closing, and close on a drag from their top", async ({ page }) => {
    const { list } = await scrolledList(page);
    await tap(page, await center(page.getByRole("button", { name: /^Filters/ })));
    const filters = page.getByRole("dialog", { name: "Filters" });
    await expect(filters).toBeVisible();
    await settle(page);
    const top = await topOf(filters);

    await drag(page, { x: MIDDLE, y: 420 }, { x: MIDDLE, y: 220 }, { duration: 250, hold: 150 });
    await settle(page);
    const scrolled = await contentScroll(page);
    expect(scrolled, "the options scrolled").toBeGreaterThan(80);
    expect(await topOf(filters)).toBe(top);

    await drag(page, { x: MIDDLE, y: 320 }, { x: MIDDLE, y: 400 }, { duration: 250, hold: 150 });
    await settle(page);
    await expect(filters).toBeVisible();
    expect(await contentScroll(page)).toBeLessThan(scrolled);
    expect(await topOf(filters), "the sheet did not move while its options scrolled").toBe(top);

    await resetContentScroll(page);
    await drag(page, { x: MIDDLE, y: 320 }, { x: MIDDLE, y: 600 }, { duration: 350, hold: 150 });
    await settle(page);
    await expect(filters).toBeHidden();
    expect(entryOf(await snapshot(page)), "the filters are not a history entry").toEqual(entryOf(list));
  });

  test("the filters close on a fling down from their header", async ({ page }) => {
    const { list } = await scrolledList(page);
    await tap(page, await center(page.getByRole("button", { name: /^Filters/ })));
    const filters = page.getByRole("dialog", { name: "Filters" });
    await expect(filters).toBeVisible();
    await settle(page);
    const head = await center(filters.getByRole("heading", { level: 2, name: "Filters" }));
    await fling(page, head, { x: head.x, y: head.y + 90 });
    await settle(page);
    await expect(filters).toBeHidden();
    expect(entryOf(await snapshot(page))).toEqual(entryOf(list));
  });

  test("the sort choices spring back from a short drag and close on a fling from their header", async ({ page }) => {
    const { list } = await scrolledList(page);
    await tap(page, await center(page.getByRole("button", { name: /^Sort/ })));
    const sort = page.getByRole("dialog", { name: "Sort and view" });
    await expect(sort).toBeVisible();
    await settle(page);
    const top = await topOf(sort);
    const head = await center(sort.getByRole("heading", { level: 2, name: "Sort and view" }));

    await drag(page, head, { x: head.x, y: head.y + 30 }, { duration: 300, hold: 200 });
    await settle(page);
    await expect(sort).toBeVisible();
    expect(await topOf(sort)).toBe(top);

    await fling(page, head, { x: head.x, y: head.y + 90 });
    await settle(page);
    await expect(sort).toBeHidden();
    expect(entryOf(await snapshot(page))).toEqual(entryOf(list));
  });
});

test("a pull down at the top of a list reloads nothing, and the document refuses overscroll gestures", async ({ page }) => {
  await scrolledList(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => ({ origin: performance.timeOrigin, hash: location.hash }));
  await drag(page, { x: MIDDLE, y: 250 }, { x: MIDDLE, y: 600 }, { duration: 400, hold: 300 });
  await settle(page);
  expect(await page.evaluate(() => ({ origin: performance.timeOrigin, hash: location.hash }))).toEqual(before);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY)).toBe("contain");
});
