/**
 * Walk-throughs of the history rules as a person meets them, the ones the
 * architecture review checked on paper (docs/design/architecture-review.md
 * records its findings). The letters are that review's:
 *
 * (c) Explore → region → category → open app → step next ×3 → Back
 * (d) Search: type, open result, step, Back, edit query, Back
 * (e) switch bottom-bar destinations in various orders, then Back repeatedly
 * (h) the user edits the hash, or a second deep link arrives in the same tab
 * (i) Forward after Back when the sheet was closed with the X
 */

import { expect, test } from "../lib/fixtures.ts";
import { sheetHash } from "../lib/catalog.ts";
import { appsInCategory, biggestLens, build, chipLink, commonNameWord, featuredApp, level, regionTile, regionsBySize, requireShape, resourceRegion } from "../lib/pick.ts";
import { appRows, back, closeSheetButton, escapeRegExp, firstVisibleRowId, forward, launch, navLink, rowOf, sheet, snapshot, typeHash, visibleRow } from "../lib/app.ts";

const L = level();
const exact = (hash: string): RegExp => new RegExp(`${escapeRegExp(hash)}$`);

test("(c) Explore → region → category → sheet → next ×3 → Back closes the sheet onto the list showing the last app viewed, and Back walks up the levels", async ({ page }) => {
  requireShape(appsInCategory(L.category.id).length >= 5, "category with five entries to step through");
  await launch(page, "#/");
  const start = await snapshot(page);
  await regionTile(page, L.regionId).click();
  await chipLink(page, `Categories in ${L.regionName}`, L.category).click();
  await expect(page.getByRole("heading", { level: 1, name: L.category.name })).toBeVisible();
  const list = await snapshot(page);

  await (await visibleRow(page, 0)).click();
  await expect(sheet(page)).toBeVisible();
  const opened = await snapshot(page);
  const position = page.getByRole("group", { name: "Results" }).getByRole("status");
  const startAt = Number.parseInt((await position.textContent()) ?? "", 10);
  for (let step = 0; step < 3; step += 1) await page.getByRole("button", { name: "Next result" }).click();
  await expect(position).toHaveText(new RegExp(`^${startAt + 3} of \\d+$`));
  const stepped = await snapshot(page);
  expect(stepped.length).toBe(opened.length);
  expect(stepped.state?.id).toBe(opened.state?.id);
  const lastViewed = new URLSearchParams(stepped.hash.split("?")[1]).get("app") ?? "";

  await back(page);
  await expect(page).toHaveURL(exact(`#/cat/${L.category.id}`));
  await expect(sheet(page)).toBeHidden();
  const returned = await snapshot(page);
  expect(returned.state?.id).toBe(list.state?.id);
  await expect(rowOf(page, lastViewed)).toBeInViewport({ ratio: 1 });
  expect(await firstVisibleRowId(page)).not.toBeNull();

  await back(page);
  await expect(page).toHaveURL(exact(`#/region/${L.regionId}`));
  await back(page);
  await expect(page).toHaveURL(/#\/$/);
  expect((await snapshot(page)).state?.idx).toBe(start.state?.idx);
});

test("(d) Search: type, open, step, Back, edit the query, Back leaves Search for where the user was", async ({ page }) => {
  const word = commonNameWord();
  await launch(page, "#/");
  await page.getByRole("main").click({ position: { x: 5, y: 5 } });
  const explore = await snapshot(page);
  await navLink(page, "Search").click();
  const field = page.getByRole("searchbox", { name: "Search the catalog" });
  await field.pressSequentially(word, { delay: 30 });
  await expect(page).toHaveURL(exact(`#/search?q=${word}`));
  await appRows(page).first().click();
  await expect(sheet(page)).toBeVisible();
  const position = page.getByRole("group", { name: "Results" }).getByRole("status");
  const startAt = Number.parseInt((await position.textContent()) ?? "", 10);
  await page.getByRole("button", { name: "Next result" }).click();
  await expect(position).toHaveText(new RegExp(`^${startAt + 1} of \\d+$`));
  await back(page);
  await expect(page).toHaveURL(exact(`#/search?q=${word}`));
  await expect(sheet(page)).toBeHidden();
  const search = await snapshot(page);
  expect(search.length - explore.length).toBe(2);

  await field.fill(`${word} app`);
  await expect(page).toHaveURL(exact(`#/search?q=${word}%20app`));
  expect((await snapshot(page)).length).toBe(search.length);
  await back(page);
  await expect(page).toHaveURL(/#\/$/);
  await forward(page);
  await expect(page).toHaveURL(exact(`#/search?q=${word}%20app`));
  await expect(field).toHaveValue(`${word} app`);
});

test("(e) bottom-bar destinations in several orders, then Back repeatedly, return through where the user was, once each", async ({ page }) => {
  const region = regionsBySize().filter((item) => item.id !== resourceRegion()?.id).at(-1);
  if (!region) throw new Error("no region");
  await launch(page, "#/");
  await regionTile(page, region.id).click();
  await expect(page).toHaveURL(exact(`#/region/${region.id}`));
  const start = await snapshot(page);
  await navLink(page, "Saved").click();
  await navLink(page, "Search").click();
  await navLink(page, "Saved").click();
  await navLink(page, "Search").click();
  await expect(page).toHaveURL(/#\/search$/);
  expect((await snapshot(page)).length - start.length).toBe(1);
  await back(page);
  await expect(page).toHaveURL(exact(`#/region/${region.id}`));
  await back(page);
  await expect(page).toHaveURL(/#\/$/);

  await navLink(page, "Saved").click();
  await navLink(page, "Explore").click();
  await expect(page).toHaveURL(/#\/$/);
  expect((await snapshot(page)).state?.idx).toBe(0);
  await navLink(page, "Search").click();
  await navLink(page, "Explore").click();
  await expect(page).toHaveURL(/#\/$/);
  expect((await snapshot(page)).state?.idx).toBe(0);
});

test("(h) a hand-edited hash and a second deep link stack on the current context, and Back returns through them", async ({ page }) => {
  const app = featuredApp();
  await launch(page, "#/");
  await regionTile(page, L.regionId).click();
  const region = await snapshot(page);
  await typeHash(page, "#/saved");
  await expect(page.getByRole("heading", { level: 1, name: "Saved" })).toBeVisible();
  await typeHash(page, `#/app/${app.id}`);
  await expect(sheet(page, app.name)).toBeVisible();
  const deep = await snapshot(page);
  expect(deep.hash).toBe(sheetHash(app));
  expect(deep.length - region.length).toBe(2);
  expect(deep.state?.idx).toBe((region.state?.idx ?? 0) + 2);
  await closeSheetButton(page).click();
  await expect(page).toHaveURL(exact(`#/cat/${app.atlas.category}`));
  await back(page);
  await expect(page).toHaveURL(/#\/saved$/);
  await back(page);
  await expect(page).toHaveURL(exact(`#/region/${L.regionId}`));
});

test("(h) a hash naming nothing shows the not-found view and Back leaves it", async ({ page }) => {
  await launch(page, "#/");
  await page.getByRole("main").click({ position: { x: 5, y: 5 } });
  await typeHash(page, "#/region/no-such-region");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Not found" })).toBeVisible();
  await back(page);
  await expect(page).toHaveURL(/#\/$/);
});

test("(h) a share link to an id no catalog has, and no redirect names, says so and offers a search for the name in it", async ({ page }) => {
  expect(Object.hasOwn(build.atlas.redirects, "org.example.orgzly")).toBe(false);
  await launch(page, "#/app/org.example.orgzly");
  await expect(page.getByRole("main")).toContainText("No app has the id “org.example.orgzly”.");
  await page.getByRole("link", { name: "Search for “orgzly”" }).click();
  await expect(page).toHaveURL(/#\/search\?q=orgzly$/);
  await expect(page.getByRole("searchbox", { name: "Search the catalog" })).toHaveValue("orgzly");
});

test("(i) Forward after closing the sheet with the X reopens the same sheet, and Back closes it again", async ({ page }) => {
  const lens = biggestLens();
  requireShape(lens.size >= 2, "lens with two entries");
  await launch(page, `#/lens/${lens.key}`);
  await page.getByRole("main").click({ position: { x: 5, y: 5 } });
  const link = appRows(page).nth(1);
  const href = (await link.getAttribute("href")) ?? "";
  await link.click();
  await expect(sheet(page)).toBeVisible();
  await closeSheetButton(page).click();
  await expect(sheet(page)).toBeHidden();
  await expect(page).toHaveURL(exact(`#/lens/${lens.key}`));
  await forward(page);
  await expect(page).toHaveURL(exact(href));
  await expect(sheet(page)).toBeVisible();
  await back(page);
  await expect(sheet(page)).toBeHidden();
  await expect(page).toHaveURL(exact(`#/lens/${lens.key}`));
});
