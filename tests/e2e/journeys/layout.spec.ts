/**
 * Layout at phone widths: no horizontal overflow at 320, 336, 360, 384 and
 * 412 px on every view, and rows that keep one shape with nothing cut at
 * their edge (336 px is Firefox on the reference phone; 320 px is the
 * narrowest the layout is held to); persistent chrome under a fifth of
 * 688 px (ARCHITECTURE.md § Budgets); where the first result sits on list
 * views.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { sheetHash } from "../lib/catalog.ts";
import { TALL_LIST, biggestLens, build, categoriesIn, commonNameWord, featuredApp, level, regionsBySize, requireShape, resourceRegion } from "../lib/pick.ts";
import { COMPACT_ROWS, launch, openFilters, ready, resultList, seedStorage, sheet, sortButton, sortSheet } from "../lib/app.ts";

const L = level();
const LENS = biggestLens();
const APP = featuredApp();
const WORD = commonNameWord();
const GUIDES = resourceRegion();

const VIEWS: { name: string; hash: string; sheet?: boolean }[] = [
  { name: "Explore", hash: "#/" },
  { name: "a region", hash: `#/region/${L.regionId}` },
  { name: "a category", hash: `#/cat/${L.category.id}` },
  { name: "a lens", hash: `#/lens/${LENS.key}` },
  { name: "Search, idle", hash: "#/search" },
  { name: "Search with text and a filter", hash: `#/search?q=${WORD}&f=${LENS.key}` },
  { name: "Saved, empty", hash: "#/saved" },
  { name: "Settings", hash: "#/settings" },
  { name: "About", hash: "#/about" },
  { name: "Sources and licenses", hash: "#/about/sources" },
  { name: "Icon credits", hash: "#/about/icons" },
  { name: "Data health", hash: "#/about/health" },
  { name: "Third-party licenses", hash: "#/about/notices" },
  ...(GUIDES ? [{ name: "a list of guides and sites", hash: `#/region/${GUIDES.id}` }] : []),
  { name: "not found", hash: "#/nowhere" },
  { name: "an entry that is not there", hash: "#/app/org.example.missing" },
  { name: "the app sheet", hash: sheetHash(APP), sheet: true },
];

/** Elements whose box extends past the right edge of the viewport, outside any horizontal scroller (chip strips scroll on purpose). */
/** What reaches past the window's right edge once nothing is moving: a panel sliding in is past it by design until it lands. */
async function overflowing(page: Page): Promise<string[]> {
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== "running"));
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out: string[] = [];
    if (document.documentElement.scrollWidth > width) out.push(`document scrollWidth ${document.documentElement.scrollWidth} > ${width}`);
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.right <= width + 1) continue;
      let scroller: HTMLElement | null = element.parentElement;
      let clipped = false;
      while (scroller && scroller !== document.body) {
        const style = getComputedStyle(scroller);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          clipped = true;
          break;
        }
        scroller = scroller.parentElement;
      }
      if (!clipped) out.push(`${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40)}" right=${Math.round(rect.right)}`);
    }
    return out.slice(0, 8);
  });
}

/**
 * What is wrong with the rows on screen: a name cut on its single line, a
 * badge that is not whole, a row whose parts are not in the one order every
 * row has, or a row of another height.
 */
async function rowFaults(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const rows = [...document.querySelectorAll<HTMLElement>("main [data-row]")].filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < innerHeight;
    });
    const heights = new Set(rows.map((row) => Math.round(row.getBoundingClientRect().height)));
    if (heights.size > 1) out.push(`rows of ${[...heights].join(" and ")} px`);
    for (const row of rows) {
      const id = row.dataset.row ?? "";
      const name = row.querySelector<HTMLElement>(".row-name");
      /* A compact row is one line of name by choice of the person who set it; a comfortable row gives a long name a second line. */
      if (name && !row.classList.contains("is-compact") && getComputedStyle(name).whiteSpace === "nowrap" && name.scrollWidth > name.clientWidth + 1) out.push(`${id}: the name is cut on one line`);
      const link = row.querySelector<HTMLElement>(".row-link");
      const edge = link ? link.getBoundingClientRect().right : innerWidth;
      for (const chip of row.querySelectorAll<HTMLElement>(".fchip")) {
        const rect = chip.getBoundingClientRect();
        const holder = chip.parentElement?.getBoundingClientRect();
        if (rect.right > edge + 0.5 || (holder && rect.right > holder.right + 0.5)) out.push(`${id}: the badge “${chip.textContent}” is cut`);
      }
      const body = row.querySelector(".row-body");
      const order = body ? [...body.children].map((part) => part.className.split(" ")[0]).join(" ") : "";
      if (!/^row-top(( row-url)?( row-sum)?( row-match)?( row-foot)?| row-line)$/.test(order)) out.push(`${id}: parts in the order ${order}`);
      const foot = row.querySelector<HTMLElement>(".row-foot");
      if (foot && foot.getBoundingClientRect().bottom > row.getBoundingClientRect().bottom + 0.5) out.push(`${id}: the last line runs out of the row`);
    }
    return out.slice(0, 10);
  });
}

for (const width of [320, 336, 360, 384, 412]) {
  test.describe(`${width} px wide`, () => {
    test.use({ viewport: { width, height: 688 } });
    const lists = [
      { name: "a lens", hash: `#/lens/${LENS.key}`, compact: false },
      { name: "a region", hash: `#/region/${L.regionId}`, compact: false },
      { name: "a search by GitHub downloads", hash: "#/search?sort=dl-github", compact: false },
      { name: "a lens in compact rows", hash: `#/lens/${LENS.key}`, compact: true },
    ];
    for (const list of lists) {
      test(`${list.name}: every row has one shape, names are not cut on one line and no badge is cut`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "phone", "phone widths");
        if (list.compact) await seedStorage(page, COMPACT_ROWS);
        await launch(page, list.hash);
        const faults: string[] = [];
        for (const top of [0, 2400, 7200]) {
          await page.evaluate((y) => window.scrollTo(0, y), top);
          await page.waitForTimeout(250);
          faults.push(...await rowFaults(page));
        }
        expect(faults).toEqual([]);
      });
    }
    for (const view of VIEWS) {
      test(`${view.name}: nothing overflows horizontally`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== "phone", "phone widths");
        await launch(page, view.hash);
        if (view.sheet) await expect(sheet(page)).toBeVisible();
        await page.waitForTimeout(300);
        expect(await overflowing(page)).toEqual([]);
      });
    }
    test("Explore's map shows every region's name and count whole, on a short screen too, with and without the introduction", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "phone widths");
      const faults: string[] = [];
      /* 595 px is Firefox's height on the reference phone with its toolbar showing, where the map is at its least. */
      for (const intro of [true, false]) {
        if (!intro) await seedStorage(page, { "droid-atlas:v1:settings": JSON.stringify({ v: 1, theme: "system", density: "comfortable", resume: true, introSeen: true }) });
        for (const height of [688, 595]) {
          await page.setViewportSize({ width, height });
          await launch(page, "#/");
          await expect(page.getByRole("complementary", { name: /^What / })).toHaveCount(intro ? 1 : 0);
          await page.waitForTimeout(300);
          const cut = await page.locator(".mosaic .tile").evaluateAll((tiles) => tiles.flatMap((tile) => {
            const box = tile.getBoundingClientRect();
            return [...tile.querySelectorAll(".tile-name, .tile-count")].flatMap((part) => {
              const shown = part.getBoundingClientRect();
              return shown.bottom > box.bottom + 0.5 || shown.right > box.right + 0.5 ? [`“${part.textContent ?? ""}” in ${Math.round(box.width)}×${Math.round(box.height)}`] : [];
            });
          }));
          faults.push(...cut.map((line) => `${height} px tall, ${intro ? "with" : "without"} the introduction: ${line}`));
        }
      }
      expect(faults).toEqual([]);
    });
    test("Saved with apps: nothing overflows horizontally", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "phone widths");
      await seedStorage(page, { "droid-atlas:v1:saved": JSON.stringify({ v: 1, items: [{ id: APP.id, packages: [], repo: null, savedAt: 1 }] }) });
      await launch(page, "#/saved");
      expect(await overflowing(page)).toEqual([]);
    });
    test("compact rows with active filters: nothing overflows horizontally", async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "phone widths");
      await seedStorage(page, COMPACT_ROWS);
      await launch(page, `#/region/${L.regionId}?f=${LENS.key}`);
      expect(await overflowing(page)).toEqual([]);
    });
  });
}

test("the wide layout does not overflow either", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "wide layout");
  for (const view of VIEWS) {
    await page.goto(`/${view.hash}`);
    await ready(page);
    expect(await overflowing(page), view.name).toEqual([]);
  }
});

/** Total height of what stays fixed or stuck over the content once the list has scrolled. */
async function persistentChrome(page: Page): Promise<{ total: number; parts: string[] }> {
  return page.evaluate(() => {
    const height = innerHeight;
    const parts: { top: number; bottom: number; label: string }[] = [];
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const position = getComputedStyle(element).position;
      if (position !== "fixed" && position !== "sticky") continue;
      if (element.closest("dialog")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.height === 0 || rect.bottom <= 0 || rect.top >= height) continue;
      if (rect.height > height / 2) continue;
      parts.push({ top: Math.max(0, rect.top), bottom: Math.min(height, rect.bottom), label: `${element.tagName.toLowerCase()}[${element.getAttribute("aria-label") ?? element.getAttribute("role") ?? ""}] ${Math.round(rect.height)}px` });
    }
    parts.sort((a, b) => a.top - b.top);
    let total = 0;
    let reach = -1;
    for (const part of parts) {
      const start = Math.max(part.top, reach);
      if (part.bottom > start) total += part.bottom - start;
      reach = Math.max(reach, part.bottom);
    }
    return { total: Math.round(total), parts: parts.map((p) => p.label) };
  });
}

test.describe("persistent chrome at 384 × 688", () => {
  test.use({ viewport: { width: 384, height: 688 } });
  const big = regionsBySize()[0];
  const cases = [
    { name: "a region list, scrolled", hash: `#/region/${big?.id}` },
    { name: "a region list with active filters, scrolled", hash: `#/region/${big?.id}?f=${LENS.key}` },
    { name: "search with text and a filter, scrolled", hash: `#/search?q=${WORD}&f=${LENS.key}` },
    { name: "compact rows with active filters, scrolled", hash: `#/region/${big?.id}?f=${LENS.key}`, compact: true },
  ];
  for (const item of cases) {
    test(`${item.name}: under a fifth of the height (137.6 px)`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "phone size");
      requireShape((big?.size ?? 0) >= TALL_LIST, `region with ${TALL_LIST} entries`);
      if (item.compact) await seedStorage(page, COMPACT_ROWS);
      await launch(page, item.hash);
      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.waitForTimeout(400);
      const chrome = await persistentChrome(page);
      testInfo.annotations.push({ type: "persistent chrome", description: `${chrome.total}px: ${chrome.parts.join(", ")}` });
      expect(chrome.total, chrome.parts.join(", ")).toBeLessThan(688 / 5);
    });
  }
});

/**
 * Controls smaller than 44 × 44 CSS px (ARCHITECTURE.md § Accessibility: "44 px
 * targets"). Links inside running text are exempt, as WCAG 2.5.8 exempts
 * inline targets.
 */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const modal = [...document.querySelectorAll("dialog[open]")].find((dialog) => dialog.matches(":modal"));
    const controls = (modal ?? document).querySelectorAll<HTMLElement>("a[href], button, select, input:not([type=hidden]), summary, [role=button], [tabindex='0']");
    /* A link whose ::after is stretched over a positioned ancestor (the map tiles) is as large as that ancestor. */
    const hitBox = (element: HTMLElement): DOMRect => {
      const after = getComputedStyle(element, "::after");
      if (after.content !== "none" && after.position === "absolute" && element.offsetParent instanceof HTMLElement && element.offsetParent !== document.body) {
        return element.offsetParent.getBoundingClientRect();
      }
      return element.getBoundingClientRect();
    };
    for (const element of controls) {
      if (element.closest("[inert]") || element.matches(":disabled")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || rect.bottom < 0 || rect.top > innerHeight) continue;
      if (element.tagName === "A" && element.parentElement && /^(P|DD|BLOCKQUOTE|LI|SPAN)$/.test(element.parentElement.tagName) && [...element.parentElement.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim())) continue;
      const target = element.tagName === "INPUT" && (element as HTMLInputElement).type === "radio" ? element.closest("label") ?? element : element;
      const box = hitBox(target);
      if (Math.min(box.width, box.height) < 44 - 0.5) {
        const name = (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        out.push(`${element.tagName.toLowerCase()} “${name}” ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
    }
    return [...new Set(out)];
  });
}

test.describe("touch targets at 384 × 688", () => {
  test.use({ viewport: { width: 384, height: 688 } });
  for (const view of [...VIEWS, { name: "the filters", hash: `#/region/${L.regionId}`, panel: true }, { name: "the sort and view sheet", hash: `#/region/${L.regionId}`, sort: true }]) {
    test(`${view.name}: every control on screen is at least 44 px in both directions`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "phone size");
      await launch(page, view.hash);
      if ("sheet" in view && view.sheet) await expect(sheet(page)).toBeVisible();
      if ("panel" in view) await openFilters(page);
      if ("sort" in view) {
        await sortButton(page).click();
        await expect(sortSheet(page)).toBeVisible();
      }
      await page.waitForTimeout(300);
      expect(await smallTargets(page)).toEqual([]);
    });
  }
});

test.describe("first result position at 384 × 688", () => {
  test.use({ viewport: { width: 384, height: 688 } });
  const cases = [
    { name: "a region", hash: `#/region/${L.regionId}` },
    { name: "a category", hash: `#/cat/${L.category.id}` },
    { name: "a lens", hash: `#/lens/${LENS.key}` },
    { name: "search with text", hash: `#/search?q=${WORD}` },
  ];
  for (const item of cases) {
    test(`${item.name}: the first result is fully on the first screen, above the bottom bar`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "phone size");
      await launch(page, item.hash);
      const first = resultList(page).getByRole("listitem").first();
      const box = await first.boundingBox();
      const nav = await page.getByRole("navigation", { name: "Primary" }).boundingBox();
      if (!box || !nav) throw new Error("no row or no bottom bar");
      testInfo.annotations.push({ type: "first result", description: `top ${Math.round(box.y)} px, bottom ${Math.round(box.y + box.height)} px; bottom bar from ${Math.round(nav.y)} px` });
      expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
    });
  }
});

test("the interface does not select under a long press; what a person copies does", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "a long press is the phone's");
  const selectable = (locator: ReturnType<Page["locator"]>): Promise<string> => locator.first().evaluate((element) => getComputedStyle(element).userSelect);
  await launch(page, `#/cat/${L.category.id}`);
  for (const [what, locator] of [["a list's title", page.locator(".place-head h1")], ["the bottom bar", page.locator(".nav")], ["a chip", page.locator(".chip, .tchip")]] as const) {
    expect(await selectable(locator), what).toBe("none");
  }
  await launch(page, sheetHash(APP));
  await expect(sheet(page)).toBeVisible();
  for (const [what, locator] of [["the app's name", page.locator("#sheet-title")], ["its summary or description", sheet(page).locator("[data-sheet-scroll] p").filter({ hasText: /\w{4}/ })], ["its package id", sheet(page).locator("[data-sheet-scroll] code")]] as const) {
    if (!(await locator.count())) continue;
    expect(await selectable(locator), what).not.toBe("none");
  }
});

test.describe("a label that does not fit gives way whole", () => {
  for (const width of [320, 336, 384]) {
    test(`at ${width} px Explore's header and the sheet's main button cut no word`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "phone size");
      await page.setViewportSize({ width, height: 688 });
      await launch(page, "#/");
      const header = await page.locator(".home-meta").evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [...element.children].map((part) => {
          const rect = part.getBoundingClientRect();
          const shown = rect.top < box.bottom - 1;
          return { text: part.textContent ?? "", shown, whole: rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5 };
        });
      });
      expect(header[0], "the count of entries is always shown").toMatchObject({ shown: true, whole: true });
      expect(header.filter((part) => part.shown && !part.whole), "a count that does not fit is left out, not cut").toEqual([]);

      const longest = [...build.apps]
        .filter((app) => app.listings.some((listing) => listing.kind === "app") && app.atlas.channels.length > 0 && app.atlas.channels.every((channel) => channel.type === "play" && channel.listed !== false))
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      requireShape(Boolean(longest), "app whose only store is Google Play, the longest label the main button has");
      if (!longest) return;
      await launch(page, sheetHash(longest));
      const label = await sheet(page).locator(".sheet-foot .btn-primary").evaluate((button) => {
        const line = button.querySelector<HTMLElement>(".btn-main");
        const what = button.querySelector<HTMLElement>(".btn-what");
        if (!line || !what) return null;
        const box = line.getBoundingClientRect();
        const rect = what.getBoundingClientRect();
        return { text: what.textContent, onTheLine: rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1, whole: what.scrollWidth <= what.clientWidth + 1 };
      });
      expect(label, "where the button leads is on it, whole, with or without the verb").toEqual({ text: "Google Play", onTheLine: true, whole: true });
    });

    test(`at ${width} px the app's own sentences never break inside a product's name, and a size stays with its unit`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "phone size");
      await page.setViewportSize({ width, height: 688 });
      for (const hash of ["#/about", "#/about/sources"]) {
        await launch(page, hash);
        const names = await page.getByRole("main").evaluate((main) => [...main.querySelectorAll(".whole")].map((name) => ({
          text: name.textContent ?? "",
          lines: new Set([...name.getClientRects()].map((rect) => Math.round(rect.top))).size,
        })));
        expect(names.filter((name) => /F-Droid/.test(name.text)).length, `${hash}: F-Droid is named and kept whole`).toBeGreaterThan(0);
        expect(names.filter((name) => name.lines > 1).map((name) => name.text), `${hash}: no name on two lines`).toEqual([]);
      }
      await launch(page, "#/settings");
      const lead = await page.getByRole("main").locator(".settings-lead").textContent();
      if (lead && /B stored/.test(lead)) expect(lead, "a size is joined to its unit").toMatch(/\d [kM]?B stored/);
    });

    test(`at ${width} px a short value in the sheet's Details stays whole beside the sources that state it`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "phone size");
      await page.setViewportSize({ width, height: 688 });
      await launch(page, sheetHash(APP));
      const facts = sheet(page).locator("dl.facts");
      await expect(facts).toBeAttached();
      const lines = await facts.evaluate((list) => [...list.querySelectorAll<HTMLElement>(".fact-line.has-source")].map((line) => {
        const value = line.querySelector<HTMLElement>(".fact-value span[dir]");
        const words = document.createRange();
        if (value) words.selectNodeContents(value);
        return {
          value: value?.textContent ?? "",
          lines: value ? new Set([...words.getClientRects()].map((rect) => Math.round(rect.top))).size : 0,
          brokenSources: [...line.querySelectorAll(".fact-source .whole")].filter((name) => name.getClientRects().length > 1).map((name) => name.textContent ?? ""),
        };
      }));
      requireShape(lines.length > 0, "Details line naming sources of its own");
      expect(lines.filter((line) => line.value.length <= 20 && line.lines > 1).map((line) => line.value), "a short value is on one line").toEqual([]);
      expect(lines.flatMap((line) => line.brokenSources), "a source's name is never broken").toEqual([]);
    });
  }
});

test("on a phone a region's categories that do not fit open from a first chip into a block of every name, and close from where they opened", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "phone widths");
  const [region] = regionsBySize().filter((item) => categoriesIn(item.id).length >= 10);
  requireShape(Boolean(region), "a region with ten categories or more");
  if (!region) return;
  const total = categoriesIn(region.id).length;
  await launch(page, `#/region/${region.id}`);
  const strip = page.getByRole("navigation", { name: `Categories in ${region.name}` });
  const all = strip.getByRole("button", { name: `All ${total}` });
  await expect(all).toBeInViewport();
  const where = await all.boundingBox();

  await all.click();
  const links = strip.getByRole("link");
  await expect(links).toHaveCount(total);
  for (const link of await links.all()) await expect(link).toBeInViewport();
  const fewer = strip.getByRole("button", { name: "Fewer" });
  expect((await fewer.boundingBox())?.y).toBe(where?.y);

  await fewer.click();
  await expect(strip.getByRole("button", { name: `All ${total}` })).toBeInViewport();
  const tops = await links.evaluateAll((items) => new Set(items.map((item) => Math.round(item.getBoundingClientRect().top))).size);
  expect(tops, "one line again").toBe(1);
});
