/**
 * A quick look at how the sheets answer real touch input, against a running
 * server. It prints what it saw after each gesture; the journeys in
 * `journeys/sheets.spec.ts` are the checks.
 *
 *   node tools/drag-check.ts [--base http://127.0.0.1:4324/]
 */

import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";
import { loadBuild } from "../lib/catalog.ts";
import { PHONE_CONTEXT, centerOf, drag, fling, tap } from "../lib/phone.ts";

const { values } = parseArgs({ options: { base: { type: "string", default: "http://127.0.0.1:4324/" } } });
const build = loadBuild();
const categories = [...build.categories.values()]
  .map((category) => ({ id: category.id, size: build.apps.filter((app) => app.categories.has(category.id)).length }))
  .sort((a, b) => b.size - a.size);
const category = categories[0]?.id ?? "";

async function state(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const sheet = document.querySelector<HTMLDialogElement>("dialog.sheet");
    const panel = document.querySelector<HTMLDialogElement>("dialog.panel[open]");
    const body = document.querySelector<HTMLElement>("dialog[open] [data-sheet-scroll]");
    return {
      hash: location.hash,
      length: history.length,
      idx: (history.state as { idx?: number } | null)?.idx,
      sheet: sheet?.open ? sheet.className.replace("bsheet sheet ", "") : "closed",
      sheetTop: sheet?.open ? Math.round(sheet.getBoundingClientRect().top) : null,
      panel: panel ? Math.round(panel.getBoundingClientRect().top) : "closed",
      bodyScroll: body ? Math.round(body.scrollTop) : null,
      pageScroll: Math.round(window.scrollY),
      origin: Math.round(performance.timeOrigin),
    };
  });
}

const browser = await chromium.launch();
const context = await browser.newContext({ ...PHONE_CONTEXT, colorScheme: "dark", serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("pageerror:", error.message));
const say = async (what: string): Promise<void> => {
  await page.waitForTimeout(450);
  console.log(what.padEnd(46), JSON.stringify(await state(page)));
};

await page.goto(`${values.base}#/cat/${category}`);
await page.locator(".rows .row-link").first().waitFor();
await page.evaluate(() => window.scrollTo(0, 300));
await page.waitForTimeout(300);
await say("list, scrolled 300");

await tap(page, await centerOf(page, ".rows .row:nth-child(3) .row-link"));
await say("tap a row");

await drag(page, { x: 192, y: 420 }, { x: 192, y: 460 }, { duration: 300, hold: 200 });
await say("body: short slow drag down 40");

await drag(page, { x: 192, y: 420 }, { x: 192, y: 640 }, { duration: 400, hold: 200 });
await say("body: slow drag down 220");

await tap(page, await centerOf(page, ".rows .row:nth-child(3) .row-link"));
await say("tap a row again");

await drag(page, { x: 192, y: 500 }, { x: 192, y: 300 }, { duration: 250 });
await say("half: swipe up 200 in the body");

await drag(page, { x: 192, y: 500 }, { x: 192, y: 250 }, { duration: 250, hold: 150 });
await say("full: swipe up 250 in the body");

await drag(page, { x: 192, y: 300 }, { x: 192, y: 480 }, { duration: 250, hold: 150 });
await say("full, scrolled: drag down 180 in the body");

await page.evaluate(() => document.querySelector("dialog[open] [data-sheet-scroll]")?.scrollTo(0, 0));
await drag(page, { x: 192, y: 200 }, { x: 192, y: 330 }, { duration: 300, hold: 200 });
await say("full, at top: slow drag down 130 in body");

await fling(page, { x: 192, y: 34 }, { x: 192, y: 240 });
await say("full: fling down from the top strip");

await tap(page, await centerOf(page, ".rows .row:nth-child(3) .row-link"));
await page.waitForTimeout(400);
await fling(page, { x: 192, y: 300 }, { x: 192, y: 390 });
await say("half: short fling down on the title");

await tap(page, await centerOf(page, ".bar-filter"));
await say("open filters");
await drag(page, { x: 192, y: 400 }, { x: 192, y: 200 }, { duration: 250, hold: 150 });
await say("filters: swipe up in the body");
await drag(page, { x: 192, y: 300 }, { x: 192, y: 450 }, { duration: 250, hold: 150 });
await say("filters, scrolled: drag down in the body");
await page.evaluate(() => document.querySelector("dialog[open] [data-sheet-scroll]")?.scrollTo(0, 0));
await drag(page, { x: 192, y: 300 }, { x: 192, y: 560 }, { duration: 350, hold: 150 });
await say("filters, at top: drag down 260 in the body");

await tap(page, await centerOf(page, ".bar-sort"));
await say("open sort");
const head = await centerOf(page, "dialog.panel[open] .bsheet-head");
await fling(page, head, { x: head.x, y: head.y + 90 });
await say("sort: fling down from the header");

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await drag(page, { x: 192, y: 250 }, { x: 192, y: 600 }, { duration: 400, hold: 300 });
await say("list at its top: pull down 350");

await browser.close();
