/**
 * Screenshots of every view at the phone's size, in both themes, for looking
 * at before anything is called done.
 *
 *   node tools/shots.ts --base http://127.0.0.1:4324/ --out /some/dir [--only name,name] [--theme dark|light] [--full] [--width 336]
 *
 * Each scene is a hash to open and, optionally, steps to take before the
 * picture. Images are written as `<scene>.<theme>.png` at one image pixel per
 * CSS pixel; `--full` writes them at the device's 3.75 instead, for judging
 * sharpness. `--width` takes the pictures in a viewport of another width, for
 * the browsers and phones that are narrower than the reference one.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";
import { PHONE_CONTEXT, PHONE_VIEWPORT, centerOf, drag, dragAndHold, release, tap } from "../lib/phone.ts";
import { SCENES } from "./scenes.ts";

const { values } = parseArgs({
  options: {
    base: { type: "string", default: "http://127.0.0.1:4324/" },
    out: { type: "string" },
    only: { type: "string" },
    theme: { type: "string" },
    full: { type: "boolean", default: false },
    width: { type: "string" },
  },
});

if (!values.out) {
  console.error("--out <directory> is required");
  process.exit(2);
}
const out = values.out;
mkdirSync(out, { recursive: true });

const wanted = values.only ? new Set(values.only.split(",")) : null;
const width = Number(values.width) || PHONE_VIEWPORT.width;
const themes = values.theme === "dark" || values.theme === "light" ? [values.theme] as const : ["dark", "light"] as const;
const scenes = SCENES.filter((scene) => !wanted || wanted.has(scene.name) || [...wanted].some((prefix) => prefix.endsWith("*") && scene.name.startsWith(prefix.slice(0, -1))));

export interface SceneTools {
  page: Page;
  tap(selector: string): Promise<void>;
  drag: typeof drag;
  dragAndHold: typeof dragAndHold;
  release: typeof release;
  centerOf: typeof centerOf;
  settle(ms?: number): Promise<void>;
}

const browser = await chromium.launch();
let failures = 0;
try {
  for (const theme of themes) {
    for (const scene of scenes) {
      const context = await browser.newContext({ ...PHONE_CONTEXT, viewport: { ...PHONE_VIEWPORT, width }, colorScheme: theme, reducedMotion: scene.motion ? "no-preference" : "reduce", serviceWorkers: "block" });
      const page = await context.newPage();
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(`console: ${message.text()}`);
      });
      const tools: SceneTools = {
        page,
        tap: async (selector) => tap(page, await centerOf(page, selector)),
        drag,
        dragAndHold,
        release,
        centerOf,
        settle: (ms = 250) => page.waitForTimeout(ms),
      };
      try {
        if (scene.storage) {
          await page.addInitScript((entries) => {
            for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
          }, scene.storage);
        }
        await page.goto(values.base + scene.hash);
        await page.locator(".view, .status").first().waitFor({ timeout: 20_000 });
        await page.evaluate(() => document.fonts.ready);
        await tools.settle(350);
        await scene.steps?.(tools);
        await tools.settle(scene.wait ?? 250);
        await page.screenshot({ path: join(out, `${scene.name}.${theme}.png`), scale: values.full ? "device" : "css", fullPage: scene.fullPage ?? false });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 0) problems.push(`horizontal overflow of ${overflow}px`);
      } catch (error) {
        problems.push(`failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
      if (problems.length) {
        failures += 1;
        console.log(`${scene.name}.${theme}: ${problems.join(" | ")}`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(`${scenes.length * themes.length} pictures in ${out}${failures ? `, ${failures} with problems` : ""}`);
