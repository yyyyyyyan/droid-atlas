/**
 * The app's mark in its header, on About and in the rail: one drawing shown,
 * the mark's own proportions, its pieces in the theme's fills, and nothing of
 * it cut off by the window or by a box around it, from 320 to 1920 px.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { launch } from "../lib/app.ts";

const WIDTHS = [320, 384, 768, 1024, 1440, 1920];
const FILLS = {
  dark: { k1: "rgb(182, 166, 250)", k2: "rgb(201, 181, 83)", k3: "rgb(247, 149, 141)" },
  light: { k1: "rgb(124, 108, 187)", k2: "rgb(141, 122, 0)", k3: "rgb(183, 91, 85)" },
};

interface MarkFacts { where: string; drawings: number; width: number; height: number; clipped: string | null; fills: Record<string, string> }

async function marks(page: Page): Promise<MarkFacts[]> {
  return page.locator(".mark").evaluateAll((elements) => elements
    .filter((element) => element.getClientRects().length > 0)
    .map((element) => {
      const box = element.getBoundingClientRect();
      let clipped: string | null = null;
      if (box.left < -0.5 || box.top < -0.5 || box.right > document.documentElement.clientWidth + 0.5) clipped = "the window";
      for (let parent = element.parentElement; parent && !clipped; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const outer = parent.getBoundingClientRect();
        if (box.left < outer.left - 0.5 || box.right > outer.right + 0.5 || box.top < outer.top - 0.5 || box.bottom > outer.bottom + 0.5) clipped = parent.className || parent.tagName;
      }
      const drawing = [...element.querySelectorAll("svg")].find((svg) => getComputedStyle(svg).display !== "none");
      const fills: Record<string, string> = {};
      for (const piece of ["k1", "k2", "k3"]) {
        const path = drawing?.querySelector(`.${piece}`);
        if (path) fills[piece] = getComputedStyle(path).fill;
      }
      return {
        where: element.closest(".nav-mark") ? "rail" : element.parentElement?.className ?? "",
        drawings: [...element.querySelectorAll("svg")].filter((svg) => getComputedStyle(svg).display !== "none").length,
        width: box.width,
        height: box.height,
        clipped,
        fills,
      };
    }));
}

for (const theme of ["dark", "light"] as const) {
  test(`the mark is whole and in the ${theme} theme's fills at every width`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "the widths are set here, from a phone's to a wide screen's; run once");
    await page.emulateMedia({ colorScheme: theme });
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const hash of ["#/", "#/about"]) {
        await launch(page, hash);
        const found = await marks(page);
        expect(found.length, `${hash} at ${width}`).toBeGreaterThan(0);
        for (const mark of found) {
          const label = `${mark.where} on ${hash} at ${width}`;
          expect(mark.drawings, `${label}: one drawing`).toBe(1);
          expect(mark.height, `${label}: height`).toBeGreaterThanOrEqual(17.5);
          expect(Math.abs(mark.width - (mark.height * 256) / 304), `${label}: proportions`).toBeLessThanOrEqual(0.5);
          expect(mark.clipped, `${label}: not cut off`).toBeNull();
          expect(mark.fills, `${label}: fills`).toEqual(FILLS[theme]);
        }
      }
    }
  });
}
