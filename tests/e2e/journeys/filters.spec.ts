/**
 * Anti-features one by one. Each anti-feature the catalog carries is a filter
 * of its own, in two forms (flagged with it, or carried by an index without
 * it), with a plain name and counts that match a count made here from the
 * index parts. What a flag means is said in the sheet of an app that carries
 * it, not here. They combine, and "None" and "Any" stay. A list one of
 * them narrows says whose statement that is and how many apps it leaves
 * out because no index lists them.
 */

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { antiFeaturesUsed, countMatches, filteredCount, isLink, matchingApps } from "../lib/catalog.ts";
import { build, commonNameWord, regionsBySize, requireShape } from "../lib/pick.ts";
import { countStatus, escapeRegExp, hashOf, launch, openFilters } from "../lib/app.ts";

const USED = antiFeaturesUsed(build);

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the filters are the same in both layouts; run once, at phone size");
  void page;
});

/** The group of one anti-feature: the one its name labels. */
function groupOf(filters: Locator, feature: (typeof USED)[number]): Locator {
  return filters.getByRole("group").filter({ has: filters.page().locator(`[id="af-${feature.id}"]`) });
}

async function showAll(filters: Locator): Promise<void> {
  const all = filters.getByRole("region", { name: /^Anti-features/ }).getByRole("button", { name: /^All \d+$/ });
  if (await all.count()) await all.click();
}

function count(button: Locator): Promise<number> {
  return button.innerText().then((text) => Number(/([\d,]+)\s*$/.exec(text)?.[1]?.replace(/,/g, "")));
}

test("every anti-feature in the catalog has its own filter: a plain name, and With and Without counts that match the catalog", async ({ page }) => {
  requireShape(USED.length > 0, "app an index flags with an anti-feature");
  await launch(page, "#/search");
  const filters = await openFilters(page);
  await showAll(filters);
  const section = filters.getByRole("region", { name: /^Anti-features/ });
  await expect(section.getByRole("group")).toHaveCount(USED.length);

  const names: string[] = [];
  for (const feature of USED) {
    const group = groupOf(section, feature);
    await expect(group, feature.id).toHaveCount(1);
    const name = ((await group.getByRole("paragraph").first().innerText()) ?? "").trim();
    names.push(name);
    expect(name.length, `a name for ${feature.id}`).toBeGreaterThan(2);
    if (feature.description) {
      expect(name, `${feature.id} is named in words, not by a key run together in capitals`).not.toMatch(/^[A-Z][a-z]+([A-Z][a-z]+)+$/);
      await expect(group, "what a flag means is said on an app that carries it, not on every filter").not.toContainText(feature.description.replace(/\.$/, ""));
    }
    expect(await count(group.getByRole("button", { name: /^With / })), `With ${feature.id}`).toBe(feature.with);
    expect(await count(group.getByRole("button", { name: /^Without / })), `Without ${feature.id}`).toBe(feature.without);
  }
  expect(new Set(names).size, "no two anti-features share a name").toBe(names.length);
});

test("“None” and “Any” stay, with counts from the catalog", async ({ page }) => {
  requireShape(USED.length > 0, "app an index flags with an anti-feature");
  await launch(page, "#/search");
  const filters = await openFilters(page);
  const section = filters.getByRole("region", { name: /^Anti-features/ });
  const clean = section.getByRole("button", { name: /^None \d/ });
  const any = section.getByRole("button", { name: /^Any \d/ });
  expect(await count(clean)).toBe(countMatches(build, "", ["clean"]));
  expect(await count(any)).toBe(countMatches(build, "", ["anti"]));
  await clean.click();
  await expect(page).toHaveURL(/[?&]f=clean$/);
  await expect(countStatus(page)).toHaveText(new RegExp(`^${escapeRegExp(filteredCount(build, matchingApps(build, "", ["clean"])))}$`));
});

test("anti-features combine with each other and with other filters, and With and Without of the same one replace each other", async ({ page }) => {
  const byCount = [...USED].sort((a, b) => b.with - a.with);
  const [first, second] = byCount;
  requireShape(Boolean(first && second), "two anti-features");
  if (!first || !second) return;
  await launch(page, "#/search");
  const filters = await openFilters(page);
  await showAll(filters);
  const section = filters.getByRole("region", { name: /^Anti-features/ });

  await groupOf(section, first).getByRole("button", { name: /^With / }).click();
  await expect(page).toHaveURL(new RegExp(`f=af:${escapeRegExp(first.id)}$`));
  await expect(groupOf(section, first).getByRole("button", { name: /^With / })).toHaveAttribute("aria-pressed", "true");

  const offered = await count(groupOf(section, second).getByRole("button", { name: /^Without / }));
  expect(offered, "the count beside an option is what choosing it would give").toBe(countMatches(build, "", [`af:${first.id}`, `no:${second.id}`]));
  await groupOf(section, second).getByRole("button", { name: /^Without / }).click();
  expect(new URLSearchParams(hashOf(page).split("?")[1]).get("f")?.split(",").sort()).toEqual([`af:${first.id}`, `no:${second.id}`].sort());

  await groupOf(section, first).getByRole("button", { name: /^Without / }).click();
  const tokens = new URLSearchParams(hashOf(page).split("?")[1]).get("f")?.split(",") ?? [];
  expect(tokens.sort()).toEqual([`no:${first.id}`, `no:${second.id}`].sort());
  await expect(groupOf(section, first).getByRole("button", { name: /^With / })).toHaveAttribute("aria-pressed", "false");

  const open = filters.getByRole("button", { name: /^Open source \d/ });
  if (await open.count()) {
    await open.click();
    tokens.push("open");
  }
  const expected = filteredCount(build, matchingApps(build, "", tokens));
  await filters.getByRole("button", { name: /^(Show [\d,]+ |No .* match)/ }).click();
  await expect(filters).toBeHidden();
  await expect(countStatus(page)).toHaveText(new RegExp(`^${escapeRegExp(expected)}$`));
});

/**
 * The line above a list an anti-feature filter narrows, made here from the
 * index parts: the indexes that flag anti-features, and how many apps that
 * pass the search and the other filters neither index lists.
 */
function statedLine(text: string, others: string[]): string {
  const names = [build.apps.some((app) => app.fdroid !== null) ? "F-Droid" : "", build.apps.some((app) => app.izzy !== null) ? "IzzyOnDroid" : ""].filter(Boolean);
  const unknown = matchingApps(build, text, others).filter((app) => app.fdroid === null && app.izzy === null && !isLink(app)).length;
  const who = `${names.join(" and ")} ${names.length === 1 ? "flags" : "flag"} anti-features`;
  if (unknown === 0) return `${who}.`;
  return `${who}, so ${unknown.toLocaleString("en")} ${unknown === 1 ? "app" : "apps"} ${names.length === 1 ? "it does not list" : "listed by neither"} ${unknown === 1 ? "is" : "are"} left out.`;
}

function statedNote(page: Page): Locator {
  return page.getByRole("main").locator("p.list-note");
}

test("the page of “No anti-features” says whose statement it is and how many apps it leaves out", async ({ page }) => {
  requireShape(countMatches(build, "", ["clean"]) > 0, "app an index lists with no anti-feature");
  await launch(page, "#/lens/clean");
  await expect(statedNote(page)).toHaveText(statedLine("", []));
  const unknown = build.apps.filter((app) => app.fdroid === null && app.izzy === null && !isLink(app)).length;
  expect(countMatches(build, "", ["clean"]) + countMatches(build, "", ["anti"]) + unknown, "listed without, listed with, and listed by neither are every app").toBe(build.apps.filter((app) => !isLink(app)).length);
});

test("wherever an anti-feature filter narrows a list the line is there, and its count is of what that list would otherwise hold", async ({ page }) => {
  requireShape(USED.length > 0, "app an index flags with an anti-feature");
  const first = USED[0]?.id ?? "";
  for (const f of ["clean", "anti", `af:${first}`, `no:${first}`]) {
    await launch(page, `#/search?f=${f}`);
    await expect(statedNote(page), f).toHaveText(statedLine("", []));
  }

  if (countMatches(build, "", ["shizuku", "clean"]) > 0) {
    await launch(page, "#/search?f=shizuku,clean");
    await expect(statedNote(page), "with a second filter on").toHaveText(statedLine("", ["shizuku"]));
    await launch(page, "#/lens/shizuku?f=clean");
    await expect(statedNote(page), "on another filter's own page").toHaveText(statedLine("", ["shizuku"]));
  }

  const word = commonNameWord();
  await launch(page, `#/search?f=anti&q=${encodeURIComponent(word)}`);
  await expect(statedNote(page), `with “${word}” searched`).toHaveText(statedLine(word, []));

  const region = regionsBySize()[0];
  if (region) {
    await launch(page, `#/region/${region.id}?f=clean`);
    await expect(statedNote(page), `in ${region.name}`).toHaveText(statedLine("", [`r:${region.id}`]));
  }
});

test("a list no anti-feature filter narrows says nothing of the kind, and the Filters panel says it once under Anti-features", async ({ page }) => {
  await launch(page, "#/search");
  await expect(statedNote(page)).toHaveCount(0);
  const filters = await openFilters(page);
  const section = filters.getByRole("region", { name: /^Anti-features$/ });
  requireShape((await section.count()) > 0, "app an index lists");
  await expect(section.getByRole("paragraph").first()).toHaveText("F-Droid and IzzyOnDroid flag these, so apps listed by neither are left out.");
  await expect(filters.locator("p.panel-hint")).toHaveCount(1);
});

test.describe("an anti-feature filter given in the address", () => {
  for (const feature of USED.slice(0, 4)) {
    test(`with ${feature.id}, and without it`, async ({ page }) => {
      await launch(page, `#/search?f=af:${feature.id}`);
      await expect(countStatus(page)).toHaveText(new RegExp(`^${escapeRegExp(filteredCount(build, matchingApps(build, "", [`af:${feature.id}`])))}$`));
      expect(matchingApps(build, "", [`af:${feature.id}`]).length).toBe(feature.with);
      await launch(page, `#/search?f=no:${feature.id}`);
      await expect(countStatus(page)).toHaveText(new RegExp(`^${escapeRegExp(filteredCount(build, matchingApps(build, "", [`no:${feature.id}`])))}$`));
      expect(matchingApps(build, "", [`no:${feature.id}`]).length).toBe(feature.without);
    });
  }
});
