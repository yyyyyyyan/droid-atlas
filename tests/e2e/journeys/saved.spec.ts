/** Saved apps (ARCHITECTURE.md § State and restoration): save, unsave and undo, the Saved view, persistence, retired ids, other windows. */

import { expect, test } from "../lib/fixtures.ts";
import { featuredApp, requireShape } from "../lib/pick.ts";
import { countMatches, loadBuild } from "../lib/catalog.ts";
import { serveChanged } from "../lib/inject.ts";
import { appRows, countStatus, launch, navLink, ready, renderedRowIds, resultList, seedStorage, sheet } from "../lib/app.ts";

const KEY = "droid-atlas:v1:saved";
const build = loadBuild();

interface StoredSaved { v: number; items: { id: string; packages: string[]; repo: string | null; savedAt: number; removedAt?: number }[] }

async function stored(page: import("@playwright/test").Page): Promise<StoredSaved | null> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null") as StoredSaved | null, KEY);
}

test("saving from a row and from the sheet, the Saved view, unsaving, and reload", async ({ page }) => {
  const gallery = featuredApp();
  const word = (gallery.name.split(/\s+/)[0] ?? gallery.name).toLowerCase();
  requireShape(countMatches(build, word, []) >= 2, `second app matching "${word}"`);
  await launch(page, `#/search?q=${encodeURIComponent(word)}`);
  const rowSave = resultList(page).getByRole("button", { name: `Save ${gallery.name}` });
  await rowSave.click();
  await expect(resultList(page).getByRole("button", { name: `Remove ${gallery.name} from saved` })).toHaveAttribute("aria-pressed", "true");
  const afterSave = await stored(page);
  expect(afterSave?.v).toBe(1);
  expect(afterSave?.items[0]).toMatchObject({ id: gallery.id, packages: gallery.atlas.packages, repo: gallery.atlas.repo?.url ?? null });
  expect(typeof afterSave?.items[0]?.savedAt).toBe("number");

  const other = appRows(page).filter({ hasNotText: gallery.name }).first();
  await other.click();
  await expect(sheet(page)).toBeVisible();
  const footSave = sheet(page).getByRole("button", { name: /^Save / });
  const otherName = ((await footSave.getAttribute("aria-label")) ?? "").replace(/^Save /, "");
  await footSave.click();
  await expect(sheet(page).getByRole("button", { name: `Remove ${otherName} from saved` })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toBeHidden();

  await navLink(page, "Saved").click();
  await expect(page).toHaveURL(/#\/saved$/);
  await expect(countStatus(page)).toHaveText(/^2 (apps?|entr(y|ies)|links?)$/);
  expect((await renderedRowIds(page))[1]).toBe(gallery.id);

  await page.reload();
  await ready(page);
  await expect(countStatus(page)).toHaveText(/^2 (apps?|entr(y|ies)|links?)$/);

  await resultList(page).getByRole("button", { name: `Remove ${gallery.name} from saved` }).click();
  await expect(countStatus(page)).toHaveText(/^1 (apps?|entr(y|ies)|links?)$/);
  const afterUnsave = await stored(page);
  expect(afterUnsave?.items.find((item) => item.id === gallery.id)?.removedAt).toEqual(expect.any(Number));
  await page.reload();
  await ready(page);
  await expect(countStatus(page)).toHaveText(/^1 (apps?|entr(y|ies)|links?)$/);
});

test("an empty Saved view says so and offers the map", async ({ page }) => {
  await launch(page, "#/saved");
  await expect(page.getByRole("main")).toContainText("Nothing saved yet");
  await page.getByRole("link", { name: "Explore the map" }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test("a saved app whose id was retired is found through Catalog.redirects, for a redirect added to the served catalog and every one it has", async ({ page }) => {
  const target = featuredApp();
  await serveChanged(page, build, [{ role: "atlas", change: (atlas) => { (atlas.redirects as Record<string, string | null>)["retired.example.id"] = target.id; } }]);
  const redirects: [string, string][] = [
    ["retired.example.id", target.id],
    ...Object.entries(build.atlas.redirects).filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== target.id),
  ];
  const items = redirects.map(([retired], index) => ({ id: retired, packages: [] as string[], repo: null, savedAt: 1_700_000_000_000 + index }));
  await seedStorage(page, { [KEY]: JSON.stringify({ v: 1, items }) });
  await launch(page, "#/saved");
  await expect(countStatus(page)).toHaveText(new RegExp(`^${redirects.length} (app|entr|link)`));
  for (const [, successor] of redirects) {
    const app = build.byId.get(successor);
    await expect(resultList(page).getByRole("link", { name: new RegExp(`^${app?.name}`) })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "No longer in the catalogs" })).toHaveCount(0);
});

test("removing an entry in Saved offers Undo, which brings it back with its note and its place in the list", async ({ page }) => {
  const sorted = [...build.apps].filter((app) => app.listings.some((listing) => listing.kind === "app")).sort((a, b) => a.id.localeCompare(b.id));
  const [first, second, third] = sorted;
  requireShape(Boolean(first && second && third), "three apps");
  if (!first || !second || !third) return;
  const items = [first, second, third].map((app, index) => ({
    id: app.id, packages: app.atlas.packages, repo: app.atlas.repo?.url ?? null, savedAt: 1_700_000_000_000 - index * 1000,
    ...(index === 1 ? { note: "check before installing", noteAt: 1_700_000_000_000 } : {}),
  }));
  await seedStorage(page, { [KEY]: JSON.stringify({ v: 1, items }) });
  await launch(page, "#/saved");
  await expect(countStatus(page)).toHaveText(/^3 (apps?|entr(y|ies)|links?)$/);
  const order = await renderedRowIds(page);
  expect(order).toEqual([first.id, second.id, third.id]);

  await resultList(page).getByRole("button", { name: `Remove ${second.name} from saved` }).click();
  await expect(countStatus(page)).toHaveText(/^2 (apps?|entr(y|ies)|links?)$/);
  const bar = page.getByRole("status").filter({ hasText: `Removed ${second.name} and its note` });
  await expect(bar).toBeVisible();
  expect((await stored(page))?.items.find((item) => item.id === second.id)?.removedAt).toEqual(expect.any(Number));

  await bar.getByRole("button", { name: "Undo" }).click();
  await expect(bar).toHaveCount(0);
  await expect(countStatus(page)).toHaveText(/^3 (apps?|entr(y|ies)|links?)$/);
  expect(await renderedRowIds(page)).toEqual(order);
  expect(await stored(page)).toEqual({ v: 1, items });

  await resultList(page).getByRole("button", { name: `Remove ${first.name} from saved` }).click();
  await expect(page.getByRole("status").filter({ hasText: `Removed ${first.name}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0, { timeout: 12_000 });
  await expect(countStatus(page)).toHaveText(/^2 (apps?|entr(y|ies)|links?)$/);
});

test("a saved app that left every catalog is listed apart and can be removed", async ({ page }) => {
  await seedStorage(page, { [KEY]: JSON.stringify({ v: 1, items: [{ id: "gone.from.every.catalog", packages: ["gone.from.every.catalog"], repo: null, savedAt: 1 }] }) });
  await launch(page, "#/saved");
  const gone = page.getByRole("region", { name: "No longer in the catalogs" });
  await expect(gone).toContainText("gone.from.every.catalog");
  await gone.getByRole("button", { name: "Remove" }).click();
  await expect(gone).toHaveCount(0);
});

test("a save made in another window of the same browser appears without a reload", async ({ context, page }) => {
  await launch(page, "#/saved");
  await expect(page.getByRole("main")).toContainText("Nothing saved yet");
  const other = await context.newPage();
  const gallery = featuredApp();

  await other.goto(`/#/search?q=${encodeURIComponent(gallery.name)}`);
  await ready(other);
  await resultList(other).getByRole("button", { name: `Save ${gallery.name}` }).click();
  await expect(countStatus(page)).toHaveText(/^1 (apps?|entr(y|ies)|links?)$/);
  await other.close();
});
