/**
 * ARCHITECTURE.md § Security and privacy: "No third-party request without a
 * tap". Every journey already fails on an off-origin request (lib/fixtures.ts);
 * this one walks a whole session through every view, the sheet with its
 * description and icon, saving, search, filters, the pages under About
 * (license texts and icon credits included) and settings, and records
 * every request so the audit can list what a session fetches.
 */

import { expect, test } from "../lib/fixtures.ts";
import { sheetHash } from "../lib/catalog.ts";
import { biggestLens, commonNameWord, featuredApp, level, regionTile } from "../lib/pick.ts";
import { appRows, launch, navLink, openFilters, setRows, sheet } from "../lib/app.ts";

test("a full session requests nothing outside the site's origin until a link is tapped", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "").origin;
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const L = level();
  const app = featuredApp();

  await launch(page, "#/");
  await regionTile(page, L.regionId).click();
  await page.evaluate(() => window.scrollTo(0, 1500));
  await page.waitForTimeout(300);
  await page.goto(`/${sheetHash(app)}`);
  await expect(sheet(page, app.name)).toBeVisible();
  await expect(sheet(page).getByText("Loading…", { exact: true })).toHaveCount(0);
  await sheet(page).getByRole("button", { name: /^Save / }).click();
  await page.keyboard.press("Escape");
  await navLink(page, "Search").click();
  await page.getByRole("searchbox", { name: "Search the catalog" }).fill(commonNameWord());
  const filters = await openFilters(page);
  await filters.getByRole("button", { pressed: false, disabled: false }).filter({ hasText: /\d$/ }).first().click();
  await page.keyboard.press("Escape");
  await appRows(page).first().click();
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await navLink(page, "Saved").click();
  await page.goto(`/#/lens/${biggestLens().key}`);
  await setRows(page, "Compact");
  for (const about of ["#/about", "#/about/sources", "#/about/icons", "#/about/health", "#/about/notices", "#/about/license/GPL-3.0-or-later"]) {
    await page.goto(`/${about}`);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeVisible();
  }
  await expect(page.getByRole("main").getByText("Loading")).toHaveCount(0);
  await page.goto("/#/settings");
  await page.getByRole("radio", { name: "Light" }).check();
  await page.waitForTimeout(500);

  const offsite = requests.filter((url) => !url.startsWith("data:") && new URL(url).origin !== origin);
  expect(offsite).toEqual([]);
  const paths = [...new Set(requests.map((url) => new URL(url).pathname.replace(/\/c\/[0-9a-f]+\//, "/c/<hash>/").replace(/\/icons\/[0-9a-f]+\.webp$/, "/icons/<hash>.webp").replace(/\/assets\/[^/]+$/, "/assets/<file>")))].sort();
  test.info().annotations.push({ type: "requests", description: `${requests.length} requests; distinct paths: ${paths.join(" ")}` });
});
