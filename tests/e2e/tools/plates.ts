/**
 * Which icons stand on the other plate (`app/src/ui/plate.ts`), decided in
 * the browser by the app's own code for every icon file the build credits,
 * with what deciding costs:
 *
 *   node tools/plates.ts [--base http://127.0.0.1:4324/]
 *
 * Loads a module of the app from the development server, as
 * `tools/name-widths.ts` does.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { build } from "../lib/pick.ts";

const { values } = parseArgs({ options: { base: { type: "string", default: "http://127.0.0.1:4324/" } } });
const listed = build.manifest.files.find((file) => file.role === "icons");
if (!listed) throw new Error("the build credits no icons");
const records = (JSON.parse(readFileSync(join(build.dir, listed.path), "utf8")) as { icons: { file: string; name: string }[] }).icons;
const files = [...new Map(records.map((record) => [record.file, record.name])).entries()];
const dataRoot = new URL("data/", values.base).href;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(values.base);
  const result = await page.evaluate(async ({ files, dataRoot }) => {
    const plate = (await import(/* @vite-ignore */ `${location.origin}/src/ui/plate.ts`)) as { sampleGlyph(image: HTMLImageElement): "light" | "dark" | null };
    const out: { light: string[]; dark: string[]; failed: string[]; times: number[] } = { light: [], dark: [], failed: [], times: [] };
    for (const [file, name] of files) {
      const image = new Image();
      image.src = new URL(file, dataRoot).href;
      const loaded = await image.decode().then(() => true, () => false);
      if (!loaded) {
        out.failed.push(name);
        continue;
      }
      /* Each in a frame of its own, so the app's budget per frame never skips one. */
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const start = performance.now();
      const glyph = plate.sampleGlyph(image);
      out.times.push(performance.now() - start);
      if (glyph === "light") out.light.push(name);
      if (glyph === "dark") out.dark.push(name);
    }
    return out;
  }, { files, dataRoot });
  const times = result.times.sort((a, b) => a - b);
  console.log(`${files.length} icon files, ${result.failed.length} did not load${result.failed.length ? `: ${result.failed.slice(0, 5).join(", ")}` : ""}`);
  console.log(`on the dark plate (a light glyph): ${result.light.length}: ${result.light.sort().join(", ")}`);
  console.log(`on the light plate (a dark glyph): ${result.dark.length}: ${result.dark.sort().join(", ")}`);
  console.log(`deciding one: median ${times[Math.floor(times.length / 2)]?.toFixed(3)} ms, slowest ${times.at(-1)?.toFixed(3)} ms`);
} finally {
  await browser.close();
}
