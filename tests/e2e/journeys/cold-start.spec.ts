/**
 * Cold start (ARCHITECTURE.md § Cold start): nothing is pushed before the
 * first gesture; the first gesture puts every level above the target beneath
 * it (the list under a sheet, its region, the map).
 *
 * Chrome marks entries created without a user gesture as skippable, and its
 * own Back button and the Android Back gesture skip them. `history.back()`
 * from automation does not. So these tests check the stack the router builds
 * by reading `history.state` and `history.length`; whether the browser's own
 * Back then behaves is VERIFICATION.md release check 2, on the device.
 */

import { expect, test } from "../lib/fixtures.ts";
import { sheetHash } from "../lib/catalog.ts";
import { build, featuredApp, regionsBySize } from "../lib/pick.ts";
import { back, firstGesture, launch, sheet, snapshot } from "../lib/app.ts";

function regionOf(categoryId: string | undefined): string {
  const region = build.categories.get(categoryId ?? "")?.region;
  if (!region) throw new Error(`no region for category ${String(categoryId)}`);
  return region;
}

test("cold deep link to a sheet stays one entry until the first gesture, then its list, its region and the map are seeded beneath it (the browser's skippable-entry behavior is not reproduced by automation)", async ({ page }) => {
  const app = featuredApp();
  await launch(page, `#/app/${app.id}`);
  await expect(sheet(page, app.name)).toBeVisible();
  const cold = await snapshot(page);
  expect(cold.hash).toBe(sheetHash(app));
  expect(cold.state?.idx).toBe(0);
  expect(cold.state?.under).toBeNull();
  await page.waitForTimeout(500);
  expect((await snapshot(page)).length).toBe(cold.length);

  await firstGesture(page);
  await expect.poll(async () => (await snapshot(page)).state?.idx).toBe(3);
  const seeded = await snapshot(page);
  expect(seeded.length - cold.length).toBe(3);
  expect(seeded.hash).toBe(cold.hash);
  expect(seeded.state?.id).toBe(cold.state?.id);
  expect(seeded.state?.under).toBe(`#/cat/${app.atlas.category}`);

  await back(page);
  await expect(page).toHaveURL(new RegExp(`#/cat/${app.atlas.category}$`));
  await expect(sheet(page)).toBeHidden();
  expect((await snapshot(page)).state?.idx).toBe(2);
  await back(page);
  await expect(page).toHaveURL(new RegExp(`#/region/${regionOf(app.atlas.category)}$`));
  await back(page);
  await expect(page).toHaveURL(/#\/$/);
  expect((await snapshot(page)).state?.idx).toBe(0);
});

test("cold deep link to a level seeds Explore beneath it on the first gesture (automation does not reproduce skippable entries)", async ({ page }) => {
  await launch(page, `#/region/${regionsBySize()[0]?.id}`);
  const cold = await snapshot(page);
  expect(cold.state?.idx).toBe(0);
  await firstGesture(page);
  await expect.poll(async () => (await snapshot(page)).state?.idx).toBe(1);
  expect((await snapshot(page)).length - cold.length).toBe(1);
  await back(page);
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { level: 1, name: "Droid Atlas" })).toBeVisible();
});

test("a keydown is a first gesture too: Escape on a cold sheet seeds, then closes it onto the list", async ({ page }) => {
  const app = featuredApp();
  await launch(page, `#/app/${app.id}`);
  await expect(sheet(page, app.name)).toBeVisible();
  const cold = await snapshot(page);
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`#/cat/${app.atlas.category}$`));
  const after = await snapshot(page);
  expect(after.state?.idx).toBe(2);
  expect(after.length - cold.length).toBe(3);
});

test("Explore entered cold has nothing to seed: the first gesture adds no entry", async ({ page }) => {
  await launch(page, "#/");
  const cold = await snapshot(page);
  await firstGesture(page);
  await page.waitForTimeout(300);
  const after = await snapshot(page);
  expect(after.length).toBe(cold.length);
  expect(after.state?.idx).toBe(0);
});

test("a cold sheet is a modal dialog the platform's close request can close before any gesture (CloseWatcher itself is checked on the device)", async ({ page }) => {
  const app = featuredApp();
  await launch(page, `#/app/${app.id}`);
  test.skip((page.viewportSize()?.width ?? 0) >= 1024, "on a wide screen the sheet is a panel, not a modal");
  const modal = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open]");
    return dialog ? dialog.matches(":modal") : null;
  });
  expect(modal).toBe(true);
  const hasCloseWatcher = await page.evaluate(() => typeof (window as unknown as { CloseWatcher?: unknown }).CloseWatcher === "function");
  test.info().annotations.push({ type: "close-watcher-available", description: String(hasCloseWatcher) });
});
