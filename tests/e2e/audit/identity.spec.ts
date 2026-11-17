/**
 * M2: identity. Every merge in the build report is re-justified here from the
 * upstream links and the cache, every listed non-merge is re-judged, and the
 * catalog is searched for merges the pipeline missed and like-named pairs the
 * report leaves out (ARCHITECTURE.md § Identity: "The build report lists
 * every merge … and every pair of like-named entries that was not merged").
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadBuild, type App, type Listing } from "../lib/catalog.ts";
import { SYNTHETIC } from "../lib/pick.ts";
import { cacheDir } from "./audit-config.ts";
import { canonicalRepo, readCache, repoKey, storeLinkPackage, type Cache } from "./cache.ts";
import { readUpstream } from "./upstream.ts";

interface ReportEntry { source: string; file: string; line: number; name: string; url: string; app?: string }
interface Report {
  identity: {
    merges: { app: string; identifier: string; crossSource: boolean; entries: ReportEntry[] }[];
    nonMerges: { a: ReportEntry; b: ReportEntry; similarity: string }[];
    multiPackageRepos: { repo: string; packages: string[] }[];
  };
}

const build = loadBuild();
const reportPath = join(build.dataRoot, "report.json");
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, "utf8")) as Report : null;
const dir = cacheDir();
const upstream = readUpstream(build);

test.beforeEach(() => {
  if (SYNTHETIC) test.skip(!dir || !report, "the synthetic build ships no cache or report to audit against");
  else {
    expect(report, "data/report.json").not.toBeNull();
    expect(dir, "the upstream cache (E2E_CACHE_DIR or .cache)").not.toBeNull();
  }
});

/** Every link an upstream entry gives: its own, its store badges, and further links. */
function linksOf(entry: ReportEntry): string[] {
  const parsed = [...upstream.androidFoss, ...upstream.awesomeShizuku].find((e) => e.source === entry.source && e.line === entry.line && e.file === entry.file);
  const listing = build.sources.find((s) => s.info.id === entry.source)?.listings.find((l) => l.name === entry.name && l.url.replace(/\/$/, "") === entry.url.replace(/\/$/, ""));
  return [entry.url, parsed?.fdroid, parsed?.izzy, ...(listing?.extraLinks.map((l) => l.url) ?? [])].filter((u): u is string => Boolean(u));
}

function indexRepo(pkg: string, cache: Cache): string | null {
  const source = cache.fdroid.packages[pkg]?.metadata.sourceCode ?? cache.izzy.packages[pkg]?.metadata.sourceCode;
  return canonicalRepo(repoKey(source), cache);
}

/** Why an entry belongs to a package or repository, or null when nothing it links says so. */
function ties(entry: ReportEntry, identifier: string, cache: Cache): string | null {
  const links = linksOf(entry);
  const [kind, ...rest] = identifier.split(":");
  const value = rest.join(":");
  const repos = links.map((url) => canonicalRepo(repoKey(url), cache)).filter((r): r is string => Boolean(r));
  if (kind === "package") {
    const linked = links.map(storeLinkPackage).filter((p): p is string => Boolean(p));
    if (linked.includes(value)) return `links ${value}`;
    if (linked.some((p) => p.startsWith(`${value}.`) || value.startsWith(`${p}.`))) return `links a suffix variant of ${value}`;
    const named = indexRepo(value, cache);
    if (named && repos.includes(named)) return `its repository ${named} is the one the index names for ${value}`;
    return null;
  }
  if (kind === "repo") {
    const wanted = canonicalRepo(value, cache);
    if (repos.includes(wanted ?? "")) return `links ${wanted}`;
    for (const pkg of links.map(storeLinkPackage).filter((p): p is string => Boolean(p))) {
      const base = pkg.replace(/\.(fdroid|foss|play|beta|libre)$/, "");
      if (indexRepo(pkg, cache) === wanted || indexRepo(base, cache) === wanted) return `links ${pkg}, whose index repository is ${wanted}`;
    }
    return null;
  }
  return null;
}

test("every merge in the build report is justified by an identifier the entries and the cache confirm", () => {
  const cache = readCache(dir ?? "");
  const unjustified: string[] = [];
  const justified: string[] = [];
  for (const merge of report?.identity.merges ?? []) {
    const reasons = merge.entries.map((entry) => ties(entry, merge.identifier, cache));
    const line = `${merge.app} (${merge.identifier}): ${merge.entries.map((e, i) => `${e.source}:${e.line} “${e.name}” ${reasons[i] ?? "— NOTHING TIES IT"}`).join(" | ")}`;
    if (reasons.some((reason) => reason === null)) unjustified.push(line);
    else justified.push(line);
  }
  test.info().annotations.push({ type: "merges judged right", description: `${justified.length}: ${justified.join(" ;; ")}` });
  expect(unjustified).toEqual([]);
});

function nameKey(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(app|apps|client|android|for|the)\b/g, "").replace(/[^a-z0-9]+/g, "");
}

test("every listed non-merge is right: the two entries have no shared package and no shared single-app repository", () => {
  const cache = readCache(dir ?? "");
  const wrong: string[] = [];
  for (const pair of report?.identity.nonMerges ?? []) {
    const a = linksOf(pair.a);
    const b = linksOf(pair.b);
    const packages = (links: string[]): Set<string> => new Set(links.map(storeLinkPackage).filter((p): p is string => Boolean(p)));
    const repos = (links: string[]): Set<string> => new Set(links.map((url) => canonicalRepo(repoKey(url), cache)).filter((r): r is string => Boolean(r)));
    const sharedPackage = [...packages(a)].filter((p) => packages(b).has(p));
    const sharedRepo = [...repos(a)].filter((r) => repos(b).has(r));
    if (sharedPackage.length || sharedRepo.length) {
      wrong.push(`“${pair.a.name}” ${pair.a.source}:${pair.a.line} and “${pair.b.name}” ${pair.b.source}:${pair.b.line} share ${[...sharedPackage, ...sharedRepo].join(", ")}`);
    }
  }
  expect(wrong).toEqual([]);
});

test("every pair of like-named entries in different apps is listed in the report's non-merges", () => {
  const listings: (Listing & { app: string })[] = build.sources.flatMap((s) => s.listings);
  const byKey = new Map<string, (Listing & { app: string })[]>();
  for (const listing of listings) {
    const key = nameKey(listing.name);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), listing]);
  }
  const reported = new Set((report?.identity.nonMerges ?? []).map((pair) => [pair.a.app, pair.b.app].sort().join(" ")));
  const missing: string[] = [];
  for (const [key, group] of byKey) {
    const apps = [...new Set(group.map((l) => l.app))].sort();
    for (let i = 0; i < apps.length; i += 1) {
      for (let j = i + 1; j < apps.length; j += 1) {
        const pair = `${apps[i]} ${apps[j]}`;
        if (!reported.has(pair)) {
          const names = group.filter((l) => l.app === apps[i] || l.app === apps[j]).map((l) => `“${l.name}” (${l.source})`);
          missing.push(`${key}: ${pair} — ${[...new Set(names)].join(", ")}`);
        }
      }
    }
  }
  expect(missing).toEqual([]);
});

function liveRepo(app: App, cache: Cache): string | null {
  return canonicalRepo(repoKey(app.atlas.repo?.url), cache);
}

test("no two apps share a live package id, nor a single-app repository with neither a fork (merges the pipeline might have missed)", () => {
  const cache = readCache(dir ?? "");
  const multi = new Set((report?.identity.multiPackageRepos ?? []).map((m) => canonicalRepo(m.repo, cache)));
  const byPackage = new Map<string, string[]>();
  const byRepo = new Map<string, string[]>();
  for (const app of build.apps) {
    for (const channel of app.atlas.channels) {
      if (channel.listed === false) continue;
      byPackage.set(channel.pkg, [...new Set([...(byPackage.get(channel.pkg) ?? []), app.id])]);
    }
    const repo = liveRepo(app, cache);
    if (repo && !app.atlas.facets.fork && !multi.has(repo) && app.listings.every((l) => l.kind === "app")) {
      byRepo.set(repo, [...(byRepo.get(repo) ?? []), app.id]);
    }
  }
  const shared = [
    ...[...byPackage].filter(([, apps]) => apps.length > 1).map(([pkg, apps]) => `package ${pkg}: ${apps.join(", ")}`),
    ...[...byRepo].filter(([, apps]) => apps.length > 1).map(([repo, apps]) => `repository ${repo}: ${apps.join(", ")}`),
  ];
  expect(shared).toEqual([]);
});

test("the one rejected store link (rule 5) is right: the index names an unrelated repository that another entry lists", () => {
  const cache = readCache(dir ?? "");
  const rejected = (JSON.parse(readFileSync(reportPath, "utf8")) as { identity: { rejectedLinks: { entry: ReportEntry; pkg: string; indexRepo: string }[] } }).identity.rejectedLinks;
  const wrong: string[] = [];
  for (const link of rejected) {
    const named = indexRepo(link.pkg, cache);
    const entryRepo = canonicalRepo(repoKey(link.entry.url), cache);
    const otherLists = build.apps.some((app) => liveRepo(app, cache) === named && !app.listings.some((l) => l.name === link.entry.name));
    if (!named || named === entryRepo || !otherLists) wrong.push(`${link.entry.name} → ${link.pkg}: index ${named}, entry ${entryRepo}, listed elsewhere ${otherLists}`);
  }
  expect(wrong).toEqual([]);
});
