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
import { htmlToText, httpUrl, isoFromMillis, markdownToText, normalizeUrl, truncate } from "../lib/text.ts";

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
  /**
   * The latest version's permission names that `facts.permissionCount`
   * counts, from both `uses-permission` and `uses-permission-sdk-23`, sorted,
   * minus any that fail `PERMISSION_NAME_RE` and any past `PERMISSION_NAMES_LIMIT`.
   */
  permissions: string[];
  /** For each kept name that every declaration caps with `maxSdkVersion`, the highest cap. A name declared once without a cap has none. */
  permissionCaps: Record<string, number>;
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

/** The English text of a localized field: the first of en-US, en and en-GB that is a string. */
function localized(value: unknown): string | null {
  const map = object(value);
  if (!map) return null;
  for (const locale of ["en-US", "en", "en-GB"]) {
    const text = map[locale];
    if (typeof text === "string") return text;
  }
  return null;
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

/** Printable ASCII without spaces, at most 255 characters: what a permission name has to be to be shown. */
const PERMISSION_NAME_RE = /^[\x21-\x7e]{1,255}$/;

/**
 * Most permission names kept for one index entry. The largest list in either
 * index is 150 names (measured 2026-11-23); a list past the limit keeps its
 * first names in alphabetical order, and the count stays the index's.
 */
export const PERMISSION_NAMES_LIMIT = 500;

/** Highest `maxSdkVersion` read; a cap that is not a whole number from 1 to this is not read, and the declaration counts as uncapped. */
export const MAX_SDK_LIMIT = 1000;

/**
 * Every permission the manifest declares, in `uses-permission` and in
 * `uses-permission-sdk-23`, by name, with the widest cap any declaration of
 * it gives: none when one declaration has no `maxSdkVersion`, else the highest.
 */
function declaredPermissions(manifest: Json): Map<string, number | null> {
  const declared = new Map<string, number | null>();
  for (const key of ["usesPermission", "usesPermissionSdk23"]) {
    const list = manifest[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const element = object(item);
      const name = string(element?.["name"]);
      if (name === null) continue;
      const raw = int(element?.["maxSdkVersion"]);
      const cap = raw !== null && raw >= 1 && raw <= MAX_SDK_LIMIT ? raw : null;
      const before = declared.get(name);
      declared.set(name, before === undefined ? cap : before === null || cap === null ? null : Math.max(before, cap));
    }
  }
  return declared;
}

/** Longest anti-feature reason kept, in characters; a longer one is cut at a word and ends with an ellipsis. */
export const ANTI_FEATURE_REASON_LIMIT = 600;

/** Longest summary kept, in characters, cut the same way. */
export const SUMMARY_LIMIT = 600;

/** A letter, digit, mark, punctuation or symbol: text made only of spaces and invisible characters says nothing. */
const VISIBLE_RE = /[\p{L}\p{M}\p{N}\p{P}\p{S}]/u;

/**
 * Short index text as plain text of at most `limit` characters. The raw text
 * is cut to four times the limit before its Markdown is read, because reading
 * takes time that grows faster than the length.
 */
function shortText(text: string | null, limit: number): string | null {
  if (!text) return null;
  const plain = truncate(markdownToText(text.slice(0, limit * 4)), limit);
  return plain && VISIBLE_RE.test(plain) ? plain : null;
}

/**
 * The index's own English sentence for each anti-feature the version flags,
 * by key, as plain text. A key whose reason is missing, empty, invisible or
 * not in English has no entry.
 */
function antiFeatureReasons(flags: Json | null, keys: readonly string[]): Record<string, string> {
  const reasons: Record<string, string> = {};
  for (const key of keys) {
    const plain = shortText(string(localized(flags?.[key])), ANTI_FEATURE_REASON_LIMIT);
    if (plain) reasons[key] = plain;
  }
  return reasons;
}

function record(origin: IndexOrigin, indexAt: string, repoBase: string, pkg: string, raw: Json): IndexRecord {
  const meta = object(raw["metadata"]) ?? {};
  const latest = latestVersion(object(raw["versions"]));
  const manifest = object(latest?.["manifest"]) ?? {};
  const usesSdk = object(manifest["usesSdk"]) ?? {};
  const declared = declaredPermissions(manifest);
  const kept = [...declared.keys()].filter((name) => PERMISSION_NAME_RE.test(name)).sort().slice(0, PERMISSION_NAMES_LIMIT);
  const flags = object(latest?.["antiFeatures"]);
  const antiFeatures = Object.keys(flags ?? {}).filter((key) => ANTI_FEATURE_KEY_RE.test(key)).sort();
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
    summary: shortText(summary, SUMMARY_LIMIT),
    description: htmlToText(string(localized(meta["description"]))),
    license: string(meta["license"]),
    sourceCode: httpUrl(string(meta["sourceCode"])),
    webSite: httpUrl(string(meta["webSite"])),
    iconUrl: iconName && iconName.startsWith("/") ? httpUrl(repoBase + iconName) : null,
    iconSha256: iconSha && /^[0-9a-f]{64}$/.test(iconSha) ? iconSha : null,
    allAntiFeatures: allAntiFeatures(object(raw["versions"])),
    permissions: kept,
    permissionCaps: Object.fromEntries(kept.flatMap((name) => {
      const cap = declared.get(name);
      return typeof cap === "number" ? [[name, cap]] : [];
    })),
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
      antiFeatures,
      antiFeatureReasons: antiFeatureReasons(flags, antiFeatures),
      permissionCount: declared.size,
      declaresShizuku: declared.has(SHIZUKU_PERMISSION),
      declaresInternet: declared.has(INTERNET_PERMISSION),
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
