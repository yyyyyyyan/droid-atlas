/**
 * Times the catalog parse, join and index build against the budgets in
 * docs/ARCHITECTURE.md, on the build that `public/data/version.json` (or the
 * version file given) points at. Each sample is taken with fresh inputs; the
 * first run of each step is reported too, because a launch pays that one.
 *
 *   node scripts/measure-model.ts [version.fixture.json]
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { buildVocabulary, countOptions, parseQuery, runQuery } from "../src/catalog/filters.ts";
import { buildModel } from "../src/catalog/model.ts";
import type { CatalogVersion } from "../src/catalog/schema.ts";
import { joinCatalog, type CatalogParts } from "../../schema/join.ts";
import type { Manifest } from "../../schema/parts.ts";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");

function timed(runs: number, work: () => void): { first: number; median: number } {
  const samples: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    work();
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { first: samples[0] ?? 0, median: sorted[Math.floor(sorted.length / 2)] ?? 0 };
}

function line(label: string, time: { first: number; median: number }): void {
  console.log(`${label.padEnd(30)} first ${time.first.toFixed(2).padStart(7)} ms   median ${time.median.toFixed(2).padStart(7)} ms`);
}

const version = JSON.parse(await readFile(join(dataDir, process.argv[2] ?? "version.json"), "utf8")) as CatalogVersion;
const base = join(dataDir, dirname(version.manifest));
const manifest = JSON.parse(await readFile(join(dataDir, version.manifest), "utf8")) as Manifest;
const texts = new Map<string, string>();
for (const file of manifest.files) {
  if (["atlas", "source", "index", "github"].includes(file.role)) texts.set(file.path, await readFile(join(base, file.path), "utf8"));
}

const parseAll = (): CatalogParts => {
  const of = (role: string): unknown[] => manifest.files.filter((file) => file.role === role).map((file) => JSON.parse(texts.get(file.path) ?? "null"));
  return { atlas: of("atlas")[0], sources: of("source"), indexes: of("index"), github: of("github")[0] } as CatalogParts;
};

console.log("Parts the app loads at start:");
let raw = 0;
let zipped = 0;
for (const [path, text] of texts) {
  const gzip = gzipSync(text, { level: 9 }).length;
  raw += text.length;
  zipped += gzip;
  const parse = timed(9, () => JSON.parse(text));
  console.log(`  ${path.padEnd(30)} ${(text.length / 1024).toFixed(0).padStart(5)} kB  gzip ${(gzip / 1024).toFixed(0).padStart(4)} kB  parse ${parse.median.toFixed(1)} ms`);
}
console.log(`  ${"total".padEnd(30)} ${(raw / 1024).toFixed(0).padStart(5)} kB  gzip ${(zipped / 1024).toFixed(0).padStart(4)} kB\n`);

const parts = parseAll();
const catalog = joinCatalog(parts);
const model = buildModel(catalog, Date.now());
const vocabulary = buildVocabulary(model);
const typed = parseQuery(vocabulary, { q: "launcher", f: "no-internet" });
const allKeys = vocabulary.defs.map((def) => def.key);

console.log(`${catalog.apps.length} apps, ${catalog.categories.length} categories, ${vocabulary.defs.length} filter tokens`);
line("parse every part", timed(9, parseAll));
line("joinCatalog", timed(9, () => joinCatalog(parseAll())));
line("  of which parsing", timed(9, parseAll));
line("model + vocabulary", timed(15, () => buildVocabulary(buildModel(catalog, Date.now()))));
line("search text + one filter", timed(50, () => runQuery(vocabulary, model.entries, typed)));
line("sort the whole catalog", timed(50, () => runQuery(vocabulary, model.entries, parseQuery(vocabulary, { sort: "stars" }))));
line("counts for every filter option", timed(50, () => countOptions(vocabulary, model.entries, typed, allKeys)));
