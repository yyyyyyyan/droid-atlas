/**
 * Share in Settings, against a stand-in for Chrome for Android's rule: it
 * shares files of a short list of types, refuses JSON with `NotAllowedError`
 * although `canShare` says yes, and refuses any share asked for outside the
 * tap that allowed it. Whether Android's share sheet then opens is the
 * phone's to confirm; what is held here is what the page asks for, and when.
 *
 * Also: a result of Settings' buttons is seen, above the bottom bar.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { launch, primaryNav } from "../lib/app.ts";

interface ShareCall { name: string; type: string; active: boolean }

/** Replaces the browser's share with one that follows Chrome for Android's rule, or refuses everything. */
async function standInShare(page: Page, refuseAll: boolean): Promise<void> {
  await page.addInitScript((refuse) => {
    const calls: { name: string; type: string; active: boolean }[] = [];
    (window as unknown as { shareCalls: typeof calls }).shareCalls = calls;
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: (data: { files?: File[] }) => {
        const file = data.files?.[0];
        const active = navigator.userActivation.isActive;
        calls.push({ name: file?.name ?? "", type: file?.type ?? "", active });
        if (refuse || !active || file?.type !== "text/plain") return Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
        return Promise.resolve();
      },
    });
  }, refuseAll);
}

const calls = (page: Page): Promise<ShareCall[]> => page.evaluate(() => (window as unknown as { shareCalls: ShareCall[] }).shareCalls);

test("Share hands the export to the share sheet inside the tap, in the form Chrome for Android takes", async ({ page }) => {
  await standInShare(page, false);
  await launch(page, "#/settings");
  const share = page.getByRole("main").getByRole("button", { name: "Share" });
  await share.scrollIntoViewIfNeeded();
  await share.click();
  await expect.poll(() => calls(page)).toHaveLength(1);
  const [call] = await calls(page);
  expect(call, "one file, plain text, asked for while the tap still counts").toMatchObject({ type: "text/plain", active: true });
  expect(call?.name).toMatch(/\.txt$/);
  await expect(page.getByRole("main").getByText("Sharing failed")).toHaveCount(0);
});

test("a share the browser refuses says so above the bottom bar, and the button is not offered again", async ({ page }) => {
  await standInShare(page, true);
  /* The installed app's window on the reference phone, where Settings opens with its buttons just above the bottom bar. */
  await page.setViewportSize({ width: 384, height: 744 });
  await launch(page, "#/settings");
  const share = page.getByRole("main").getByRole("button", { name: "Share" });
  await share.click();
  const result = page.getByRole("main").getByText("Sharing failed. Use Export.");
  await expect(result).toBeVisible();
  await page.waitForTimeout(600);
  const box = await result.boundingBox();
  const bar = await primaryNav(page).boundingBox();
  expect(box, "the result is on screen").not.toBeNull();
  if (box && bar) {
    expect(box.y, "below the top of the screen").toBeGreaterThanOrEqual(0);
    if (bar.y > box.y) expect(box.y + box.height, "and above the bottom bar").toBeLessThanOrEqual(bar.y);
  }
  await expect(share, "a browser that refused one share refuses the next").toHaveCount(0);
});
