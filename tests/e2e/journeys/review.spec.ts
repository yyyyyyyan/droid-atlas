/**
 * What the design review asked of Explore, the loading frame, the sheet and
 * Settings, measured: the map is of apps and the guides are a line under the
 * quick filters; the header counts apps; no category name is cut inside a
 * tile; a new entry's date is whole or absent; the loading frame is the app's
 * own; the sheet has two sections of links and its copy controls say what
 * they copy; Settings exports in one block and imports in the next.
 */

import { expect, test } from "../lib/fixtures.ts";
import { isLink, sheetHash } from "../lib/catalog.ts";
import { build, featuredApp, regionTile, regionsBySize, requireShape, resourceRegion } from "../lib/pick.ts";
import { DESKTOP_UA, launch, sheet } from "../lib/app.ts";

const GUIDES = resourceRegion();
const APP_COUNT = build.apps.filter((app) => !isLink(app)).length;

test.describe("Explore", () => {
  test("the map is of apps, the guides are one line under the quick filters, and the header counts apps", async ({ page }) => {
    await launch(page, "#/");
    await expect(page.locator(".home-meta")).toHaveText(`${APP_COUNT.toLocaleString("en")} ${APP_COUNT === 1 ? "app" : "apps"}`);
    requireShape(GUIDES !== null, "a region of guides");
    if (!GUIDES) return;
    await expect(regionTile(page, GUIDES.id), "no tile for the guides").toHaveCount(0);
    for (const region of regionsBySize().filter((item) => item.id !== GUIDES.id)) await expect(regionTile(page, region.id)).toHaveCount(1);
    const line = page.getByRole("region", { name: "Quick filters" }).getByRole("link", { name: new RegExp(`^${GUIDES.name}`) });
    await expect(line).toBeVisible();
    await line.click();
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(GUIDES.name);
  });

  test("from 1024 to 1920 no category name inside a tile is cut, and each count stands beside the end of its name", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a phone's tiles name no categories");
    for (const [width, height] of [[1024, 768], [1280, 800], [1366, 682], [1440, 900], [1920, 1080]] as const) {
      await page.setViewportSize({ width, height });
      await launch(page, "#/");
      const facts = await page.evaluate(() => {
        const shown = [...document.querySelectorAll<HTMLElement>(".tile-cats li")].filter((item) => !item.hidden);
        return {
          shown: shown.length,
          ellipsis: (document.querySelector(".mosaic")?.textContent ?? "").includes("…"),
          cut: shown.filter((item) => {
            const box = item.getBoundingClientRect();
            const tile = item.closest(".tile")?.getBoundingClientRect();
            return item.scrollWidth > item.clientWidth + 1 || (tile ? box.bottom > tile.bottom || box.right > tile.right + 0.5 : false);
          }).map((item) => item.textContent),
          apart: shown.flatMap((item) => {
            const end = [...(item.querySelector(".t")?.getClientRects() ?? [])].at(-1);
            const lines = item.querySelector(".n")?.getClientRects();
            const count = lines?.[0];
            if (!end || !lines || !count) return [`${item.textContent}: no name or count`];
            if (lines.length > 1) return [`${item.textContent}: the count is broken over ${lines.length} lines`];
            const gap = count.left - end.right;
            return gap > 12 || Math.abs(count.top - end.top) > 2 ? [`${item.textContent}: ${Math.round(gap)} px`] : [];
          }),
        };
      });
      expect(facts.shown, `names shown at ${width}`).toBeGreaterThan(0);
      expect(facts.ellipsis, `an ellipsis at ${width}`).toBe(false);
      expect(facts.cut, `cut names at ${width}`).toEqual([]);
      expect(facts.apart, `counts apart from their names at ${width}`).toEqual([]);
    }
  });

  test("from 1024 to 1920 a region's name breaks only between words, and its name and count stand whole inside its tile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the wide map; a phone's tiles break a name after its hyphen");
    for (const [width, height] of [[1024, 768], [1280, 800], [1440, 900], [1600, 900], [1920, 1080]] as const) {
      await page.setViewportSize({ width, height });
      await launch(page, "#/");
      await expect(page.locator(".mosaic .tile").first()).toBeVisible();
      const faults = await page.locator(".mosaic .tile").evaluateAll((tiles) => tiles.flatMap((tile) => {
        const found: string[] = [];
        const box = tile.getBoundingClientRect();
        const name = tile.querySelector(".tile-name");
        const node = name?.firstChild;
        if (node instanceof Text) {
          const text = node.data;
          const top = (index: number): number => {
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            return range.getBoundingClientRect().top;
          };
          for (let index = 0; index < text.length; index += 1) {
            if (text[index] !== "-") continue;
            let next = index + 1;
            while (text[next] === "⁠") next += 1;
            if (next < text.length && Math.abs(top(next) - top(index)) > 2) found.push(`“${text.replaceAll("⁠", "")}” breaks after its hyphen`);
          }
        }
        for (const part of tile.querySelectorAll(".tile-name, .tile-count")) {
          const shown = part.getBoundingClientRect();
          if (shown.bottom > box.bottom + 0.5 || shown.right > box.right + 0.5) found.push(`“${part.textContent ?? ""}” is cut in ${Math.round(box.width)}×${Math.round(box.height)}`);
        }
        return found;
      }));
      expect(faults, `at ${width}`).toEqual([]);
    }
  });

  test("at 320 a new entry's date stands whole beside its category or not at all", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "phone width");
    await page.setViewportSize({ width: 320, height: 800 });
    await launch(page, "#/");
    const lines = await page.locator(".home-new .row-meta-text").evaluateAll((items) => items.map((item) => {
      const name = item.querySelector<HTMLElement>(".row-meta-name");
      const when = item.querySelector<HTMLElement>(".row-meta-when");
      return { shown: when !== null && name !== null && when.offsetTop === name.offsetTop, whole: when ? when.scrollWidth <= when.clientWidth + 1 : false, text: item.textContent };
    }));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) if (line.shown) expect(line.whole, line.text ?? "").toBe(true);
  });
});

test("while the catalog loads on another page, the frame is the app's own with that page marked, no map is drawn, and nothing moves sideways when the page arrives", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the rail is the wide layout's");
  await page.route("**/data/c/**", async (route) => {
    await new Promise((done) => setTimeout(done, 1500));
    await route.continue();
  });
  await page.goto("/#/settings", { waitUntil: "commit" });
  const current = page.locator(".nav [aria-current='page']");
  await expect(current).toHaveText("About");
  await expect(page.locator(".boot-map")).toHaveCount(0);
  const before = await current.boundingBox();
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Settings" })).toBeVisible({ timeout: 15_000 });
  const after = await page.locator(".nav [aria-current='page']").boundingBox();
  expect(after?.x, "the rail stays where it was").toBe(before?.x);
});

test.describe("at 1440 with the catalog slowed, what the frame shows stands where the page puts it", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the wide layout");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("**/data/c/**", async (route) => {
      await new Promise((done) => setTimeout(done, 1500));
      await route.continue();
    });
  });

  test("Explore's name keeps its size and place", async ({ page }) => {
    await page.goto("/#/", { waitUntil: "commit" });
    const before = await page.locator("div.main[aria-busy] .wordmark").boundingBox({ timeout: 5_000 });
    await expect(page.locator(".mosaic .tile").first()).toBeVisible({ timeout: 15_000 });
    const after = await page.locator("main .wordmark").boundingBox();
    for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs((after?.[key] ?? 0) - (before?.[key] ?? 0)), key).toBeLessThanOrEqual(0.5);
  });

  test("Settings' Loading… stands where its title will", async ({ page }) => {
    await page.goto("/#/settings", { waitUntil: "commit" });
    const wait = page.locator("div.main[aria-busy]").getByText("Loading…");
    await expect(wait).toBeVisible();
    const before = await wait.boundingBox();
    const title = page.getByRole("main").getByRole("heading", { level: 1, name: "Settings" });
    await expect(title).toBeVisible({ timeout: 15_000 });
    const after = await title.boundingBox();
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0)), "the left edge").toBeLessThanOrEqual(1);
    const middle = (box: { y: number; height: number } | null): number => (box ? box.y + box.height / 2 : 0);
    expect(Math.abs(middle(after) - middle(before)), "the line").toBeLessThanOrEqual(4);
  });
});

test.describe("the sheet", () => {
  test("its links are in two sections, Get it and Links, and its last button says what it copies", async ({ page }) => {
    const app = featuredApp();
    await launch(page, sheetHash(app));
    const headings = await sheet(page).locator("h3.overline").allInnerTexts();
    expect(headings.map((text) => text.toLowerCase())).not.toContain("source code");
    expect(headings.map((text) => text.toLowerCase())).toContain("links");
    await expect(sheet(page).getByRole("button", { name: "Copy link to this page" })).toBeVisible();
  });

  test.describe("off Android", () => {
    test.use({ userAgent: DESKTOP_UA });
    test("the releases row copies the releases address and says so", async ({ page }) => {
      const app = [...build.apps].sort((a, b) => a.id.localeCompare(b.id)).find((candidate) => candidate.atlas.repo?.host === "github" && candidate.github?.release?.hasApk && candidate.atlas.channels.length === 0);
      requireShape(app !== undefined, "an app whose only way to get it is GitHub releases");
      if (!app) return;
      await launch(page, sheetHash(app));
      await expect(sheet(page).getByRole("button", { name: "Copy GitHub releases link" })).toBeVisible();
      await expect(sheet(page).getByRole("button", { name: "Copy source link" })).toHaveCount(0);
    });
  });
});

test("Settings: export and share in one block, then import under its sentence, with one Import for both kinds of file", async ({ page }) => {
  await launch(page, "#/settings");
  const main = page.getByRole("main");
  await expect(main.getByRole("button", { name: /Import a \.txt export/ })).toHaveCount(0);
  const exportBox = await main.getByRole("button", { name: "Export" }).boundingBox();
  const importBox = await main.getByRole("button", { name: "Import" }).boundingBox();
  const sentence = await main.getByText("Importing merges with what is here.").boundingBox();
  expect((exportBox?.y ?? 0) < (sentence?.y ?? 0) && (sentence?.y ?? 0) < (importBox?.y ?? 0), "Export, then the sentence, then Import").toBe(true);
  const accept = await main.locator("input[type=file]").getAttribute("accept");
  expect(accept).toContain(".json");
  expect(accept).toContain(".txt");
});
