/**
 * History rules 1 to 8 of docs/ARCHITECTURE.md § History rules, each checked
 * on URL, `history.length` delta, `history.state` and what is on screen.
 *
 * Most tests reach their starting place by a tap, so the router's cold-start
 * seeding (tested on its own in cold-start.spec.ts) has already happened.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { appsInCategory, biggestLens, build, chipLink, featuredApp, level, regionTile, requireShape } from "../lib/pick.ts";
import { sheetHash } from "../lib/catalog.ts";
import { serveChanged } from "../lib/inject.ts";
import {
  appRows,
  back,
  chooseSort,
  closeSheetButton,
  countStatus,
  escapeRegExp,
  forward,
  hashOf,
  hidePage,
  isWide,
  launch,
  navLink,
  openFilters,
  resultList,
  setRows,
  sheet,
  snapshot,
  sortButton,
  sortSheet,
  typeHash,
} from "../lib/app.ts";

const L = level();
const REGION_HASH = `#/region/${L.regionId}`;
const CATEGORY_HASH = `#/cat/${L.category.id}`;
const exact = (hash: string): RegExp => new RegExp(`${escapeRegExp(hash)}$`);

async function enterRegionFromExplore(page: Page): Promise<void> {
  await launch(page, "#/");
  await regionTile(page, L.regionId).click();
  await expect(page).toHaveURL(exact(REGION_HASH));
  await expect(page.getByRole("heading", { level: 1, name: L.regionName })).toBeVisible();
}

async function enterCategory(page: Page): Promise<void> {
  await enterRegionFromExplore(page);
  await chipLink(page, `Categories in ${L.regionName}`, L.category).click();
  await expect(page).toHaveURL(exact(CATEGORY_HASH));
}

async function openFirstRow(page: Page): Promise<string> {
  const link = resultList(page).getByRole("link").first();
  const href = (await link.getAttribute("href")) ?? "";
  await link.click();
  const id = new URLSearchParams(href.split("?")[1]).get("app") ?? "";
  await expect(sheet(page)).toBeVisible();
  return id;
}

test.describe("rule 1: push", () => {
  test("a deeper level adds one entry with a new id at idx + 1", async ({ page }) => {
    await launch(page, "#/");
    const root = await snapshot(page);
    await regionTile(page, L.regionId).click();
    await expect(page).toHaveURL(exact(REGION_HASH));
    const region = await snapshot(page);
    expect(region.length - root.length).toBe(1);
    expect(region.state?.idx).toBe((root.state?.idx ?? -1) + 1);
    expect(region.state?.id).not.toBe(root.state?.id);
    expect(region.state?.under).toBeNull();

    await chipLink(page, `Categories in ${L.regionName}`, L.category).click();
    await expect(page).toHaveURL(exact(CATEGORY_HASH));
    const category = await snapshot(page);
    expect(category.length - region.length).toBe(1);
    expect(category.state?.idx).toBe((region.state?.idx ?? -1) + 1);
    await expect(page.getByRole("heading", { level: 1, name: L.category.name })).toBeVisible();
  });

  test("opening the sheet from a list adds one entry whose `under` is that list", async ({ page }) => {
    await enterCategory(page);
    const list = await snapshot(page);
    const id = await openFirstRow(page);
    await expect(page).toHaveURL(exact(`${CATEGORY_HASH}?app=${id}`));
    const opened = await snapshot(page);
    expect(opened.length - list.length).toBe(1);
    expect(opened.state?.idx).toBe((list.state?.idx ?? -1) + 1);
    expect(opened.state?.under).toBe(CATEGORY_HASH);
  });
});

test.describe("rule 2: replace, same entry id", () => {
  test("sort and filter changes replace the entry and keep its id", async ({ page }) => {
    await enterCategory(page);
    const before = await snapshot(page);
    await chooseSort(page, "Recently added");
    await expect(page).toHaveURL(/sort=added/);
    const sorted = await snapshot(page);
    expect(sorted.length).toBe(before.length);
    expect(sorted.state?.id).toBe(before.state?.id);

    await page.getByRole("button", { name: /^Filters/ }).click();
    const panel = page.getByRole("dialog", { name: "Filters" });
    await panel.getByRole("button", { pressed: false, disabled: false }).filter({ hasText: /\d$/ }).first().click();
    await expect(page).toHaveURL(/[?&]f=/);
    await page.keyboard.press("Escape");
    const filtered = await snapshot(page);
    expect(filtered.length).toBe(before.length);
    expect(filtered.state?.id).toBe(before.state?.id);
    await expect(countStatus(page)).toHaveText(/^\d+ of \d+/);

    await back(page);
    await expect(page).toHaveURL(exact(REGION_HASH));
  });

  test("stepping to the next result inside the sheet replaces and keeps the id", async ({ page }) => {
    requireShape(appsInCategory(L.category.id).length >= 2, "category with two entries to step between");
    await enterCategory(page);
    await openFirstRow(page);
    const opened = await snapshot(page);
    await expect(page.getByRole("group", { name: "Results" }).getByRole("status")).toHaveText(/^1 of \d+$/);
    await page.getByRole("button", { name: "Next result" }).click();
    await expect(page.getByRole("group", { name: "Results" }).getByRole("status")).toHaveText(/^2 of \d+$/);
    const stepped = await snapshot(page);
    expect(stepped.length).toBe(opened.length);
    expect(stepped.state?.id).toBe(opened.state?.id);
    expect(stepped.hash).not.toBe(opened.hash);
    expect(stepped.state?.under).toBe(CATEGORY_HASH);
  });
});

test.describe("rules 3 and 4: replace with a new entry id", () => {
  test("a sibling category chip replaces the entry with a new id, and the new view starts at the top", async ({ page }) => {
    requireShape(Boolean(L.sibling), "region with two categories");
    const sibling = L.sibling;
    if (!sibling) return;
    await enterCategory(page);
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(1300);
    const before = await snapshot(page);
    await chipLink(page, `Other categories in ${L.regionName}`, sibling).click();
    await expect(page).toHaveURL(exact(`#/cat/${sibling.id}`));
    const after = await snapshot(page);
    expect(after.length).toBe(before.length);
    expect(after.state?.idx).toBe(before.state?.idx);
    expect(after.state?.id).not.toBe(before.state?.id);
    expect(after.scrollY).toBe(0);
    await expect(page.getByRole("heading", { level: 1, name: sibling.name })).toBeVisible();
    await back(page);
    await expect(page).toHaveURL(exact(REGION_HASH));
  });

  test("Saved from the Search root replaces with a new id (rule 5's replace is rule 3's kind)", async ({ page }) => {
    await launch(page, "#/");
    await navLink(page, "Search").click();
    await expect(page).toHaveURL(/#\/search$/);
    const search = await snapshot(page);
    await navLink(page, "Saved").click();
    await expect(page).toHaveURL(/#\/saved$/);
    const saved = await snapshot(page);
    expect(saved.length).toBe(search.length);
    expect(saved.state?.idx).toBe(search.state?.idx);
    expect(saved.state?.id).not.toBe(search.state?.id);
  });
});

test.describe("rule 5: bottom bar", () => {
  test("Search from the Explore root pushes, and Back returns to Explore", async ({ page }) => {
    await launch(page, "#/");
    await page.getByRole("main").click({ position: { x: 5, y: 5 } });
    const root = await snapshot(page);
    await navLink(page, "Search").click();
    await expect(page).toHaveURL(/#\/search$/);
    const search = await snapshot(page);
    expect(search.length - root.length).toBe(1);
    await expect(navLink(page, "Search")).toHaveAttribute("aria-current", "page");
    await back(page);
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Droid Atlas" })).toBeVisible();
  });

  test("Search from deep inside Explore pushes, so Back returns to where the user was", async ({ page }) => {
    await enterCategory(page);
    const category = await snapshot(page);
    await navLink(page, "Search").click();
    await expect(page).toHaveURL(/#\/search$/);
    expect((await snapshot(page)).length - category.length).toBe(1);
    await back(page);
    await expect(page).toHaveURL(exact(CATEGORY_HASH));
  });

  test("Explore goes back to the root Explore entry and never pushes", async ({ page }) => {
    await enterCategory(page);
    const deep = await snapshot(page);
    await navLink(page, "Explore").click();
    await expect(page).toHaveURL(/#\/$/);
    const root = await snapshot(page);
    expect(root.length).toBe(deep.length);
    expect(root.state?.idx).toBe(0);
    await expect(page.getByRole("heading", { level: 1, name: "Droid Atlas" })).toBeVisible();
    await forward(page);
    await expect(page).toHaveURL(exact(REGION_HASH));
  });

  test("Explore from Search (pushed from deep inside Explore) returns to the root, not a new entry", async ({ page }) => {
    await enterCategory(page);
    await navLink(page, "Search").click();
    await expect(page).toHaveURL(/#\/search$/);
    const search = await snapshot(page);
    await navLink(page, "Explore").click();
    await expect(page).toHaveURL(/#\/$/);
    const root = await snapshot(page);
    expect(root.length).toBe(search.length);
    expect(root.state?.idx).toBe(0);
  });

  test("selecting the current destination with a sheet open closes the sheet without a new entry", async ({ page }) => {
    test.skip(!isWide(page), "on a phone the sheet is modal, so the bottom bar cannot be reached while it is open");
    const app = featuredApp();
    await launch(page, "#/");
    await navLink(page, "Search").click();
    await page.getByRole("searchbox", { name: "Search the catalog" }).fill(app.name);
    await expect(page).toHaveURL(/q=/);
    const list = await snapshot(page);
    const listHash = (await snapshot(page)).hash;
    await appRows(page).first().click();
    await expect(sheet(page)).toBeVisible();
    await navLink(page, "Search").click();
    await expect(page).toHaveURL(exact(listHash));
    await expect(sheet(page)).toBeHidden();
    const closed = await snapshot(page);
    expect(closed.state?.idx).toBe(list.state?.idx);
  });
});

test.describe("rule 6: the sheet's close control", () => {
  test("closes by going back when the list is beneath, and Forward reopens the sheet", async ({ page }) => {
    await enterCategory(page);
    const list = await snapshot(page);
    const id = await openFirstRow(page);
    const opened = await snapshot(page);
    await closeSheetButton(page).click();
    await expect(page).toHaveURL(exact(CATEGORY_HASH));
    await expect(sheet(page)).toBeHidden();
    const closed = await snapshot(page);
    expect(closed.length).toBe(opened.length);
    expect(closed.state?.id).toBe(list.state?.id);
    await forward(page);
    await expect(page).toHaveURL(exact(`app=${id}`));
    await expect(sheet(page)).toBeVisible();
  });

  test("replaces with the list when the entry beneath is not that list", async ({ page }) => {
    await launch(page, "#/");
    await page.getByRole("main").click({ position: { x: 5, y: 5 } });
    const app = appsInCategory(L.category.id)[0];
    if (!app) throw new Error("no app in the category");
    await typeHash(page, `${REGION_HASH}?app=${app.id}`);
    await expect(sheet(page)).toBeVisible();
    const adopted = await snapshot(page);
    expect(adopted.state?.under).toBeNull();
    await closeSheetButton(page).click();
    await expect(page).toHaveURL(exact(REGION_HASH));
    const closed = await snapshot(page);
    expect(closed.length).toBe(adopted.length);
    expect(closed.state?.idx).toBe(adopted.state?.idx);
    await expect(sheet(page)).toBeHidden();
  });
});

test.describe("rule 7: navigations the router did not make", () => {
  test("a typed hash is adopted as a new entry at idx + 1", async ({ page }) => {
    const lens = biggestLens();
    await enterRegionFromExplore(page);
    const region = await snapshot(page);
    await typeHash(page, `#/lens/${lens.key}`);
    await expect(page.getByRole("heading", { level: 1, name: lens.label })).toBeVisible();
    const after = await snapshot(page);
    expect(after.length - region.length).toBe(1);
    expect(after.state?.idx).toBe((region.state?.idx ?? -1) + 1);
    expect(after.state?.id).not.toBe(region.state?.id);
    await back(page);
    await expect(page).toHaveURL(exact(REGION_HASH));
  });

  test("a typed share link #/app/<id> is normalized by replace to its category with the sheet open", async ({ page }) => {
    const app = featuredApp();
    await enterRegionFromExplore(page);
    const region = await snapshot(page);
    await typeHash(page, `#/app/${app.id}`);
    await expect(sheet(page, app.name)).toBeVisible();
    const shared = await snapshot(page);
    expect(shared.hash).toBe(sheetHash(app));
    expect(shared.length - region.length).toBe(1);
    await back(page);
    await expect(page).toHaveURL(exact(REGION_HASH));
  });

  test("a share link to a retired id follows Catalog.redirects (a redirect added to the served catalog, and every one it has)", async ({ page }) => {
    const target = featuredApp();
    await serveChanged(page, build, [{ role: "atlas", change: (atlas) => { (atlas.redirects as Record<string, string | null>)["retired.example.id"] = target.id; } }]);
    const redirects: [string, string][] = [["retired.example.id", target.id], ...Object.entries(build.atlas.redirects).filter((entry): entry is [string, string] => entry[1] !== null).slice(0, 3)];
    await launch(page, "#/");
    for (const [retired, successor] of redirects) {
      const app = build.byId.get(successor);
      if (!app) throw new Error(`redirect target ${successor} missing`);
      await typeHash(page, `#/app/${retired}`);
      await expect(sheet(page, app.name)).toBeVisible();
      expect(hashOf(page)).toBe(sheetHash(app));
    }
  });
});

test.describe("rule 8: nothing else touches history", () => {
  test("typing a query adds no entry and keeps the id; the URL follows after the pause", async ({ page }) => {
    await launch(page, "#/");
    await navLink(page, "Search").click();
    const search = await snapshot(page);
    const field = page.getByRole("searchbox", { name: "Search the catalog" });
    await field.pressSequentially("free notes app", { delay: 40 });
    await expect(page).toHaveURL(/q=free%20notes%20app$/);
    const typed = await snapshot(page);
    expect(typed.length).toBe(search.length);
    expect(typed.state?.id).toBe(search.state?.id);
  });

  test("scrolling, the row density, the filters and the sort sheet add no entry", async ({ page }) => {
    await enterRegionFromExplore(page);
    const before = await snapshot(page);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(1300);
    await setRows(page, "Compact");
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    await sortButton(page).click();
    await expect(sortSheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sortSheet(page)).toBeHidden();
    const filters = await openFilters(page);
    await page.keyboard.press("Escape");
    await expect(filters).toBeHidden();
    await page.waitForTimeout(1300);
    const after = await snapshot(page);
    expect(after.length).toBe(before.length);
    expect(after.state?.id).toBe(before.state?.id);
    expect(after.hash).toBe(before.hash);
  });

  test("a pending query edit is flushed before a push", async ({ page }) => {
    const app = featuredApp();
    await launch(page, "#/");
    await navLink(page, "Search").click();
    await page.getByRole("searchbox", { name: "Search the catalog" }).fill(app.name);
    await appRows(page).first().click();
    await expect(sheet(page)).toBeVisible();
    const opened = await snapshot(page);
    const listHash = `#/search?q=${encodeURIComponent(app.name)}`;
    expect(opened.state?.under).toBe(listHash);
    await back(page);
    expect(hashOf(page)).toBe(listHash);
  });

  test("a pending query edit survives Back and is restored on Forward", async ({ page }) => {
    await launch(page, "#/");
    await navLink(page, "Search").click();
    await page.getByRole("searchbox", { name: "Search the catalog" }).fill("signal");
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/#\/$/);
    await forward(page);
    await expect(page).toHaveURL(/#\/search\?q=signal$/);
    await expect(page.getByRole("searchbox", { name: "Search the catalog" })).toHaveValue("signal");
  });

  test("a pending query edit is flushed when the page is hidden", async ({ page }) => {
    await launch(page, "#/");
    await navLink(page, "Search").click();
    await page.getByRole("searchbox", { name: "Search the catalog" }).fill("k");
    await page.getByRole("searchbox", { name: "Search the catalog" }).fill("keyboard");
    await hidePage(page);
    expect(hashOf(page)).toBe("#/search?q=keyboard");
  });
});
