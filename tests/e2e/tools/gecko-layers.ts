/**
 * Back and Escape on the sort and filter sheets in desktop Firefox, the
 * nearest Gecko this machine runs. Prints one line per check:
 *
 *   node tools/gecko-layers.ts [--base http://127.0.0.1:4324/] [--width 336]
 *
 * Needs Playwright's Firefox (`pnpm --filter ./tests/e2e exec playwright
 * install firefox`). Firefox for Android decides by itself whether Back leaves
 * the tab; what is checked here is the page's side: Escape (a close request)
 * and `history.back()` each close a sheet, and neither leaves an entry that a
 * later Back would spend on nothing.
 */

import { parseArgs } from "node:util";
import { firefox, type Page } from "@playwright/test";
import { regionsBySize } from "../lib/pick.ts";

const { values } = parseArgs({ options: { base: { type: "string", default: "http://127.0.0.1:4324/" }, width: { type: "string", default: "336" } } });
const [big] = regionsBySize();
const region = `#/region/${big?.id ?? ""}`;
let failures = 0;

function check(ok: boolean, what: string, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
}

/** Whether a sheet has left the screen within a second: it slides away for 180 ms first. */
const gone = (sheet: ReturnType<Page["getByRole"]>): Promise<boolean> => sheet.waitFor({ state: "hidden", timeout: 1000 }).then(() => true, () => false);
const hash = (page: Page): Promise<string> => page.evaluate(() => location.hash);
const length = (page: Page): Promise<number> => page.evaluate(() => history.length);

async function pressBack(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    addEventListener("popstate", () => resolve(), { once: true });
    history.back();
  }));
  await page.waitForTimeout(150);
}

async function fresh(page: Page): Promise<void> {
  await page.goto(`${values.base}${region}`);
  await page.waitForSelector("main");
  await page.waitForTimeout(300);
}

const sortSheet = (page: Page) => page.getByRole("dialog", { name: "Sort and view" });
const filterSheet = (page: Page) => page.getByRole("dialog", { name: "Filters" });
const openSort = async (page: Page): Promise<void> => {
  await page.getByRole("main").getByRole("button", { name: /^Sort: / }).click();
  await sortSheet(page).waitFor();
};
const openFilters = async (page: Page): Promise<void> => {
  await page.getByRole("main").getByRole("button", { name: /^Filters/ }).first().click();
  await filterSheet(page).waitFor();
};

const browser = await firefox.launch();
try {
  const context = await browser.newContext({ viewport: { width: Number(values.width), height: 744 }, serviceWorkers: "block" });
  const page = await context.newPage();

  await fresh(page);
  const facts = await page.evaluate(() => ({ watcher: typeof (window as { CloseWatcher?: unknown }).CloseWatcher, gecko: CSS.supports("-moz-appearance", "none"), agent: navigator.userAgent }));
  console.log(`${facts.agent}; CloseWatcher: ${facts.watcher}; -moz-appearance: ${facts.gecko}`);

  await openSort(page);
  const withSheet = await length(page);
  await pressBack(page);
  check(await gone(sortSheet(page)), "Back closes the sort sheet on the tab's first page");
  check((await hash(page)) === region, "and the page stays", await hash(page));
  await pressBack(page);
  check((await hash(page)) === "#/", "the next Back goes up a level", await hash(page));

  await fresh(page);
  await openSort(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(await gone(sortSheet(page)), "Escape closes the sort sheet");
  check((await length(page)) <= withSheet + 1, "history did not grow past the sheet's entry", String(await length(page)));
  await pressBack(page);
  check((await hash(page)) === "#/", "after Escape, one Back goes up a level", await hash(page));

  await fresh(page);
  await openSort(page);
  await sortSheet(page).getByRole("radiogroup", { name: "Sort by" }).getByRole("radio", { name: /^GitHub stars/ }).click();
  await sortSheet(page).waitFor({ state: "hidden" });
  await page.waitForTimeout(200);
  check(/sort=/.test(await hash(page)), "a chosen sort is in the address", await hash(page));
  await pressBack(page);
  check((await hash(page)) === "#/", "after choosing, one Back goes up a level", await hash(page));

  await fresh(page);
  await openFilters(page);
  await pressBack(page);
  check(await gone(filterSheet(page)), "Back closes the filters");
  await openFilters(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(await gone(filterSheet(page)), "Escape closes the filters");
  await pressBack(page);
  check((await hash(page)) === "#/", "after both, one Back goes up a level", await hash(page));
  await context.close();
} finally {
  await browser.close();
}
console.log(failures === 0 ? "all checks passed" : `${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
