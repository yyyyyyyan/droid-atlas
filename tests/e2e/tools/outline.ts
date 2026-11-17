/**
 * Prints the accessibility outline (roles and names) of a view at phone size,
 * against a running server: what a journey can find by role. Optional steps
 * open a sheet first.
 *
 *   node tools/outline.ts "#/region/tools" [--open filters|sort|row] [--base http://127.0.0.1:4324/] [--wide]
 */

import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { PHONE_CONTEXT } from "../lib/phone.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string", default: "http://127.0.0.1:4324/" },
    open: { type: "string" },
    wide: { type: "boolean", default: false },
    within: { type: "string", default: "body" },
  },
});

const browser = await chromium.launch();
const context = await browser.newContext(values.wide ? { viewport: { width: 1280, height: 800 }, serviceWorkers: "block" } : { ...PHONE_CONTEXT, serviceWorkers: "block" });
const page = await context.newPage();
page.on("pageerror", (error) => console.log("pageerror:", error.message));
await page.goto(`${values.base}${positionals[0] ?? "#/"}`);
await page.getByRole("main").waitFor();
await page.waitForTimeout(600);
if (values.open === "filters") await page.getByRole("button", { name: /^Filters/ }).click();
if (values.open === "sort") await page.getByRole("button", { name: /^Sort/ }).click();
if (values.open === "row") await page.getByRole("main").getByRole("list").last().getByRole("link").first().click();
await page.waitForTimeout(700);
console.log(await page.locator(values.within).ariaSnapshot());
await browser.close();
