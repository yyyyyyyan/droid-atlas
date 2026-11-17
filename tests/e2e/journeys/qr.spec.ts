/**
 * On a computer, the wide panel offers the page's link as a QR code for a
 * phone's camera: drawn in the page with nothing asked of another site, dark
 * on white in either theme, and offered nowhere a phone or a narrow window is.
 */

import { expect, test } from "../lib/fixtures.ts";
import { isLink, sheetHash } from "../lib/catalog.ts";
import { build, featuredApp } from "../lib/pick.ts";
import { launch, sheet } from "../lib/app.ts";

const CODE_NAME = "QR code of the link to this page";
const CODE_TEXT = "Point your phone’s camera here to open this page.";
const PLATE_PX = 164;

test.describe("on a computer", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a mouse and the wide layout");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`the panel shows the page's link as a QR code, dark on white, asking nothing of another site (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await launch(page, sheetHash(featuredApp()));
      const origin = new URL(page.url()).origin;
      const elsewhere: string[] = [];
      page.on("request", (request) => {
        if (new URL(request.url()).origin !== origin) elsewhere.push(request.url());
      });
      const toggle = sheet(page).getByRole("button", { name: "Open on phone" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(sheet(page).getByRole("img", { name: CODE_NAME })).toHaveCount(0);
      const closedLook = await toggle.evaluate((button) => getComputedStyle(button).backgroundColor);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.blur();
      await page.mouse.move(0, 0);
      expect(await toggle.evaluate((button) => getComputedStyle(button).backgroundColor), "the open button looks on").not.toBe(closedLook);
      const code = sheet(page).getByRole("img", { name: CODE_NAME });
      await expect(code, "the code comes into view whole").toBeInViewport({ ratio: 1 });
      const drawn = await code.evaluate((svg) => {
        const [, , side] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
        const box = svg.getBoundingClientRect();
        return {
          side: side ?? 0,
          width: box.width,
          height: box.height,
          plate: svg.querySelector("rect")?.getAttribute("fill"),
          ink: svg.querySelector("path")?.getAttribute("fill"),
          runs: (svg.querySelector("path")?.getAttribute("d") ?? "").split("M").length - 1,
        };
      });
      expect(drawn.side, "the smallest code with its margin is 29 modules").toBeGreaterThanOrEqual(29);
      expect([drawn.width, drawn.height]).toEqual([PLATE_PX, PLATE_PX]);
      expect([drawn.plate, drawn.ink]).toEqual(["#fff", "#000"]);
      expect(drawn.runs).toBeGreaterThan(50);
      const panel = await sheet(page).boundingBox();
      const box = await code.boundingBox();
      expect(box && panel && box.x + box.width <= panel.x + panel.width, "the code fits the panel").toBe(true);
      const words = sheet(page).getByText(CODE_TEXT);
      await expect(words).toBeVisible();
      const wordsBox = await words.boundingBox();
      expect(wordsBox && box && wordsBox.x >= box.x + box.width && wordsBox.y >= box.y && wordsBox.y + wordsBox.height <= box.y + box.height, "the line stands right of the code, within its height").toBe(true);
      expect(elsewhere).toEqual([]);
      await toggle.click();
      await expect(code).toHaveCount(0);
    });
  }

  test("the plate is one size for a short link and a long one", async ({ page }) => {
    const apps = build.apps.filter((app) => !isLink(app)).sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id));
    const sizes: number[][] = [];
    for (const app of [apps[0], apps.at(-1)]) {
      if (!app) continue;
      await launch(page, sheetHash(app));
      await sheet(page).getByRole("button", { name: "Open on phone" }).click();
      const code = sheet(page).getByRole("img", { name: CODE_NAME });
      await expect(code).toBeVisible();
      const box = await code.boundingBox();
      sizes.push([box?.width ?? 0, box?.height ?? 0]);
    }
    expect(sizes).toEqual([[PLATE_PX, PLATE_PX], [PLATE_PX, PLATE_PX]]);
  });

  test("a narrow window does not offer it", async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await launch(page, sheetHash(featuredApp()));
    await expect(sheet(page).getByRole("button", { name: "Copy link to this page" })).toBeVisible();
    await expect(sheet(page).getByRole("button", { name: "Open on phone" })).toBeHidden();
  });
});

test("a phone is not offered a code for itself", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "touch only");
  await launch(page, sheetHash(featuredApp()));
  await expect(sheet(page).getByRole("button", { name: "Copy link to this page" })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Open on phone" })).toHaveCount(0);
});
