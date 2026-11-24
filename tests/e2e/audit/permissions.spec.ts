/**
 * Every app's permission names, count and caps against the index the build
 * was made from: the names of both `uses-permission` and
 * `uses-permission-sdk-23` of the latest version, counted once each; a name
 * keeps a cap only when every declaration of it has one, and then the
 * highest.
 */

import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBuild, type DetailsOf } from "../lib/catalog.ts";
import { cacheDir } from "./audit-config.ts";
import { readCache } from "./cache.ts";

const build = loadBuild();

/** Every details entry of the build, by origin and app id, read once. */
const shards = { fdroid: new Map<string, DetailsOf>(), izzy: new Map<string, DetailsOf>() };
for (const file of build.manifest.files) {
  if (file.role !== "details" || (file.origin !== "fdroid" && file.origin !== "izzy")) continue;
  for (const [id, entry] of Object.entries(JSON.parse(readFileSync(join(build.dir, file.path), "utf8")) as Record<string, DetailsOf>)) shards[file.origin].set(id, entry);
}

interface Declared { name?: unknown; maxSdkVersion?: unknown }

test("each index's names, count and caps are both manifest elements', the widest declaration of a name winning", () => {
  const dir = cacheDir();
  test.skip(!dir, "needs the cache the build was made from");
  const cache = readCache(dir ?? "");
  const problems: string[] = [];
  let checked = 0;
  for (const app of build.apps) {
    for (const origin of ["fdroid", "izzy"] as const) {
      const record = app[origin];
      if (!record) continue;
      const versions = Object.values(cache[origin].packages[record.facts.pkg]?.versions ?? {});
      const manifest = versions.sort((a, b) => (b.manifest?.versionCode ?? 0) - (a.manifest?.versionCode ?? 0))[0]?.manifest as { usesPermission?: Declared[]; usesPermissionSdk23?: Declared[] } | undefined;
      const widest = new Map<string, number | null>();
      for (const item of [...(manifest?.usesPermission ?? []), ...(manifest?.usesPermissionSdk23 ?? [])]) {
        if (typeof item.name !== "string" || !item.name.trim()) continue;
        const name = item.name.trim();
        const cap = typeof item.maxSdkVersion === "number" && Number.isInteger(item.maxSdkVersion) && item.maxSdkVersion >= 1 && item.maxSdkVersion <= 1000 ? item.maxSdkVersion : null;
        const before = widest.get(name);
        widest.set(name, before === undefined ? cap : before === null || cap === null ? null : Math.max(before, cap));
      }
      const shard = shards[origin].get(app.id) ?? {};
      const names = shard.permissions ?? [];
      const expectedCaps = Object.fromEntries(names.flatMap((name) => {
        const cap = widest.get(name);
        return typeof cap === "number" ? [[name, cap]] : [];
      }));
      checked++;
      if (record.facts.permissionCount !== widest.size) problems.push(`${origin} ${app.id}: count ${record.facts.permissionCount}, the manifest declares ${widest.size}`);
      if (names.some((name) => !widest.has(name))) problems.push(`${origin} ${app.id}: a name the manifest does not declare`);
      if (JSON.stringify(shard.permissionCaps ?? {}) !== JSON.stringify(expectedCaps)) problems.push(`${origin} ${app.id}: caps ${JSON.stringify(shard.permissionCaps ?? {})}, expected ${JSON.stringify(expectedCaps)}`);
      if (record.facts.declaresInternet !== widest.has("android.permission.INTERNET")) problems.push(`${origin} ${app.id}: internet`);
    }
  }
  test.info().annotations.push({ type: "index entries checked", description: String(checked) });
  expect(checked).toBeGreaterThan(0);
  expect(problems).toEqual([]);
});
