/**
 * Page helpers shared by the journeys. Elements are found by role and
 * accessible name, as a person or a screen reader finds them. Two attributes
 * the app sets for its own use are read as well, because nothing a person
 * sees carries the same fact: `data-row` (the entry a row is for) and
 * `data-sheet-scroll` (the part of a sheet that scrolls).
 */

import { expect, test, type Locator, type Page } from "@playwright/test";

export interface EntryState {
  id: string;
  idx: number;
  under: string | null;
  scroll: { y: number; anchor: { key: string; offset: number } | null } | null;
}

export interface HistorySnapshot {
  length: number;
  state: EntryState | null;
  hash: string;
  scrollY: number;
}

export const ANDROID_CHROME_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";
export const FIREFOX_ANDROID_UA = "Mozilla/5.0 (Android 14; Mobile; rv:146.0) Gecko/146.0 Firefox/146.0";
export const DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

export function isWide(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}

const consoleLogs = new WeakMap<Page, string[]>();

function watchConsole(page: Page): string[] {
  let log = consoleLogs.get(page);
  if (!log) {
    const lines: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") lines.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => lines.push(`pageerror: ${error.message}`));
    consoleLogs.set(page, lines);
    log = lines;
  }
  return log;
}

/**
 * Waits until the catalog has loaded and a view is on screen; if it does not,
 * says what the page showed instead.
 *
 * One case is retried: Chromium aborts in-flight requests with
 * ERR_NETWORK_CHANGED when the host's network interfaces change, which on a
 * workstation happens independently of the app. The app then shows its own
 * "did not load" screen, and the retry is the user's path out of it ("Try
 * again"), recorded on the test so it is not silent.
 */
export async function ready(page: Page): Promise<void> {
  const log = watchConsole(page);
  const main = page.getByRole("main");
  const failure = page.getByRole("alert").filter({ hasText: "The catalog did not load" });
  await expect(main.or(failure)).toBeVisible({ timeout: 15_000 }).catch(() => undefined);
  if (await failure.isVisible() && log.some((line) => line.includes("ERR_NETWORK_CHANGED"))) {
    test.info().annotations.push({ type: "retried after ERR_NETWORK_CHANGED", description: page.url() });
    log.length = 0;
    await page.getByRole("button", { name: "Try again" }).click();
  }
  try {
    await expect(main).toBeVisible({ timeout: 15_000 });
  } catch (error) {
    const shown = await page.evaluate(() => `${document.readyState} | ${location.href} | ${document.body?.innerText.replace(/\s+/g, " ").slice(0, 300)}`).catch((cause: unknown) => String(cause));
    throw new Error(`the app did not boot: ${shown} | console: ${log.join(" / ") || "none"}`, { cause: error });
  }
}

/** Opens the app at a hash (or with no hash) as a fresh document. */
export async function launch(page: Page, hash = ""): Promise<void> {
  await page.goto(`/${hash}`);
  await ready(page);
}

export async function snapshot(page: Page): Promise<HistorySnapshot> {
  return page.evaluate(() => ({
    length: history.length,
    state: history.state as EntryState | null,
    hash: location.hash,
    scrollY: Math.round(window.scrollY),
  }));
}

/**
 * Which history entry is on show, without the scroll position the app keeps
 * writing into it: two snapshots of the same entry at the same place in the
 * stack compare equal.
 */
export function entryOf(shot: HistorySnapshot): { hash: string; length: number; id: string | undefined; idx: number | undefined; under: string | null | undefined } {
  return { hash: shot.hash, length: shot.length, id: shot.state?.id, idx: shot.state?.idx, under: shot.state?.under };
}

/** Sets the hash the way a user editing the address bar does: a navigation the router did not make. */
export async function typeHash(page: Page, hash: string): Promise<void> {
  await page.evaluate((next) => {
    location.hash = next;
  }, hash);
}

export async function back(page: Page): Promise<void> {
  const before = page.url();
  await page.evaluate(() => history.back());
  await expect.poll(() => page.url()).not.toBe(before);
}

export async function forward(page: Page): Promise<void> {
  const before = page.url();
  await page.evaluate(() => history.forward());
  await expect.poll(() => page.url()).not.toBe(before);
}

/** The hash part of the current URL, decoded the way the app writes it. */
export function hashOf(page: Page): string {
  return new URL(page.url()).hash;
}

export function primaryNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Primary" });
}

export function navLink(page: Page, name: "Explore" | "Search" | "Saved" | "About"): Locator {
  return primaryNav(page).getByRole("link", { name, exact: true });
}

/** The app sheet: a modal dialog on a phone, a side panel (complementary landmark) on a wide screen. Both are named by the app. */
export function sheet(page: Page, appName?: string | RegExp): Locator {
  const role = isWide(page) ? "complementary" : "dialog";
  if (appName !== undefined) return page.getByRole(role, { name: appName });
  return isWide(page)
    ? page.getByRole("complementary").filter({ has: page.getByRole("button", { name: "Close details" }) })
    : page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Close details" }) });
}

export function closeSheetButton(page: Page): Locator {
  return page.getByRole("button", { name: "Close details" });
}

/** The virtualized result list of the view on screen. Its name ends with "sorted by …". */
export function resultList(page: Page): Locator {
  return page.getByRole("main").getByRole("list", { name: /sorted by/ });
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A row's link, by the app name its accessible name starts with. */
export function rowLink(page: Page, appName: string): Locator {
  return resultList(page).getByRole("link", { name: new RegExp(`^${escapeRegExp(appName)}(\\s|$)`) }).first();
}

/**
 * The rows of the result list that open a sheet inside the app. A row for a
 * guide or a site is the outside link itself and is left out: a journey must
 * never follow one.
 */
export function appRows(page: Page): Locator {
  return resultList(page).locator('a[href^="#/"]');
}

export function sortButton(page: Page): Locator {
  return page.getByRole("main").getByRole("button", { name: /^Sort: / });
}

/** The sort in force, as the bar's button words it ("Name", "Best match", "Stars"). */
export async function currentSort(page: Page): Promise<string | null> {
  if (!(await sortButton(page).count())) return null;
  return ((await sortButton(page).getAttribute("aria-label")) ?? "").replace(/^Sort: /, "");
}

export function sortSheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "Sort and view" });
}

/** Opens the sort sheet and picks a sort by the start of its name; choosing closes the sheet. */
export async function chooseSort(page: Page, name: string): Promise<void> {
  await sortButton(page).click();
  await sortSheet(page).getByRole("radiogroup", { name: "Sort by" }).getByRole("radio", { name: new RegExp(`^${escapeRegExp(name)}`) }).click();
  await expect(sortSheet(page)).toBeHidden();
}

/** Opens the sort sheet, sets the row density and closes the sheet again. */
export async function setRows(page: Page, density: "Comfortable" | "Compact"): Promise<void> {
  await sortButton(page).click();
  await sortSheet(page).getByRole("radiogroup", { name: "Rows" }).getByRole("radio", { name: density }).click();
  await sortSheet(page).getByRole("button", { name: "Close sorting" }).click();
  await expect(sortSheet(page)).toBeHidden();
}

export function filtersSheet(page: Page): Locator {
  return page.getByRole("dialog", { name: "Filters" });
}

export async function openFilters(page: Page): Promise<Locator> {
  await page.getByRole("main").getByRole("button", { name: /^Filters/ }).first().click();
  await expect(filtersSheet(page)).toBeVisible();
  return filtersSheet(page);
}

/** localStorage content that starts the app with compact rows and the introduction already seen. */
export const COMPACT_ROWS = { "droid-atlas:v1:settings": JSON.stringify({ v: 1, theme: "system", density: "compact", resume: true, introSeen: true }) };

/** The status in a list's bar: "16 entries", or "55 of 1,294" while filtered. */
export function countStatus(page: Page): Locator {
  return page.getByRole("main").getByRole("status").filter({ hasText: /\d/ }).first();
}

export function parseCount(text: string): number {
  const match = /^([\d,]+)/.exec(text.trim());
  if (!match?.[1]) throw new Error(`no count in "${text}"`);
  return Number(match[1].replace(/,/g, ""));
}

/** Entry ids of the rows rendered in the result list, in order, guides and sites included. */
export async function renderedRowIds(page: Page): Promise<string[]> {
  return resultList(page).locator("[data-row]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row") ?? ""));
}

/** The first row whose top edge is below the sticky chrome: what the user sees first. */
export async function firstVisibleRowId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const lists = [...document.querySelectorAll('main [role="list"], main ol, main ul')].filter((list) => /sorted by/.test(list.getAttribute("aria-label") ?? ""));
    const list = lists[0];
    if (!list) return null;
    const stuck = [...document.querySelectorAll<HTMLElement>("body *")].filter((el) => {
      const position = getComputedStyle(el).position;
      return (position === "sticky" || position === "fixed") && el.getBoundingClientRect().top <= 1 && el.getBoundingClientRect().height < innerHeight / 2;
    });
    const top = Math.max(0, ...stuck.map((el) => el.getBoundingClientRect().bottom));
    for (const row of list.querySelectorAll("[data-row]")) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > top + 4) return row.getAttribute("data-row");
    }
    return null;
  });
}

/**
 * A row link that is on screen, `offset` rows below the first visible one. A
 * virtual list renders rows above the viewport too, and clicking one of those
 * would make Playwright scroll the page first.
 */
export async function visibleRow(page: Page, offset = 0): Promise<Locator> {
  const first = await firstVisibleRowId(page);
  if (!first) throw new Error("no visible row");
  const ids = await renderedRowIds(page);
  const id = ids[ids.indexOf(first) + offset];
  if (!id) throw new Error(`no row ${offset} below ${first}`);
  return rowOf(page, id);
}

/** The link of the row for one entry. */
export function rowOf(page: Page, id: string): Locator {
  return resultList(page).locator(`[data-row="${id}"]`).getByRole("link").first();
}

/** Scrolls the window and waits for the app's scroll listener to record the position. */
export async function scrollTo(page: Page, y: number): Promise<number> {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(1300);
  return page.evaluate(() => Math.round(window.scrollY));
}

/**
 * A neutral first gesture: a pointer press on a heading, which is not a
 * control. With a modal sheet open the page behind it is inert, so the press
 * goes to the sheet's own heading.
 */
export async function firstGesture(page: Page): Promise<void> {
  const modal = page.getByRole("dialog");
  const target = (await modal.count()) > 0 && !isWide(page)
    ? modal.getByRole("heading", { level: 2 }).first()
    : page.getByRole("main").getByRole("heading", { level: 1 }).first();
  const box = await target.boundingBox();
  if (!box) throw new Error("no gesture target");
  /* The far end of a title's last line: the way up to the region reaches over the start of a category's title, and a gesture must land on no control. */
  await page.mouse.click(box.x + box.width - 2, box.y + box.height - 2);
}

/**
 * Writes localStorage for the app's origin from a same-origin document that
 * does not run the app (the catalog's version.json), so no app code rewrites
 * the values when the page closes.
 */
export async function seedStorage(page: Page, entries: Record<string, string>, area: "local" | "session" = "local"): Promise<void> {
  await page.goto("/data/version.json");
  await page.evaluate(({ values, which }) => {
    const store = which === "local" ? localStorage : sessionStorage;
    for (const [key, value] of Object.entries(values)) store.setItem(key, value);
  }, { values: entries, which: area });
}

/** Hides the page the way the browser does when the user switches away, so `visibilitychange` handlers run. */
export async function hidePage(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}
