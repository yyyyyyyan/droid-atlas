/**
 * Measures: a list sorted by one shows it on every row, and the sheet's
 * statistics name the source of each figure and the period it covers.
 * Download figures of different sources are never added, ranked against each
 * other or shown without their source: each source has a sort of its own.
 *
 * Every expected value is computed here from the catalog parts.
 */

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { sheetHash, type App, type DownloadStat } from "../lib/catalog.ts";
import { build, featuredApp, requireShape } from "../lib/pick.ts";
import { launch, renderedRowIds, resultList, sheet, sortButton, sortSheet } from "../lib/app.ts";

const ORIGINS = [
  { id: "fdroid", name: "F-Droid", meaning: "Requests for the app's APK files to F-Droid's own download servers" },
  { id: "izzy", name: "IzzyOnDroid", meaning: "Successful APK downloads from the IzzyOnDroid servers that report statistics" },
  { id: "github", name: "GitHub", meaning: "Downloads of the APK files attached to the latest GitHub release" },
] as const;

/** "Nov 7, 2026", and the forms a range of such dates takes. */
const AMERICAN_DATE = /[A-Z][a-z]{2} \d{1,2}(, \d{4})?( – ([A-Z][a-z]{2} )?\d{1,2})?, \d{4}/;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

function figure(app: App, origin: string): DownloadStat | undefined {
  return app.downloads.find((stat) => stat.origin === origin);
}

function row(page: Page, id: string): Locator {
  return resultList(page).locator(`[data-row="${id}"]`);
}

/** The apps of the rows on screen at the top of the list, in order. */
async function leadingApps(page: Page): Promise<App[]> {
  const ids = (await renderedRowIds(page)).slice(0, 6);
  return ids.map((id) => {
    const app = build.byId.get(id);
    if (!app) throw new Error(`row ${id} is not in the catalog`);
    return app;
  });
}

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "what a row and the sheet say does not depend on the layout; run once, at phone size");
  void page;
});

test.describe("a list sorted by a measure shows the measure on each row", () => {
  test("GitHub stars: the count on every row, most first", async ({ page }) => {
    requireShape(build.apps.filter((app) => app.github !== null).length > 6, "apps with GitHub facts");
    await launch(page, "#/search?sort=stars");
    const apps = await leadingApps(page);
    const stars = apps.map((app) => app.github?.stars ?? -1);
    expect(stars).toEqual([...stars].sort((a, b) => b - a));
    expect(stars[0]).toBe(Math.max(...build.apps.map((app) => app.github?.stars ?? -1)));
    for (const app of apps) {
      await expect(row(page, app.id).getByTitle(`${(app.github?.stars ?? 0).toLocaleString("en")} GitHub stars`, { exact: true })).toBeVisible();
    }
  });

  test("recently updated: when the newest release was, in words and as an American date", async ({ page }) => {
    await launch(page, "#/search?sort=release");
    for (const app of await leadingApps(page)) {
      const tag = row(page, app.id).getByTitle(/^Latest release /);
      await expect(tag).toBeVisible();
      expect((await tag.getAttribute("title")) ?? "").toMatch(AMERICAN_DATE);
      await expect(tag).toHaveText(/^(today|\d+(d|mo) ago|\d+(\.\d)?y ago)$/);
    }
  });

  test("sorted by name, a row carries no measure", async ({ page }) => {
    await launch(page, "#/search");
    await expect(resultList(page).getByTitle(/GitHub stars$|^Latest release |downloads from |^Added to the catalogs/)).toHaveCount(0);
  });

  for (const origin of ORIGINS) {
    test(`downloads from ${origin.name}: only its own figures, most first, each with its period`, async ({ page }) => {
      const counted = build.apps.filter((app) => figure(app, origin.id));
      requireShape(counted.length > 6, `download figures from ${origin.name}`);
      await launch(page, `#/search?sort=dl-${origin.id}`);
      await expect(sortButton(page)).toHaveAccessibleName(new RegExp(`${origin.name}`));
      const apps = await leadingApps(page);
      const counts = apps.map((app) => figure(app, origin.id)?.count ?? -1);
      expect(counts.every((count) => count > 0), "the leading rows all have a figure from this source").toBe(true);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      expect(counts[0]).toBe(Math.max(...counted.map((app) => figure(app, origin.id)?.count ?? 0)));
      for (const app of apps) {
        const tag = row(page, app.id).getByTitle(new RegExp(`^${(figure(app, origin.id)?.count ?? 0).toLocaleString("en")} downloads from ${origin.name}, `));
        await expect(tag).toBeVisible();
        const title = (await tag.getAttribute("title")) ?? "";
        expect(title).not.toMatch(ISO_DATE);
        expect(title, "the period the figure covers").toMatch(new RegExp(`(${AMERICAN_DATE.source})|running total`));
      }
    });
  }

  for (const origin of ORIGINS) {
    test(`downloads from ${origin.name}: the list says above its rows what period the figures cover, and nothing else`, async ({ page }) => {
      const counted = build.apps.filter((app) => figure(app, origin.id));
      requireShape(counted.length > 0, `download figures from ${origin.name}`);
      const source = build[origin.id].downloadSource;
      if (!source) throw new Error(`the ${origin.name} part names no publisher for its figures`);
      await launch(page, `#/search?sort=dl-${origin.id}`);
      await expect(resultList(page)).toBeVisible();
      const note = page.getByRole("main").locator("p.sort-note");
      if (source.newest === null) {
        await expect(note, "running totals: the line says what the date beside each figure is").toHaveText("Since each app’s latest release");
        for (const app of await leadingApps(page)) {
          const from = figure(app, origin.id)?.from;
          if (from) await expect(row(page, app.id).getByTitle(/ downloads from /)).toHaveText(/, since [A-Z][a-z]{2} (\d{1,2}|\d{4})$/);
        }
        return;
      }
      await expect(note).toBeVisible();
      const text = ((await note.textContent()) ?? "").trim();
      expect(text, "a period, as American dates, and no sentence").toMatch(new RegExp(`^(${AMERICAN_DATE.source})$`));
      expect(text).not.toMatch(ISO_DATE);
      for (const app of await leadingApps(page)) {
        if (figure(app, origin.id)) await expect(row(page, app.id).getByTitle(/ downloads from /), "a row shows the figure, not the word").toHaveText(/^[\d.,]+[kM]?$/);
      }
    });
  }

  test("a list in any other order carries no such note", async ({ page }) => {
    for (const sort of ["name", "stars", "release"]) {
      await launch(page, `#/search?sort=${sort}`);
      await expect(resultList(page)).toBeVisible();
      await expect(page.getByRole("main").locator("p.sort-note")).toHaveCount(0);
    }
  });

  test("the sort sheet offers downloads source by source and never a total, and explains nothing", async ({ page }) => {
    const offered = ORIGINS.filter((origin) => build.apps.some((app) => figure(app, origin.id)));
    await launch(page, "#/search");
    await sortButton(page).click();
    const choices = sortSheet(page).getByRole("radiogroup", { name: "Sort by" });
    for (const origin of ORIGINS) {
      const choice = choices.getByRole("radio", { name: new RegExp(`^${origin.name} downloads`) });
      if (offered.includes(origin)) await expect(choice).toHaveText(`${origin.name} downloads`);
      else await expect(choice).toHaveCount(0);
    }
    await expect(choices.getByRole("radio", { name: /total|all sources|combined|overall|most downloaded/i })).toHaveCount(0);
    const words = (await sortSheet(page).innerText()).split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
    expect(words, "the sheet is its choices and nothing else").toBeLessThan(32);
  });
});

test.describe("the sheet's statistics", () => {
  function mostCounted(): App | undefined {
    return [...build.apps].sort((a, b) => b.downloads.length - a.downloads.length || a.id.localeCompare(b.id))[0];
  }

  test("stars, last activity and the latest release of each source, with American dates", async ({ page }) => {
    const app = featuredApp();
    requireShape(app.github !== null, "featured entry with GitHub facts");
    await launch(page, sheetHash(app));
    const stats = sheet(page).getByRole("region", { name: "Statistics" });
    await expect(stats).toBeVisible();
    await expect(stats).toContainText(`GitHub stars${(app.github?.stars ?? 0).toLocaleString("en")}`);
    await expect(stats.getByText("Last commit · GitHub")).toBeVisible();
    const releases = stats.getByRole("list", { name: "Latest release" }).getByRole("listitem");
    const expected = [
      ...(app.fdroid ? [{ source: "F-Droid", version: app.fdroid.facts.version }] : []),
      ...(app.izzy ? [{ source: "IzzyOnDroid", version: app.izzy.facts.version }] : []),
      ...(app.github?.release ? [{ source: "GitHub", version: app.github.release.tag }] : []),
    ];
    await expect(releases).toHaveCount(expected.length);
    for (const [index, release] of expected.entries()) {
      const item = releases.nth(index);
      await expect(item).toContainText(release.source);
      if (release.version) await expect(item).toContainText(release.version);
      expect(await item.innerText()).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4}|date not stated/);
    }
    expect(await stats.innerText()).not.toMatch(ISO_DATE);
  });

  test("downloads: one line per source with its figure and its period and nothing else; what each counts is one tap away, said once; nothing added up", async ({ page }) => {
    const app = mostCounted();
    requireShape(Boolean(app && app.downloads.length > 0), "entry with a download figure");
    if (!app) return;
    await launch(page, sheetHash(app));
    const stats = sheet(page).getByRole("region", { name: "Statistics" });
    const lines = stats.getByRole("list", { name: "Downloads" }).getByRole("listitem");
    await expect(lines).toHaveCount(app.downloads.length);
    for (const [index, stat] of app.downloads.entries()) {
      const origin = ORIGINS.find((candidate) => candidate.id === stat.origin);
      if (!origin) throw new Error(`unknown origin ${stat.origin}`);
      const line = lines.nth(index);
      const runningTotal = build[origin.id].downloadSource?.newest === null;
      const period = stat.from === null && stat.to === null ? "running total" : runningTotal ? "since [A-Z][a-z]{2} \\d{1,2}, \\d{4}" : AMERICAN_DATE.source;
      const text = (await line.innerText()).replace(/\s+/g, " ").trim();
      expect(text, "source, figure, period, and nothing else").toMatch(new RegExp(`^${origin.name} ${stat.count.toLocaleString("en")} (${period})$`));
      expect(text).not.toMatch(ISO_DATE);
      await expect(line.getByRole("link")).toHaveCount(0);
    }
    for (const origin of ORIGINS) await expect(stats, "what a source counts is not repeated on every sheet").not.toContainText(origin.meaning);
    await expect(stats).not.toContainText(/compared|added together/);
    const sum = app.downloads.reduce((total, stat) => total + stat.count, 0);
    const text = await stats.innerText();
    if (app.downloads.length > 1) expect(text, "no sum of the sources' figures").not.toContain(sum.toLocaleString("en"));
    expect(text).not.toMatch(/\btotal downloads\b|\bin total\b|\bcombined\b|\boverall\b/i);

    const how = stats.getByRole("link", { name: "How these are counted" });
    await expect(how).toHaveCount(1);
    await how.click();
    await expect(page).toHaveURL(/#\/about\/sources\?at=facts$/);
    const facts = page.getByRole("main").getByRole("region", { name: "Facts and descriptions" });
    await expect(facts.getByRole("heading", { level: 2 })).toBeInViewport();
    for (const stat of app.downloads) {
      const origin = ORIGINS.find((candidate) => candidate.id === stat.origin);
      if (origin) await expect(facts).toContainText(`Downloads${origin.meaning}`);
    }
  });

  for (const width of [320, 336, 384]) {
    test(`at ${width} px no figure, version or date of the statistics is broken across lines`, async ({ page }) => {
      const app = [...build.apps].sort((a, b) => Math.max(0, ...b.downloads.map((stat) => stat.count)) - Math.max(0, ...a.downloads.map((stat) => stat.count)) || a.id.localeCompare(b.id))[0];
      requireShape(Boolean(app && app.downloads.length > 0), "entry with a download figure");
      if (!app) return;
      await page.setViewportSize({ width, height: 688 });
      await launch(page, sheetHash(app));
      const stats = sheet(page).getByRole("region", { name: "Statistics" });
      await expect(stats).toBeVisible();
      const broken = await stats.evaluate((section) => [...section.querySelectorAll<HTMLElement>(".stat-rows .stat-main, .stat-rows .stat-when")]
        .filter((element) => {
          const range = document.createRange();
          range.selectNodeContents(element.querySelector(".stat-note") ? element.firstChild ?? element : element);
          return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size > 1;
        })
        .map((element) => element.textContent ?? ""));
      expect(broken, "the date drops under a figure that has no room beside it; nothing is broken in two").toEqual([]);
    });
  }

  test("an entry no source counts has no Downloads block, and one with no figures at all no Statistics", async ({ page }) => {
    const uncounted = [...build.apps].sort((a, b) => a.id.localeCompare(b.id)).find((app) => app.downloads.length === 0 && app.github !== null);
    requireShape(Boolean(uncounted), "entry with GitHub facts and no download figure");
    if (!uncounted) return;
    await launch(page, sheetHash(uncounted));
    await expect(sheet(page).getByRole("region", { name: "Statistics" })).toBeVisible();
    await expect(sheet(page).getByRole("list", { name: "Downloads" })).toHaveCount(0);

    const bare = [...build.apps].sort((a, b) => a.id.localeCompare(b.id))
      .find((app) => app.downloads.length === 0 && app.github === null && !app.fdroid && !app.izzy && app.listings.some((listing) => listing.kind === "app"));
    if (!bare) return;
    await launch(page, sheetHash(bare));
    await expect(sheet(page, bare.name)).toBeVisible();
    await expect(sheet(page).getByRole("region", { name: "Statistics" })).toHaveCount(0);
  });
});
