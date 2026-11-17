/**
 * M2: no source's text in another source's file or in the JavaScript bundle
 * (ARCHITECTURE.md § Output: "Source text never enters the JavaScript bundle
 * or another source's file"; LICENSING.md §2.C). Distinctive strings are
 * sampled with the audit seed from each origin and searched for, as they are
 * written in JSON, in every other file of the build and in the site's code.
 * Index text is also held against the cached index it came from.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadBuild, sample } from "../lib/catalog.ts";
import { SYNTHETIC } from "../lib/pick.ts";
import { siteDir } from "../site.ts";
import { SEED, cacheDir } from "./audit-config.ts";
import { readCache } from "./cache.ts";
import { upstreamFiles } from "./upstream.ts";

const build = loadBuild();

/** The text of each file of the build that carries content, keyed by its manifest path, with its origin. */
const FILES = build.manifest.files
  .filter((file) => file.role !== "upstream")
  .map((file) => ({ path: file.path, origin: file.origin, text: readFileSync(join(build.dir, file.path), "utf8") }));

const CODE = readdirSync(join(siteDir(), "assets"))
  .filter((name) => /\.(js|css|html)$/.test(name))
  .map((name) => ({ path: `assets/${name}`, text: readFileSync(join(siteDir(), "assets", name), "utf8") }))
  .concat([{ path: "index.html", text: readFileSync(join(siteDir(), "index.html"), "utf8") }]);

const SNAPSHOTS = upstreamFiles(build).map((file) => ({ source: file.source, text: readFileSync(file.path, "utf8") }));

function json(text: string): string {
  return JSON.stringify(text).slice(1, -1);
}

/** Strings long enough that finding one elsewhere cannot be coincidence. */
function distinctive(texts: (string | null | undefined)[]): string[] {
  return [...new Set(texts.filter((t): t is string => typeof t === "string" && t.length >= 40))];
}

function foundIn(text: string, ownOrigins: string[]): string[] {
  const needle = json(text);
  return [
    ...FILES.filter((file) => !ownOrigins.includes(file.origin) && file.text.includes(needle)).map((file) => file.path),
    ...CODE.filter((file) => file.text.includes(text) || file.text.includes(needle)).map((file) => file.path),
  ];
}

const shizukuPart = build.sources.find((s) => s.info.id === "awesome-shizuku");
const afPart = build.sources.find((s) => s.info.id === "android-foss");

/**
 * True when the origin itself states these words in the cache (a list copied
 * an app's own summary, or part of it, or its GitHub description), so finding
 * them in that origin's part is that origin's own text, not leakage.
 */
function originSaysItself(text: string, origin: string): boolean {
  const dir = cacheDir();
  if (!dir) return false;
  const cache = readCache(dir);
  if (origin === "github") return Object.values(cache.github).some((repo) => repo.description?.includes(text));
  const index = origin === "fdroid" ? cache.fdroid : origin === "izzy" ? cache.izzy : null;
  if (!index) return false;
  const plainText = (html: string): string => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'");
  return Object.values(index.packages).some((pkg) =>
    [...Object.values(pkg.metadata.summary ?? {}), ...Object.values(pkg.metadata.description ?? {})].some((own) => own.includes(text) || plainText(own).includes(text)));
}

/** The origin whose text a build file holds, for the files that hold one origin's text. */
function originOfPath(path: string): string | null {
  if (path === "sources/github.json") return "github";
  const match = /^(?:sources\/|details\/)(fdroid|izzy)(?:\.json|\/)/.exec(path);
  return match?.[1] ?? null;
}

test("every awesome-shizuku description appears in no other origin's file and not in the site's code", () => {
  const texts = distinctive((shizukuPart?.listings ?? []).map((l) => l.description));
  if (SYNTHETIC) test.skip(texts.length === 0, "the synthetic catalog has no long descriptions");
  else expect(texts.length).toBeGreaterThan(40);
  test.info().annotations.push({ type: "strings searched", description: String(texts.length) });
  const shared: string[] = [];
  const leaks = texts
    .map((t) => ({ text: t.slice(0, 60), where: foundIn(t, ["awesome-shizuku"]).filter((path) => {
      const origin = originOfPath(path);
      if (origin && originSaysItself(t, origin)) {
        shared.push(`“${t.slice(0, 60)}” is also ${origin}'s own text`);
        return false;
      }
      return true;
    }) }))
    .filter((leak) => leak.where.length > 0);
  if (shared.length) test.info().annotations.push({ type: "same words in two sources", description: shared.join("; ") });
  expect(leaks).toEqual([]);
});

test(`every F-Droid and IzzyOnDroid summary, and 40 description excerpts each (seed ${SEED}), appear in neither catalog's file, nor GitHub's, nor the site's code, unless that catalog wrote the same words itself`, () => {
  const problems: string[] = [];
  for (const origin of ["fdroid", "izzy"] as const) {
    const part = origin === "fdroid" ? build.fdroid : build.izzy;
    const summaries = distinctive(Object.values(part.apps).map((record) => record.summary));
    const details = FILES.filter((f) => f.path.startsWith(`details/${origin}/`))
      .flatMap((f) => Object.values(JSON.parse(f.text) as Record<string, { description: string }>).map((d) => d.description.slice(0, 200)));
    for (const text of [...summaries, ...sample(distinctive(details), 40, SEED)]) {
      const where = foundIn(text, ["fdroid", "izzy"]).filter((path) => {
        if (path === "sources/awesome-shizuku.json" || path === "sources/android-foss.json") {
          const source = path.includes("shizuku") ? "awesome-shizuku" : "android-foss";
          return !SNAPSHOTS.some((s) => s.source === source && s.text.includes(text));
        }
        return true;
      });
      if (where.length) problems.push(`${origin} “${text.slice(0, 60)}…” found in ${where.join(", ")}`);
    }
  }
  expect(problems).toEqual([]);
});

test("a GitHub description is shipped only for apps whose summary it is (LICENSING.md §2.F)", () => {
  const problems = build.apps
    .filter((app) => app.githubDescription !== null)
    .filter((app) => Boolean(app.fdroid?.summary || app.izzy?.summary || app.listings.find((l) => l.source === "awesome-shizuku")?.description))
    .map((app) => `${app.id}: GitHub description shipped although a licensed summary exists`);
  expect(problems).toEqual([]);
});

test("Android FOSS listing names (seeded) appear only as listing names: the bundle carries none of the catalog", () => {
  const names = sample(((afPart?.listings ?? []).map((l) => l.name)).filter((n) => n.length >= 12), 40, SEED);
  const inCode = names.filter((name) => CODE.some((file) => file.text.includes(name)));
  expect(inCode).toEqual([]);
});

test(`index text is carried exactly: summaries and description excerpts (40 each, seed ${SEED}) match the cached index`, () => {
  const dir = cacheDir();
  if (SYNTHETIC) test.skip(!dir, "the synthetic build ships no cache");
  else expect(dir, "the upstream cache").not.toBeNull();
  const cache = readCache(dir ?? "");
  const problems: string[] = [];
  const english = (map: Record<string, string> | undefined): string | null => {
    if (!map) return null;
    const key = ["en-US", "en", "en-GB"].find((k) => k in map) ?? Object.keys(map).find((k) => k.startsWith("en")) ?? Object.keys(map)[0];
    return key ? map[key] ?? null : null;
  };
  /** Letters and digits only: how the index's HTML and the shipped plain text are compared, since markup, bullets and entities are rendered differently by design. */
  const letters = (text: string): string => text.replace(/&[a-z]+;|&#\d+;/gi, "").replace(/<[^>]+>/g, "").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
  for (const origin of ["fdroid", "izzy"] as const) {
    const part = origin === "fdroid" ? build.fdroid : build.izzy;
    const index = origin === "fdroid" ? cache.fdroid : cache.izzy;
    for (const [id, record] of sample(Object.entries(part.apps), 40, SEED)) {
      const cached = index.packages[record.facts.pkg]?.metadata;
      if (!cached) {
        problems.push(`${origin} ${id}: ${record.facts.pkg} not in the cached index`);
        continue;
      }
      const summary = english(cached.summary);
      if ((record.summary ?? null) !== (summary?.trim() || null)) problems.push(`${origin} ${id}: summary “${record.summary}” ≠ index “${summary}”`);
    }
    const shards = FILES.filter((f) => f.path.startsWith(`details/${origin}/`));
    const details = shards.flatMap((f) => Object.entries(JSON.parse(f.text) as Record<string, { description: string }>));
    for (const [id, detail] of sample(details, 40, SEED)) {
      const pkg = part.apps[id]?.facts.pkg;
      const full = pkg ? english(index.packages[pkg]?.metadata.description) : null;
      if (!full) {
        problems.push(`${origin} ${id}: details shard has a description, the cached index has none`);
        continue;
      }
      const shipped = letters(detail.description.replace(/…\s*$/, ""));
      const indexed = letters(full);
      if (!indexed.startsWith(shipped)) {
        const at = [...shipped].findIndex((ch, i) => indexed[i] !== ch);
        problems.push(`${origin} ${id}: shipped text departs from the index at letter ${at}: “…${shipped.slice(Math.max(0, at - 20), at + 30)}” vs “…${indexed.slice(Math.max(0, at - 20), at + 30)}”`);
      }
    }
  }
  expect(problems).toEqual([]);
});
