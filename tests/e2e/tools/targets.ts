/**
 * How much of each control answers a tap, measured by hit-testing outward
 * from its center, so a control partly covered by a neighbor counts only
 * where a tap reaches it. Prints every control on screen that answers over
 * less than 44 px in either direction:
 *
 *   node tools/targets.ts [--base http://127.0.0.1:4324/] [--width 384]
 *
 * The layout journey measures boxes; this is the stricter look, for the
 * views where targets sit close together.
 */

import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";
import { sheetHash } from "../lib/catalog.ts";
import { PHONE_CONTEXT, PHONE_VIEWPORT } from "../lib/phone.ts";
import { build, featuredApp, regionsBySize } from "../lib/pick.ts";

const { values } = parseArgs({ options: { base: { type: "string", default: "http://127.0.0.1:4324/" }, width: { type: "string" } } });
const width = Number(values.width) || PHONE_VIEWPORT.width;
const region = regionsBySize()[0]?.id ?? "";
const category = build.apps.find((app) => app.regions.has(region))?.atlas.category ?? "";
const gone = build.apps.find((app) => app.atlas.repoMissing);

interface View {
  name: string;
  hash: string;
  /** Scroll positions to measure at, as fractions of the scrollable height of the view or the open sheet. */
  at?: number[];
}

const VIEWS: View[] = [
  { name: "Explore", hash: "#/", at: [0, 1] },
  { name: "a category", hash: `#/cat/${category}` },
  { name: "the app sheet", hash: sheetHash(featuredApp()), at: [0, 0.25, 0.5, 0.75, 1] },
  ...(gone ? [{ name: "a sheet whose repository is gone", hash: sheetHash(gone), at: [0, 1] }] : []),
  { name: "Settings", hash: "#/settings", at: [0, 1] },
  { name: "Sources and licenses", hash: "#/about/sources", at: [0, 0.2, 0.4, 0.6, 0.8, 1] },
  { name: "Data health", hash: "#/about/health", at: [0, 0.33, 0.66, 1] },
  { name: "Icon credits", hash: "#/about/icons" },
  { name: "About", hash: "#/about", at: [0, 1] },
];

async function measure(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const modal = [...document.querySelectorAll("dialog[open]")].find((dialog) => dialog.matches(":modal"));
    const controls = (modal ?? document).querySelectorAll<HTMLElement>("a[href], button, select, input:not([type=hidden]), summary, [role=button]");
    for (const element of controls) {
      if (element.closest("[inert]") || element.matches(":disabled")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const target = element.tagName === "INPUT" ? element.closest("label") ?? element : element;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const answers = (px: number, py: number): boolean => {
        const hit = document.elementFromPoint(px, py);
        return hit !== null && (target.contains(hit) || hit.contains(element));
      };
      /* Only a control whose center a tap reaches, with 30 px of the screen around it, is measured: the rest is under a bar or at the screen's edge. */
      if (x < 30 || x > innerWidth - 30 || y < 30 || y > innerHeight - 30 || !answers(x, y)) continue;
      /* A control that runs under a bar fixed to the screen is not short, it is scrolled: it is left for another scroll position. */
      let underBar = false;
      const pinned = (hit: Element | null): boolean => {
        for (let node = hit; node && node !== document.body; node = node.parentElement) {
          if (node.contains(target)) return false;
          const position = getComputedStyle(node).position;
          if (position === "fixed" || position === "sticky") return true;
        }
        return hit === null;
      };
      let scroller: Element | null = target.parentElement;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      const frame = scroller?.getBoundingClientRect() ?? null;
      const reach = (dx: number, dy: number): number => {
        let steps = 0;
        while (steps < 40 && answers(x + dx * (steps + 1), y + dy * (steps + 1))) steps += 1;
        const stopY = y + dy * (steps + 1);
        if (steps < 40 && (pinned(document.elementFromPoint(x + dx * (steps + 1), stopY)) || (frame !== null && (stopY < frame.top || stopY > frame.bottom)))) underBar = true;
        return steps;
      };
      const wide = reach(-1, 0) + reach(1, 0) + 1;
      const tall = reach(0, -1) + reach(0, 1) + 1;
      if (!underBar && Math.min(wide, tall) < 44) {
        const name = (element.getAttribute("aria-label") ?? element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 36);
        out.push(`${element.tagName.toLowerCase()} “${name}” answers over ${wide}×${tall}`);
      }
    }
    return [...new Set(out)];
  });
}

const browser = await chromium.launch();
try {
  for (const view of VIEWS) {
    const context = await browser.newContext({ ...PHONE_CONTEXT, viewport: { width, height: PHONE_VIEWPORT.height }, reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    await page.goto(`${values.base}${view.hash}`);
    await page.waitForSelector(".nav");
    await page.waitForTimeout(900);
    const found = new Set<string>();
    for (const fraction of view.at ?? [0]) {
      await page.evaluate((part) => {
        const body = document.querySelector<HTMLElement>("dialog[open] .sheet-body");
        if (body) body.scrollTop = (body.scrollHeight - body.clientHeight) * part;
        else window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * part);
      }, fraction);
      await page.waitForTimeout(250);
      for (const line of await measure(page)) found.add(line);
    }
    console.log(`${view.name}: ${found.size === 0 ? "every control answers over 44 px" : ""}`);
    for (const line of found) console.log(`  ${line}`);
    await context.close();
  }
} finally {
  await browser.close();
}
