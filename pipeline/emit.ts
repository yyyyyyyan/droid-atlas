/**
 * Writes a build to the data directory (docs/ARCHITECTURE.md § Output):
 *
 *   version.json                                the only mutable file, written last
 *   c/<digest>/manifest.json                    every file of the build with sha256 and license
 *   c/<digest>/atlas.json, sources/*.json, icons.json
 *   c/<digest>/details/<origin>/<n>.json        long text and permission names, one origin per shard
 *   icons/<content-hash>.webp                   written by the icon stage
 *   upstream/<source>/<commit>…                 snapshot of the upstream files used
 *   licenses/<SPDX-id>.txt                      every license the manifest or icons.json names
 *
 * Output is deterministic: ordering is fixed upstream, and every timestamp
 * comes from the inputs or from `generatedAt`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  CATALOG_SCHEMA_VERSION,
  detailsShard,
  type AntiFeature,
  type App,
  type Catalog,
  type CatalogVersion,
  type Category,
  type DetailsEntry,
  type DetailsShard,
  type EnrichmentInfo,
  type Region,
  type SourceCategory,
  type SourceId,
  type SourceInfo,
} from "../schema/catalog.ts";
import type { CatalogParts } from "../schema/join.ts";
import type { IconsPart, Manifest, ManifestFile, PartHeader } from "../schema/parts.ts";
import { sha256, stableStringify } from "./lib/hash.ts";

export interface CatalogFields {
  sources: SourceInfo[];
  enrichment: EnrichmentInfo;
  regions: Region[];
  categories: Category[];
  sourceCategories: SourceCategory[];
  antiFeatures: AntiFeature[];
  apps: App[];
  redirects: Record<string, string | null>;
}

export type DetailsByOrigin = Record<"fdroid" | "izzy", Record<string, DetailsEntry>>;

/** Budget for one details shard, gzip-compressed (docs/ARCHITECTURE.md § Budgets), with headroom. */
export const SHARD_TARGET_BYTES = 32_000;
export const SHARD_BUDGET_BYTES = 40_000;
const DIRECTORY_HASH_LENGTH = 16;
const BUILD_DIR_RE = /^[0-9a-f]{16}$/;

/**
 * Hash of everything a build publishes except `generatedAt` and the hash
 * itself: the catalog, the details text and the icon records. Part headers
 * are excluded because their dates follow `generatedAt`, so two builds of
 * unchanged sources share this hash while their files differ; the directory
 * a build is published in is therefore named by `buildDirectory`, not by this.
 */
export function catalogHash(fields: CatalogFields, details: DetailsByOrigin, icons: IconsPart["icons"]): string {
  return sha256(stableStringify({ schema: CATALOG_SCHEMA_VERSION, ...fields, details, icons }));
}

export function assembleCatalog(fields: CatalogFields, details: DetailsByOrigin, icons: IconsPart["icons"], generatedAt: string): Catalog {
  return {
    schema: CATALOG_SCHEMA_VERSION,
    generatedAt,
    hash: catalogHash(fields, details, icons),
    sources: fields.sources,
    enrichment: fields.enrichment,
    regions: fields.regions,
    categories: fields.categories,
    sourceCategories: fields.sourceCategories,
    antiFeatures: fields.antiFeatures,
    apps: fields.apps,
    redirects: fields.redirects,
  };
}

/**
 * The directory of a build, named by a digest of the bytes of every file in
 * it. Files under it are served as immutable, so the name has to change
 * whenever any byte does, including a part header.
 */
export function buildDirectory(files: { path: string; sha256: string }[]): string {
  const listed = files.map((f) => [f.path, f.sha256]).sort(([a = ""], [b = ""]) => (a < b ? -1 : a > b ? 1 : 0));
  return `c/${sha256(stableStringify(listed)).slice(0, DIRECTORY_HASH_LENGTH)}`;
}

export function gzipSize(text: string): number {
  return gzipSync(text, { level: 9 }).length;
}

function shardsFor(details: Record<string, DetailsEntry>, count: number): DetailsShard[] {
  const shards: DetailsShard[] = Array.from({ length: count }, () => ({}));
  for (const id of Object.keys(details).sort()) {
    const shard = shards[detailsShard(id, count)];
    const entry = details[id];
    if (shard && entry !== undefined) shard[id] = entry;
  }
  return shards;
}

/**
 * The smallest shard count, shared by all origins, whose largest shard stays
 * under the target. An entry that is past the target by itself raises the
 * target to its own size plus the target, so it shares a shard of ordinary
 * size and the build does not split into a shard per app; the count also
 * stops growing once the largest shard holds a single entry.
 */
export function shardCount(details: DetailsByOrigin): number {
  const origins = [details.fdroid, details.izzy];
  const totals = origins.map((d) => gzipSize(JSON.stringify(d)));
  const ids = Math.max(Object.keys(details.fdroid).length, Object.keys(details.izzy).length, 1);
  const largestEntry = Math.max(0, ...origins.flatMap((d) => Object.entries(d).map(([id, entry]) => gzipSize(JSON.stringify({ [id]: entry })))));
  const target = largestEntry > SHARD_TARGET_BYTES ? largestEntry + SHARD_TARGET_BYTES : SHARD_TARGET_BYTES;
  for (let count = Math.max(1, Math.ceil(Math.max(...totals) / target)); ; count++) {
    const shards = origins.flatMap((d) => shardsFor(d, count));
    const sizes = shards.map((s) => gzipSize(JSON.stringify(s)));
    const largest = Math.max(...sizes);
    const alone = Object.keys(shards[sizes.indexOf(largest)] ?? {}).length <= 1;
    if (largest <= target || alone || count >= ids) return count;
  }
}

export interface UpstreamSnapshot {
  source: SourceId;
  commit: string;
  /** Files relative to the upstream repository root. */
  files: { path: string; content: string }[];
  license: string;
  attribution: string;
}

export interface BuildFiles {
  catalog: Catalog;
  parts: CatalogParts;
  icons: IconsPart;
  details: DetailsByOrigin;
  upstream: UpstreamSnapshot[];
  /** SPDX id → license text. */
  licenses: Map<string, string>;
}

export interface EmitResult {
  version: CatalogVersion;
  manifest: Manifest;
  directory: string;
  gzipBytes: Record<string, number>;
  shardGzipBytes: number[];
}

/** Writes through a temporary name and renames, so a reader never sees a half-written file. */
export function writeAtomic(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Upstream snapshot paths: one Markdown file for a single-file source, a directory otherwise. */
function upstreamPaths(snapshot: UpstreamSnapshot): { path: string; content: string }[] {
  if (snapshot.files.length === 1 && snapshot.files[0]) {
    return [{ path: `upstream/${snapshot.source}/${snapshot.commit}.md`, content: snapshot.files[0].content }];
  }
  return snapshot.files.map((f) => ({ path: `upstream/${snapshot.source}/${snapshot.commit}/${f.path}`, content: f.content }));
}

/** Writes a build. Returns what it wrote; `version.json` is replaced only after everything else is in place. */
export function emit(outDir: string, build: BuildFiles): EmitResult {
  const { catalog, parts } = build;
  const previousVersion = readJson<CatalogVersion>(join(outDir, "version.json"));
  const files: ManifestFile[] = [];
  const gzipBytes: Record<string, number> = {};
  const pending: { relative: string; content: string; shared: boolean }[] = [];
  const put = (relative: string, content: string, entry: Omit<ManifestFile, "path" | "sha256" | "bytes">, shared = false): void => {
    const bytes = Buffer.from(content);
    const path = shared ? `../../${relative}` : relative;
    pending.push({ relative, content, shared });
    files.push({ path, ...entry, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
    gzipBytes[path] = gzipSize(content);
  };
  const json = (value: unknown): string => JSON.stringify(value);
  const header = (h: PartHeader): { license: string; attribution: string } => ({ license: h.license, attribution: h.attribution });

  put("atlas.json", json(parts.atlas), { role: "atlas", origin: "droid-atlas", ...header(parts.atlas.header) });
  for (const source of parts.sources) {
    put(`sources/${source.info.id}.json`, json(source), { role: "source", origin: source.info.id, ...header(source.header) });
  }
  for (const index of parts.indexes) {
    put(`sources/${index.origin}.json`, json(index), { role: "index", origin: index.origin, ...header(index.header) });
  }
  put("sources/github.json", json(parts.github), { role: "github", origin: "github", ...header(parts.github.header) });
  put("icons.json", json(build.icons), { role: "icons", origin: "droid-atlas", ...header(build.icons.header) });

  const count = shardCount(build.details);
  const shardGzipBytes: number[] = [];
  for (const origin of ["fdroid", "izzy"] as const) {
    const index = parts.indexes.find((p) => p.origin === origin);
    if (!index) continue;
    shardsFor(build.details[origin], count).forEach((shard, n) => {
      const text = json(shard);
      shardGzipBytes.push(gzipSize(text));
      put(`details/${origin}/${n}.json`, text, { role: "details", origin, ...header(index.header) });
    });
  }

  for (const snapshot of build.upstream) {
    for (const file of upstreamPaths(snapshot)) {
      put(file.path, file.content, { role: "upstream", origin: snapshot.source, license: snapshot.license, attribution: snapshot.attribution }, true);
    }
  }
  for (const [id, text] of [...build.licenses].sort(([a], [b]) => (a < b ? -1 : 1))) {
    writeAtomic(join(outDir, "licenses", `${id}.txt`), text);
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const directory = buildDirectory(files);
  for (const file of pending) writeAtomic(join(outDir, file.shared ? "" : directory, file.relative), file.content);
  const manifest: Manifest = { schema: catalog.schema, generatedAt: catalog.generatedAt, hash: catalog.hash, files, detailsShards: count };
  writeAtomic(join(outDir, directory, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
  const version: CatalogVersion = { schema: catalog.schema, generatedAt: catalog.generatedAt, hash: catalog.hash, manifest: `${directory}/manifest.json` };
  writeAtomic(join(outDir, "version.json"), `${JSON.stringify(version, null, 2)}\n`);

  const previousDirectory = previousVersion?.manifest?.split("/").slice(0, 2).join("/") ?? null;
  prune(outDir, directory, previousDirectory);
  return { version, manifest, directory, gzipBytes, shardGzipBytes };
}

/**
 * Removes builds and upstream snapshots that neither the new build nor the
 * one it replaces refers to; open clients may still be reading the latter.
 * License texts are never removed: they are small and a stale reader may
 * still link to one.
 */
function prune(outDir: string, current: string, previous: string | null): void {
  const keepDirs = new Set([current, previous].filter((d): d is string => d !== null).map((d) => d.replace(/^c\//, "")));
  const root = join(outDir, "c");
  if (existsSync(root)) {
    for (const name of readdirSync(root)) if (BUILD_DIR_RE.test(name) && !keepDirs.has(name)) rmSync(join(root, name), { recursive: true, force: true });
  }
  const referenced = new Set<string>();
  for (const name of keepDirs) {
    const manifest = readJson<Manifest>(join(root, name, "manifest.json"));
    for (const file of manifest?.files ?? []) {
      if (file.path.startsWith("../../upstream/")) referenced.add(file.path.slice("../../".length));
    }
  }
  const upstream = join(outDir, "upstream");
  if (existsSync(upstream)) {
    for (const source of readdirSync(upstream)) {
      for (const entry of readdirSync(join(upstream, source))) {
        const relative = `upstream/${source}/${entry}`;
        const used = [...referenced].some((path) => path === relative || path.startsWith(`${relative}/`));
        if (!used) rmSync(join(upstream, source, entry), { recursive: true, force: true });
      }
    }
  }
}
