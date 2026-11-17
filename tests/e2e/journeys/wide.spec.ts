/**
 * The wide layout's pages, measured: under Explore's map the content is as
 * wide as the map; a list starts within reach of the top,
 * with nothing beside it until an app is chosen; chips keep to one line; the
 * keyboard shortcuts wait behind `?`; the guides read as a reading list whose
 * addresses are never cut inside a path; every page but Explore stands on one
 * centered axis with its title on the content's left edge.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { sheetHash } from "../lib/catalog.ts";
import { appsInRegion, categoriesIn, regionsBySize, requireShape, resourceRegion } from "../lib/pick.ts";
import { launch, sheet } from "../lib/app.ts";

const SIZES = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const RAIL = 88;
const GUIDES = resourceRegion();
const APP_REGIONS = regionsBySize().filter((region) => region.id !== GUIDES?.id);

/** Space left and right of an element inside the area right of the rail. */
async function margins(page: Page, selector: string): Promise<{ left: number; right: number }> {
  return page.locator(selector).first().evaluate((element, rail) => {
    const box = element.getBoundingClientRect();
    return { left: Math.round(box.left - rail), right: Math.round(document.documentElement.clientWidth - box.right) };
  }, RAIL);
}

async function leftOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const first = range.getClientRects()[0] ?? element.getBoundingClientRect();
    return Math.round(first.left);
  });
}

test.describe("a list in the wide layout", () => {
  test.beforeEach(({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "wide layout");
    void page;
  });

  for (const size of SIZES) {
    test(`at ${size.width} × ${size.height} every region's first app is within 240 px of the top, and nothing stands beside the list`, async ({ page }) => {
      await page.setViewportSize(size);
      for (const region of APP_REGIONS) {
        await launch(page, `#/region/${region.id}`);
        const row = page.locator("[data-row]").first();
        await expect(row).toBeVisible();
        const top = await row.evaluate((element) => Math.round(element.getBoundingClientRect().top));
        expect(top, `${region.name}: the top of the first app row`).toBeLessThanOrEqual(240);
        await expect(page.getByRole("complementary"), "no panel until an app is chosen").toHaveCount(0);
        const space = await margins(page, ".view-list");
        expect(Math.abs(space.left - space.right), `${region.name}: the list is centered`).toBeLessThanOrEqual(2);
        const names = await page.locator(".view-list").first().locator(".chip-name").allInnerTexts();
        expect(new Set(names).size, `${region.name}: no category twice`).toBe(names.length);
      }
    });
  }

  test("the categories keep to one line, and All opens every one of them, then Fewer closes it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const region = APP_REGIONS.find((item) => categoriesIn(item.id).length >= 10);
    requireShape(Boolean(region), "a region with ten categories or more");
    if (!region) return;
    await launch(page, `#/region/${region.id}`);
    const strip = page.getByRole("navigation", { name: `Categories in ${region.name}` });
    const tops = async (): Promise<number[]> => strip.locator("li:not([hidden])").evaluateAll((items) => [...new Set(items.map((item) => Math.round(item.getBoundingClientRect().top)))]);
    expect(await tops(), "one line").toHaveLength(1);
    const all = strip.getByRole("button", { name: /^All \d+$/ });
    await expect(all).toBeVisible();
    const total = Number((await all.innerText()).replace(/\D/g, ""));
    const where = await all.boundingBox();
    await all.click();
    await expect(strip.getByRole("link")).toHaveCount(total);
    for (const link of await strip.getByRole("link").all()) await expect(link).toBeVisible();
    const fewer = strip.getByRole("button", { name: "Fewer" });
    const moved = await fewer.boundingBox();
    expect([moved?.x, moved?.y], "Fewer stands where All was clicked").toEqual([where?.x, where?.y]);
    await fewer.click();
    expect(await tops(), "one line again").toHaveLength(1);
  });

  test("the tools keep to one line: Filters, Sort, the quick filters that fit, and the count at its end", async ({ page }) => {
    for (const size of SIZES) {
      await page.setViewportSize(size);
      const [region] = APP_REGIONS;
      if (!region) return;
      await launch(page, `#/region/${region.id}`);
      const bar = page.getByRole("group", { name: "Filters and sorting" });
      const tops = await bar.locator("button:visible, [role=status]").evaluateAll((items) => [...new Set(items.map((item) => Math.round(item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2)))]);
      expect(tops, `one line at ${size.width}`).toHaveLength(1);
      const count = await bar.getByRole("status").evaluate((element) => Math.round(element.getBoundingClientRect().right));
      const others = await bar.locator("button:visible").evaluateAll((items) => Math.max(...items.map((item) => Math.round(item.getBoundingClientRect().right))));
      expect(count, "the count at the end").toBeGreaterThan(others);
    }
  });

  test("choosing an app brings the panel and the list keeps the rest; closing it centers the list again", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const [region] = APP_REGIONS;
    const app = region ? appsInRegion(region.id)[2] : undefined;
    if (!region || !app) return;
    await launch(page, sheetHash(app));
    await expect(sheet(page, app.name)).toBeVisible();
    await page.waitForTimeout(300);
    const list = await page.locator(".view-list").first().evaluate((element) => element.getBoundingClientRect().right);
    const panel = await sheet(page).evaluate((element) => element.getBoundingClientRect().left);
    expect(list, "the list ends before the panel").toBeLessThanOrEqual(panel);
    await page.getByRole("button", { name: "Close details" }).click();
    await expect(page.getByRole("complementary")).toHaveCount(0);
    await page.waitForTimeout(300);
    const space = await margins(page, ".view-list");
    expect(Math.abs(space.left - space.right)).toBeLessThanOrEqual(2);
  });

  test("the keyboard shortcuts are behind ? and About's link, and nowhere on a list", async ({ page }) => {
    const [region] = APP_REGIONS;
    await launch(page, `#/region/${region?.id ?? ""}`);
    await expect(page.getByText("Move through the list")).toBeHidden();
    await page.locator("body").press("?");
    const dialog = page.getByRole("dialog", { name: "Keyboard" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Move through the list");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await launch(page, "#/about");
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByRole("dialog", { name: "Keyboard" })).toBeVisible();
  });
});

test("on a phone About offers no keyboard shortcuts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "touch only");
  await launch(page, "#/about");
  await expect(page.getByRole("button", { name: "Keyboard shortcuts" })).toBeHidden();
});

test.describe("the guides as a reading list", () => {
  test("no circle, no bookmark, every address the site alone or a project, never cut inside a path, and titles on the section names' edge", async ({ page }) => {
    requireShape(GUIDES !== null, "a region of guides");
    if (!GUIDES) return;
    await launch(page, `#/region/${GUIDES.id}`);
    const list = page.locator(".reading");
    await expect(list).toBeVisible();
    await expect(list.locator(".ico, .row-save, [aria-label^='Save']")).toHaveCount(0);
    const sites = await list.locator(".reading-site").evaluateAll((lines) => lines.map((line) => ({
      text: line.textContent ?? "",
      cut: line.scrollWidth > line.clientWidth + 1,
    })));
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(site.cut, site.text).toBe(false);
      const [host = "", ...path] = site.text.split("/");
      const forge = ["github.com", "gitlab.com", "codeberg.org"].includes(host);
      expect(path.length, site.text).toBeLessThanOrEqual(forge ? 2 : 0);
    }
    const titleLefts = await list.locator(".reading-title").evaluateAll((titles) => titles.map((title) => Math.round(title.getBoundingClientRect().left)));
    if (await list.locator(".reading-group > .overline").count() === 0) return;
    const sectionLeft = await leftOf(page, ".reading-group > .overline");
    for (const left of titleLefts) expect(Math.abs(left - sectionLeft)).toBeLessThanOrEqual(1);
  });

  test("at 1920 the page is a centered column, and no arrow is more than 720 px from its title", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "wide layout");
    if (!GUIDES) return;
    await page.setViewportSize({ width: 1920, height: 1080 });
    await launch(page, `#/region/${GUIDES.id}`);
    const space = await margins(page, ".view-list");
    expect(Math.abs(space.left - space.right)).toBeLessThanOrEqual(2);
    const reach = await page.locator(".reading-row").evaluateAll((rows) => Math.max(...rows.map((row) => {
      const title = row.querySelector(".reading-title")?.getBoundingClientRect();
      const arrow = row.querySelector(".icon")?.getBoundingClientRect();
      return title && arrow ? arrow.right - title.left : 0;
    })));
    expect(reach).toBeLessThanOrEqual(720);
  });
});

test.describe("one axis for the text pages", () => {
  const PAGES = [
    { name: "About", hash: "#/about", content: ".about h2" },
    { name: "Settings", hash: "#/settings", content: ".settings .overline" },
    { name: "Sources and licenses", hash: "#/about/sources", content: ".page > :first-child" },
    { name: "Data health", hash: "#/about/health", content: ".page > :first-child" },
    { name: "Icon credits", hash: "#/about/icons", content: ".page > :first-child" },
  ];
  for (const width of [1280, 1440, 1920]) {
    test(`at ${width}, the content is centered right of the rail and starts on the title's left edge`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "wide layout");
      await page.setViewportSize({ width, height: 900 });
      for (const view of PAGES) {
        await launch(page, view.hash);
        await expect(page.locator(".view-page h1")).toBeVisible();
        const space = await margins(page, ".view-page");
        expect(Math.abs(space.left - space.right), `${view.name}: centered`).toBeLessThanOrEqual(2);
        const title = await leftOf(page, ".view-page h1");
        const content = await leftOf(page, view.content);
        expect(Math.abs(title - content), `${view.name}: the title's edge is the content's`).toBeLessThanOrEqual(1);
      }
    });
  }
});

test.describe("Explore in the wide layout", () => {
  for (const size of SIZES) {
    test(`at ${size.width}, what is under the map is as wide as the map, and every quick filter is in view`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "wide layout");
      await page.setViewportSize(size);
      await launch(page, "#/");
      const map = await page.locator(".mosaic").boundingBox();
      const below = await page.locator(".home-below").boundingBox();
      if (!map || !below) throw new Error("no map or nothing under it");
      expect(Math.abs(below.x - map.x), "left edges").toBeLessThanOrEqual(1);
      expect(Math.abs(below.x + below.width - (map.x + map.width)), "right edges").toBeLessThanOrEqual(1);
      const filters = page.getByRole("region", { name: "Quick filters" }).getByRole("link");
      expect(await filters.count()).toBeGreaterThan(0);
      const outside = await filters.evaluateAll((links) => links.filter((link) => {
        const box = link.getBoundingClientRect();
        return box.left < 0 || box.right > document.documentElement.clientWidth;
      }).length);
      expect(outside, "quick filters out of view sideways").toBe(0);
    });
  }

  for (const width of [1440, 1600, 1920]) {
    test(`at ${width}, the newest entries reach the quick filters: no gap under the map wider than 40 px`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "wide layout");
      await page.setViewportSize({ width, height: 900 });
      await launch(page, "#/");
      const parts = await page.evaluate(() => {
        const box = (selector: string): { left: number; right: number } => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return { left: Math.round(rect?.left ?? 0), right: Math.round(rect?.right ?? 0) };
        };
        const rows = [...document.querySelectorAll(".home-new .rows > li")]
          .filter((row) => getComputedStyle(row).display !== "none")
          .map((row) => row.getBoundingClientRect())
          .map((row) => ({ left: Math.round(row.left), right: Math.round(row.right) }));
        return { map: box(".mosaic"), lenses: box(".home-lenses"), rows };
      });
      const columns = [...new Map(parts.rows.map((row) => [row.left, row])).values()].sort((a, b) => a.left - b.left);
      expect(columns[0]?.left, "the first column starts at the map's left edge").toBe(parts.map.left);
      const edges = [...columns.map((column) => [column.left, column.right]), [parts.lenses.left, parts.lenses.right]];
      for (let index = 1; index < edges.length; index += 1) {
        expect((edges[index]?.[0] ?? 0) - (edges[index - 1]?.[1] ?? 0), `gap ${index} at ${width}`).toBeLessThanOrEqual(40);
      }
      expect(parts.lenses.right, "the quick filters end at the map's right edge").toBe(parts.map.right);
    });
  }

  test("Search's pins keep to one line", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "wide layout");
    await page.setViewportSize({ width: 1280, height: 800 });
    await launch(page, "#/search");
    const pins = page.locator(".pins-list > li:not([hidden])");
    await expect(pins.first()).toBeVisible();
    const tops = await pins.evaluateAll((items) => [...new Set(items.map((item) => Math.round(item.getBoundingClientRect().top)))]);
    expect(tops).toHaveLength(1);
  });
});

test.describe("headers, dialogs and columns", () => {
  test("from 1200 px a level's header reaches 72 px past its column on both sides, the back control on it and the title on the content's edge", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "wide layout");
    await page.setViewportSize({ width: 1440, height: 900 });
    const [region] = APP_REGIONS;
    const pages = [`#/region/${region?.id ?? ""}`, ...(GUIDES ? [`#/region/${GUIDES.id}`] : [])];
    for (const hash of pages) {
      await launch(page, hash);
      const facts = await page.evaluate(() => {
        const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
        const column = rect(".view-list");
        const head = rect(".place-head");
        const back = rect(".place-head > .icon-btn");
        const title = rect(".place-head h1");
        const content = rect(".cats .chip, .reading-group > .overline, .reading-block");
        return {
          column: [Math.round(column?.left ?? 0), Math.round(column?.right ?? 0)],
          head: [Math.round(head?.left ?? 0), Math.round(head?.right ?? 0)],
          back: [Math.round(back?.left ?? 0), Math.round(back?.right ?? 0)],
          title: Math.round(title?.left ?? 0),
          content: Math.round(content?.left ?? 0),
        };
      });
      expect(facts.head[0], `${hash}: left reach`).toBe((facts.column[0] ?? 0) - 72);
      expect(facts.head[1], `${hash}: right reach`).toBe((facts.column[1] ?? 0) + 72);
      expect(facts.back[0], `${hash}: the back control inside the header`).toBe((facts.head[0] ?? 0) + 16);
      expect(Math.abs(facts.title - facts.content), `${hash}: title on the content's edge`).toBeLessThanOrEqual(1);
    }
  });

  test("the keyboard dialog is as tall as its five rows", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "wide layout");
    await launch(page, "#/about");
    await page.locator("body").press("?");
    const dialog = page.getByRole("dialog", { name: "Keyboard" });
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    const rows = await dialog.locator(".keys").boundingBox();
    expect((box?.height ?? 0) - (rows?.height ?? 0), "no more than its header and margins").toBeLessThan(140);
  });

  test("at 768 a text page's column is centered", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await launch(page, "#/settings");
    const space = await page.locator(".view-page").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { left: Math.round(box.left), right: Math.round(document.documentElement.clientWidth - box.right) };
    });
    expect(Math.abs(space.left - space.right)).toBeLessThanOrEqual(2);
  });

  test("at 384 a guide's site line breaks only between its parts, never inside one", async ({ page }) => {
    if (!GUIDES) return;
    await page.setViewportSize({ width: 384, height: 832 });
    await launch(page, `#/region/${GUIDES.id}`);
    const broken = await page.locator(".reading-site > span").evaluateAll((parts) => parts.filter((part) => part.getClientRects().length > 1).map((part) => part.textContent));
    expect(broken).toEqual([]);
  });
});
