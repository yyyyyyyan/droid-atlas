/**
 * A long list under a thumb: rows are on screen in every frame of a fast
 * fling, and stay well ahead of the scroll in the direction it is going.
 *
 * The flings are real touch input with the events' own times, so the page is
 * thrown as hard as a person throws it, and the processor is slowed to stand
 * in for a phone's. On every animation frame the page records whether rows
 * cover the part of the list on screen and how far they reach beyond it
 * (lib/frames.ts). The compositor can run ahead of those frames, which is
 * why a floor is asserted for the distance ahead and not only for coverage.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { biggestLens, requireShape } from "../lib/pick.ts";
import { COMPACT_ROWS, launch, resultList, seedStorage } from "../lib/app.ts";
import { startFrameSampling, stopFrameSampling, summarize, throttleCpu, type FlingSummary } from "../lib/frames.ts";
import { PHONE_VIEWPORT, fling } from "../lib/phone.ts";

const LENS = biggestLens();
/** Rows enough for several screens of travel at full speed. */
const LONG_LIST = 300;
const MIDDLE = PHONE_VIEWPORT.width / 2;

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "flings are the phone's gesture");
  void page;
});
test.use({ viewport: { ...PHONE_VIEWPORT } });
test.describe.configure({ timeout: 120_000 });

/** Five quick flings in one direction, sampled until the page has come to rest. */
async function flingAndSample(page: Page, direction: "up" | "down"): Promise<FlingSummary> {
  const [from, to] = direction === "up" ? [600, 180] : [180, 600];
  await startFrameSampling(page);
  for (let count = 0; count < 5; count += 1) {
    await fling(page, { x: MIDDLE, y: from }, { x: MIDDLE, y: to }, { duration: 45 });
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(3500);
  return summarize(await stopFrameSampling(page));
}

function expectRowsUnderTheFinger(summary: FlingSummary, what: string): void {
  test.info().annotations.push({ type: what, description: JSON.stringify(summary) });
  expect(summary.distance, `${what}: the page traveled`).toBeGreaterThan(8 * PHONE_VIEWPORT.height);
  expect(summary.peakSpeed, `${what}: the page was thrown, in px per second`).toBeGreaterThan(5000);
  expect(summary.frames, `${what}: frames sampled`).toBeGreaterThan(60);
  expect(summary.worstUncovered, `${what}: px of the list on screen with no row over it, in the worst frame`).toBe(0);
  expect(summary.leastAhead, `${what}: px of rows ahead of the scroll, in the worst frame`).toBeGreaterThanOrEqual(PHONE_VIEWPORT.height / 2);
}

for (const density of ["comfortable", "compact"] as const) {
  test(`fast flings through a long list never show a frame without rows (${density} rows, processor slowed four times)`, async ({ page }) => {
    requireShape(LENS.size >= LONG_LIST, `list of ${LONG_LIST} entries`);
    if (density === "compact") await seedStorage(page, COMPACT_ROWS);
    await launch(page, `#/lens/${LENS.key}`);
    await expect(resultList(page)).toBeVisible();
    await page.waitForTimeout(500);
    await throttleCpu(page, 4);

    expectRowsUnderTheFinger(await flingAndSample(page, "up"), "flings toward the end");
    expectRowsUnderTheFinger(await flingAndSample(page, "down"), "flings back toward the start");
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`an icon's plate is chosen before it shows and does not change while it is shown (${theme} theme)`, async ({ page }) => {
    requireShape(LENS.size >= LONG_LIST, `list of ${LONG_LIST} entries`);
    await page.emulateMedia({ colorScheme: theme });
    await launch(page, `#/lens/${LENS.key}`);
    await expect(resultList(page)).toBeVisible();
    await page.evaluate(() => {
      const shown = new WeakMap<Element, string>();
      const changes: string[] = [];
      (window as unknown as { plateChanges: string[] }).plateChanges = changes;
      new MutationObserver((records) => {
        for (const record of records) {
          const icon = record.target as Element;
          if (!icon.classList.contains("ico")) continue;
          const before = shown.get(icon);
          const now = icon.className;
          if (before !== undefined && before !== now) changes.push(`${before} → ${now}`);
          if (icon.classList.contains("has-img")) shown.set(icon, now);
        }
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class"] });
    });
    await throttleCpu(page, 4);
    await flingAndSample(page, "up");
    await flingAndSample(page, "down");
    const changes = await page.evaluate(() => (window as unknown as { plateChanges: string[] }).plateChanges);
    expect(changes, "an icon shown on one plate is never moved to another").toEqual([]);
    expect(await resultList(page).locator(".ico.has-img").count(), "icons were shown").toBeGreaterThan(0);
  });
}

test("at rest a list holds a few screens of rows around the screen, not the whole list", async ({ page }) => {
  requireShape(LENS.size >= LONG_LIST, `list of ${LONG_LIST} entries`);
  await launch(page, `#/lens/${LENS.key}`);
  await page.evaluate(() => window.scrollTo(0, 6000));
  await page.waitForTimeout(1500);
  const rendered = await resultList(page).locator("[data-row]").count();
  const onScreen = Math.ceil(PHONE_VIEWPORT.height / 88);
  expect(rendered).toBeGreaterThanOrEqual(onScreen * 5);
  expect(rendered).toBeLessThan(LENS.size / 2);
});
