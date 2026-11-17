/**
 * The sheet never shows a placeholder for an app that has an icon: it shows
 * the list-size file at once and the large one once that has loaded, and a
 * large file that fails or is slow leaves the small one.
 */

import { expect, test } from "../lib/fixtures.ts";
import { build, requireShape } from "../lib/pick.ts";
import { sheetHash } from "../lib/catalog.ts";
import { launch, sheet } from "../lib/app.ts";

/* The reference phone's pixel ratio, at which a 56 px icon given both files in `srcset` is drawn from the large one. */
test.use({ deviceScaleFactor: 3.75 });

const WITH_BOTH = [...build.apps].sort((a, b) => a.id.localeCompare(b.id)).find((app) => app.atlas.icon && app.atlas.iconLarge && app.atlas.icon !== app.atlas.iconLarge);

test("a large icon that fails leaves the small one in the sheet, never the placeholder", async ({ page }) => {
  requireShape(Boolean(WITH_BOTH), "app with an icon in two sizes");
  if (!WITH_BOTH?.atlas.iconLarge) return;
  await page.route(`**/${WITH_BOTH.atlas.iconLarge}`, (route) => route.abort("failed"));
  await launch(page, sheetHash(WITH_BOTH));
  await expect(sheet(page)).toBeVisible();
  const icon = sheet(page).locator(".sheet-head .ico");
  await expect(icon).toHaveClass(/has-img/);
  await page.waitForTimeout(800);
  await expect(icon, "still the icon, not a placeholder").toHaveClass(/has-img/);
  await expect(icon.locator("img")).toHaveAttribute("src", new RegExp(`${WITH_BOTH.atlas.icon}$`));
});

const LARGE = new Set(build.apps.flatMap((app) => (app.atlas.iconLarge && app.atlas.iconLarge !== app.atlas.icon ? [app.atlas.iconLarge.split("/").pop() ?? ""] : [])));

test("with every large icon out of reach, thirty sheets show thirty icons: no placeholder, no empty plate", async ({ page }) => {
  test.setTimeout(180_000);
  const apps = [...build.apps].filter((app) => app.atlas.icon && app.listings.some((listing) => listing.kind === "app")).sort((a, b) => a.id.localeCompare(b.id));
  requireShape(apps.length >= 30, "thirty apps with an icon");
  await page.route("**/icons/**", (route) => (LARGE.has(new URL(route.request().url()).pathname.split("/").pop() ?? "") ? route.abort("internetdisconnected") : route.continue()));
  const step = Math.max(1, Math.floor(apps.length / 30));
  const missing: string[] = [];
  for (const app of apps.filter((_, index) => index % step === 0).slice(0, 30)) {
    await launch(page, sheetHash(app));
    const icon = sheet(page).locator(".sheet-head .ico");
    await expect(icon).toHaveClass(/has-img/, { timeout: 5000 }).catch(() => missing.push(`${app.id}: ${"not shown"}`));
    await page.waitForTimeout(200);
    const shown = await icon.getAttribute("class");
    if (!/has-img/.test(shown ?? "")) missing.push(`${app.id}: ${shown}`);
  }
  expect(missing, "every sheet shows its icon").toEqual([]);
});

test("online, the large icon replaces the list-size one with no step back to an empty plate or a placeholder, and rows never ask for a large one", async ({ page }) => {
  requireShape(Boolean(WITH_BOTH), "app with an icon in two sizes");
  if (!WITH_BOTH?.atlas.iconLarge) return;
  const largeAsked: string[] = [];
  page.on("request", (request) => {
    const name = new URL(request.url()).pathname.split("/").pop() ?? "";
    if (LARGE.has(name)) largeAsked.push(name);
  });
  await page.addInitScript(() => {
    const states: string[] = [];
    (window as unknown as { iconStates: string[] }).iconStates = states;
    new MutationObserver(() => {
      const icon = document.querySelector(".sheet-head .ico");
      if (icon && states.at(-1) !== icon.className) states.push(icon.className);
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "src"] });
  });
  await launch(page, `${sheetHash(WITH_BOTH)}`);
  const img = sheet(page).locator(".sheet-head .ico img");
  await expect(img).toHaveAttribute("src", new RegExp(`${WITH_BOTH.atlas.iconLarge}$`), { timeout: 8000 });
  const states = await page.evaluate(() => (window as unknown as { iconStates: string[] }).iconStates);
  const firstShown = states.findIndex((state) => /has-img/.test(state));
  expect(firstShown, "the icon was shown").toBeGreaterThanOrEqual(0);
  expect(states.slice(firstShown).filter((state) => !/has-img/.test(state)), "once shown, never empty or a placeholder again").toEqual([]);

  largeAsked.length = 0;
  await page.goto("/#/lens/shizuku");
  await expect(page.getByRole("main")).toBeVisible();
  for (const y of [0, 3000, 9000, 20000]) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(300);
  }
  expect(largeAsked, "a list asks only for list-size icons").toEqual([]);
});

test("a slow large icon follows the small one, which shows at once", async ({ page }) => {
  requireShape(Boolean(WITH_BOTH), "app with an icon in two sizes");
  if (!WITH_BOTH?.atlas.iconLarge) return;
  await page.route(`**/${WITH_BOTH.atlas.iconLarge}`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });
  await launch(page, sheetHash(WITH_BOTH));
  const img = sheet(page).locator(".sheet-head .ico img");
  await expect(img).toHaveAttribute("src", new RegExp(`${WITH_BOTH.atlas.icon}$`));
  await expect(sheet(page).locator(".sheet-head .ico")).toHaveClass(/has-img/);
  await expect(img).toHaveAttribute("src", new RegExp(`${WITH_BOTH.atlas.iconLarge}$`), { timeout: 8000 });
});

for (const ratio of [1, 2, 3, 3.75]) {
  test.describe(`at ${ratio} device pixels per CSS pixel`, () => {
    test.use({ deviceScaleFactor: ratio });
    test(ratio > 192 / 56 ? "the sheet fetches the large icon and shows it" : "the sheet asks for no icon file beyond the one its row shows", async ({ page }) => {
      requireShape(Boolean(WITH_BOTH), "app with an icon in two sizes");
      if (!WITH_BOTH?.atlas.iconLarge) return;
      const largeAsked: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).pathname.endsWith(WITH_BOTH.atlas.iconLarge ?? "")) largeAsked.push(request.url());
      });
      await launch(page, sheetHash(WITH_BOTH));
      const icon = sheet(page).locator(".sheet-head .ico");
      await expect(icon).toHaveClass(/has-img/);
      if (ratio > 192 / 56) {
        await expect(icon.locator("img")).toHaveAttribute("src", new RegExp(`${WITH_BOTH.atlas.iconLarge}$`));
      } else {
        await page.waitForTimeout(800);
        expect(largeAsked, "no large file asked for").toEqual([]);
        await expect(icon.locator("img")).toHaveAttribute("src", new RegExp(`${WITH_BOTH.atlas.icon}$`));
      }
    });
  });
}
