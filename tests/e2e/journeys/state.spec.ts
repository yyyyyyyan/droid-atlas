/**
 * Display settings, storage that is corrupt, old or unavailable, and a catalog
 * that fails to load. ARCHITECTURE.md: "Every read tolerates missing, corrupt
 * or older-version data."
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { featuredApp, regionTile, regionsBySize } from "../lib/pick.ts";
import { countStatus, launch, navLink, ready, resultList, seedStorage, setRows, sheet, sortButton, sortSheet } from "../lib/app.ts";

const [BIG_REGION] = regionsBySize();
if (!BIG_REGION) throw new Error("the catalog has no region");
const BIG = BIG_REGION;

async function rowHeight(page: Page): Promise<number> {
  const box = await resultList(page).getByRole("listitem").first().boundingBox();
  return Math.round(box?.height ?? 0);
}

test.describe("density and theme", () => {
  test("compact rows are chosen in the sort and view sheet, persist across reload, and Settings shows the same choice", async ({ page }) => {
    await launch(page, `#/region/${BIG.id}`);
    const comfortable = await rowHeight(page);
    await setRows(page, "Compact");
    await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
    const compact = await rowHeight(page);
    expect(compact).toBeLessThan(comfortable);
    await page.reload();
    await ready(page);
    expect(await rowHeight(page)).toBe(compact);
    await sortButton(page).click();
    await expect(sortSheet(page).getByRole("radio", { name: "Compact" })).toBeChecked();
    await page.keyboard.press("Escape");
    await page.goto("/#/settings");
    await ready(page);
    await expect(page.getByRole("radio", { name: "Compact" })).toBeChecked();
    await page.getByRole("radio", { name: "Comfortable" }).check();
    await page.goto(`/#/region/${BIG.id}`);
    await ready(page);
    expect(await rowHeight(page)).toBe(comfortable);
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`"System" follows a ${scheme} system scheme, and an explicit choice overrides it and persists`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await launch(page, "#/settings");
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
      const other = scheme === "light" ? "dark" : "light";
      await page.getByRole("radio", { name: other === "light" ? "Light" : "Dark" }).check();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", other);
      await ready(page);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(background);
      await page.getByRole("radio", { name: "System" }).check();
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    });
  }

  test("dark is true black", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await launch(page, "#/");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(0, 0, 0)");
  });
});

test.describe("storage that cannot be trusted", () => {
  test("a corrupt saved list is set aside, the user is told, and saving starts again", async ({ page }) => {
    await seedStorage(page, { "droid-atlas:v1:saved": "{not json" });
    await launch(page, "#/saved");
    await expect(page.getByRole("main").getByRole("status").filter({ hasText: /could not be read/ })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("droid-atlas:v1:saved.corrupt"))).toBe("{not json");
    await navLink(page, "Explore").click();
    await regionTile(page, BIG.id).click();
    await resultList(page).getByRole("button", { name: /^Save / }).first().click();
    await navLink(page, "Saved").click();
    await expect(countStatus(page)).toHaveText(/^1 (apps?|entr(y|ies)|links?)$/);
  });

  test("corrupt settings, pins, last place and session mirrors do not stop the app", async ({ page }) => {
    await seedStorage(page, {
      "droid-atlas:v1:settings": "[",
      "droid-atlas:v1:pins": "{\"v\":1,\"items\":\"nope\"}",
      "droid-atlas:v1:lastPlace:browser": "{\"hash\":42}",
    });
    await page.evaluate(() => {
      sessionStorage.setItem("droid-atlas:v1:scroll", "{bad");
      sessionStorage.setItem("droid-atlas:v1:stack", "{\"not\":\"an array\"}");
    });
    await launch(page, "");
    await expect(page).toHaveURL(/#\/$/);
    await navLink(page, "Search").click();
    await expect(page.getByRole("region", { name: "Pins" }).getByRole("button").first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("droid-atlas:v1:pins.corrupt"))).toBe("{\"v\":1,\"items\":\"nope\"}");
    expect(await page.evaluate(() => localStorage.getItem("droid-atlas:v1:settings.corrupt"))).toBe("[");
    await page.getByRole("searchbox", { name: "Search the catalog" }).fill(featuredApp().name);
    await expect(countStatus(page)).toHaveText(/ of /);
  });

  test("data from an older shape (no version marker) is set aside rather than misread", async ({ page }) => {
    await seedStorage(page, {
      "droid-atlas:v1:saved": JSON.stringify(["org.example.one", "org.example.two"]),
      "droid-atlas:v1:settings": JSON.stringify({ theme: "light", density: "compact" }),
    });
    await launch(page, "#/saved");
    await expect(page.getByRole("main")).toContainText(/could not be read|Nothing saved yet/);
    await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
  });

  test("with storage blocked the app runs, says saves will not last, and saving still works for the session", async ({ page }) => {
    await page.addInitScript(() => {
      for (const name of ["localStorage", "sessionStorage"] as const) {
        Object.defineProperty(window, name, { get() { throw new DOMException("The operation is insecure.", "SecurityError"); } });
      }
    });
    await launch(page, "#/saved");
    await expect(page.getByRole("main")).toContainText(/not keeping data for this site/);
    await navLink(page, "Explore").click();
    await regionTile(page, BIG.id).click();
    await resultList(page).getByRole("button", { name: /^Save / }).first().click();
    await navLink(page, "Saved").click();
    await expect(countStatus(page)).toHaveText(/^1 (apps?|entr(y|ies)|links?)$/);
  });
});

test.describe("catalog load failure and recovery", () => {
  test("the connection failing says so, and Try again loads the catalog once it is back", async ({ page }) => {
    let fail = true;
    await page.route("**/data/version.json", (route) => (fail ? route.abort("internetdisconnected") : route.continue()));
    await page.goto(`/#/region/${BIG.id}`);
    await expect(page.getByRole("alert")).toContainText("The catalog did not load");
    await expect(page.getByRole("alert").getByRole("paragraph"), "a title, what to do, and a button: the error's own words are not shown").toHaveText(["Check the connection and try again."]);
    fail = false;
    await page.getByRole("button", { name: "Try again" }).click();
    await ready(page);
    await expect(page.getByRole("heading", { level: 1, name: BIG.name })).toBeVisible();
  });

  test("a missing part (HTTP 404) is reported as a fault on the site's side", async ({ page }) => {
    await page.route("**/sources/github.json", (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/#/");
    await expect(page.getByRole("alert")).toContainText("The catalog is missing");
  });

  test("a part whose bytes do not match the manifest is refused as damaged", async ({ page }) => {
    await page.route("**/sources/awesome-shizuku.json", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(/"name":"([^"]+)"/, "\"name\":\"$1 tampered\"");
      await route.fulfill({ response, body });
    });
    await page.goto("/#/");
    await expect(page.getByRole("alert")).toContainText("The catalog arrived damaged");
    await expect(page.getByRole("alert").getByRole("paragraph")).toHaveCount(0);
  });

  test("a catalog in a newer schema asks for a reload instead of misreading it", async ({ page }) => {
    await page.route("**/data/version.json", async (route) => {
      const response = await route.fetch();
      const version = await response.json() as Record<string, unknown>;
      await route.fulfill({ response, json: { ...version, schema: Number(version.schema) + 1 } });
    });
    await page.goto("/#/");
    await expect(page.getByRole("alert")).toContainText("The app needs an update");
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  });

  test("version.json is fetched bypassing the HTTP cache", async ({ page }) => {
    const pending: Promise<string>[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/data/version.json")) pending.push(request.allHeaders().then((headers) => headers["cache-control"] ?? ""));
    });
    await launch(page, "#/");
    const modes = await Promise.all(pending);
    expect(modes.length).toBeGreaterThan(0);
    expect(modes.every((value) => /no-cache|max-age=0/.test(value))).toBe(true);
  });

  test("a description that fails to load leaves the rest of the sheet complete, and Try again loads it", async ({ page }) => {
    const gallery = featuredApp();
    test.skip(!gallery.fdroid && !gallery.izzy, "the entry the suite features has no description to load in this catalog");
    let fail = true;
    await page.route("**/details/**", (route) => (fail ? route.abort("failed") : route.continue()));
    await launch(page, `#/app/${gallery.id}`);
    const failed = sheet(page).getByText("The description did not load.");
    await expect(failed).toBeVisible();
    await expect(sheet(page).getByRole("region", { name: "Details" })).toBeVisible();
    fail = false;
    await sheet(page).getByRole("button", { name: "Try again" }).click();
    await expect(failed).toHaveCount(0);
    await expect(sheet(page).locator(".sheet-desc").getByText(/^From /)).toBeVisible();
  });
});
