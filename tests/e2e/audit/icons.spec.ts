/**
 * Icon credits against the files the build ships and the sources it read:
 * every credit names two real files for an app that shows them, and every
 * original is the one a source states (an index entry in the cache, a cached
 * lookup, or a reviewed source in pipeline/icon-policy.json), with the bytes
 * the credit records.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadBuild } from "../lib/catalog.ts";
import { SYNTHETIC } from "../lib/pick.ts";
import { REPO_ROOT } from "../site.ts";
import { cacheDir } from "./audit-config.ts";
import { readCache, type IndexPackage } from "./cache.ts";

const build = loadBuild();
const dir = cacheDir();

interface IconRecord {
  file: string;
  fileLarge: string;
  app: string;
  name: string;
  rule: string;
  original: { url: string; sha256: string };
  revision: string | null;
  retrieved: string;
  author: string;
  license: string;
  project: string | null;
  changes: string;
}

const RULES = ["fdroid-index", "izzy-index", "repo-fastlane", "repo-metadata", "repo-launcher", "readme-logo", "site-icon", "store-listing", "forge-avatar"];
const records = (JSON.parse(readFileSync(join(build.dir, "icons.json"), "utf8")) as { icons: IconRecord[] }).icons;
const atlas = build.atlas.apps as (typeof build.atlas.apps[number] & { iconLarge: string | null })[];
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

test("every icon credit names two shipped files, each named by its own content hash, for the app that shows them", () => {
  const problems: string[] = [];
  const byApp = new Map(records.map((r) => [r.app, r]));
  if (byApp.size !== records.length) problems.push("two credits for one app");
  for (const record of records) {
    for (const file of [record.file, record.fileLarge]) {
      const name = /^icons\/([0-9a-f]{16})\.webp$/.exec(file)?.[1];
      const path = join(build.dataRoot, file);
      if (!name) problems.push(`${record.app}: file name ${file}`);
      else if (!existsSync(path)) problems.push(`${record.app}: ${file} is credited but not shipped`);
      else if (!sha256(readFileSync(path)).startsWith(name)) problems.push(`${record.app}: ${file} does not hash to its name`);
    }
    if (!RULES.includes(record.rule)) problems.push(`${record.app}: unknown rule ${record.rule}`);
    if (!/^https:\/\//.test(record.original.url)) problems.push(`${record.app}: original ${record.original.url}`);
    if (!/^[0-9a-f]{64}$/.test(record.original.sha256)) problems.push(`${record.app}: original sha256 ${record.original.sha256}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.retrieved)) problems.push(`${record.app}: retrieved ${record.retrieved}`);
    if (!record.author.trim() || !record.license.trim() || !record.name.trim()) problems.push(`${record.app}: credit without author, license or name`);
    if (/index$|^repo-/.test(record.rule) && !record.revision) problems.push(`${record.app}: ${record.rule} without the index time or commit it was read at`);
  }
  for (const app of atlas) {
    const record = byApp.get(app.id);
    if (app.icon === null && app.iconLarge === null) {
      if (record) problems.push(`${app.id}: a credit but no icon`);
      continue;
    }
    if (!record) problems.push(`${app.id}: icon ${app.icon} has no credit`);
    else if (record.file !== app.icon || record.fileLarge !== app.iconLarge) problems.push(`${app.id}: atlas ${app.icon} ${app.iconLarge} ≠ credit ${record.file} ${record.fileLarge}`);
  }
  expect(problems).toEqual([]);
});

/** The index's icon entries for a package, as absolute URLs with their SHA-256. */
function indexIcons(pkg: IndexPackage | undefined, base: string): { url: string; sha256: string }[] {
  const icon = (pkg?.metadata as { icon?: Record<string, { name?: string; sha256?: string }> } | undefined)?.icon ?? {};
  return Object.values(icon).map((entry) => ({ url: `${base}${entry.name ?? ""}`, sha256: entry.sha256 ?? "" }));
}

test("every original is one a source states, and the cached original has the bytes the credit records", () => {
  if (!dir) {
    test.skip(SYNTHETIC, "the synthetic build is audited only against a cache named in E2E_CACHE_DIR");
    expect(dir, "the upstream cache (E2E_CACHE_DIR or .cache)").not.toBeNull();
    return;
  }
  const cache = readCache(dir);
  const discovery = JSON.parse(readFileSync(join(dir, "icons", "discovery.json"), "utf8")) as { entries: Record<string, { candidates: { url: string }[] }> };
  const reviewed = (JSON.parse(readFileSync(join(REPO_ROOT, "pipeline", "icon-policy.json"), "utf8")) as { sources?: { app: string; rule: string; url: string; sha256: string }[] }).sources ?? [];
  const problems: string[] = [];
  for (const record of records) {
    if (record.rule === "fdroid-index" || record.rule === "izzy-index") {
      const origin = record.rule === "fdroid-index" ? "fdroid" : "izzy";
      const pkg = (origin === "fdroid" ? build.fdroid : build.izzy).apps[record.app]?.facts.pkg;
      const icons = pkg ? indexIcons((origin === "fdroid" ? cache.fdroid : cache.izzy).packages[pkg], origin === "fdroid" ? "https://f-droid.org/repo" : "https://apt.izzysoft.de/fdroid/repo") : [];
      const stated = icons.find((icon) => icon.url === record.original.url);
      if (!stated) problems.push(`${record.app}: ${record.original.url} is not an icon the ${origin} index states for ${pkg ?? "the app"}`);
      else if (stated.sha256 !== record.original.sha256) problems.push(`${record.app}: the index states ${stated.sha256}, the credit ${record.original.sha256}`);
    } else if (reviewed.some((s) => s.app === record.app && s.url === record.original.url)) {
      if (!reviewed.some((s) => s.app === record.app && s.url === record.original.url && s.sha256 === record.original.sha256 && s.rule === record.rule)) problems.push(`${record.app}: the reviewed source ${record.original.url} names other bytes or another rule`);
    } else if (!discovery.entries[record.app]?.candidates.some((c) => c.url === record.original.url)) {
      problems.push(`${record.app}: ${record.original.url} is neither among the app's cached lookup results nor a reviewed source`);
    }
    const key = sha256(new TextEncoder().encode(record.original.url)).slice(0, 32);
    const original = join(dir, "icons", "originals", key);
    if (!existsSync(original)) problems.push(`${record.app}: original not in the cache`);
    else if (sha256(readFileSync(original)) !== record.original.sha256) problems.push(`${record.app}: cached original does not hash to the credit's sha256`);
  }
  expect(problems).toEqual([]);
});
