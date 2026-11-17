/**
 * Search (DECISIONS.md: Console's combinable search): matches at the start of
 * a word of the name come first, every row says why it matched, typing adds
 * no history, filters combine, counts match a count computed here from the
 * catalog parts, Clear resets, pins persist, and the full bar returns when
 * the keyboard goes away.
 */

import { expect, test } from "../lib/fixtures.ts";
import { biggestLens, commonNameWord, featuredApp, regionsBySize, requireShape } from "../lib/pick.ts";
import { FILTER_TESTS, countMatches, filteredCount, fold, loadBuild, matchingApps, wholeCount } from "../lib/catalog.ts";
import { appRows, countStatus, escapeRegExp, filtersSheet, hashOf, launch, navLink, openFilters, renderedRowIds, resultList, sheet, snapshot, sortButton } from "../lib/app.ts";
import { tap } from "../lib/phone.ts";

const build = loadBuild();

/** A token the app offers: it drops tokens for facts no entry carries and places the catalog does not have. */
function isOffered(token: string): boolean {
  if (token.startsWith("r:")) return build.apps.some((app) => app.regions.has(token.slice(2)));
  if (token.startsWith("c:")) return build.apps.some((app) => app.categories.has(token.slice(2)));
  if (token.startsWith("s:")) return build.apps.some((app) => app.sources.has(token.slice(2) as "android-foss"));
  const test = FILTER_TESTS[token];
  return Boolean(test && build.apps.some(test));
}

function searchHash(text: string, filters: string[]): string {
  const params = new URLSearchParams();
  if (text) params.set("q", text);
  if (filters.length) params.set("f", filters.join(","));
  const query = params.toString().replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%2F/g, "/");
  return `#/search${query ? `?${query}` : ""}`;
}

const CASES: { text: string; filters: string[] }[] = [
  { text: "", filters: ["shizuku"] },
  { text: "", filters: ["shizuku", "no-internet"] },
  { text: "", filters: ["fdroid", "izzy", "apk"] },
  { text: "", filters: ["closed", "source-available"] },
  { text: "", filters: ["r:media", "r:games"] },
  { text: "", filters: ["s:awesome-shizuku", "paid"] },
  { text: "", filters: ["c:music-making", "c:sound-volume", "no-internet"] },
  { text: "", filters: ["archived"] },
  { text: "", filters: ["stale"] },
  { text: "", filters: ["anti", "fork"] },
  { text: "player", filters: [] },
  { text: "player", filters: ["open"] },
  { text: "music player", filters: [] },
  { text: "signal", filters: [] },
  { text: "org.fossify", filters: [] },
  { text: "keyboard", filters: ["fdroid", "r:personal"] },
  { text: "launcher", filters: ["shizuku"] },
];

test.describe("counts match an independent count from the catalog parts", () => {
  for (const { text, filters } of CASES) {
    const label = `${text ? `“${text}”` : "no text"} + [${filters.join(", ")}]`;
    test(label, async ({ page }) => {
      requireShape(filters.every(isOffered), `entry for every token of ${filters.join(", ")}`);
      const expected = filteredCount(build, matchingApps(build, text, filters));
      await launch(page, searchHash(text, filters));
      await expect(countStatus(page)).toHaveText(new RegExp(`^${escapeRegExp(expected)}$`));
    });
  }

  test("the unfiltered count is the whole catalog", async ({ page }) => {
    await launch(page, "#/search");
    await expect(countStatus(page)).toHaveText(wholeCount(build));
  });
});

/** Whether a word of the name begins with the text: the matches best match puts first. */
function startsNameWord(name: string, text: string): boolean {
  return fold(name).split(/[^\p{L}\p{N}]+/u).some((part) => part.startsWith(text));
}

test("entries with a name word that begins with the text come first, ahead of the same letters inside a word", async ({ page }) => {
  const text = commonNameWord();
  await launch(page, searchHash(text, []));
  const ids = await renderedRowIds(page);
  const leading = build.apps.filter((app) => app.searchText.includes(text) && startsNameWord(app.name, text)).length;
  requireShape(leading > 1, "word that begins a word of several names");
  ids.forEach((id, index) => {
    const name = build.byId.get(id)?.name ?? "";
    expect(startsNameWord(name, text), `row ${index + 1}, “${name}”`).toBe(index < leading);
  });
  if (build.apps.some((app) => fold(app.name).startsWith(text))) {
    expect(fold(build.byId.get(ids[0] ?? "")?.name ?? "").startsWith(text), "a name that starts with the query comes first").toBe(true);
  }
});

test("every row of a text search shows why it is there: the words marked in its name or summary, or a line naming where they were found", async ({ page }) => {
  const text = commonNameWord();
  await launch(page, searchHash(text, []));
  const rows = resultList(page).locator("[data-row]");
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);
  const unexplained: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const marks = await row.locator("mark").allTextContents();
    if (!marks.some((mark) => fold(mark).includes(text.slice(0, 2)))) unexplained.push((await row.getAttribute("data-row")) ?? `row ${index}`);
  }
  expect(unexplained, "rows with nothing marked").toEqual([]);

  const hidden = build.apps.find((app) => app.searchText.includes(text) && !fold(app.name).includes(text) && !fold(app.summary ?? "").includes(text));
  requireShape(Boolean(hidden), `entry that matches “${text}” somewhere other than its name and summary`);
  if (!hidden) return;
  await launch(page, searchHash(`${text} ${fold(hidden.name).split(" ")[0] ?? ""}`.trim(), []));
  const row = resultList(page).locator(`[data-row="${hidden.id}"]`);
  await expect(row).toContainText(new RegExp(`(Summary|Description|Also listed as|Package|Repository|Category): .*${escapeRegExp(text)}`, "i"));
  await expect(row.locator("mark").filter({ hasText: new RegExp(escapeRegExp(text), "i") }).first()).toBeVisible();
});

test("the compact bar is for the keyboard: when the keyboard goes away with the field still focused, Sort, Pin and the count return", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the on-screen keyboard is the phone's");
  const text = commonNameWord();
  await launch(page, "#/search");
  const field = page.getByRole("searchbox", { name: "Search the catalog" });
  await field.fill(text);
  const full = page.viewportSize();
  if (!full) throw new Error("no viewport");
  await page.setViewportSize({ width: full.width, height: full.height - 300 });
  await expect(page.locator("html")).toHaveClass(/has-keyboard/);
  await expect(sortButton(page)).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  await expect(page.getByRole("search").getByRole("button", { name: "Filters" })).toBeVisible();

  await page.setViewportSize(full);
  await expect(page.locator("html")).not.toHaveClass(/has-keyboard/);
  await expect(field).toBeFocused();
  await expect(sortButton(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "Pin", exact: true })).toBeVisible();
  await expect(countStatus(page)).toHaveText(/ of /);
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
});

/*
 * UX-115. On a phone the tap's mousedown moves the focus out of the field
 * before its mouseup lands; the page must not rearrange itself in between,
 * or the release lands on whatever moved under the finger and no link is
 * clicked. The keyboard itself goes some milliseconds after the click.
 */
test("with the keyboard up, a tap on a result opens its sheet the first time", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the on-screen keyboard is the phone's");
  await launch(page, "#/search");
  const field = page.getByRole("searchbox", { name: "Search the catalog" });
  await field.fill(commonNameWord());
  const full = page.viewportSize();
  if (!full) throw new Error("no viewport");
  await page.setViewportSize({ width: full.width, height: 440 });
  await expect(page.locator("html")).toHaveClass(/has-keyboard/);
  await expect(page.getByRole("search").getByRole("button", { name: "Filters" })).toBeVisible();

  const link = appRows(page).first();
  const box = await link.boundingBox();
  if (!box) throw new Error("no result to tap");
  const before = hashOf(page);
  await tap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.setViewportSize(full);

  await expect(sheet(page)).toBeVisible();
  expect(hashOf(page)).not.toBe(before);
  await expect(page.locator("html")).not.toHaveClass(/has-keyboard/);
});

test("with the keyboard up, a tap on the compact bar's Filters opens the filters the first time", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the on-screen keyboard is the phone's");
  await launch(page, "#/search");
  await page.getByRole("searchbox", { name: "Search the catalog" }).fill(commonNameWord());
  const full = page.viewportSize();
  if (!full) throw new Error("no viewport");
  await page.setViewportSize({ width: full.width, height: 440 });
  const filters = page.getByRole("search").getByRole("button", { name: "Filters" });
  await expect(filters).toBeVisible();
  const box = await filters.boundingBox();
  if (!box) throw new Error("no Filters button");
  await tap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await page.setViewportSize(full);
  await expect(filtersSheet(page)).toBeVisible();
});

test("case and diacritics do not change the results", async ({ page }) => {
  const word = (featuredApp().name.split(/\s+/)[0] ?? "").toLowerCase();
  await launch(page, searchHash(word.toUpperCase(), []));
  const upper = await countStatus(page).textContent();
  await launch(page, searchHash(word, []));
  expect(await countStatus(page).textContent()).toBe(upper);
  const accented = build.apps.find((app) => /[À-ſ]/.test(app.name));
  requireShape(Boolean(accented), "app name with a diacritic");
  const marked = (accented?.name ?? "").split(/\s+/).find((part) => /[À-ſ]/.test(part)) ?? "";
  await launch(page, searchHash(fold(marked), []));
  const plain = await countStatus(page).textContent();
  await launch(page, searchHash(marked, []));
  expect(await countStatus(page).textContent()).toBe(plain);
});

test("filters chosen in the panel combine, and the panel's option counts are what choosing them would give", async ({ page }) => {
  requireShape(isOffered("shizuku") && isOffered("no-internet"), "entries that work with Shizuku and entries without internet");
  await launch(page, "#/");
  await navLink(page, "Search").click();
  const panel = await openFilters(page);
  await panel.getByRole("button", { name: /^Works with Shizuku \d+$/ }).click();
  await expect(page).toHaveURL(/f=shizuku/);
  const offered = await panel.getByRole("button", { name: /^No internet permission \d+$/ }).textContent();
  const offeredCount = Number(/(\d+)$/.exec(offered ?? "")?.[1]);
  expect(offeredCount).toBe(countMatches(build, "", ["shizuku", "no-internet"]));
  await panel.getByRole("button", { name: /^No internet permission \d+$/ }).click();
  await expect(panel.getByRole("button", { name: /^No internet permission \d+$/ })).toHaveAttribute("aria-pressed", "true");
  for (const region of regionsBySize().slice(0, 3)) {
    const option = panel.getByRole("button", { name: new RegExp(`^${escapeRegExp(region.name)} \\d+$`) });
    if (!(await option.count())) continue;
    const regionOffered = Number(/(\d+)$/.exec((await option.first().textContent()) ?? "")?.[1]);
    expect(regionOffered, region.name).toBe(countMatches(build, "", ["shizuku", "no-internet", `r:${region.id}`]));
  }
  await panel.getByRole("button", { name: /^(Show \d+ entr|No entries match)/ }).click();
  await expect(panel).toBeHidden();
  const expected = countMatches(build, "", ["shizuku", "no-internet"]);
  await expect(countStatus(page)).toHaveText(new RegExp(`^${expected} of `));
});

test("typing and a filter, then the field's clear and the filter's chip, reset to the whole catalog without adding history; nothing else offers to clear", async ({ page }) => {
  const word = commonNameWord();
  await launch(page, "#/");
  await navLink(page, "Search").click();
  const start = await snapshot(page);
  await page.getByRole("searchbox", { name: "Search the catalog" }).pressSequentially(word, { delay: 25 });
  await page.getByRole("button", { name: /^Filters/ }).click();
  const panel = page.getByRole("dialog", { name: "Filters" });
  await panel.getByRole("button", { pressed: false, disabled: false }).filter({ hasText: /\d$/ }).first().click();
  await expect(page).toHaveURL(/&f=/);
  const token = new URLSearchParams(hashOf(page).split("?")[1]).get("f") ?? "";
  await page.keyboard.press("Escape");
  await expect(countStatus(page)).toHaveText(new RegExp(`^${countMatches(build, word, [token])} of `));
  await expect(page.getByRole("button", { name: "Clear", exact: true }), "one way to clear the text: the field's own").toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove search text/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("group", { name: "Active filters" }).getByRole("button", { name: /, remove filter$/ }).click();
  await expect(page).toHaveURL(/#\/search$/);
  await expect(page.getByRole("searchbox", { name: "Search the catalog" })).toHaveValue("");
  await expect(countStatus(page)).toHaveText(wholeCount(build));
  const after = await snapshot(page);
  expect(after.length).toBe(start.length);
  expect(after.state?.id).toBe(start.state?.id);
});

test("a token the catalog no longer has is dropped from the URL rather than matching nothing", async ({ page }) => {
  const lens = biggestLens();
  await launch(page, `#/search?f=${lens.key},no-such-token`);
  await expect(countStatus(page)).toHaveText(new RegExp(`^${countMatches(build, "", [lens.key])} of `));
});

test("a pinned query is kept on the device, survives reload and reapplies the query", async ({ page }) => {
  const lens = biggestLens();
  const word = commonNameWord();
  await launch(page, `#/search?q=${word}&f=${lens.key}`);
  await page.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pinned", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page.getByRole("group", { name: "Active filters" }).getByRole("button", { name: /, remove filter$/ }).click();
  const pin = page.getByRole("region", { name: "Pins" }).getByRole("button", { name: new RegExp(`“${escapeRegExp(word)}”`) });
  await expect(pin).toBeVisible();
  await page.reload();
  await expect(pin).toBeVisible();
  await expect(pin).toContainText(String(countMatches(build, word, [lens.key])));
  await pin.click();
  await expect(page).toHaveURL(new RegExp(`q=${word}&f=${lens.key}`));
});
