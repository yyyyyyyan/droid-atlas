/**
 * Droid Atlas's taxonomy: the table's own rules, the resolution rule on
 * synthetic listings, and, when the repository holds a built catalog, the
 * table against every upstream category and app of that catalog.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadPrevious } from "../validate.ts";
import {
  CATEGORIES,
  describeTaxonomy,
  loadPlacements,
  MAPPING,
  mappingsOf,
  mapSourceCategory,
  REGIONS,
  remainderOf,
  resolveCategory,
  type CatchAll,
  type Placement,
} from "../taxonomy.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "app", "public", "data");
const PLACEMENTS = loadPlacements(join(ROOT, "pipeline", "placements.json"));
const stored = existsSync(join(DATA, "version.json"));

const catchAlls = Object.entries(MAPPING).filter((entry): entry is [string, CatchAll] => typeof entry[1] !== "string");

test("the thirteen regions, in order", () => {
  assert.deepEqual(
    REGIONS.map((r) => r.id),
    ["system", "apps", "files", "automation", "device", "privacy", "personal", "comms", "media", "work", "world", "games", "guides"],
  );
});

test("category ids are unique slugs and names are unique", () => {
  const ids = CATEGORIES.map((c) => c.id);
  const names = CATEGORIES.map((c) => c.name);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(names).size, names.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, id);
});

test("every category belongs to a region, and no category carries its region's name", () => {
  const regions = new Map(REGIONS.map((r) => [r.id, r.name]));
  for (const category of CATEGORIES) {
    assert.ok(regions.has(category.region), category.id);
    assert.notEqual(category.name.toLowerCase(), regions.get(category.region)?.toLowerCase(), category.id);
  }
});

test("names are US English and in title case", () => {
  for (const { name } of CATEGORIES) {
    assert.doesNotMatch(name, /isation|ise\b|colour|centre|favourite|programme|catalogue/i, name);
    for (const word of name.split(/\s+/)) assert.match(word, /^(?:[A-Z0-9]|&$)/, `${name}: ${word}`);
  }
});

test("a region has at most one remainder, and every region a catch-all or a fallback leads to has one", () => {
  for (const region of REGIONS) assert.ok(CATEGORIES.filter((c) => c.region === region.id && c.remainder).length <= 1, region.id);
  const needed = new Set([...catchAlls.map(([, c]) => c.home), "world", "games", "system", "device"]);
  for (const region of needed) assert.doesNotThrow(() => remainderOf(region), region);
});

test("the mapping names only categories in the table", () => {
  const ids = new Set(CATEGORIES.map((c) => c.id));
  for (const [source, target] of Object.entries(MAPPING)) {
    if (typeof target === "string") assert.ok(ids.has(target), `${source} → ${target}`);
    else assert.ok(REGIONS.some((r) => r.id === target.home), `${source} → ${target.home}`);
  }
});

test("an upstream category missing from the table falls back to its source's fallback region's remainder", () => {
  assert.deepEqual(mapSourceCategory({ id: "android-foss/apps-brand-new", source: "android-foss", section: "Apps" }), { category: "other-apps", kind: "fallback", home: null });
  assert.deepEqual(mapSourceCategory({ id: "android-foss/games-brand-new", source: "android-foss", section: "Games" }), { category: "other-games", kind: "fallback", home: null });
  assert.deepEqual(mapSourceCategory({ id: "awesome-shizuku/vendor-new", source: "awesome-shizuku", section: "Vendor-specific" }), { category: "other-devices", kind: "fallback", home: null });
  assert.deepEqual(mapSourceCategory({ id: "awesome-shizuku/brand-new", source: "awesome-shizuku", section: "Apps" }), { category: "other-system-tools", kind: "fallback", home: null });
});

test("the owner's three cases: Utilities is a catch-all, Synchronisation maps to a US name, Productivity carries no region name", () => {
  assert.deepEqual(mapSourceCategory({ id: "android-foss/apps-utilities", source: "android-foss", section: "Apps" }), { category: null, kind: "catch-all", home: "system" });
  assert.equal(CATEGORIES.find((c) => c.id === MAPPING["android-foss/apps-synchronisation"])?.name, "Cloud & Sync");
  assert.equal(PLACEMENTS.get("com.sakethh.linkora")?.category, "bookmarks-read-later");
  assert.equal(PLACEMENTS.get("app.cliphistory")?.category, "clipboard-tools");
});

const SOURCE_CATEGORIES = [
  { id: "android-foss/apps-utilities", source: "android-foss" as const, section: "Apps" },
  { id: "android-foss/apps-notes", source: "android-foss" as const, section: "Apps" },
  { id: "awesome-shizuku/productivity", source: "awesome-shizuku" as const, section: "Apps" },
  { id: "awesome-shizuku/audio", source: "awesome-shizuku" as const, section: "Apps" },
];
const MAPPINGS = mappingsOf(SOURCE_CATEGORIES);

test("resolution: a placement wins over every listing", () => {
  const placements = new Map<string, Placement>([["a", { category: "launchers", reason: "test" }]]);
  assert.deepEqual(resolveCategory("a", ["android-foss/apps-notes"], MAPPINGS, placements), { category: "launchers", how: "placed" });
});

test("resolution: the first listing in a category that is not a catch-all decides", () => {
  assert.deepEqual(resolveCategory("a", ["android-foss/apps-utilities", "awesome-shizuku/audio"], MAPPINGS, new Map()), { category: "sound-volume", how: "mapped" });
  assert.deepEqual(resolveCategory("a", ["android-foss/apps-notes", "awesome-shizuku/audio"], MAPPINGS, new Map()), { category: "notes-journals", how: "mapped" });
});

test("resolution: an app only in catch-alls waits in its first catch-all's region's remainder", () => {
  assert.deepEqual(resolveCategory("a", ["awesome-shizuku/productivity", "android-foss/apps-utilities"], MAPPINGS, new Map()), { category: "other-productivity", how: "awaiting" });
  assert.deepEqual(resolveCategory("a", ["android-foss/apps-utilities"], MAPPINGS, new Map()), { category: "other-system-tools", how: "awaiting" });
});

test("every placement has a one-line reason", () => {
  for (const [app, placement] of PLACEMENTS) {
    assert.ok(placement.reason.length <= 140, app);
    assert.doesNotMatch(placement.reason, /\n/, app);
  }
});

test("the stored catalog: every upstream category is mapped or a catch-all", { skip: stored ? false : "no built catalog in app/public/data" }, async () => {
  const { catalog } = await loadPrevious(DATA);
  const unmapped = catalog.sourceCategories.filter((c) => !Object.hasOwn(MAPPING, c.id)).map((c) => c.id);
  assert.deepEqual(unmapped, []);
  assert.equal(catalog.sourceCategories.filter((c) => c.source === "android-foss").length, 88);
  assert.equal(catalog.sourceCategories.filter((c) => c.source === "awesome-shizuku").length, 51);
});

test("the stored catalog: an app that awaits placement is in its region's remainder and docs/TAXONOMY.md names it and no other, no placement is stale, and only a remainder is empty", { skip: stored ? false : "no built catalog in app/public/data" }, async () => {
  const { catalog } = await loadPrevious(DATA);
  const mappings = mappingsOf(catalog.sourceCategories);
  const filing = new Map(
    catalog.apps.map((app) => [app.id, resolveCategory(app.id, app.listings.map((l) => l.category), mappings, PLACEMENTS).how]),
  );
  const filed = catalog.apps.map((app) => ({ ...app, category: resolveCategory(app.id, app.listings.map((l) => l.category), mappings, PLACEMENTS).category }));
  const description = describeTaxonomy({ ...catalog, categories: [...CATEGORIES], apps: filed }, filing, PLACEMENTS);
  const page = readFileSync(join(ROOT, "docs", "TAXONOMY.md"), "utf8");
  for (const waiting of description.awaiting) {
    const listed = catalog.apps.find((app) => app.id === waiting.app);
    const home = listed?.listings.map((l) => mappings.get(l.category)?.home).find((h): h is string => typeof h === "string");
    const remainder = remainderOf(home ?? "system");
    assert.equal(waiting.category, remainder.id, `${waiting.app} waits in the remainder of its catch-all's region`);
    assert.equal(listed?.category, remainder.id, `${waiting.app} is stored in that remainder`);
    const line = page.split("\n").find((l) => l.startsWith(`- **${remainder.name}** (`)) ?? "";
    assert.ok([`: ${waiting.name} (awaiting placement)`, `, ${waiting.name} (awaiting placement)`].some((item) => line.includes(item)), `docs/TAXONOMY.md names ${waiting.app} under ${remainder.name}`);
  }
  assert.equal(page.split(" (awaiting placement)").length - 1, description.awaiting.length, "docs/TAXONOMY.md names no other app as awaiting placement");
  assert.deepEqual(description.stale.map((s) => s.app), []);
  assert.deepEqual(description.fallbacks, []);
  const empty = description.categories.filter((c) => c.apps === 0);
  assert.deepEqual(empty.filter((c) => !c.remainder).map((c) => c.id), []);
  assert.equal(filed.find((app) => app.id === "com.sakethh.linkora")?.category, "bookmarks-read-later");
});
