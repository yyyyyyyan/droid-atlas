/**
 * Droid Atlas files every app in one category of its own. A chip, a tile, a
 * header and the sheet's place line name that category, in US English, once;
 * the source's own category stays in the sheet's sources block, quoted as the
 * source wrote it. An app from a source's catch-all is shown where it was
 * placed. A category with no app appears nowhere. A category address or a
 * pin of the build before leads to that category's successor, or to its
 * region when it has no single one.
 */

import { expect, test } from "../lib/fixtures.ts";
import { build, categoriesIn, regionName, regionsBySize, requireShape, resourceRegion, SYNTHETIC } from "../lib/pick.ts";
import { countStatus, escapeRegExp, hashOf, launch, openFilters, parseCount, ready, seedStorage, sheet } from "../lib/app.ts";
import type { Locator, Page } from "@playwright/test";
import { countMatches, fold } from "../lib/catalog.ts";
import type { App, Category } from "../lib/catalog.ts";

const GUIDES = resourceRegion();
const REGIONS = regionsBySize().filter((region) => region.id !== GUIDES?.id);
const NOT_US = /isation|isations|colour|centre|favourite|catalogue|licence|programme/i;

/** The categories are the same in both layouts, so most of this runs once, at phone size. */
function phoneOnly(projectName: string): void {
  test.skip(projectName !== "phone", "the categories are the same in both layouts; run once");
}

/** An app whose every listing sits in a source's catch-all: it is filed only by a placement. */
function placedFromCatchAll(): App | undefined {
  const linkora = build.byId.get("com.sakethh.linkora");
  if (linkora) return linkora;
  return build.apps.find((app) => app.listings.length > 0 && app.listings.every((listing) => build.sourceCategories.get(listing.category)?.category === null));
}

/**
 * An app whose source names its category in words that stand neither in the
 * name of the category Droid Atlas files it under nor in that category's
 * region: only then would the source's name on the place line be a label.
 */
function renamedBySource(): { app: App; sourceName: string } | undefined {
  const preferred = build.apps.find((app) => app.listings.some((listing) => build.sourceCategories.get(listing.category)?.name === "Synchronisation"));
  for (const app of preferred ? [preferred, ...build.apps] : build.apps) {
    const listing = app.listings[0];
    const source = listing ? build.sourceCategories.get(listing.category) : undefined;
    const own = build.categories.get(app.atlas.category);
    if (!source || !own || listing?.kind !== "app") continue;
    if (!fold(`${own.name} ${regionName(own.region)}`).includes(fold(source.name))) return { app, sourceName: source.name };
  }
  return undefined;
}

test("in every region, no category name stands twice among the chips, no chip has a separator, and every name is US English", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  for (const region of REGIONS) {
    await launch(page, `#/region/${region.id}`);
    const strip = page.getByRole("navigation", { name: `Categories in ${region.name}` });
    if (await strip.count() === 0) continue;
    const names = await strip.locator(".chip-name").evaluateAll((spans) => spans.map((span) => span.textContent ?? ""));
    expect(names, region.name).toEqual(categoriesIn(region.id).map((category) => category.name));
    for (const name of names) {
      expect(name, region.name).not.toContain(" · ");
      expect(name, region.name).not.toMatch(NOT_US);
      expect(name.toLowerCase(), `${name} repeats its region`).not.toBe(region.name.toLowerCase());
    }
    expect(new Set(names).size, `${region.name}: ${names.join(", ")}`).toBe(names.length);
  }
});

test("a category page's header is its own name over its region, both in US English", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  for (const region of REGIONS.slice(0, 6)) {
    const [category] = categoriesIn(region.id);
    if (!category) continue;
    await launch(page, `#/cat/${category.id}`);
    const head = page.getByRole("main").getByRole("heading", { level: 1 });
    await expect(head).toHaveText(category.name);
    await expect(head).not.toHaveText(NOT_US);
    await expect(page.getByRole("main").getByRole("link", { name: regionName(region.id), exact: true }).first()).toBeVisible();
  }
});

test("no Explore tile names a category twice or in a non-US spelling, where tiles are large enough to name them", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "a phone's tiles name no categories");
  await page.setViewportSize({ width: 1440, height: 900 });
  await launch(page, "#/");
  const lists = await page.locator(".tile").evaluateAll((tiles) => tiles.map((tile) => [...tile.querySelectorAll(".tile-cats .t")].map((name) => name.textContent ?? "")));
  expect(lists.filter((names) => names.length > 0).length).toBeGreaterThan(3);
  for (const names of lists) {
    expect(new Set(names).size, names.join(", ")).toBe(names.length);
    for (const name of names) expect(name).not.toMatch(NOT_US);
  }
});

test("an app from a source's catch-all is shown under its placement, and its sheet names that category and its region", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const app = placedFromCatchAll();
  requireShape(app !== undefined, "app listed only in a catch-all category");
  if (!app) return;
  const category = build.categories.get(app.atlas.category);
  if (!category) throw new Error(`${app.id} names no category`);
  if (app.id === "com.sakethh.linkora") {
    expect(category.region, "Linkora is not under System & Tweaks").not.toBe("system");
    expect(category.name).toBe("Bookmarks & Read Later");
  }
  await launch(page, `#/app/${app.id}`);
  await expect(sheet(page, app.name)).toBeVisible();
  await expect.poll(() => hashOf(page)).toBe(`#/cat/${category.id}?app=${app.id}`);
  const places = sheet(page).locator(".sheet-places a");
  await expect(places).toHaveText([category.name, regionName(category.region)]);
});

test("the source's own category is shown in the sources block, quoted in the source's spelling, and nowhere it would label the app", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const found = renamedBySource();
  requireShape(found !== undefined, "app whose source names its category differently");
  if (!found) return;
  const { app, sourceName } = found;
  const own = build.categories.get(app.atlas.category);
  await launch(page, `#/app/${app.id}`);
  await expect(sheet(page, app.name)).toBeVisible();
  await sheet(page).locator("summary", { hasText: "Sources and credits" }).click();
  const facts = sheet(page).locator(".listing-facts").first();
  await expect(facts.locator("dt", { hasText: /^Category$/ })).toBeVisible();
  await expect(facts.locator("dd").first()).toContainText(`“${sourceName}”`);
  await expect(facts.locator("dd").first().getByRole("link")).toHaveCount(0);
  await expect(sheet(page).locator(".sheet-places")).not.toContainText(sourceName);
  await expect(sheet(page).locator(".sheet-places a").first()).toHaveText(own?.name ?? "");
});

test("a category that holds no app, an empty remainder above all, appears in no chip, filter or address", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const empty = [...build.categories.values()].filter((category) => !build.apps.some((app) => app.atlas.category === category.id));
  requireShape(empty.length > 0, "category with no app");
  for (const category of empty) {
    await launch(page, `#/region/${category.region}`);
    const strip = page.getByRole("navigation", { name: `Categories in ${regionName(category.region)}` });
    if (await strip.count() > 0) await expect(strip.getByRole("link", { name: new RegExp(`^${escapeRegExp(category.name)} `) })).toHaveCount(0);
    await launch(page, `#/search?f=c:${category.id}`);
    await expect(page.getByRole("button", { name: new RegExp(`^${escapeRegExp(category.name)}\\s*, remove filter$`) })).toHaveCount(0);
    await launch(page, `#/cat/${category.id}`);
    await expect(page.getByRole("main").getByRole("heading", { level: 1, name: category.name, exact: true })).toHaveCount(0);
  }
});

/** The wordings of the source notes that fit a category's page: every app on it is in a source category carrying that wording. */
function fittingNotes(categoryId: string): string[] {
  const noted = [...build.sourceCategories.values()].filter((source) => source.category === categoryId && source.note);
  const apps = build.apps.filter((app) => app.atlas.category === categoryId);
  const wordings = [...new Set(noted.map((source) => `${source.source} ${source.note}`))];
  return wordings
    .filter((wording) => {
      const ids = new Set(noted.filter((source) => `${source.source} ${source.note}` === wording).map((source) => source.id));
      return apps.every((app) => app.listings.some((listing) => ids.has(listing.category)));
    })
    .map((wording) => noted.find((source) => `${source.source} ${source.note}` === wording)?.note ?? "");
}

test("a source's note stands on a category's page once, and only where every app on the page is in the list the note speaks of", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const noted = [...new Set([...build.sourceCategories.values()].filter((source) => source.note && source.category).map((source) => source.category ?? ""))]
    .filter((id) => build.apps.some((app) => app.atlas.category === id));
  requireShape(noted.length > 0, "category with a source's note");
  for (const id of noted) {
    await launch(page, `#/cat/${id}`);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(build.categories.get(id)?.name ?? "");
    const shown = await page.locator(".head-note").evaluateAll((notes) => notes.map((note) => (note.firstChild?.textContent ?? "").trim()));
    expect(shown, id).toEqual(fittingNotes(id));
    expect(new Set(shown).size, `${id}: one note per wording`).toBe(shown.length);
  }
});

test("a category that holds apps of both catalogs offers the Catalog filter, and one of a single catalog does not", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const held = [...build.categories.values()].filter((category) => build.apps.some((app) => app.atlas.category === category.id && app.listings.some((listing) => listing.kind === "app")));
  const sourcesIn = (id: string): number => new Set(build.apps.filter((app) => app.atlas.category === id).flatMap((app) => [...app.sources])).size;
  const both = held.find((category) => sourcesIn(category.id) > 1);
  const single = held.find((category) => sourcesIn(category.id) === 1);
  requireShape(both !== undefined && single !== undefined, "category of both catalogs and one of a single catalog");
  if (!both || !single) return;
  await launch(page, `#/cat/${both.id}`);
  await expect((await openFilters(page)).getByRole("region", { name: /^Catalog/ })).toBeVisible();
  await launch(page, `#/cat/${single.id}`);
  await expect((await openFilters(page)).getByRole("region", { name: /^Catalog/ })).toHaveCount(0);
});

test("a search for a category's name puts its apps first, marks the name in each row's label and adds no line that repeats it", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const category = [build.categories.get("launchers"), ...build.categories.values()]
    .find((candidate) => candidate !== undefined && wordsOf(candidate.name).length === 1 && build.apps.filter((app) => app.atlas.category === candidate.id).length >= 3);
  requireShape(category !== undefined, "category named in one word with three apps");
  if (!category) return;
  const word = category.name.toLowerCase();
  await launch(page, `#/search?q=${encodeURIComponent(category.name)}`);
  const rows = page.getByRole("main").locator("[data-row]");
  await expect(rows.first()).toBeVisible();
  const first = await rows.evaluateAll((found) => found.slice(0, 5).map((row) => ({
    id: row.getAttribute("data-row") ?? "",
    label: row.querySelector(".row-meta-text")?.textContent ?? "",
    marked: row.querySelector(".row-meta-text mark")?.textContent ?? "",
    lines: [...row.querySelectorAll(".row-match-where")].map((line) => line.textContent ?? ""),
  })));
  expect(first.length).toBeGreaterThan(0);
  for (const row of first) {
    const app = build.byId.get(row.id);
    const named = (app?.name ?? "").toLowerCase().includes(word);
    expect(named || app?.atlas.category === category.id, `${row.id} is in ${category.name} or carries the word in its name`).toBe(true);
    expect(row.lines.filter((line) => line.startsWith("Category:")), `${row.id}: no line repeats the label`).toEqual([]);
    if (app?.atlas.category === category.id) expect(row.marked.toLowerCase(), `${row.id}: “${row.label}” is marked`).toBe(word);
  }
});

test("the interface's spelling of a source's category name finds what the source's spelling finds: the whole category", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const source = [...build.sourceCategories.values()].find((candidate) => candidate.category !== null && /isation/.test(candidate.name));
  requireShape(source !== undefined, "source category spelled the British way");
  if (!source) return;
  const inCategory = build.apps.filter((app) => app.atlas.category === source.category).length;
  const counts: number[] = [];
  for (const query of [source.name, source.name.replace(/isation/g, "ization")]) {
    await launch(page, `#/search?q=${encodeURIComponent(query)}`);
    await expect(countStatus(page)).toHaveText(/ of /);
    counts.push(parseCount(await countStatus(page).innerText()));
  }
  expect(counts[1], `“${source.name}” in US spelling`).toBe(counts[0]);
  expect(counts[0]).toBeGreaterThanOrEqual(inCategory);
});

interface Named { category: Category; size: number; own: boolean; by: string | null }

const wordsOf = (text: string): string[] => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The categories a search names, read from the catalog parts: those that
 * hold an entry and whose names (its own, and the sources' names it takes
 * in, in either spelling) have a word beginning with each word typed. The
 * one named in full comes first, then those found by their own name, then
 * the larger.
 */
function categoriesNamedBy(text: string): Named[] {
  const typed = wordsOf(text);
  const begun = (names: readonly string[]): boolean => typed.every((word) => names.some((name) => wordsOf(name).some((part) => part.startsWith(word))));
  const found: Named[] = [];
  for (const category of build.categories.values()) {
    const size = build.apps.filter((app) => app.atlas.category === category.id).length;
    const taken = [...build.sourceCategories.values()].filter((source) => source.category === category.id).map((source) => source.name);
    if (size === 0 || !begun([category.name, ...taken, ...taken.map((name) => name.replace(/isation/g, "ization"))])) continue;
    const own = begun([category.name]);
    found.push({ category, size, own, by: own ? null : taken.find((name) => begun([name, name.replace(/isation/g, "ization")])) ?? null });
  }
  const rank = (named: Named): number => (fold(named.category.name) === fold(text) ? 0 : named.own ? 1 : 2);
  return found.sort((a, b) => rank(a) - rank(b) || b.size - a.size);
}

function categoryRows(page: Page): Locator {
  return page.getByRole("navigation", { name: "Categories this search names" }).getByRole("link");
}

const countOf = (named: Named): string => `${named.size} ${named.category.region === GUIDES?.id ? (named.size === 1 ? "link" : "links") : named.size === 1 ? "app" : "apps"}`;

test("a search that names one category opens with one row for it: its name, its region and how many apps it holds, reached from the field by keyboard and leading to the category", async ({ page }) => {
  const one = [...build.categories.values()].map((category) => categoriesNamedBy(category.name)).find((named) => named.length === 1 && named[0]?.own && named[0].size > 1)?.[0];
  requireShape(one !== undefined, "category whose name names no other");
  if (!one) return;
  await launch(page, `#/search?q=${encodeURIComponent(one.category.name)}`);
  const rows = categoryRows(page);
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText(one.category.name);
  await expect(rows).toContainText(`Category in ${regionName(one.category.region)} · ${countOf(one)}`);
  await expect(rows.locator("xpath=ancestor::*[@data-row]"), "the row is no app's row").toHaveCount(0);
  expect(parseCount(await countStatus(page).innerText()), "the count is of apps alone").toBe(countMatches(build, one.category.name, []));
  await page.getByRole("searchbox", { name: "Search the catalog" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => hashOf(page)).toBe(`#/cat/${one.category.id}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(one.category.name);
});

test("a word several categories share shows at most three of them, the larger first, each leading to its own category", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const shared = [...new Set([...build.categories.values()].flatMap((category) => wordsOf(category.name)))]
    .filter((word) => word.length >= 3)
    .map((word) => ({ word, named: categoriesNamedBy(word) }))
    .sort((a, b) => b.named.length - a.named.length)[0];
  requireShape(shared !== undefined && shared.named.length >= 2, "word that two categories share");
  if (!shared || shared.named.length < 2) return;
  await launch(page, `#/search?q=${encodeURIComponent(shared.word)}`);
  const rows = categoryRows(page);
  const expected = shared.named.slice(0, 3);
  await expect(rows).toHaveCount(expected.length);
  const shown = await rows.evaluateAll((links) => links.map((link) => ({ id: (link.getAttribute("href") ?? "").replace("#/cat/", ""), text: link.textContent ?? "" })));
  expect(shown.map((row) => Number(/· ([\d,]+) /.exec(row.text)?.[1]?.replace(/,/g, ""))), `“${shared.word}”: the larger first`).toEqual(expected.map((named) => named.size));
  for (const row of shown) {
    const named = shared.named.find((candidate) => candidate.category.id === row.id);
    expect(named, `${row.id} is named by “${shared.word}”`).toBeDefined();
    if (named) expect(row.text).toContain(named.category.name);
  }
});

test("a word that only occurs in apps' summaries or names brings no category row", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const inSummary = build.apps.flatMap((app) => wordsOf(app.summary ?? "")).find((word) => word.length >= 5 && categoriesNamedBy(word).length === 0);
  const inName = build.apps.flatMap((app) => wordsOf(app.name)).find((word) => word.length >= 5 && word !== inSummary && categoriesNamedBy(word).length === 0);
  requireShape(inSummary !== undefined && inName !== undefined, "summary word and name word that no category carries");
  for (const word of [inSummary, inName]) {
    if (!word) continue;
    await launch(page, `#/search?q=${encodeURIComponent(word)}`);
    await expect(page.getByRole("main").locator("[data-row]").first(), `“${word}” finds apps`).toBeVisible();
    await expect(categoryRows(page), `“${word}” names no category`).toHaveCount(0);
  }
});

test("a source's name for a category brings the category's row in either spelling, and the row says which name it answers to", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const source = [...build.sourceCategories.values()].find((candidate) => /isation/.test(candidate.name) && categoriesNamedBy(candidate.name).some((named) => named.category.id === candidate.category && named.by === candidate.name));
  requireShape(source !== undefined, "category that takes in a source's name spelled the British way");
  if (!source) return;
  for (const query of [source.name, source.name.replace(/isation/g, "ization")]) {
    const expected = categoriesNamedBy(query).slice(0, 3);
    await launch(page, `#/search?q=${encodeURIComponent(query)}`);
    const rows = categoryRows(page);
    await expect(rows, `“${query}”`).toHaveCount(expected.length);
    const row = rows.filter({ hasText: build.categories.get(source.category ?? "")?.name ?? "" });
    await expect(row, `“${query}”`).toContainText(`includes “${source.name}”`);
    expect(hashOf(page)).toContain("#/search");
    await expect(row).toHaveAttribute("href", `#/cat/${source.category}`);
  }
});

/** Where an address of the build before leads, by the rule of UX-116, read from the catalog parts. */
function successorOf(sourceId: string): string {
  const source = build.sourceCategories.get(sourceId);
  if (!source) throw new Error(`no source category ${sourceId}`);
  const held = source.category !== null && build.apps.some((app) => app.atlas.category === source.category);
  return held ? `#/cat/${source.category}` : `#/region/${source.region}`;
}

/**
 * The addresses the build before gave same-named categories of one region,
 * which it showed as one (read from that build's data), and where each leads.
 */
const MERGED_BEFORE: Record<string, string> = {
  "automation/automation": "#/cat/automation-tools",
  "work/productivity": "#/region/work",
  "automation/terminals": "#/cat/terminals-linux",
  "automation/ai-agents": "#/cat/ai-agents",
  "world/android-auto": "#/cat/android-auto",
  "media/audio": "#/cat/sound-volume",
  "personal/customization": "#/cat/system-ui-gestures",
  "automation/development-utilities": "#/cat/developer-tools",
  "system/display-management": "#/cat/display-tools",
  "files/file-management": "#/cat/file-managers",
  "games/games": "#/cat/game-tools",
  "personal/input-methods": "#/cat/buttons-controllers",
  "privacy/network": "#/cat/network-tools",
  "system/power-management": "#/cat/battery-power",
  "system/quick-settings": "#/cat/quick-settings-tiles",
  "apps/software-management": "#/cat/app-managers",
  "device/samsung-oneui": "#/cat/samsung",
  "device/miui": "#/cat/xiaomi",
};

test("every category address of the build before leads to a page: its successor, or its region when it has no single one", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const before = [
    ...[...build.sourceCategories.keys()].map((id) => [id, successorOf(id)] as const),
    ...(SYNTHETIC ? [] : Object.entries(MERGED_BEFORE)),
  ];
  expect(before.length).toBeGreaterThan(3);
  await launch(page, "#/");
  for (const [id, target] of before) {
    await page.evaluate((hash) => { location.hash = hash; }, `#/cat/${id}`);
    await expect.poll(() => hashOf(page), { message: `#/cat/${id}` }).toBe(target);
    await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Not found" })).toHaveCount(0);
  }
});

test("a window reloaded on an old category address opens its successor, and one with a sheet open opens that app's category with the sheet", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const sources = [...build.sourceCategories.values()];
  const mapped = sources.find((source) => successorOf(source.id).startsWith("#/cat/"));
  const catchAll = sources.find((source) => source.category === null);
  requireShape(mapped !== undefined && catchAll !== undefined, "mapped source category and a catch-all");
  if (!mapped || !catchAll) return;
  await launch(page, `#/cat/${mapped.id}?sort=name`);
  await expect.poll(() => hashOf(page)).toBe(`${successorOf(mapped.id)}?sort=name`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(build.categories.get(mapped.category ?? "")?.name ?? "");

  await launch(page, `#/cat/${catchAll.id}`);
  await expect.poll(() => hashOf(page)).toBe(`#/region/${catchAll.region}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(regionName(catchAll.region));

  const app = build.apps.find((candidate) => candidate.listings.some((listing) => listing.category === catchAll.id) && candidate.listings.some((listing) => listing.kind === "app"));
  if (!app) throw new Error(`no app in ${catchAll.id}`);
  const own = build.categories.get(app.atlas.category);
  await launch(page, `#/cat/${catchAll.id}?app=${app.id}`);
  await expect.poll(() => hashOf(page)).toBe(`#/cat/${app.atlas.category}?app=${app.id}`);
  await expect(sheet(page, app.name)).toBeVisible();
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(own?.name ?? "");
  await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toHaveCount(0);
});

test("a pin stored on an old category filters by its successor under the successor's name; a part that has none is dropped from the pin and from its name", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  const sources = [...build.sourceCategories.values()];
  const mapped = sources.find((source) => successorOf(source.id).startsWith("#/cat/"));
  const catchAll = sources.find((source) => source.category === null);
  requireShape(mapped !== undefined && catchAll !== undefined, "mapped source category and a catch-all");
  if (!mapped || !catchAll) return;
  const successor = build.categories.get(mapped.category ?? "");
  if (!successor) throw new Error("no successor");
  const inSuccessor = build.apps.filter((app) => app.atlas.category === successor.id).length;
  const inRegion = build.apps.filter((app) => app.regions.has(catchAll.region)).length;
  const pins = { v: 1, items: [
    { id: "a", name: `Old name of ${mapped.name}`, q: "", f: `c:${mapped.id}`, sort: "" },
    { id: "b", name: `${regionName(catchAll.region)} · ${catchAll.name}`, q: "", f: `r:${catchAll.region},c:${catchAll.id}`, sort: "" },
    { id: "c", name: `Only ${catchAll.name}`, q: "", f: `c:${catchAll.id}`, sort: "" },
  ] };
  await seedStorage(page, { "droid-atlas:v1:pins": JSON.stringify(pins) });
  await launch(page, "#/search");
  const list = page.getByRole("region", { name: "Pins" });
  await expect(list.locator(".pin-name")).toHaveText([successor.name, regionName(catchAll.region)]);
  await expect(list.locator(".pin-count")).toHaveText([String(inSuccessor), String(inRegion)]);
  await list.getByRole("button", { name: new RegExp(`^${escapeRegExp(successor.name)}`) }).click();
  await expect.poll(() => new URLSearchParams(hashOf(page).split("?")[1] ?? "").get("f")).toBe(`c:${successor.id}`);
});

/**
 * The nine categories the owner renamed or moved, as the build of catalog
 * `c/9b329c7a00991b27` addressed them, with the address, name and region each
 * has now.
 */
const RENAMED_BEFORE: { before: string; now: string; name: string; region: string }[] = [
  { before: "music-tools", now: "music-making", name: "Music Making", region: "media" },
  { before: "audio-tools", now: "sound-volume", name: "Sound & Volume", region: "media" },
  { before: "ebook-pdf-readers", now: "ebook-document-readers", name: "E-book & Document Readers", region: "work" },
  { before: "pdf-document-tools", now: "scanners-pdf-tools", name: "Scanners & PDF Tools", region: "work" },
  { before: "movies-tv", now: "movie-tv-trackers", name: "Movie & TV Trackers", region: "media" },
  { before: "video-front-ends", now: "video-streaming-clients", name: "Video Streaming Clients", region: "media" },
  { before: "interface-tweaks", now: "system-ui-gestures", name: "System UI & Gestures", region: "personal" },
  { before: "android-tv", now: "android-tv", name: "Android TV", region: "device" },
  { before: "android-auto", now: "android-auto", name: "Android Auto", region: "device" },
];

test("each renamed or moved category's address of the build before opens it under its name and region now, with a sheet open too", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  test.skip(SYNTHETIC, "the addresses name the real catalog's categories");
  for (const { before, now, name, region } of RENAMED_BEFORE) {
    await launch(page, `#/cat/${before}?sort=name`);
    await expect.poll(() => hashOf(page), { message: `#/cat/${before}` }).toBe(`#/cat/${now}?sort=name`);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByRole("main").getByRole("link", { name: regionName(region), exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toHaveCount(0);
  }

  const app = build.byId.get("com.wirelessalien.android.moviedb");
  if (!app) throw new Error("the catalog lacks com.wirelessalien.android.moviedb");
  await launch(page, `#/cat/movies-tv?app=${app.id}`);
  await expect.poll(() => hashOf(page)).toBe(`#/cat/movie-tv-trackers?app=${app.id}`);
  await expect(sheet(page, app.name)).toBeVisible();
  await expect(sheet(page).locator(".sheet-places a")).toHaveText(["Movie & TV Trackers", "Media"]);

  const tv = build.apps.find((candidate) => candidate.atlas.category === "android-tv");
  if (!tv) throw new Error("no app in Android TV");
  await launch(page, `#/cat/android-tv?app=${tv.id}`);
  await expect(sheet(page, tv.name)).toBeVisible();
  await expect(sheet(page).locator(".sheet-places a")).toHaveText(["Android TV", "Device-specific"]);
});

test("a last place stored on a renamed category with a sheet open resumes on the category under its new name, sheet and all", async ({ context, page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  test.skip(SYNTHETIC, "the address names the real catalog's categories");
  const app = build.apps.find((candidate) => candidate.atlas.category === "system-ui-gestures");
  if (!app) throw new Error("no app in System UI & Gestures");
  const stored = { hash: `#/cat/interface-tweaks?app=${app.id}`, at: Date.now() - 60_000, memo: null, fallback: "#/region/personal" };
  await seedStorage(page, { "droid-atlas:v1:lastPlace:browser": JSON.stringify(stored) });
  await page.close();
  const resumed = await context.newPage();
  await resumed.goto("/");
  await ready(resumed);
  await expect.poll(() => hashOf(resumed)).toBe(`#/cat/system-ui-gestures?app=${app.id}`);
  await expect(sheet(resumed, app.name)).toBeVisible();
  await expect(sheet(resumed).locator(".sheet-places a")).toHaveText(["System UI & Gestures", "Personalization"]);
});

test("an app the owner regrouped still opens from its sheet address under the category it had, and names its new place", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  test.skip(SYNTHETIC, "the addresses name the real catalog's apps");
  const cases: { hash: string; id: string; place: [string, string] }[] = [
    { hash: "#/cat/battery-power?app=github-burakgon-stop", id: "github-burakgon-stop", place: ["App Freezers", "Apps & Installers"] },
    { hash: "#/cat/developer-tools?app=rikka.fpsmonitor", id: "rikka.fpsmonitor", place: ["Monitors & Task Managers", "System & Tweaks"] },
    { hash: "#/cat/interface-tweaks?app=com.farmerbb.taskbar", id: "com.farmerbb.taskbar", place: ["Desktop Modes", "Personalization"] },
  ];
  for (const { hash, id, place } of cases) {
    const app = build.byId.get(id);
    if (!app) throw new Error(`the catalog lacks ${id}`);
    await launch(page, hash);
    await expect(sheet(page, app.name), hash).toBeVisible();
    await expect(sheet(page).locator(".sheet-places a"), hash).toHaveText(place);
    await expect(page.getByRole("heading", { level: 1, name: "Not found" })).toHaveCount(0);
  }
});

test("a pin stored on a renamed category by the build before shows the new name and filters by it", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  test.skip(SYNTHETIC, "the pins name the real catalog's categories");
  const count = (id: string): number => build.apps.filter((app) => app.atlas.category === id).length;
  const pins = { v: 1, items: [
    { id: "pin-music", name: "Music Tools", q: "", f: "c:music-tools", sort: "" },
    { id: "pin-tv", name: "Android TV", q: "", f: "c:android-tv", sort: "" },
  ] };
  await seedStorage(page, { "droid-atlas:v1:pins": JSON.stringify(pins) });
  await launch(page, "#/search");
  const list = page.getByRole("region", { name: "Pins" });
  await expect(list.locator(".pin-name")).toHaveText(["Music Making", "Android TV"]);
  await expect(list.locator(".pin-count")).toHaveText([String(count("music-making")), String(count("android-tv"))]);
  await list.getByRole("button", { name: /^Music Making/ }).click();
  await expect.poll(() => new URLSearchParams(hashOf(page).split("?")[1] ?? "").get("f")).toBe("c:music-making");
});

test("an address that never was a category is not found", async ({ page }, testInfo) => {
  phoneOnly(testInfo.project.name);
  await launch(page, "#/cat/nowhere/at-all");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
});
