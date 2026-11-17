/**
 * Back closes a sheet that has no URL of its own (the sort choices, the
 * filters), wherever the page sits in the tab's history.
 *
 * Chromium hands Android Back to an open dialog first, so there the sheets
 * add nothing to history. Firefox for Android does that only when it has an
 * entry to go back to: on a tab's first page it closes the tab instead. Where
 * the browser needs it, the app gives such a sheet an entry of its own while
 * it is open. Firefox for Android cannot be driven here, so these journeys
 * take that path in Chromium by removing `CloseWatcher` before the app loads,
 * and stand the browser's Back in with `history.back()`. Whether the phone's
 * Firefox then keeps the tab is the device's to confirm.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { regionsBySize } from "../lib/pick.ts";
import { chooseSort, filtersSheet, launch, openFilters, snapshot, sortButton, sortSheet } from "../lib/app.ts";

const [BIG] = regionsBySize();
const REGION = `#/region/${BIG?.id ?? ""}`;

/** The browser this app treats as needing an entry per sheet. */
async function withoutCloseWatcher(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as { CloseWatcher?: unknown }).CloseWatcher;
  });
}

/** The browser's Back, for a page whose address does not change. */
async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    addEventListener("popstate", () => resolve(), { once: true });
    history.back();
  }));
}

test("where Back reaches an open dialog first, the sort and filter sheets add nothing to history", async ({ page }) => {
  await launch(page, REGION);
  const before = await snapshot(page);
  await sortButton(page).click();
  await expect(sortSheet(page)).toBeVisible();
  expect((await snapshot(page)).length).toBe(before.length + (before.state?.idx === 0 ? 1 : 0));
  const opened = await snapshot(page);
  await sortSheet(page).getByRole("button", { name: "Close sorting" }).click();
  await expect(sortSheet(page)).toBeHidden();
  const filters = await openFilters(page);
  await filters.getByRole("button", { name: "Close filters" }).click();
  await expect(filtersSheet(page)).toBeHidden();
  expect((await snapshot(page)).length, "nothing pushed for either sheet").toBe(opened.length);
});

test("on a tab's first page, Back closes the sort sheet and leaves the page where it was", async ({ page }) => {
  await withoutCloseWatcher(page);
  await launch(page, REGION);
  await sortButton(page).click();
  await expect(sortSheet(page)).toBeVisible();
  const open = await snapshot(page);
  await pressBack(page);
  await expect(sortSheet(page)).toBeHidden();
  const after = await snapshot(page);
  expect(after.hash).toBe(REGION);
  expect(after.length, "the tab still has the sheet's entry ahead of it, and nothing more").toBe(open.length);
  await expect(page.getByRole("main")).toBeVisible();
  await pressBack(page);
  expect((await snapshot(page)).hash, "the next Back goes up a level").toBe("#/");
});

test("a sort chosen in the sheet is kept by the page beneath, and the next Back goes up a level", async ({ page }) => {
  await withoutCloseWatcher(page);
  await launch(page, REGION);
  await chooseSort(page, "GitHub stars");
  const sorted = (await snapshot(page)).hash;
  expect(sorted).toMatch(/sort=/);
  await pressBack(page);
  expect((await snapshot(page)).hash, "no Back is spent on a sheet that is gone").toBe("#/");
});

test("the filters close on Back, and closed by their control they leave no entry behind", async ({ page }) => {
  await withoutCloseWatcher(page);
  await launch(page, REGION);
  let filters = await openFilters(page);
  await pressBack(page);
  await expect(filters).toBeHidden();
  expect((await snapshot(page)).hash).toBe(REGION);

  filters = await openFilters(page);
  await filters.getByRole("button", { name: "Close filters" }).click();
  await expect(filters).toBeHidden();
  await pressBack(page);
  expect((await snapshot(page)).hash, "no Back is spent on a sheet that is gone").toBe("#/");
});
