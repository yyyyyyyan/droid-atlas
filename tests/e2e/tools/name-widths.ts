/**
 * Compares the app's estimate of how wide a name is set in a row with what
 * the browser measures, for every name in the served catalog:
 *
 *   node tools/name-widths.ts [--base http://127.0.0.1:4324/]
 *
 * It needs the development server, which serves the app's modules one by
 * one. A row decides from the estimate, before it is laid out, whether its
 * name takes one line or two, so an estimate that is too narrow cuts a name
 * and one that is too wide gives a short name a second line's room. This
 * prints how far the estimate is from the measure and the names it gets
 * wrong at each width the journeys check.
 */

import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { loadBuild } from "../lib/catalog.ts";
import { PHONE_CONTEXT } from "../lib/phone.ts";

const { values } = parseArgs({ options: { base: { type: "string", default: "http://127.0.0.1:4324/" } } });
const names = [...new Set(loadBuild().apps.map((app) => app.name))];

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ ...PHONE_CONTEXT, serviceWorkers: "block" })).newPage();
  await page.goto(values.base);
  await page.waitForSelector(".nav");
  const rows = await page.evaluate(async (all) => {
    const facts = (await import(/* @vite-ignore */ `${location.origin}/src/catalog/facts.ts`)) as { nameWidth(name: string): number };
    const font = `600 16px ${getComputedStyle(document.documentElement).getPropertyValue("--font-ui")}`;
    await document.fonts.load(font);
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("no canvas");
    context.font = font;
    return all.map((name) => ({ name, measured: context.measureText(name).width, estimated: facts.nameWidth(name) }));
  }, names);

  const ratios = rows.filter((row) => row.measured > 0).map((row) => row.estimated / row.measured).sort((a, b) => a - b);
  const at = (share: number): string => (ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * share))] ?? 0).toFixed(3);
  console.log(`${rows.length} names; estimate / measure: least ${at(0)}, 5% ${at(0.05)}, median ${at(0.5)}, 95% ${at(0.95)}, most ${at(1)}`);
  for (const width of [320, 336, 360, 384, 412]) {
    const line = width - 126;
    const cut = rows.filter((row) => row.measured > line && row.estimated <= line);
    const spare = rows.filter((row) => row.measured <= line && row.estimated > line);
    const wrapped = rows.filter((row) => row.estimated > line).length;
    console.log(`${width} px (line ${line}): ${wrapped} names take two lines; ${cut.length} would be cut on one (${cut.slice(0, 6).map((row) => row.name).join(" | ")}); ${spare.length} get a second line they do not need (${spare.slice(0, 6).map((row) => row.name).join(" | ")})`);
  }
} finally {
  await browser.close();
}
