/**
 * What depends on where the app runs: Android, an iPhone, or a computer. The
 * platform is decided once, from the browser's own statement where it gives
 * one and the user agent otherwise; these journeys set the user agent, which
 * Chromium also reports as its platform.
 *
 * - Only Android gets an `intent:` link.
 * - Install: the button where the browser offers it; the browser menu named
 *   on Android, where it installs from there, unless the app is installed
 *   already; nothing anywhere else.
 * - Wording that would be untrue elsewhere: "your F-Droid app", "tap".
 */

import { expect, test } from "../lib/fixtures.ts";
import { build, featuredApp, lensTest, requireShape } from "../lib/pick.ts";
import { descriptionsOf, sample, sheetHash, type App } from "../lib/catalog.ts";
import { ANDROID_CHROME_UA, DESKTOP_UA, launch, sheet } from "../lib/app.ts";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";

const FIREFOX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:146.0) Gecko/20100101 Firefox/146.0";

const PLATFORMS = [
  { name: "Android", ua: ANDROID_CHROME_UA, android: true, desktop: false },
  { name: "an iPhone", ua: IPHONE_UA, android: false, desktop: false },
  { name: "a computer", ua: DESKTOP_UA, android: false, desktop: true },
  { name: "a computer with Firefox", ua: FIREFOX_UA, android: false, desktop: true },
];

for (const platform of PLATFORMS) {
  test.describe(`on ${platform.name}`, () => {
    test.use({ userAgent: platform.ua });
    test.beforeEach(({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "what is said depends on the platform, not the layout; run once");
      void page;
    });

    test("a sheet's links: an intent link only on Android", async ({ page }) => {
      await launch(page, sheetHash(featuredApp()));
      await expect(sheet(page)).toBeVisible();
      const hrefs = await sheet(page).locator("a[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
      const intents = hrefs.filter((href) => href.startsWith("intent:"));
      if (platform.android) expect(intents.length).toBeLessThanOrEqual(1);
      else expect(intents, "nothing but Android answers an intent link").toEqual([]);
      if (!platform.android) await expect(sheet(page).getByText(/^Needs /)).toHaveCount(0);
    });

    test("twenty sheets in each of two lenses: every address off the app is the web's, and Obtainium is named only on Android, where the catalog does not name it", async ({ page }) => {
      test.skip(platform.android, "on Android the sheet keeps its intent link");
      for (const key of ["apk", "fdroid"]) {
        const namesObtainium = (app: App): boolean => JSON.stringify(app).includes("Obtainium") || descriptionsOf(build, app.id).some((text) => text.includes("Obtainium"));
        const apps = sample(build.apps.filter((app) => lensTest(key)(app) && !namesObtainium(app)), 20, 11);
        requireShape(apps.length > 0, `apps in the ${key} lens`);
        for (const app of apps) {
          await launch(page, sheetHash(app));
          await expect(sheet(page, app.name)).toBeVisible();
          const hrefs = await sheet(page).locator("[href]").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
          expect(hrefs.filter((href) => !href.startsWith("#") && !/^https?:/.test(href)), app.id).toEqual([]);
          await expect(sheet(page)).not.toContainText("Obtainium");
        }
      }
    });

    test("Install: nothing in a tab of a browser that has the app installed already", async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "getInstalledRelatedApps", { value: () => Promise.resolve([{ platform: "webapp", url: `${location.origin}/manifest.webmanifest` }]) });
      });
      await launch(page, "#/settings");
      await expect(page.getByRole("main").getByRole("heading", { name: "Your data" })).toBeVisible();
      await expect(page.getByRole("main").getByRole("heading", { name: "Install", exact: true })).toHaveCount(0);
      await expect(page.getByRole("main").getByText(/Add to Home screen/)).toHaveCount(0);
    });

    test("Install says only what this platform can do", async ({ page }) => {
      await launch(page, "#/settings");
      const install = page.getByRole("main").getByRole("heading", { name: "Install", exact: true });
      if (platform.android) {
        await expect(page.getByRole("main").getByText("In the browser menu, choose Add to Home screen.")).toBeVisible();
      } else {
        await expect(install, "no instruction that does not apply here, and no empty section").toHaveCount(0);
        await expect(page.getByRole("main").getByText(/Add to Home screen/)).toHaveCount(0);
      }
    });

    test("About's how-to and Saved's hint speak of what this platform has", async ({ page }) => {
      await launch(page, "#/about");
      const howTo = page.getByRole("main").getByRole("region", { name: "How to use it" });
      if (platform.android) await expect(howTo).toContainText("your F-Droid app");
      else {
        await expect(howTo).not.toContainText("F-Droid app");
        await expect(howTo).not.toContainText("Obtainium");
        await expect(howTo).toContainText("The get-it buttons open the store’s web page.");
      }
      await launch(page, "#/saved");
      await expect(page.getByRole("main")).toContainText("Use the bookmark on an app to keep it here.");
    });
  });
}
