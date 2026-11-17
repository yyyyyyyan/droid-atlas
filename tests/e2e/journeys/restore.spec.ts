/**
 * ARCHITECTURE.md § State and restoration: scroll on Back, reload of every
 * view, a discarded tab coming back, and resuming the last place on a launch.
 */

import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { sheetHash } from "../lib/catalog.ts";
import { TALL_LIST, appsInRegion, biggestLens, build, commonNameWord, featuredApp, lensTest, level, regionName, regionTile, regionsBySize, requireShape } from "../lib/pick.ts";
import {
  back,
  countStatus,
  currentSort,
  escapeRegExp,
  firstGesture,
  firstVisibleRowId,
  launch,
  navLink,
  ready,
  resultList,
  seedStorage,
  sheet,
  snapshot,
  visibleRow,
  type EntryState,
} from "../lib/app.ts";

const L = level();
const [BIG, OTHER] = regionsBySize();
const LENS = biggestLens();
const LENS_TEST = lensTest(LENS.key);
const exact = (hash: string): RegExp => new RegExp(`${escapeRegExp(hash)}$`);
const bigTall = (BIG?.size ?? 0) >= TALL_LIST;

interface ViewState {
  hash: string;
  id: string | undefined;
  length: number;
  heading: string;
  sheetOpen: boolean;
  count: string | null;
  sort: string | null;
  query: string | null;
  firstRow: string | null;
  scrollY: number;
}

async function viewState(page: Page): Promise<ViewState> {
  const snap = await snapshot(page);
  const heading = (await page.getByRole("main").getByRole("heading", { level: 1 }).first().textContent())?.trim() ?? "";
  const hasCount = (await countStatus(page).count()) > 0;
  const field = page.getByRole("searchbox", { name: "Search the catalog" });
  return {
    hash: snap.hash,
    id: snap.state?.id,
    length: snap.length,
    heading,
    sheetOpen: await sheet(page).isVisible(),
    count: hasCount ? ((await countStatus(page).textContent())?.trim() ?? null) : null,
    sort: await currentSort(page),
    query: (await field.count()) ? await field.inputValue() : null,
    firstRow: await firstVisibleRowId(page),
    scrollY: snap.scrollY,
  };
}

function expectSameView(after: ViewState, before: ViewState): void {
  expect(after.hash).toBe(before.hash);
  expect(after.id).toBe(before.id);
  expect(after.heading).toBe(before.heading);
  expect(after.sheetOpen).toBe(before.sheetOpen);
  expect(after.count).toBe(before.count);
  expect(after.sort).toBe(before.sort);
  expect(after.query).toBe(before.query);
  expect(after.firstRow).toBe(before.firstRow);
  expect(Math.abs(after.scrollY - before.scrollY), `scroll was ${before.scrollY}, is ${after.scrollY}`).toBeLessThanOrEqual(2);
}

/** Scrolls to `y`, or as far as the page goes, and waits for the app to record it. */
async function settleScroll(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(1300);
}

test.describe("Back restores the list's position", () => {
  test("a scrolled region list is where it was after Search and Back", async ({ page }) => {
    requireShape(bigTall, `region with ${TALL_LIST} entries`);
    await launch(page, "#/");
    await regionTile(page, BIG?.id ?? "").click();
    await expect(page).toHaveURL(exact(`#/region/${BIG?.id}`));
    await settleScroll(page, 1600);
    const before = await viewState(page);
    expect(before.scrollY).toBeGreaterThan(1000);
    await navLink(page, "Search").click();
    await expect(page).toHaveURL(/#\/search$/);
    await back(page);
    await expect(page).toHaveURL(exact(`#/region/${BIG?.id}`));
    await expect.poll(() => firstVisibleRowId(page)).toBe(before.firstRow);
    const after = await viewState(page);
    expect(Math.abs(after.scrollY - before.scrollY)).toBeLessThanOrEqual(2);
  });

  test("closing a sheet with Back leaves the list exactly where it was", async ({ page }) => {
    requireShape(LENS.size >= TALL_LIST, `lens with ${TALL_LIST} entries`);
    await launch(page, `#/lens/${LENS.key}`);
    await page.getByRole("main").click({ position: { x: 5, y: 5 } });
    await settleScroll(page, 1500);
    const before = await viewState(page);
    await (await visibleRow(page, 1)).click();
    await expect(sheet(page)).toBeVisible();
    await back(page);
    await expect(sheet(page)).toBeHidden();
    const after = await viewState(page);
    expect(after.firstRow).toBe(before.firstRow);
    expect(Math.abs(after.scrollY - before.scrollY)).toBeLessThanOrEqual(2);
  });
});

test.describe("reload reproduces the view", () => {
  const word = commonNameWord();
  const views: { name: string; hash: string; scroll: number; openRow?: number }[] = [
    { name: "Explore, scrolled", hash: "#/", scroll: 500 },
    { name: "a region with a filter, sort and scroll", hash: `#/region/${BIG?.id}?f=${LENS.key}&sort=added`, scroll: 900 },
    { name: "a category with the sheet open", hash: `#/cat/${L.category.id}`, scroll: 0, openRow: 0 },
    { name: "a lens narrowed to a region", hash: `#/lens/${LENS.key}?f=r:${BIG?.id}`, scroll: 600 },
    { name: "search with text, sort, scroll and an open sheet", hash: `#/search?q=${word}&sort=stars`, scroll: 300, openRow: 1 },
    { name: "Settings", hash: "#/settings", scroll: 0 },
  ];

  for (const view of views) {
    test(`reload of ${view.name}`, async ({ page }) => {
      await launch(page, view.hash);
      await page.getByRole("main").click({ position: { x: 5, y: 5 } });
      if (view.scroll) await settleScroll(page, view.scroll);
      if (view.openRow !== undefined) {
        await (await visibleRow(page, view.openRow)).click();
        await expect(sheet(page)).toBeVisible();
        await page.waitForTimeout(1300);
      }
      const before = await viewState(page);
      await page.reload();
      await ready(page);
      if (view.openRow !== undefined) await expect(sheet(page)).toBeVisible();
      await expect.poll(async () => (await viewState(page)).firstRow).toBe(before.firstRow);
      expectSameView(await viewState(page), before);
    });
  }

  test("reload of Saved with saved apps, scrolled", async ({ page }) => {
    const toSave = Math.min(14, BIG?.size ?? 0);
    await launch(page, `#/region/${BIG?.id}`);
    await page.getByRole("main").click({ position: { x: 5, y: 5 } });
    for (let index = 0; index < toSave; index += 1) {
      const save = resultList(page).getByRole("button", { name: /^Save / }).first();
      await save.scrollIntoViewIfNeeded();
      await save.click();
    }
    await navLink(page, "Saved").click();
    await expect(page).toHaveURL(/#\/saved$/);
    await expect(countStatus(page)).toHaveText(new RegExp(`^${toSave} (app|entr)`));
    await settleScroll(page, 300);
    const before = await viewState(page);
    await page.reload();
    await ready(page);
    await expect.poll(async () => (await viewState(page)).firstRow).toBe(before.firstRow);
    expectSameView(await viewState(page), before);
  });
});

/**
 * A discarded tab comes back as a fresh document in the same tab, with the
 * same URL and sessionStorage; Chrome also restores `history.state`, and sets
 * `document.wasDiscarded`. Automation cannot discard a tab, so it is simulated
 * with a new page in the same context, given the old page's sessionStorage and
 * URL before any of the app's code runs.
 */
async function discardAndRestore(context: BrowserContext, page: Page, withHistoryState: boolean): Promise<Page> {
  const saved = await page.evaluate(() => ({
    url: location.href,
    state: history.state as EntryState | null,
    session: Object.fromEntries(Object.keys(sessionStorage).map((key) => [key, sessionStorage.getItem(key) ?? ""])),
  }));
  await page.close();
  const revived = await context.newPage();
  await revived.addInitScript(({ session, state, keepState }) => {
    if (sessionStorage.getItem("__restored") === "1") return;
    for (const [key, value] of Object.entries(session)) sessionStorage.setItem(key, value);
    sessionStorage.setItem("__restored", "1");
    if (keepState) history.replaceState(state, "", location.href);
    Object.defineProperty(document, "wasDiscarded", { value: true, configurable: true });
  }, { session: saved.session, state: saved.state, keepState: withHistoryState });
  await revived.goto(saved.url);
  await ready(revived);
  return revived;
}

test.describe("simulated tab discard", () => {
  const listHash = `#/region/${BIG?.id}?f=${LENS.key}&sort=release`;
  const longEnough = appsInRegion(BIG?.id ?? "").filter((app) => LENS_TEST(app)).length >= TALL_LIST;

  test("with sessionStorage, URL and history.state kept, the view, filters, sheet and scroll come back", async ({ context, page }) => {
    requireShape(longEnough, `filtered region list of ${TALL_LIST} entries`);
    await launch(page, listHash);
    await page.getByRole("main").click({ position: { x: 5, y: 5 } });
    await settleScroll(page, 700);
    await (await visibleRow(page, 1)).click();
    await expect(sheet(page)).toBeVisible();
    await page.waitForTimeout(1300);
    const before = await viewState(page);
    const revived = await discardAndRestore(context, page, true);
    await expect(sheet(revived)).toBeVisible();
    await expect.poll(async () => (await viewState(revived)).firstRow).toBe(before.firstRow);
    const after = await viewState(revived);
    expect(after.hash).toBe(before.hash);
    expect(after.id).toBe(before.id);
    expect(after.count).toBe(before.count);
    expect(after.sort).toBe(before.sort);
    expect(Math.abs(after.scrollY - before.scrollY)).toBeLessThanOrEqual(2);
  });

  test("with only sessionStorage and the URL, the view, filters and scroll come back", async ({ context, page }) => {
    requireShape(longEnough, `filtered region list of ${TALL_LIST} entries`);
    await launch(page, listHash);
    await page.getByRole("main").click({ position: { x: 5, y: 5 } });
    await settleScroll(page, 700);
    const before = await viewState(page);
    const revived = await discardAndRestore(context, page, false);
    const after = await viewState(revived);
    expect(after.hash).toBe(before.hash);
    expect(after.count).toBe(before.count);
    expect(after.sort).toBe(before.sort);
    expect(after.firstRow, "first visible row after the revived page loads").toBe(before.firstRow);
    expect(Math.abs(after.scrollY - before.scrollY)).toBeLessThanOrEqual(2);
  });

  test("a discarded tab with no hash keeps its own place instead of resuming another", async ({ context, page }) => {
    await seedStorage(page, { "droid-atlas:v1:lastPlace:browser": JSON.stringify({ hash: `#/region/${BIG?.id}`, at: Date.now(), memo: null, fallback: null }) });
    const revived = await context.newPage();
    await revived.addInitScript(() => Object.defineProperty(document, "wasDiscarded", { value: true, configurable: true }));
    await revived.goto("/");
    await ready(revived);
    await expect(revived).toHaveURL(/#\/$/);
  });
});

function lastPlace(hash: string, ageMs = 60_000, fallback: string | null = null): string {
  return JSON.stringify({ hash, at: Date.now() - ageMs, memo: null, fallback });
}

async function launchAs(context: BrowserContext, mode: "browser" | "standalone", path = "/"): Promise<Page> {
  const page = await context.newPage();
  if (mode === "standalone") {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => {
        if (/display-mode:\s*standalone/.test(query)) {
          const list = original("(min-width: 0px)");
          return Object.create(list, { matches: { value: true }, media: { value: query } }) as MediaQueryList;
        }
        return original(query);
      };
    });
  }
  await page.goto(path);
  await ready(page);
  return page;
}

test.describe("resume on a route-less launch", () => {
  const A = BIG?.id ?? "";
  const B = OTHER?.id ?? "";

  test("a browser launch with no hash resumes the browser's last place", async ({ context, page }) => {
    await launch(page, "#/");
    await regionTile(page, A).click();
    await expect(page).toHaveURL(exact(`#/region/${A}`));
    await page.close();
    const next = await launchAs(context, "browser");
    await expect(next).toHaveURL(exact(`#/region/${A}`));
    await expect(next.getByRole("heading", { level: 1, name: regionName(A) })).toBeVisible();
    expect((await snapshot(next)).state?.idx).toBe(0);
  });

  test("the last place is kept per display mode: the installed app does not resume a browser tab's place, nor the other way round", async ({ context, page }) => {
    test.slow(true, "boots the app four times in sequence");
    requireShape(Boolean(OTHER), "second region");
    await launch(page, "#/");
    await regionTile(page, A).click();
    await expect(page).toHaveURL(exact(`#/region/${A}`));
    await page.close();
    const installed = await launchAs(context, "standalone");
    await expect(installed).toHaveURL(/#\/$/);
    await regionTile(installed, B).click();
    await expect(installed).toHaveURL(exact(`#/region/${B}`));
    await installed.close();
    const tab = await launchAs(context, "browser");
    await expect(tab).toHaveURL(exact(`#/region/${A}`));
    await tab.close();
    const again = await launchAs(context, "standalone");
    await expect(again).toHaveURL(exact(`#/region/${B}`));
  });

  test("an open sheet is resumed with the sheet open", async ({ context, page }) => {
    const app = featuredApp();
    await launch(page, sheetHash(app));
    await expect(sheet(page, app.name)).toBeVisible();
    await page.close();
    const next = await launchAs(context, "browser");
    await expect(sheet(next, app.name)).toBeVisible();
  });

  test("a place older than seven days is not resumed", async ({ context, page }) => {
    await seedStorage(page, { "droid-atlas:v1:lastPlace:browser": lastPlace(`#/region/${A}`, 8 * 24 * 3600 * 1000) });
    await page.close();
    const next = await launchAs(context, "browser");
    await expect(next).toHaveURL(/#\/$/);
  });

  test("a resumed app that no longer exists falls back to its list, and a vanished list to its region", async ({ context, page }) => {
    await seedStorage(page, { "droid-atlas:v1:lastPlace:browser": lastPlace(`#/cat/${L.category.id}?app=gone.app.id`, 60_000, `#/region/${L.regionId}`) });
    await page.close();
    const first = await launchAs(context, "browser");
    await expect(first).toHaveURL(exact(`#/cat/${L.category.id}`));
    await first.close();
    const seeder = await context.newPage();
    await seedStorage(seeder, { "droid-atlas:v1:lastPlace:browser": lastPlace("#/cat/no-such-category", 60_000, `#/region/${L.regionId}`) });
    await seeder.close();
    const second = await launchAs(context, "browser");
    await expect(second).toHaveURL(exact(`#/region/${L.regionId}`));
  });

  test("an explicit #/ opens Explore even with a last place stored", async ({ context, page }) => {
    await seedStorage(page, { "droid-atlas:v1:lastPlace:browser": lastPlace(`#/region/${A}`) });
    await page.close();
    const next = await launchAs(context, "browser", "/#/");
    await expect(next).toHaveURL(/#\/$/);
  });

  test("a resumed sheet's first gesture puts its list, its region and the map beneath it, so Back climbs level by level", async ({ context, page }) => {
    const app = featuredApp();
    const category = build.categories.get(app.atlas.category);
    if (!category) throw new Error("the featured entry has no category");
    await seedStorage(page, { "droid-atlas:v1:lastPlace:browser": lastPlace(sheetHash(app)) });
    await page.close();
    const next = await launchAs(context, "browser");
    await expect(sheet(next, app.name)).toBeVisible();
    expect((await snapshot(next)).state?.idx).toBe(0);
    await firstGesture(next);
    await expect.poll(async () => (await snapshot(next)).state?.idx).toBe(3);
    await back(next);
    await expect(sheet(next)).toBeHidden();
    await expect(next).toHaveURL(exact(`#/cat/${category.id}`));
    await back(next);
    await expect(next).toHaveURL(exact(`#/region/${category.region}`));
    await back(next);
    await expect(next).toHaveURL(/#\/$/);
    expect((await snapshot(next)).state?.idx).toBe(0);
  });

  test("a resumed level's first gesture seeds Explore beneath it, so Back reaches the map", async ({ context, page }) => {
    await seedStorage(page, { "droid-atlas:v1:lastPlace:browser": lastPlace(`#/region/${A}`) });
    await page.close();
    const next = await launchAs(context, "browser");
    await expect(next).toHaveURL(exact(`#/region/${A}`));
    await next.getByRole("heading", { level: 1, name: regionName(A) }).click();
    await expect.poll(async () => (await snapshot(next)).state?.idx).toBe(1);
    await back(next);
    await expect(next).toHaveURL(/#\/$/);
  });
});
