/**
 * The pictures `shots.ts` takes: every view and every layer of the app, with
 * entries chosen from the served catalog by shape, so the same list works on
 * the real build and on a synthetic one.
 */

import { loadBuild, type App } from "../lib/catalog.ts";
import type { SceneTools } from "./shots.ts";

export interface Scene {
  name: string;
  hash: string;
  steps?(tools: SceneTools): Promise<void>;
  /** localStorage to seed before the app starts. */
  storage?: Record<string, string>;
  fullPage?: boolean;
  /** Keep animations (reduced motion is emulated otherwise, so pictures are of settled states). */
  motion?: boolean;
  wait?: number;
}

const build = loadBuild();

function first(test: (app: App) => boolean, what: string): App {
  const found = [...build.apps].sort((a, b) => a.id.localeCompare(b.id)).find(test);
  if (!found) throw new Error(`the catalog has no ${what}`);
  return found;
}

function sheetOver(app: App): string {
  const category = app.atlas.category;
  return `#/cat/${category}?app=${encodeURIComponent(app.id)}`;
}

const isApp = (app: App): boolean => app.listings.some((listing) => listing.kind === "app");
const live = (app: App, type: string): boolean => app.atlas.channels.some((channel) => channel.type === type && channel.listed === true);

const regions = build.atlas.regions
  .map((region) => ({ ...region, size: build.apps.filter((app) => app.regions.has(region.id)).length }))
  .filter((region) => region.size > 0)
  .sort((a, b) => b.size - a.size);
const bigRegion = regions[0]?.id ?? "";
const guides = regions.find((region) => region.id === "guides")?.id ?? null;
const categories = [...build.categories.values()]
  .map((category) => ({ ...category, size: build.apps.filter((app) => app.categories.has(category.id)).length }))
  .sort((a, b) => b.size - a.size);
const bigCategory = categories[0]?.id ?? "";
const notedCategory = categories.find((category) => category.size > 0 && [...build.sourceCategories.values()].some((source) => source.category === category.id && source.note))?.id ?? null;

const inBoth = first((app) => live(app, "fdroid") && live(app, "izzy"), "app in both repositories");
const inNeither = first((app) => isApp(app) && !app.fdroid && !app.izzy && app.github !== null, "app that no repository indexes");
const bare = first((app) => isApp(app) && !app.fdroid && !app.izzy && app.github === null && !app.summary, "app with no facts at all");
const closed = first((app) => app.atlas.facets.openness === "closed-source" && app.atlas.facets.shizuku, "closed-source Shizuku app");
const flagged = first((app) => (app.fdroid?.facts.antiFeatures.length ?? 0) + (app.izzy?.facts.antiFeatures.length ?? 0) > 1, "app with two anti-features");
const resource = build.apps.find((app) => app.listings.length > 0 && app.listings.every((listing) => listing.kind === "resource")) ?? null;

const savedStorage = {
  "droid-atlas:v1:saved": JSON.stringify({
    v: 1,
    items: [inBoth, inNeither, closed, flagged].map((app, index) => ({
      id: app.id, packages: app.atlas.packages, repo: app.atlas.repo?.slug ?? null, savedAt: 1_794_000_000_000 - index * 86_400_000,
      ...(index === 1 ? { note: "Try this on the tablet first", noteAt: 1_794_000_000_000 } : {}),
    })),
  }),
};
const compactStorage = { "droid-atlas:v1:settings": JSON.stringify({ v: 1, theme: "system", density: "compact", resume: true, introSeen: true }) };

const seenStorage = { "droid-atlas:v1:settings": JSON.stringify({ v: 1, theme: "system", density: "comfortable", resume: true, introSeen: true }) };

/** Stands in for the on-screen keyboard: with a field focused, the window loses the height a keyboard takes. */
const keyboardUp = async ({ page, settle }: SceneTools): Promise<void> => {
  await page.setViewportSize({ width: 384, height: 388 });
  await settle(500);
};
const keyboardDown = async ({ page, settle }: SceneTools): Promise<void> => {
  await page.setViewportSize({ width: 384, height: 688 });
  await settle(400);
};

const scrollBy = (y: number) => async ({ page, settle }: SceneTools): Promise<void> => {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await settle(400);
};

export const SCENES: Scene[] = [
  { name: "explore", hash: "#/" },
  { name: "explore-seen", hash: "#/", storage: seenStorage },
  { name: "explore-lenses", hash: "#/", steps: scrollBy(520) },
  { name: "explore-new", hash: "#/", steps: scrollBy(900) },
  { name: "explore-end", hash: "#/", steps: scrollBy(99_999) },
  { name: "region", hash: `#/region/${bigRegion}` },
  { name: "region-scrolled", hash: `#/region/${bigRegion}`, steps: scrollBy(700) },
  { name: "region-compact", hash: `#/region/${bigRegion}`, storage: compactStorage },
  { name: "region-stars", hash: `#/region/${bigRegion}?sort=stars` },
  { name: "region-release", hash: `#/region/${bigRegion}?sort=release` },
  { name: "region-added", hash: `#/region/${bigRegion}?sort=added` },
  { name: "region-downloads-fdroid", hash: `#/region/${bigRegion}?sort=dl-fdroid` },
  { name: "region-downloads-github", hash: `#/region/${bigRegion}?sort=dl-github` },
  { name: "region-filtered", hash: `#/region/${bigRegion}?f=fdroid,no-internet` },
  { name: "category", hash: `#/cat/${bigCategory}` },
  ...(notedCategory ? [{ name: "category-note", hash: `#/cat/${notedCategory}` }] : []),
  ...(guides ? [
    { name: "guides", hash: `#/region/${guides}` },
    { name: "guides-scrolled", hash: `#/region/${guides}`, steps: scrollBy(600) },
    { name: "guides-compact", hash: `#/region/${guides}`, storage: compactStorage },
  ] : []),
  { name: "lens", hash: "#/lens/shizuku" },
  { name: "search", hash: "#/search" },
  { name: "search-text", hash: "#/search?q=file" },
  { name: "search-filtered", hash: "#/search?f=fdroid,no-internet,clean" },
  { name: "search-inside-word", hash: "#/search?q=sig" },
  { name: "search-mentioned", hash: "#/search?q=termux" },
  { name: "search-mentioned-compact", hash: "#/search?q=termux", storage: compactStorage },
  { name: "search-none", hash: "#/search?q=zzzzqqq" },
  { name: "search-compact", hash: "#/search?q=file", storage: compactStorage },
  { name: "filters", hash: "#/search", steps: async ({ tap, settle }) => { await tap(".bar-filter"); await settle(); } },
  { name: "filters-end", hash: "#/search", steps: async ({ tap, settle, page }) => { await tap(".bar-filter"); await settle(); await page.evaluate(() => document.querySelector(".panel .bsheet-body")?.scrollTo(0, 99_999)); } },
  { name: "filters-anti", hash: "#/search", steps: async ({ tap, settle, page }) => { await tap(".bar-filter"); await settle(); await page.evaluate(() => document.querySelector("#filter-group-anti")?.scrollIntoView()); } },
  { name: "sort", hash: "#/search", steps: async ({ tap, settle }) => { await tap(".bar-sort"); await settle(); } },
  {
    name: "sheet-dragging", hash: sheetOver(inBoth),
    steps: async ({ page, dragAndHold, settle }) => { await dragAndHold(page, { x: 192, y: 300 }, { x: 192, y: 430 }, { duration: 300 }); await settle(80); },
  },
  {
    name: "filters-dragging", hash: "#/search",
    steps: async ({ page, tap, dragAndHold, settle }) => { await tap(".bar-filter"); await settle(400); await dragAndHold(page, { x: 192, y: 180 }, { x: 192, y: 330 }, { duration: 300 }); await settle(80); },
  },
  {
    name: "search-keyboard", hash: "#/search",
    steps: async (tools) => { await tools.page.getByRole("searchbox").fill("file"); await keyboardUp(tools); },
  },
  {
    name: "search-keyboard-gone", hash: "#/search",
    steps: async (tools) => { await tools.page.getByRole("searchbox").fill("file"); await keyboardUp(tools); await keyboardDown(tools); },
  },
  {
    name: "saved-undo", hash: "#/saved", storage: savedStorage,
    steps: async ({ page, settle }) => { await page.getByRole("button", { name: /^Remove .* from saved$/ }).nth(1).click(); await settle(300); },
  },
  {
    name: "sheet-note-keyboard", hash: sheetOver(inNeither), storage: savedStorage,
    steps: async (tools) => { await tools.page.getByRole("textbox", { name: "Note" }).focus(); await keyboardUp(tools); },
  },
  { name: "not-found-entry", hash: "#/app/com.orgzly" },
  { name: "saved-empty", hash: "#/saved" },
  { name: "saved", hash: "#/saved", storage: savedStorage },
  { name: "about", hash: "#/about" },
  { name: "about-full", hash: "#/about", fullPage: true },
  { name: "settings", hash: "#/settings" },
  { name: "settings-full", hash: "#/settings", fullPage: true },
  { name: "about-sources", hash: "#/about/sources", fullPage: true },
  { name: "about-health", hash: "#/about/health", fullPage: true },
  { name: "about-sources-facts", hash: "#/about/sources?at=facts" },
  { name: "about-icons", hash: "#/about/icons" },
  { name: "about-license", hash: "#/about/license/GPL-3.0-or-later" },
  { name: "about-notices", hash: "#/about/notices" },
  { name: "not-found", hash: "#/nowhere/at/all" },
  { name: "sheet", hash: sheetOver(inBoth) },
  { name: "sheet-full", hash: sheetOver(inBoth), steps: async ({ tap, settle }) => { await tap(".sheet-grab"); await settle(); } },
  { name: "sheet-scrolled", hash: sheetOver(inBoth), steps: async ({ tap, settle, page }) => { await tap(".sheet-grab"); await settle(); await page.evaluate(() => document.querySelector(".sheet-body")?.scrollTo(0, 520)); } },
  { name: "sheet-end", hash: sheetOver(inBoth), steps: async ({ tap, settle, page }) => { await tap(".sheet-grab"); await settle(600); await page.evaluate(() => document.querySelector(".sheet-body")?.scrollTo(0, 99_999)); } },
  { name: "sheet-statistics", hash: sheetOver(inBoth), steps: async ({ tap, settle, page }) => { await tap(".sheet-grab"); await settle(600); await page.getByRole("heading", { name: "Statistics" }).scrollIntoViewIfNeeded(); await page.evaluate(() => document.querySelector(".sheet-body")?.scrollBy(0, 330)); } },
  { name: "sheet-neither", hash: sheetOver(inNeither), steps: async ({ tap, settle }) => { await tap(".sheet-grab"); await settle(); } },
  { name: "sheet-neither-end", hash: sheetOver(inNeither), steps: async ({ tap, settle, page }) => { await tap(".sheet-grab"); await settle(600); await page.evaluate(() => document.querySelector(".sheet-body")?.scrollTo(0, 99_999)); } },
  { name: "sheet-bare", hash: sheetOver(bare), steps: async ({ tap, settle }) => { await tap(".sheet-grab"); await settle(); } },
  { name: "sheet-closed", hash: sheetOver(closed), steps: async ({ tap, settle }) => { await tap(".sheet-grab"); await settle(); } },
  { name: "sheet-flagged", hash: sheetOver(flagged), steps: async ({ tap, settle, page }) => { await tap(".sheet-grab"); await settle(); await page.evaluate(() => document.querySelector(".sheet-body")?.scrollTo(0, 300)); } },
  ...(resource ? [
    { name: "sheet-resource", hash: sheetOver(resource) },
    { name: "sheet-resource-full", hash: sheetOver(resource), steps: async ({ tap, settle }: SceneTools) => { await tap(".sheet-grab"); await settle(); } },
  ] : []),
];
