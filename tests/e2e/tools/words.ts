/**
 * Counts the words a person is shown on the app sheet, a list, About and
 * Settings, at phone size, and writes each view's text to a file so two
 * builds can be read side by side:
 *
 *   node tools/words.ts --out /some/dir [--base http://127.0.0.1:4324/]
 *
 * A list's rows are the catalog's words, not the interface's, so a list is
 * counted without them. The sheet is counted whole, for the same entry every
 * time, and its Statistics section once more by itself.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Page } from "@playwright/test";
import { sheetHash } from "../lib/catalog.ts";
import { PHONE_CONTEXT } from "../lib/phone.ts";
import { featuredApp, regionsBySize } from "../lib/pick.ts";

const { values } = parseArgs({ options: { base: { type: "string", default: "http://127.0.0.1:4324/" }, out: { type: "string" } } });
if (!values.out) {
  console.error("--out <directory> is required");
  process.exit(2);
}
const out = values.out;
mkdirSync(out, { recursive: true });

const region = regionsBySize()[0]?.id ?? "";

interface View {
  name: string;
  hash: string;
  /** What to read: a selector, taken whole. */
  read: string;
  /** Selectors whose text is left out. */
  without?: string[];
  steps?(page: Page): Promise<void>;
}

const VIEWS: View[] = [
  { name: "app sheet", hash: sheetHash(featuredApp()), read: "dialog[open], aside.sheet, .sheet" },
  {
    name: "app sheet, statistics only", hash: sheetHash(featuredApp()), read: "[data-words='statistics']",
    steps: async (page) => {
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll("h3, h2")].find((element) => element.textContent?.trim() === "Statistics");
        heading?.closest("section, div")?.setAttribute("data-words", "statistics");
      });
    },
  },
  { name: "list (a region), without its rows", hash: `#/region/${region}`, read: "main", without: ["[data-row]"] },
  { name: "list sorted by F-Droid downloads, without its rows", hash: `#/region/${region}?sort=dl-fdroid`, read: "main", without: ["[data-row]"] },
  { name: "sort and view sheet", hash: `#/region/${region}`, read: "dialog[open]", steps: async (page) => { await page.locator(".bar-sort").click(); await page.waitForTimeout(400); } },
  { name: "filters sheet", hash: `#/region/${region}`, read: "dialog[open]", steps: async (page) => { await page.locator(".bar-filter").click(); await page.waitForTimeout(400); } },
  { name: "Explore, without its rows", hash: "#/", read: "main", without: ["[data-row]"] },
  { name: "Search, idle, without its rows", hash: "#/search", read: "main", without: ["[data-row]"] },
  { name: "Saved, empty", hash: "#/saved", read: "main" },
  { name: "About", hash: "#/about", read: "main" },
  { name: "About: sources and licenses", hash: "#/about/sources", read: "main" },
  { name: "About: data health", hash: "#/about/health", read: "main" },
  { name: "About: icon credits, without its rows", hash: "#/about/icons", read: "main", without: ["li"] },
  { name: "Settings", hash: "#/settings", read: "main" },
];

const browser = await chromium.launch();
try {
  const lines: string[] = [];
  for (const view of VIEWS) {
    const page = await (await browser.newContext({ ...PHONE_CONTEXT, colorScheme: "dark", reducedMotion: "reduce", serviceWorkers: "block" })).newPage();
    await page.goto(`${values.base}${view.hash}`);
    await page.waitForSelector(".nav");
    await page.waitForTimeout(900);
    await view.steps?.(page);
    const text = await page.evaluate(({ read, without }) => {
      const root = document.querySelector<HTMLElement>(read);
      if (!root) return null;
      const copy = root.cloneNode(true) as HTMLElement;
      for (const selector of without) for (const element of copy.querySelectorAll(selector)) element.remove();
      for (const element of copy.querySelectorAll(".sr, [aria-hidden='true']")) element.remove();
      document.body.append(copy);
      const shown = copy.innerText;
      copy.remove();
      return shown;
    }, { read: view.read, without: view.without ?? [] });
    await page.context().close();
    if (text === null) {
      lines.push(`${view.name}: nothing matched ${view.read}`);
      continue;
    }
    const words = text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
    writeFileSync(join(out, `${view.name.replace(/[^A-Za-z0-9]+/g, "-")}.txt`), `${text.replace(/\n{2,}/g, "\n").trim()}\n`);
    lines.push(`${String(words).padStart(5)}  ${view.name}`);
  }
  writeFileSync(join(out, "counts.txt"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
} finally {
  await browser.close();
}
