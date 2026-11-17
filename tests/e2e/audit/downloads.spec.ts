/**
 * Download figures against the cached publications they were made from,
 * recomputed here without the pipeline's code: F-Droid's weekly per-server
 * files, IzzyOnDroid's per-day files and GitHub's release facts. Both
 * polarities: a figure the data does not support, and data with no figure.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadBuild } from "../lib/catalog.ts";
import { SYNTHETIC } from "../lib/pick.ts";
import { cacheDir } from "./audit-config.ts";

const build = loadBuild();
const dir = cacheDir();

interface Stat {
  origin: "fdroid" | "izzy" | "github";
  count: number;
  from: string | null;
  to: string | null;
}

const statOf = (record: unknown): Stat | null => ((record as { downloads?: Stat | null } | undefined)?.downloads ?? null);

test.beforeEach(() => {
  if (SYNTHETIC) test.skip(!dir, "the synthetic build is audited only against a cache named in E2E_CACHE_DIR");
  else expect(dir, "the upstream cache (E2E_CACHE_DIR or .cache)").not.toBeNull();
});

test("every figure has its origin, a period of whole days, and at least one download", () => {
  const problems: string[] = [];
  const parts = [["fdroid", build.fdroid.apps], ["izzy", build.izzy.apps], ["github", build.github.apps]] as const;
  for (const [origin, apps] of parts) {
    for (const [id, record] of Object.entries(apps)) {
      const stat = statOf(record);
      if (!stat) continue;
      if (stat.origin !== origin) problems.push(`${id}: a ${stat.origin} figure in the ${origin} part`);
      if (!Number.isInteger(stat.count) || stat.count < 1) problems.push(`${id}: ${origin} count ${stat.count}`);
      if (!stat.from || !stat.to || !/^\d{4}-\d{2}-\d{2}$/.test(stat.from) || !/^\d{4}-\d{2}-\d{2}$/.test(stat.to) || stat.from > stat.to) problems.push(`${id}: ${origin} period ${stat.from}–${stat.to}`);
    }
  }
  expect(problems).toEqual([]);
});

test("F-Droid figures are the APK hits in the cached weekly files of the period, for the app's package", () => {
  const metrics = join(dir ?? "", "downloads", "fdroid-metrics");
  const figures = Object.entries(build.fdroid.apps).map(([id, record]) => ({ id, pkg: record.facts.pkg, stat: statOf(record) }));
  const period = figures.find((f) => f.stat)?.stat;
  test.skip(!period, "this build has no F-Droid figures");
  const hits = new Map<string, number>();
  for (const name of existsSync(metrics) ? readdirSync(metrics) : []) {
    const week = /^(http\d\d\.fdroid\.net)\.(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    if (!week) continue;
    const file = JSON.parse(readFileSync(join(metrics, name), "utf8")) as { firstProcessedDate: string; lastProcessedDate: string; paths: Record<string, { hits: number }> };
    if (file.firstProcessedDate.slice(0, 10) < (period?.from ?? "") || file.lastProcessedDate.slice(0, 10) > (period?.to ?? "")) continue;
    for (const [path, { hits: n }] of Object.entries(file.paths)) {
      const pkg = /^\/(?:repo|archive)\/(.+)_\d+\.apk$/.exec(path)?.[1];
      if (pkg) hits.set(pkg, (hits.get(pkg) ?? 0) + n);
    }
  }
  const problems: string[] = [];
  for (const { id, pkg, stat } of figures) {
    const expected = hits.get(pkg) ?? 0;
    if ((stat?.count ?? 0) !== expected) problems.push(`${id} (${pkg}): figure ${stat?.count ?? "none"}, cached files ${expected}`);
    if (stat && (stat.from !== period?.from || stat.to !== period?.to)) problems.push(`${id}: period ${stat.from}–${stat.to} differs from the build's ${period?.from}–${period?.to}`);
  }
  expect(problems).toEqual([]);
});

test("IzzyOnDroid figures are the sum of the cached daily counts over the period, for the app's package", () => {
  const stats = join(dir ?? "", "downloads", "izzy-dlstats");
  const figures = Object.entries(build.izzy.apps).map(([id, record]) => ({ id, pkg: record.facts.pkg, stat: statOf(record) }));
  const period = figures.find((f) => f.stat)?.stat;
  test.skip(!period, "this build has no IzzyOnDroid figures");
  const counts = new Map<string, number>();
  for (const name of existsSync(stats) ? readdirSync(stats) : []) {
    if (!/^\d{4}-\d{2}\.json$/.test(name)) continue;
    const days = JSON.parse(readFileSync(join(stats, name), "utf8")) as Record<string, Record<string, number>>;
    for (const [date, packages] of Object.entries(days)) {
      if (date < (period?.from ?? "") || date > (period?.to ?? "")) continue;
      for (const [pkg, n] of Object.entries(packages)) counts.set(pkg, (counts.get(pkg) ?? 0) + n);
    }
  }
  const problems: string[] = [];
  for (const { id, pkg, stat } of figures) {
    const expected = counts.get(pkg) ?? 0;
    if ((stat?.count ?? 0) !== expected) problems.push(`${id} (${pkg}): figure ${stat?.count ?? "none"}, cached days ${expected}`);
  }
  expect(problems).toEqual([]);
});

test("GitHub figures are the latest release's APK downloads in the cached facts, from its publication to the fetch", () => {
  const cached = JSON.parse(readFileSync(join(dir ?? "", "github-repos.json"), "utf8")) as { fetchedAt: string; repos: Record<string, { fullName?: string; release: { publishedAt: string; apkDownloads?: number } | null }> };
  // A repository linked under an old name and named under its new one is queried twice in one run, and GitHub's counts can move between the two queries; either answer is GitHub's statement.
  const byName = new Map<string, (typeof cached.repos)[string][]>();
  for (const repo of Object.values(cached.repos)) if (repo.fullName) byName.set(repo.fullName.toLowerCase(), [...(byName.get(repo.fullName.toLowerCase()) ?? []), repo]);
  const problems: string[] = [];
  for (const app of build.apps) {
    const slug = app.atlas.repo?.host === "github" ? app.atlas.repo.slug?.toLowerCase() : undefined;
    const stat = statOf(build.github.apps[app.id]);
    const repos = slug ? [...new Set([cached.repos[slug], ...(byName.get(slug) ?? [])].filter((r) => r !== undefined))] : [];
    if (!build.github.apps[app.id]) {
      if (stat) problems.push(`${app.id}: a GitHub figure without GitHub facts`);
      continue;
    }
    const matching = repos.filter((repo) => (repo.release?.apkDownloads ?? 0) === (stat?.count ?? 0));
    if (!matching.length) problems.push(`${app.id}: figure ${stat?.count ?? "none"}, cached release ${repos.map((r) => r.release?.apkDownloads ?? 0).join(" or ") || "none"}`);
    if (stat && (!matching.some((repo) => stat.from === repo.release?.publishedAt.slice(0, 10)) || stat.to !== cached.fetchedAt.slice(0, 10))) problems.push(`${app.id}: period ${stat.from}–${stat.to}`);
  }
  expect(problems).toEqual([]);
});
