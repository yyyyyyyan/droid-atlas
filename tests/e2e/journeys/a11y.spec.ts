/**
 * Accessibility: axe on every view in both themes (zero serious or critical
 * violations), and keyboard-only walks through the main journeys with focus
 * checked at each step.
 */

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { isLink, sheetHash } from "../lib/catalog.ts";
import { appsInCategory, biggestLens, build, featuredApp, level, regionTile, requireShape, resourceRegion } from "../lib/pick.ts";
import { COMPACT_ROWS, escapeRegExp, isWide, launch, openFilters, ready, resultList, seedStorage, sheet, sortButton, sortSheet } from "../lib/app.ts";

const L = level();
const APP = featuredApp();
const LENS = biggestLens();
const GUIDES = resourceRegion();

interface ViewCase { name: string; open(page: Page): Promise<void> }

const VIEWS: ViewCase[] = [
  { name: "Explore", open: (page) => launch(page, "#/") },
  { name: "a region", open: (page) => launch(page, `#/region/${L.regionId}`) },
  { name: "a category (with a note when the catalog has one)", open: async (page) => {
    const noted = [...build.categories.values()].find((c) => [...build.sourceCategories.values()].some((s) => s.category === c.id && s.note) && appsInCategory(c.id).length > 0);
    await launch(page, `#/cat/${noted?.id ?? L.category.id}`);
  } },
  { name: "a lens", open: (page) => launch(page, `#/lens/${LENS.key}`) },
  { name: "Search with results and a filter", open: (page) => launch(page, `#/search?q=${encodeURIComponent((APP.name.split(" ")[0] ?? "").toLowerCase())}&f=${LENS.key}`) },
  { name: "Search with no results", open: (page) => launch(page, "#/search?q=zzzzqqqq") },
  { name: "Saved, empty", open: (page) => launch(page, "#/saved") },
  { name: "Saved, with apps and one that left the catalogs", open: async (page) => {
    await seedStorage(page, { "droid-atlas:v1:saved": JSON.stringify({ v: 1, items: [{ id: APP.id, packages: [], repo: null, savedAt: 2 }, { id: "gone.app", packages: [], repo: null, savedAt: 1 }] }) });
    await launch(page, "#/saved");
  } },
  { name: "Saved, with the offer to undo a removal", open: async (page) => {
    await seedStorage(page, { "droid-atlas:v1:saved": JSON.stringify({ v: 1, items: [{ id: APP.id, packages: [], repo: null, savedAt: 2, note: "A note", noteAt: 2 }] }) });
    await launch(page, "#/saved");
    await resultList(page).getByRole("button", { name: `Remove ${APP.name} from saved` }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  } },
  { name: "Settings", open: (page) => launch(page, "#/settings") },
  { name: "About", open: (page) => launch(page, "#/about") },
  { name: "Sources and licenses", open: (page) => launch(page, "#/about/sources") },
  { name: "Icon credits", open: async (page) => {
    await launch(page, "#/about/icons");
    await expect(page.getByRole("main").getByText("Loading…", { exact: true })).toHaveCount(0);
  } },
  { name: "Data health", open: (page) => launch(page, "#/about/health") },
  { name: "Third-party licenses", open: (page) => launch(page, "#/about/notices") },
  { name: "the text of a license", open: (page) => launch(page, "#/about/license/GPL-3.0-or-later") },
  { name: "a list of guides and sites", open: (page) => launch(page, `#/region/${GUIDES?.id ?? L.regionId}`) },
  { name: "not found", open: (page) => launch(page, "#/nowhere") },
  { name: "an entry that is not there, with the offer to search", open: (page) => launch(page, "#/app/org.example.missing") },
  { name: "the app sheet", open: async (page) => {
    await launch(page, sheetHash(APP));
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page).getByText("Loading…", { exact: true })).toHaveCount(0);
  } },
  { name: "the sheet of a closed-source app", open: async (page) => {
    const closed = build.apps.find((a) => a.atlas.facets.openness === "closed-source" && a.listings.length > 0) ?? APP;
    await launch(page, sheetHash(closed));
    await expect(sheet(page)).toBeVisible();
  } },
  { name: "the filters", open: async (page) => {
    await launch(page, `#/region/${L.regionId}`);
    await openFilters(page);
  } },
  { name: "the filters with every anti-feature shown", open: async (page) => {
    await launch(page, "#/search");
    const filters = await openFilters(page);
    const all = filters.getByRole("button", { name: /^Show all \d+ anti-features$/ });
    if (await all.count()) await all.click();
  } },
  { name: "the sort and view sheet", open: async (page) => {
    await launch(page, `#/region/${L.regionId}`);
    await sortButton(page).click();
    await expect(sortSheet(page)).toBeVisible();
  } },
  { name: "compact rows", open: async (page) => {
    await seedStorage(page, COMPACT_ROWS);
    await launch(page, `#/region/${L.regionId}`);
  } },
  { name: "search results with the match marked", open: (page) => launch(page, `#/search?q=${encodeURIComponent((APP.name.split(" ")[0] ?? "").toLowerCase().slice(0, 3))}`) },
  { name: "the catalog failure screen", open: async (page) => {
    await page.route("**/data/version.json", (route) => route.abort("internetdisconnected"));
    await page.goto("/#/");
    await expect(page.getByRole("alert")).toBeVisible();
  } },
];

for (const scheme of ["dark", "light"] as const) {
  test.describe(`axe, ${scheme} theme`, () => {
    for (const view of VIEWS) {
      test(`${view.name}: no serious or critical violations`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await view.open(page);
        await page.waitForTimeout(400);
        const results = await new AxeBuilder({ page }).analyze();
        const serious = results.violations
          .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
          .map((violation) => ({
            rule: violation.id,
            impact: violation.impact,
            help: violation.help,
            count: violation.nodes.length,
            nodes: violation.nodes.slice(0, 4).map((node) => `${node.target.join(" ")} — ${node.failureSummary?.split("\n")[1]?.trim() ?? ""}`),
          }));
        const minor = results.violations.filter((violation) => violation.impact !== "serious" && violation.impact !== "critical").map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`);
        if (minor.length) test.info().annotations.push({ type: "axe minor/moderate", description: minor.join(", ") });
        expect(serious).toEqual([]);
      });
    }
  });
}

async function isFocused(target: Locator): Promise<boolean> {
  return target.evaluate((element) => element === document.activeElement).catch(() => false);
}

/**
 * Whether focus on `target` changes what is on screen: the viewport is
 * captured focused and again with focus removed. Where the ring is drawn
 * (outline, shadow, a pseudo-element over a parent) does not matter.
 */
async function focusIsVisible(page: Page, target: Locator): Promise<boolean> {
  const focused = await page.screenshot({ animations: "disabled" });
  await target.evaluate((element) => (element as HTMLElement).blur());
  const blurred = await page.screenshot({ animations: "disabled" });
  await target.evaluate((element) => (element as HTMLElement).focus({ preventScroll: true }));
  return !focused.equals(blurred);
}

/** Presses Tab until `target` has focus, then checks that the focus is visible. */
async function tabTo(page: Page, target: Locator, limit = 80): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    await page.keyboard.press("Tab");
    if (await isFocused(target.first())) {
      expect(await focusIsVisible(page, target.first()), `focus on ${String(target)} is visible`).toBe(true);
      return;
    }
  }
  throw new Error(`focus never reached ${String(target)}`);
}

test.describe("keyboard only", () => {
  test.describe.configure({ timeout: 120_000 });

  test("skip link, map to region, rows with arrows, open a sheet, close it and get focus back", async ({ page }) => {
    requireShape(appsInCategory(L.category.id).length >= 2 || L.sibling !== null, "region with two entries");
    await launch(page, "#/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await tabTo(page, regionTile(page, L.regionId));
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`#/region/${escapeRegExp(L.regionId)}$`));
    const rows = resultList(page).getByRole("link");
    await tabTo(page, rows.first(), 120);
    await page.keyboard.press("ArrowDown");
    await expect(rows.nth(1)).toBeFocused();
    const second = (await rows.nth(1).getAttribute("href")) ?? "";
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    if (!isWide(page)) {
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog[open]")))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
    await expect(resultList(page).locator(`a[href="${second.replace(/\?app=.*/, "")}?app=${new URLSearchParams(second.split("?")[1]).get("app")}"]`)).toBeFocused();
  });

  test("the filter panel opens, toggles and closes from the keyboard, returning focus to its button", async ({ page }) => {
    await launch(page, `#/region/${L.regionId}`);
    const button = page.getByRole("button", { name: /^Filters/ });
    await button.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Filters" });
    await expect(panel).toBeVisible();
    await tabTo(page, panel.getByRole("button", { pressed: false, disabled: false }).filter({ hasText: /\d$/ }));
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/[?&]f=/);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("search by keyboard: reach the field, type, reach the results, open one", async ({ page }) => {
    await launch(page, "#/");
    if (isWide(page)) {
      await page.keyboard.press("/");
    } else {
      await tabTo(page, page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Search", exact: true }));
      await page.keyboard.press("Enter");
    }
    await expect(page).toHaveURL(/#\/search$/);
    const field = page.getByRole("searchbox", { name: "Search the catalog" });
    await expect(field).toBeFocused();
    await page.keyboard.type(APP.name);
    await expect(page).toHaveURL(/q=/);
    await tabTo(page, resultList(page).getByRole("link").first(), 40);
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  });

  test("the sheet's controls are reachable and the stepper works with arrow keys", async ({ page }) => {
    requireShape(appsInCategory(L.category.id).length >= 2, "category with two entries");
    await launch(page, `#/cat/${L.category.id}`);
    await resultList(page).getByRole("link").first().focus();
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("group", { name: "Results" }).getByRole("status")).toHaveText(/^2 of \d+$/);
    await tabTo(page, page.getByRole("button", { name: "Close details" }));
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeHidden();
  });

  test("the region map's tiles are links in size order with full names", async ({ page }) => {
    await launch(page, "#/");
    const names = await page.getByRole("list", { name: /Regions of the catalog/ }).getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("aria-label") ?? ""));
    expect(names.length, "a tile for every region of apps").toBe(new Set(build.apps.filter((app) => !isLink(app)).flatMap((app) => [...app.regions])).size);
    for (const name of names) expect(name).toMatch(/^.+: \d+ entr(y|ies) in \d+ categor(y|ies)$/);
    const counts = names.map((name) => Number(/: (\d+) entr/.exec(name)?.[1]));
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });
});

test("reload with reduced motion still renders the view", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await launch(page, `#/region/${L.regionId}`);
  await page.reload();
  await ready(page);
  await expect(page.getByRole("heading", { level: 1, name: L.regionName })).toBeVisible();
});
