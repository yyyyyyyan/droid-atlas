/**
 * The `test` every journey uses. Two guards run automatically around each test:
 *
 * - No hand-off is ever followed. A click on an `intent:` or `obtainium:` link
 *   is canceled before the browser acts on it, and the test fails if one
 *   happened, because following one from automation proves nothing and could
 *   launch an external handler on the machine.
 * - No request leaves the app's origin. ARCHITECTURE.md § Security and privacy:
 *   "No third-party request without a tap". Every journey is therefore also a
 *   network test.
 */

import { expect, test as base } from "@playwright/test";

export const test = base.extend<{ guards: void }>({
  guards: [
    async ({ page, baseURL }, use, testInfo) => {
      const origin = new URL(baseURL ?? "http://localhost:4322/").origin;
      const offOrigin: string[] = [];
      page.on("request", (request) => {
        const url = request.url();
        if (url.startsWith("data:") || url.startsWith("blob:") || url === "about:blank") return;
        if (new URL(url).origin !== origin) offOrigin.push(url);
      });
      await page.addInitScript(() => {
        const taps: string[] = [];
        Object.defineProperty(window, "__handoffTaps", { value: taps });
        window.addEventListener("click", (event) => {
          const link = (event.target as Element | null)?.closest?.("a[href]");
          const href = link?.getAttribute("href") ?? "";
          if (/^(intent|obtainium|market|fdroid\.app):/i.test(href)) {
            event.preventDefault();
            taps.push(href);
          }
        }, true);
      });
      await use();
      const taps = await page.evaluate(() => (window as unknown as { __handoffTaps?: string[] }).__handoffTaps ?? []).catch(() => []);
      if (!testInfo.annotations.some((a) => a.type === "allows-offsite")) {
        expect(offOrigin, "requests that left the origin").toEqual([]);
      }
      expect(taps, "hand-off links that were activated").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
