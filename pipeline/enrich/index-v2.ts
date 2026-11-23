/**
 * Reads an F-Droid-format `index-v2.json` (F-Droid and IzzyOnDroid publish the
 * same format) into per-package records and a source-code lookup.
 *
 * The index is untrusted input: every field is type-checked as it is read and
 * text is reduced to plain text.
 */
import type { IndexFacts } from "../../schema/catalog.ts";
import type { AntiFeatureDefinition } from "../../schema/parts.ts";
import { parseRepo } from "../forge.ts";
import { htmlToText, httpUrl, isoFromMillis, markdownToText, normalizeUrl } from "../lib/text.ts";

export type IndexOrigin = "fdroid" | "izzy";

export const SHIZUKU_PERMISSION = "moe.shizuku.manager.permission.API_V23";
const INTERNET_PERMISSION = "android.permission.INTERNET";

export interface IndexRecord {
  origin: IndexOrigin;
  /** ISO timestamp of the index the record was read from. */
  indexAt: string;
  pkg: string;
  name: string | null;
  summary: string | null;
  description: string | null;
  license: string | null;
  sourceCode: string | null;
  webSite: string | null;
  /** Absolute URL of the icon in the repository, when the index names one. */
  iconUrl: string | null;
  /** SHA-256 of the icon file as the index states it. */
  iconSha256: string | null;
  /** Anti-features flagged on any version of the package, not only the latest. */
  allAntiFeatures: string[];
  facts: IndexFacts;
}

export interface IndexData {
  origin: IndexOrigin;
  /** ISO timestamp of the index. */
  timestamp: string;
  /** The anti-features the index defines (`repo.antiFeatures`), in its English wording. */
  antiFeatures: Record<string, AntiFeatureDefinition>;
  packages: Map<string, IndexRecord>;
  /** Normalized source-code URL (and repository key) → package ids that state it. */
  bySourceCode: Map<string, Set<string>>;
}

type Json = Record<string, unknown>;

function object(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function int(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The English text of a localized field. */
function localized(value: unknown): unknown {
  const map = object(value);
  if (!map) return null;
  return map["en-US"] ?? map["en"] ?? map["en-GB"] ?? null;
}

/** A localized file: `en-US` when present, otherwise the first locale (icon policy rule 1). */
function localizedFile(value: unknown): Json | null {
  const map = object(value);
  if (!map) return null;
  const preferred = object(map["en-US"]);
  if (preferred) return preferred;
  for (const entry of Object.values(map)) {
    const file = object(entry);
    if (file) return file;
  }
  return null;
}

function allAntiFeatures(versions: Json | null): string[] {
  const found = new Set<string>();
  for (const value of Object.values(versions ?? {})) {
    for (const key of Object.keys(object(object(value)?.["antiFeatures"]) ?? {})) found.add(key);
  }
  return [...found].sort();
}

function latestVersion(versions: Json | null): Json | null {
  let best: Json | null = null;
  let bestKey: [number, number] = [-1, -1];
  for (const value of Object.values(versions ?? {})) {
    const version = object(value);
    if (!version) continue;
    const manifest = object(version["manifest"]);
    const key: [number, number] = [int(version["added"]) ?? 0, int(manifest?.["versionCode"]) ?? 0];
    if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = version;
      bestKey = key;
    }
  }
  return best;
}

function record(origin: IndexOrigin, indexAt: string, repoBase: string, pkg: string, raw: Json): IndexRecord {
  const meta = object(raw["metadata"]) ?? {};
  const latest = latestVersion(object(raw["versions"]));
  const manifest = object(latest?.["manifest"]) ?? {};
  const usesSdk = object(manifest["usesSdk"]) ?? {};
  const permissions = Array.isArray(manifest["usesPermission"])
    ? manifest["usesPermission"].map((p) => string(object(p)?.["name"])).filter((p): p is string => p !== null)
    : [];
  const icon = localizedFile(meta["icon"]);
  const iconName = string(icon?.["name"]);
  const iconSha = string(icon?.["sha256"]);
  const name = string(localized(meta["name"]));
  const summary = string(localized(meta["summary"]));
  return {
    origin,
    indexAt,
    pkg,
    name: name ? markdownToText(name) : null,
    summary: summary ? markdownToText(summary) : null,
    description: htmlToText(string(localized(meta["description"]))),
    license: string(meta["license"]),
    sourceCode: httpUrl(string(meta["sourceCode"])),
    webSite: httpUrl(string(meta["webSite"])),
    iconUrl: iconName && iconName.startsWith("/") ? httpUrl(repoBase + iconName) : null,
    iconSha256: iconSha && /^[0-9a-f]{64}$/.test(iconSha) ? iconSha : null,
    allAntiFeatures: allAntiFeatures(object(raw["versions"])),
    facts: {
      origin,
      pkg,
      version: string(manifest["versionName"]),
      updatedAt: isoFromMillis(meta["lastUpdated"]),
      addedAt: isoFromMillis(meta["added"]),
      minSdk: int(usesSdk["minSdkVersion"]),
      targetSdk: int(usesSdk["targetSdkVersion"]),
      sizeBytes: int(object(latest?.["file"])?.["size"]),
      author: string(meta["authorName"]),
      antiFeatures: Object.keys(object(latest?.["antiFeatures"]) ?? {}).filter((key) => ANTI_FEATURE_KEY_RE.test(key)).sort(),
      permissionCount: new Set(permissions).size,
      declaresShizuku: permissions.includes(SHIZUKU_PERMISSION),
      declaresInternet: permissions.includes(INTERNET_PERMISSION),
    },
  };
}

/** The file of a package's latest version, as the index states it. */
export interface IndexFile {
  /** Path below the repository's base address, starting with `/`. */
  name: string;
  sha256: string;
  size: number;
}

const INDEX_FILE_NAME_RE = /^\/[A-Za-z0-9._-]+\.apk$/;
const SHA256_RE = /^[0-9a-f]{64}$/;

/**
 * The file of the latest version of each requested package, the version
 * `IndexFacts` describes. A package whose entry names no well-formed APK file
 * and hash is absent from the result.
 */
export function latestFiles(json: unknown, pkgs: Iterable<string>): Map<string, IndexFile> {
  const packages = object(object(json)?.["packages"]);
  const files = new Map<string, IndexFile>();
  if (!packages) return files;
  for (const pkg of pkgs) {
    if (!Object.hasOwn(packages, pkg)) continue;
    const file = object(latestVersion(object(object(packages[pkg])?.["versions"]))?.["file"]);
    const name = string(file?.["name"]);
    const sha256 = string(file?.["sha256"]);
    const size = int(file?.["size"]);
    if (name && INDEX_FILE_NAME_RE.test(name) && sha256 && SHA256_RE.test(sha256) && size !== null && size > 0) {
      files.set(pkg, { name, sha256, size });
    }
  }
  return files;
}

const ANTI_FEATURE_KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

/** `repo.antiFeatures`: key → English name and description, plain text. Keys that are not simple identifiers are dropped. */
export function antiFeatureDefinitions(value: unknown): Record<string, AntiFeatureDefinition> {
  const definitions: Record<string, AntiFeatureDefinition> = {};
  for (const [key, raw] of Object.entries(object(value) ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!ANTI_FEATURE_KEY_RE.test(key)) continue;
    const entry = object(raw);
    const name = string(localized(entry?.["name"]));
    const description = string(localized(entry?.["description"]));
    definitions[key] = { name: name ? markdownToText(name) : key, description: description ? markdownToText(description) : null };
  }
  return definitions;
}

/** Lookup keys for a source-code URL: the normalized URL and, for forge repositories, the repository key. */
export function sourceCodeKeys(url: string): string[] {
  const keys = [normalizeUrl(url)];
  const repo = parseRepo(url);
  if (repo) keys.push(repo.key);
  return keys;
}

export function parseIndex(origin: IndexOrigin, repoBase: string, json: unknown): IndexData {
  const root = object(json);
  const repo = object(root?.["repo"]);
  const packages = object(root?.["packages"]);
  const timestamp = isoFromMillis(repo?.["timestamp"]);
  if (!root || !packages || !timestamp) throw new Error(`${origin} index: missing repo timestamp or packages`);
  const data: IndexData = { origin, timestamp, antiFeatures: antiFeatureDefinitions(repo?.["antiFeatures"]), packages: new Map(), bySourceCode: new Map() };
  for (const [pkg, raw] of Object.entries(packages)) {
    const entry = object(raw);
    if (!entry) continue;
    const parsed = record(origin, timestamp, repoBase, pkg, entry);
    data.packages.set(pkg, parsed);
    if (!parsed.sourceCode) continue;
    for (const key of sourceCodeKeys(parsed.sourceCode)) {
      const set = data.bySourceCode.get(key) ?? new Set<string>();
      set.add(pkg);
      data.bySourceCode.set(key, set);
    }
  }
  return data;
}
