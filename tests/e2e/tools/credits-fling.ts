/**
 * Hard flings through the icon credits, judged by what is painted: the
 * composited frames are recorded (the DevTools screencast) while the page is
 * thrown with the processor slowed, and each frame's list area, under the
 * search bar and above the bottom bar, is cut into bands; a band with nothing
 * but the page's background is empty. The way the device review counted
 * frames from a screen recording. A guide, not a measurement of a phone.
 *
 *   node tools/credits-fling.ts [--base http://127.0.0.1:4324/] [--cpu 4] [--flings 6] [--out <dir>]
 *
 * With `--out`, the frames judged empty are written there, to look at.
 *
 * Prints, per direction, the frames recorded, how many were empty over the
 * whole list area, and how many over its lower half.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";
import { throttleCpu } from "../lib/frames.ts";
import { PHONE_CONTEXT, PHONE_VIEWPORT, fling } from "../lib/phone.ts";

const { values } = parseArgs({ options: { base: { type: "string", default: "http://127.0.0.1:4324/" }, cpu: { type: "string", default: "4" }, flings: { type: "string", default: "6" }, out: { type: "string" } } });
const MIDDLE = PHONE_VIEWPORT.width / 2;

interface Verdict { whole: boolean; lower: boolean }

/** Scores frames in a page of its own: a band of rows of pixels is empty when no pixel in it differs from the background. */
async function judge(judge: Page, frames: string[], top: number, bottom: number): Promise<Verdict[]> {
  return judge.evaluate(async ({ frames, top, bottom }) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];
    const verdicts: { whole: boolean; lower: boolean }[] = [];
    for (const frame of frames) {
      const image = new Image();
      image.src = `data:image/jpeg;base64,${frame}`;
      await image.decode();
      canvas.width = image.width;
      canvas.height = image.height;
      context.drawImage(image, 0, 0);
      const scale = image.height / innerHeight;
      const y0 = Math.round(top * scale);
      const y1 = Math.round(bottom * scale);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      const background = [data[(y1 - 2) * image.width * 4 + 8] ?? 0, data[(y1 - 2) * image.width * 4 + 9] ?? 0, data[(y1 - 2) * image.width * 4 + 10] ?? 0];
      const band = Math.max(1, Math.round(20 * scale));
      const bands: boolean[] = [];
      for (let y = y0; y + band <= y1; y += band) {
        let ink = false;
        for (let row = y; row < y + band && !ink; row += 2) {
          for (let x = 0; x < image.width; x += 3) {
            const at = (row * image.width + x) * 4;
            if (Math.abs((data[at] ?? 0) - background[0]!) + Math.abs((data[at + 1] ?? 0) - background[1]!) + Math.abs((data[at + 2] ?? 0) - background[2]!) > 60) {
              ink = true;
              break;
            }
          }
        }
        bands.push(!ink);
      }
      const half = Math.floor(bands.length / 2);
      verdicts.push({ whole: bands.every(Boolean), lower: bands.slice(half).every(Boolean) });
    }
    return verdicts;
  }, { frames, top, bottom });
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ ...PHONE_CONTEXT, colorScheme: "dark", serviceWorkers: "block" });
  const page = await context.newPage();
  await page.goto(`${values.base}#/about/icons`);
  await page.locator("ol.credits[aria-busy=false]").waitFor({ timeout: 60_000 });
  const top = await page.evaluate(() => Math.ceil(document.querySelector("[data-sticky-bar]")?.getBoundingClientRect().bottom ?? 0) + 4);
  const bottom = await page.evaluate(() => Math.floor(document.querySelector(".nav")?.getBoundingClientRect().top ?? innerHeight) - 4);
  const cdp = await context.newCDPSession(page);
  const judgePage = await context.newPage();
  await throttleCpu(page, Number(values.cpu));
  for (const direction of ["up", "down"] as const) {
    await page.evaluate((end) => window.scrollTo(0, end ? document.documentElement.scrollHeight : 0), direction === "up");
    await page.waitForTimeout(1500);
    const frames: string[] = [];
    const onFrame = (frame: { data: string; sessionId: number }): void => {
      frames.push(frame.data);
      void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
    };
    cdp.on("Page.screencastFrame", onFrame);
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, everyNthFrame: 1 });
    const [from, to] = direction === "up" ? [180, 600] : [600, 180];
    for (let count = 0; count < Number(values.flings); count += 1) {
      await fling(page, { x: MIDDLE, y: from }, { x: MIDDLE, y: to }, { duration: 45 });
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(1500);
    await cdp.send("Page.stopScreencast");
    cdp.off("Page.screencastFrame", onFrame);
    const verdicts = await judge(judgePage, frames, top, bottom);
    if (values.out) {
      mkdirSync(values.out, { recursive: true });
      verdicts.forEach((verdict, index) => {
        if (verdict.lower) writeFileSync(join(values.out ?? "", `${direction}-${String(index).padStart(3, "0")}.jpg`), Buffer.from(frames[index] ?? "", "base64"));
      });
    }
    console.log(`flings ${direction === "up" ? "toward the start" : "toward the end"}: ${verdicts.length} frames, ${verdicts.filter((v) => v.whole).length} with the list area empty, ${verdicts.filter((v) => v.lower).length} with its lower half empty`);
  }
} finally {
  await browser.close();
}
