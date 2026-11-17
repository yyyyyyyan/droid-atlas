/**
 * How long the icon credits hold the page: opening them, typing a letter in
 * their search, and clearing it, which brings every row back. Measured in
 * headless Chromium with the processor slowed, which is a guide to a phone
 * and not a measurement of one:
 *
 *   node tools/credits-timing.ts [--base http://127.0.0.1:4328/] [--slow 4]
 *
 * For each step it prints the time from the input to the second frame after
 * it (when the result is on screen) and the longest single task the page
 * ran while it settled. A site is served for it with
 * `E2E_SITE_DIR=<dir> node serve.ts --port 4328`.
 */

import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { PHONE_CONTEXT } from "../lib/phone.ts";

const { values } = parseArgs({ options: { base: { type: "string", default: "http://127.0.0.1:4328/" }, slow: { type: "string", default: "4" } } });
const rate = Number(values.slow) || 1;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ...PHONE_CONTEXT, reducedMotion: "reduce", serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(`${values.base}#/`);
  await page.waitForSelector(".nav");
  await page.waitForTimeout(1500);
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate });

  const opened = await page.evaluate(async () => {
    let longest = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longest = Math.max(longest, entry.duration);
    });
    observer.observe({ entryTypes: ["longtask"] });
    const started = performance.now();
    location.hash = "#/about/icons";
    let first = 0;
    let all = 0;
    while (performance.now() - started < 30_000) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const list = document.querySelector(".credits");
      if (!first && list && list.children.length > 0) first = performance.now() - started;
      if (list && list.children.length > 0 && list.getAttribute("aria-busy") !== "true") {
        all = performance.now() - started;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    observer.disconnect();
    return { first: Math.round(first), all: Math.round(all), rows: document.querySelector(".credits")?.children.length ?? 0, longest: Math.round(longest) };
  });
  console.log(`processor slowed ${rate}x`);
  console.log(`open: first rows after ${opened.first} ms, all ${opened.rows} rows after ${opened.all} ms, longest task ${opened.longest} ms`);

  const typing = (value: string) => page.evaluate(async (text) => {
    const input = document.querySelector<HTMLInputElement>("#credits-search");
    if (!input) return null;
    let longest = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longest = Math.max(longest, entry.duration);
    });
    observer.observe({ entryTypes: ["longtask"] });
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    const started = performance.now();
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const shown = performance.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 6000));
    observer.disconnect();
    const rows = [...(document.querySelector(".credits")?.children ?? [])].filter((row) => !(row as HTMLElement).hidden).length;
    return { shown: Math.round(shown), longest: Math.round(longest), rows };
  }, value);

  for (const [label, text] of [["type “a”", "a"], ["type “au”", "au"], ["clear the field", ""], ["type “termux”", "termux"], ["clear the field again", ""]] as const) {
    const result = await typing(text);
    console.log(result ? `${label}: on screen after ${result.shown} ms, longest task ${result.longest} ms, ${result.rows} rows shown` : `${label}: no search field`);
  }
} finally {
  await browser.close();
}
