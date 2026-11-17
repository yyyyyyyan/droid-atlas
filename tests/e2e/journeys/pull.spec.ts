/**
 * Pull to refresh on the phone: with a page at its very top, a finger
 * dragging down past the threshold looks for a newer catalog once and says
 * what it found; a shorter pull does nothing; an open sheet, a sideways
 * swipe and a page that is not at its top are left alone; and with the site
 * out of reach the answer is a calm line, not a failure.
 *
 * Every gesture is real touch input sent through the DevTools protocol
 * (lib/phone.ts). The catalog served here is the one on screen, so a check
 * finds nothing newer; that a newer one is shown at once is a unit test
 * (`app/src/ui/pull.test.ts`), and the feel of the gesture is a phone's to
 * judge.
 */

import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { launch, sheet } from "../lib/app.ts";
import { loadBuild } from "../lib/catalog.ts";
import { TALL_LIST, categoriesIn, regionsBySize, requireShape } from "../lib/pick.ts";
import { PHONE_VIEWPORT, drag, dragAndHold, release, tap } from "../lib/phone.ts";

const [BIG] = regionsBySize();
const REGION = `#/region/${BIG?.id ?? ""}`;
/** The region with the most categories: its line of chips is the longest the catalog has. */
const [CHIPPED] = regionsBySize().sort((a, b) => categoriesIn(b.id).length - categoriesIn(a.id).length);
const MIDDLE = PHONE_VIEWPORT.width / 2;
/** A finger has to travel 10 px to be taken for a pull and 128 px more for a release to check. */
const LONG = 240;
const SHORT = 100;

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the gesture is for a finger; a wide window with a mouse has the Data health button");
  void page;
});
test.use({ viewport: { ...PHONE_VIEWPORT } });

/** The line the gesture speaks in. */
function said(page: Page): Locator {
  return page.getByRole("status").and(page.locator(".pull-label"));
}

/** Counts the looks for a newer catalog from now on. */
function watchChecks(page: Page): { count(): number } {
  let checks = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/data/version.json")) checks += 1;
  });
  return { count: () => checks };
}

async function documentOrigin(page: Page): Promise<number> {
  return page.evaluate(() => performance.timeOrigin);
}

async function pull(page: Page, distance: number, from = 180): Promise<void> {
  await drag(page, { x: MIDDLE, y: from }, { x: MIDDLE, y: from + distance }, { duration: 350, hold: 150 });
}

test("a pull past the threshold looks for a newer catalog once and says what it found", async ({ page }) => {
  await launch(page, "#/");
  const origin = await documentOrigin(page);
  const checks = watchChecks(page);
  await expect(said(page)).toBeEmpty();

  await pull(page, LONG);
  await expect(said(page)).toHaveText(/^(Checking…|Up to date · catalog of .+)$/);
  await expect(said(page)).toHaveText(/^Up to date · catalog of \w+ \d+, \d{4}$/);
  expect(checks.count()).toBe(1);

  await expect(said(page)).toBeEmpty({ timeout: 6_000 });
  expect(checks.count()).toBe(1);
  expect(await documentOrigin(page)).toBe(origin);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test("the disc follows the finger at half its speed, and a pull let go short of the threshold does nothing", async ({ page }) => {
  await launch(page, REGION);
  const checks = watchChecks(page);
  const disc = said(page).locator("..");

  await dragAndHold(page, { x: MIDDLE, y: 180 }, { x: MIDDLE, y: 180 + SHORT }, { duration: 300 });
  const held = await disc.boundingBox();
  expect(held, "the disc is on screen under the finger").not.toBeNull();
  /* 100 px of travel, less the 10 px before it counted, at half speed: 45 px down from 52 px above the top edge. */
  expect(Math.round((held?.y ?? 0) + (held?.height ?? 0))).toBeGreaterThanOrEqual(28);
  expect(Math.round((held?.y ?? 0) + (held?.height ?? 0))).toBeLessThanOrEqual(38);
  await release(page);

  await page.waitForTimeout(600);
  await expect(said(page)).toBeEmpty();
  expect(checks.count()).toBe(0);
  expect((await disc.boundingBox())?.y ?? 0).toBeLessThan(0);
});

test("with a sheet open, a pull is not the page's", async ({ page }) => {
  await launch(page, REGION);
  const row = page.locator("[data-row] a").first();
  const box = await row.boundingBox();
  if (!box) throw new Error("no row on screen");
  await tap(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(sheet(page)).toBeVisible();
  await page.waitForTimeout(400);
  const checks = watchChecks(page);

  await pull(page, 200, 40);
  await page.waitForTimeout(600);
  await expect(said(page)).toBeEmpty();
  expect(checks.count()).toBe(0);
});

test("a sideways swipe on a line of chips scrolls the chips and checks nothing", async ({ page }) => {
  await launch(page, `#/region/${CHIPPED?.id ?? ""}`);
  const checks = watchChecks(page);
  const chips = page.getByRole("navigation", { name: /categor/i }).first();
  const box = await chips.boundingBox();
  if (!box) throw new Error("no chip line on screen");
  const y = box.y + box.height / 2;
  expect(await chips.evaluate((element) => element.scrollWidth - element.clientWidth), "the chips run past the window, so a swipe has a line to scroll").toBeGreaterThan(40);

  await drag(page, { x: 320, y }, { x: 60, y: y + 30 }, { duration: 300, hold: 150 });
  await page.waitForTimeout(500);
  expect(await chips.evaluate((element) => element.scrollLeft)).toBeGreaterThan(40);
  await expect(said(page)).toBeEmpty();
  expect(checks.count()).toBe(0);
});

test("below the top of a page a downward drag scrolls it", async ({ page }) => {
  requireShape((BIG?.size ?? 0) >= TALL_LIST, `region with ${TALL_LIST} entries`);
  await launch(page, REGION);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(300);
  const checks = watchChecks(page);

  await pull(page, LONG, 250);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(600);
  await expect(said(page)).toBeEmpty();
  expect(checks.count()).toBe(0);
});

test("with the site out of reach the pull says so calmly and keeps the catalog", async ({ page, context }) => {
  await launch(page, "#/");
  const origin = await documentOrigin(page);
  await context.setOffline(true);

  await pull(page, LONG);
  await expect(said(page)).toHaveText(/^Offline · catalog of \w+ \d+, \d{4}$/);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("list", { name: /Regions of the catalog/ })).toBeVisible();

  await context.setOffline(false);
  await expect(said(page)).toBeEmpty({ timeout: 6_000 });
  expect(await documentOrigin(page)).toBe(origin);
});

test("the button on Data health is still there for a hand that does not pull", async ({ page }) => {
  await launch(page, "#/about/health");
  await expect(page.getByRole("button", { name: "Check for a newer catalog" })).toBeVisible();
});

/**
 * A catalog is built at about 01:30 UTC, the evening before in the Americas:
 * its date is read where the reader is. Of the two zones, one always falls
 * on another day than UTC, whatever hour the build ran.
 */
for (const timezoneId of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
  test.describe(`in ${timezoneId}`, () => {
    test.use({ timezoneId });

    test("the catalog's date is the reader's day", async ({ page }) => {
      const built = Date.parse(loadBuild().version.generatedAt);
      const day = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: timezoneId }).format(built);
      await launch(page, "#/");
      await pull(page, LONG);
      await expect(said(page)).toHaveText(`Up to date · catalog of ${day}`);
    });
  });
}
