/**
 * Fixtures chosen from whichever catalog the suite serves: the real build
 * locally, a small synthetic build in CI (RELEASE.md §8). Journeys ask for a
 * shape ("a region with two categories", "an app in both repositories")
 * rather than naming real apps, and skip with the reason when the catalog
 * has no such shape.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { loadBuild, type App, type Category } from "./catalog.ts";
import { escapeRegExp } from "./app.ts";

export const build = loadBuild();

/**
 * True when the served catalog was built from the synthetic upstream fixture
 * CI uses (scripts/fixture/upstream-cache.mjs), whose list snapshots open
 * with "# Synthetic". Read from the snapshot the build itself ships.
 */
export const SYNTHETIC = build.manifest.files
  .filter((file) => file.role === "upstream" && /README\.md$|\.md$/.test(file.path))
  .some((file) => readFileSync(join(build.dir, file.path), "utf8").startsWith("# Synthetic"));

/**
 * A journey that needs a shape of data the catalog may lack (a long list, a
 * redirect, an app in both repositories). On the synthetic fixture a missing
 * shape skips the test with the reason; on a real catalog it fails, because
 * then the journey could not be checked and the suite must not pass quietly.
 */
export function requireShape(present: boolean, shape: string): void {
  if (SYNTHETIC) test.skip(!present, `the synthetic catalog has no ${shape}`);
  else expect(present, `the catalog under test has no ${shape}`).toBe(true);
}

/** Rows are 88 px in comfortable density; a list of this many rows scrolls well past two screens. */
export const TALL_LIST = 24;

export function appsInCategory(id: string): App[] {
  return build.apps.filter((app) => app.categories.has(id));
}

export function appsInRegion(id: string): App[] {
  return build.apps.filter((app) => app.regions.has(id));
}

export function regionName(id: string): string {
  return build.atlas.regions.find((region) => region.id === id)?.name ?? id;
}

/** Regions that hold at least one app, largest first, as the map orders them. */
export function regionsBySize(): { id: string; name: string; size: number }[] {
  return build.atlas.regions
    .map((region) => ({ id: region.id, name: region.name, size: appsInRegion(region.id).length }))
    .filter((region) => region.size > 0)
    .sort((a, b) => b.size - a.size);
}

/** A region's categories that hold an app, as its chips order them: largest first, the remainder last. */
export function categoriesIn(regionId: string): Category[] {
  return [...build.categories.values()]
    .filter((category) => category.region === regionId && appsInCategory(category.id).length > 0)
    .sort((a, b) => Number(a.remainder) - Number(b.remainder) || appsInCategory(b.id).length - appsInCategory(a.id).length || a.name.localeCompare(b.name));
}

export interface Level { regionId: string; regionName: string; category: Category; sibling: Category | null }

/** A region with categories whose names are unique within it, its largest such category, and another as the sibling. */
export function level(): Level {
  for (const region of regionsBySize()) {
    const categories = categoriesIn(region.id);
    const unique = categories.filter((c) => categories.filter((other) => other.name === c.name).length === 1);
    const [category, sibling] = unique;
    if (category) return { regionId: region.id, regionName: region.name, category, sibling: sibling ?? null };
  }
  throw new Error("the catalog has no category");
}

const live = (app: App, type: string): boolean => app.atlas.channels.some((c) => c.type === type && c.listed === true);

/** The app used where any well-described app will do: one in both F-Droid and IzzyOnDroid when there is one. */
export function featuredApp(): App {
  const named = build.byId.get("org.fossify.gallery");
  if (named) return named;
  const sorted = [...build.apps].sort((a, b) => a.id.localeCompare(b.id));
  const candidate = sorted.find((app) => live(app, "fdroid") && live(app, "izzy") && app.listings.length > 0)
    ?? sorted.find((app) => app.listings.length > 0 && app.listings[0]?.kind === "app");
  if (!candidate) throw new Error("the catalog has no app");
  return candidate;
}

/** The labels the app gives its lenses, keyed by filter token. A lens exists only while some entry carries its fact. */
export const LENS_LABELS: Record<string, string> = {
  shizuku: "Works with Shizuku",
  root: "Uses root",
  "no-internet": "No internet permission",
  fdroid: "On F-Droid",
  izzy: "On IzzyOnDroid",
  apk: "APK on GitHub releases",
  clean: "No anti-features at all",
};

const LENS_TESTS: Record<string, (app: App) => boolean> = {
  shizuku: (a) => a.atlas.facets.shizuku,
  root: (a) => a.atlas.facets.root,
  "no-internet": (a) => a.atlas.facets.noInternet === true,
  fdroid: (a) => a.atlas.facets.onFdroid,
  izzy: (a) => a.atlas.facets.onIzzy,
  apk: (a) => a.atlas.facets.apkOnGithub === true,
  clean: (a) => a.atlas.facets.noAntiFeatures === true,
};

/** The lens with the most entries among those whose fact the catalog carries. */
export function biggestLens(): { key: string; label: string; size: number } {
  const lenses = Object.entries(LENS_TESTS)
    .map(([key, test]) => ({ key, label: LENS_LABELS[key] ?? key, size: build.apps.filter(test).length }))
    .filter((lens) => lens.size > 0)
    .sort((a, b) => b.size - a.size);
  const [first] = lenses;
  if (!first) throw new Error("the catalog carries no lens fact");
  return first;
}

export function lensTest(key: string): (app: App) => boolean {
  return LENS_TESTS[key] ?? (() => false);
}

/** A word that occurs in more than one app's name, for searches that need several results. */
export function commonNameWord(): string {
  const counts = new Map<string, number>();
  for (const app of build.apps) {
    for (const word of new Set(app.name.toLowerCase().split(/[^\p{L}\p{N}]+/u))) {
      if (word.length >= 4) counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!best) throw new Error("no name word");
  return best[0];
}

export function regionTile(page: Page, regionId: string) {
  return page.getByRole("link", { name: new RegExp(`^${escapeRegExp(regionName(regionId))}: \\d+ entr`) });
}

/** A category's name as the app shows it. */
export function shownName(category: Category): string {
  return category.name;
}

/** A category chip's link: "<name> <count>". */
export function chipLink(page: Page, scope: string | RegExp, category: Category) {
  return page.getByRole("navigation", { name: scope }).getByRole("link", { name: new RegExp(`^${escapeRegExp(category.name)} \\d+$`) });
}

/** The first region whose every entry is a guide or a site rather than an app, when the catalog has one. */
export function resourceRegion(): { id: string; name: string; size: number } | null {
  const onlyResources = (app: App): boolean => app.listings.length > 0 && app.listings.every((listing) => listing.kind === "resource");
  return regionsBySize().find((region) => appsInRegion(region.id).every(onlyResources)) ?? null;
}
