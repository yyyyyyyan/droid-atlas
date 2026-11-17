/**
 * A look at a long list under fast flings, against a running server: real
 * touch flings with the processor slowed, a per-frame record of whether rows
 * cover the screen, and screenshots taken while the page is moving. It prints
 * a summary; `journeys/sheets.spec.ts` and `journeys/lists.spec.ts` are the
 * checks.
 *
 *   node tools/fling-check.ts [--base http://127.0.0.1:4324/] [--out <dir>] [--cpu 4] [--hash "#/lens/shizuku"] [--flings 5] [--ms 45]
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { startFrameSampling, stopFrameSampling, summarize, throttleCpu } from "../lib/frames.ts";
import { PHONE_CONTEXT, fling } from "../lib/phone.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:4324/" },
    out: { type: "string" },
    cpu: { type: "string", default: "4" },
    hash: { type: "string", default: "#/lens/shizuku" },
    flings: { type: "string", default: "5" },
    ms: { type: "string", default: "45" },
  },
});

const browser = await chromium.launch();
const context = await browser.newContext({ ...PHONE_CONTEXT, colorScheme: "dark", serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("pageerror:", error.message));
await page.goto(`${values.base}${values.hash}`);
await page.getByRole("main").getByRole("list", { name: /sorted by/ }).waitFor();
await page.waitForTimeout(600);
await throttleCpu(page, Number(values.cpu));
if (values.out) mkdirSync(values.out, { recursive: true });

await startFrameSampling(page);
for (let index = 0; index < Number(values.flings); index += 1) {
  await fling(page, { x: 192, y: 600 }, { x: 192, y: 180 }, { duration: Number(values.ms) });
  await page.waitForTimeout(60);
}
if (values.out) {
  for (const shot of [1, 2, 3]) await page.screenshot({ path: join(values.out, `moving-${shot}.png`) });
}
await page.waitForTimeout(3500);
const down = await stopFrameSampling(page);
console.log("flings up the page  ", JSON.stringify(summarize(down)));

await startFrameSampling(page);
for (let index = 0; index < Number(values.flings); index += 1) {
  await fling(page, { x: 192, y: 180 }, { x: 192, y: 600 }, { duration: Number(values.ms) });
  await page.waitForTimeout(60);
}
if (values.out) {
  for (const shot of [1, 2, 3]) await page.screenshot({ path: join(values.out, `moving-back-${shot}.png`) });
}
await page.waitForTimeout(3500);
const up = await stopFrameSampling(page);
console.log("flings back down    ", JSON.stringify(summarize(up)));
const gaps = [...down, ...up].filter((sample) => sample.uncovered > 0);
console.log("frames with a gap   ", gaps.length, JSON.stringify(gaps.slice(0, 6)));

await browser.close();
