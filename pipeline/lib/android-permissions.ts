/**
 * Android's own statements about the permissions it defines: each name's
 * protection level and, where it has one, its label, as the Android Open
 * Source Project states them at one released platform tag.
 *
 * The statements are read from two files of `platform/frameworks/base`,
 * `core/res/AndroidManifest.xml` (each `<permission>` element) and
 * `core/res/res/values/strings.xml` (the label's string resource), by
 * `scripts/vendor-android-permissions.ts`, which writes the table
 * `pipeline/android/permissions.json`. The daily build never fetches them:
 * it reads that table through `readAndroidTable`, which checks every row.
 *
 * Some declarations hold only when a build flag is on (`android:featureFlag`).
 * They are resolved against the flag values of the release configuration the
 * tag was built with, read from `platform/build/release` at the same tag; a
 * flag that configuration does not set is off, as aconfig leaves it.
 */
import { readFileSync } from "node:fs";
import { childElements, parseXml, textContent, type XmlElement } from "./xml.ts";

const ANDROID_NS = "http://schemas.android.com/apk/res/android";

/** Every word a protection level may be made of, as Android's reference for `R.attr.protectionLevel` lists them. */
export const PROTECTION_LEVEL_WORDS: ReadonlySet<string> = new Set([
  "normal", "dangerous", "signature", "signatureOrSystem", "internal",
  "privileged", "system", "development", "appop", "pre23", "installer", "verifier", "preinstalled", "setup",
  "instant", "runtime", "oem", "vendorPrivileged", "textClassifier", "configurator", "incidentReportApprover",
  "appPredictor", "companion", "retailDemo", "recents", "role", "knownSigner", "module",
]);

const BASE_WORDS = new Set(["normal", "dangerous", "signature", "signatureOrSystem", "internal"]);

/** A permission name: dot-separated Java-like identifiers, at least two parts. */
export const PERMISSION_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/;
const FLAG_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

/** Longest label kept, in characters. Android's longest is under 100. */
export const LABEL_LIMIT = 200;
/** Most rows the table may hold. Android 17 defines about 1,100 permissions. */
export const TABLE_ROW_LIMIT = 5_000;

/** One `<permission>` element as written. */
export interface Declaration {
  name: string;
  protectionLevel: string;
  /** `android:label` as written: a string resource reference or literal text; null when absent. */
  label: string | null;
  /** `android:featureFlag` as written, with a leading "!" when the declaration holds while the flag is off; null when absent. */
  featureFlag: string | null;
}

export interface TableRow {
  name: string;
  /** The level exactly as the declaration states it, words joined by "|". */
  protectionLevel: string;
  /** The label's English text with Android's string escapes resolved; null when there is none, or it is not plain text. */
  label: string | null;
}

export interface TableSource {
  name: string;
  repository: string;
  tag: string;
  commit: string;
  files: string[];
  releaseRepository: string;
  releaseCommit: string;
  releaseConfig: string;
  retrieved: string;
  license: string;
}

export interface AndroidTable {
  source: TableSource;
  /** The Android version the tag is a release of, as its tag names it ("17"). */
  androidVersion: string;
  /** What Droid Atlas changed in the statements, as the license asks a changed file to say. */
  changes: string;
  permissions: TableRow[];
}

/** True when a level is a known base word followed by known flags, each once. */
export function isProtectionLevel(level: string): boolean {
  const words = level.split("|");
  return words.length <= 12 && new Set(words).size === words.length && words.every((word) => PROTECTION_LEVEL_WORDS.has(word))
    && words.filter((word) => BASE_WORDS.has(word)).length <= 1;
}

function androidAttribute(element: XmlElement, local: string, prefix: string): string | null {
  return element.attributes.get(`${prefix}:${local}`) ?? null;
}

/** The prefix the root element binds to Android's namespace. */
function androidPrefix(root: XmlElement): string {
  for (const [attribute, value] of root.attributes) {
    if (attribute.startsWith("xmlns:") && value === ANDROID_NS) return attribute.slice(6);
  }
  throw new Error("the manifest does not bind Android's namespace");
}

/** Every `<permission>` element directly under `<manifest>`. Throws on a declaration that is not well formed. */
export function permissionDeclarations(manifestXml: string): Declaration[] {
  const root = parseXml(manifestXml);
  if (root.name !== "manifest") throw new Error(`the root element is <${root.name}>, not <manifest>`);
  const prefix = androidPrefix(root);
  return childElements(root)
    .filter((element) => element.name === "permission")
    .map((element) => {
      const name = androidAttribute(element, "name", prefix);
      const protectionLevel = androidAttribute(element, "protectionLevel", prefix) ?? "normal";
      const featureFlag = androidAttribute(element, "featureFlag", prefix);
      if (!name || !PERMISSION_NAME.test(name) || name.length > 255) throw new Error(`a permission named ${JSON.stringify(name)}`);
      if (!isProtectionLevel(protectionLevel)) throw new Error(`${name}: unknown protection level ${JSON.stringify(protectionLevel)}`);
      if (featureFlag !== null && !FLAG_NAME.test(featureFlag.replace(/^!/, ""))) throw new Error(`${name}: malformed feature flag ${JSON.stringify(featureFlag)}`);
      return { name, protectionLevel, label: androidAttribute(element, "label", prefix), featureFlag };
    });
}

/**
 * A string resource's text as Android reads it: backslash escapes resolved,
 * double quotes removed and the whitespace between them kept, other runs of
 * whitespace made one space, and the ends trimmed.
 */
export function resourceText(raw: string): string {
  let out = "";
  let quoted = false;
  let pendingSpace = false;
  for (let at = 0; at < raw.length; at++) {
    const char = raw.charAt(at);
    if (char === "\\") {
      const next = raw.charAt(++at);
      if (next === "") throw new Error("a string ending in a backslash");
      let escaped = next;
      if (next === "n") escaped = "\n";
      else if (next === "t") escaped = "\t";
      else if (next === "u") {
        const hex = raw.slice(at + 1, at + 5);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw new Error("a malformed \\u escape");
        escaped = String.fromCharCode(Number.parseInt(hex, 16));
        at += 4;
      }
      if (pendingSpace && out !== "") out += " ";
      pendingSpace = false;
      out += escaped;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && /\s/.test(char)) {
      pendingSpace = true;
    } else {
      if (pendingSpace && out !== "") out += " ";
      pendingSpace = false;
      out += char;
    }
  }
  return out;
}

/**
 * The default English text of each `<string>` in a resource file, by name:
 * the definition with no `product`, else the one for product "default".
 * Nested markup (`xliff:g`, styling) contributes its text.
 */
export function stringResources(stringsXml: string): Map<string, string> {
  const root = parseXml(stringsXml);
  if (root.name !== "resources") throw new Error(`the root element is <${root.name}>, not <resources>`);
  const plain = new Map<string, string>();
  const byDefaultProduct = new Map<string, string>();
  for (const element of childElements(root)) {
    if (element.name !== "string") continue;
    const name = element.attributes.get("name");
    if (!name) throw new Error("a <string> with no name");
    const product = element.attributes.get("product");
    const target = product === undefined ? plain : product === "default" ? byDefaultProduct : null;
    if (!target) continue;
    if (target.has(name)) throw new Error(`string ${name} defined twice`);
    target.set(name, resourceText(textContent(element)));
  }
  for (const [name, text] of byDefaultProduct) if (!plain.has(name)) plain.set(name, text);
  return plain;
}

/** A label is kept only when it is one short line of printable text with no format placeholders. */
export function isPlainLabel(text: string): boolean {
  return text.length > 0 && text.length <= LABEL_LIMIT && !/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u2028\u2029]/u.test(text) && !/%(\d+\$)?[a-zA-Z]/.test(text);
}

function resolveLabel(label: string | null, strings: Map<string, string>): string | null {
  if (label === null) return null;
  const reference = /^@(?:android:)?string\/([A-Za-z0-9_.]+)$/.exec(label);
  const text = reference ? strings.get(reference[1] ?? "") : label.startsWith("@") ? undefined : resourceText(label);
  return text !== undefined && isPlainLabel(text) ? text : null;
}

export interface ReleaseConfig {
  name: string;
  inherits: string[];
  valueSets: string[];
}

function textprotoStrings(text: string, field: string): string[] {
  return [...text.matchAll(new RegExp(`^\\s*${field}\\s*:\\s*"([^"\\\\]*)"\\s*$`, "gm"))].map((match) => match[1] ?? "");
}

/** A `release_configs/<name>.textproto` file: its name, what it inherits, in order, and its flag value sets. */
export function parseReleaseConfig(text: string): ReleaseConfig {
  const [name, ...more] = textprotoStrings(text, "name");
  if (!name || more.length > 0) throw new Error("a release configuration without exactly one name");
  return { name, inherits: textprotoStrings(text, "inherits"), valueSets: textprotoStrings(text, "aconfig_value_sets") };
}

/** The flag values one `*_flag_values.textproto` file sets, by "<package>.<name>". */
export function parseFlagValues(text: string): Map<string, boolean> {
  const values = new Map<string, boolean>();
  const blocks = text.replace(/#[^\n]*/g, "").match(/flag_value\s*\{[^{}]*\}/g) ?? [];
  for (const block of blocks) {
    const pkg = /package:\s*"([^"]+)"/.exec(block)?.[1];
    const name = /\bname:\s*"([^"]+)"/.exec(block)?.[1];
    const state = /state:\s*(ENABLED|DISABLED)\b/.exec(block)?.[1];
    if (!pkg || !name || !state || !FLAG_NAME.test(`${pkg}.${name}`)) throw new Error(`a malformed flag value: ${block.replace(/\s+/g, " ").slice(0, 120)}`);
    values.set(`${pkg}.${name}`, state === "ENABLED");
  }
  return values;
}

/**
 * The values of the wanted flags in a release configuration: those of every
 * configuration it inherits, directly or not, and its own. The answer must
 * not depend on the order they are applied in, so a wanted flag two of them
 * set differently is refused. Flags not wanted are not looked at.
 */
export function resolveFlags(
  target: string,
  configs: ReadonlyMap<string, ReleaseConfig>,
  valueSets: ReadonlyMap<string, ReadonlyMap<string, boolean>>,
  wanted: ReadonlySet<string>,
): Map<string, boolean> {
  const seen = new Set<string>();
  const order: string[] = [];
  const visit = (name: string, path: string[]): void => {
    if (path.includes(name)) throw new Error(`release configurations inherit in a cycle: ${[...path, name].join(" → ")}`);
    if (seen.has(name)) return;
    const config = configs.get(name);
    if (!config) throw new Error(`no release configuration named ${name}`);
    for (const parent of config.inherits) visit(parent, [...path, name]);
    seen.add(name);
    order.push(name);
  };
  visit(target, []);
  const flags = new Map<string, boolean>();
  const setBy = new Map<string, string>();
  for (const name of order) {
    for (const set of configs.get(name)?.valueSets ?? []) {
      const values = valueSets.get(set);
      if (!values) throw new Error(`release configuration ${name} names value set ${set}, which is not there`);
      for (const [flag, on] of values) {
        if (!wanted.has(flag)) continue;
        if (flags.has(flag) && flags.get(flag) !== on) throw new Error(`flag ${flag} is set both ways, by ${setBy.get(flag) ?? "?"} and by ${name}`);
        flags.set(flag, on);
        setBy.set(flag, name);
      }
    }
  }
  return flags;
}

export interface TableCounts {
  declarations: number;
  /** Declarations whose flag condition the release configuration leaves false. */
  leftOutByFlag: number;
  /** Declarations behind a flag the release configuration does not set, which is off. */
  flagNotSet: number;
  rows: number;
  labels: number;
}

/**
 * The table: one row per permission the release defines, sorted by name.
 * Two declarations of one name that both hold are refused.
 */
export function buildTable(declarations: readonly Declaration[], strings: Map<string, string>, flags: ReadonlyMap<string, boolean>): { rows: TableRow[]; counts: TableCounts } {
  const rows = new Map<string, TableRow>();
  let leftOutByFlag = 0;
  let flagNotSet = 0;
  for (const declaration of declarations) {
    if (declaration.featureFlag !== null) {
      const negated = declaration.featureFlag.startsWith("!");
      const flag = declaration.featureFlag.replace(/^!/, "");
      if (!flags.has(flag)) flagNotSet++;
      if ((flags.get(flag) ?? false) === negated) {
        leftOutByFlag++;
        continue;
      }
    }
    if (rows.has(declaration.name)) throw new Error(`${declaration.name} is declared twice for this release`);
    rows.set(declaration.name, { name: declaration.name, protectionLevel: declaration.protectionLevel, label: resolveLabel(declaration.label, strings) });
  }
  const sorted = [...rows.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (sorted.length > TABLE_ROW_LIMIT) throw new Error(`more than ${TABLE_ROW_LIMIT} permissions`);
  return { rows: sorted, counts: { declarations: declarations.length, leftOutByFlag, flagNotSet, rows: sorted.length, labels: sorted.filter((row) => row.label !== null).length } };
}

/** The Android version a release tag names: "android-17.0.0_r1" is "17". */
export function androidVersionOf(tag: string): string {
  const match = /^android-(\d{1,3})\.\d+(?:\.\d+)?_r\d+$/.exec(tag);
  if (!match?.[1]) throw new Error(`${tag} is not a platform release tag`);
  return match[1];
}

/** The table as committed: one row per line, so a new tag's changes read as a diff of rows. */
export function serializeTable(table: AndroidTable): string {
  const head = JSON.stringify({ source: table.source, androidVersion: table.androidVersion, changes: table.changes }, null, 2).replace(/\n}$/, "");
  const rows = table.permissions.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
  return `${head},\n  "permissions": [\n${rows}\n  ]\n}\n`;
}

const COMMIT = /^[0-9a-f]{40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function plainField(value: unknown, pattern: RegExp, what: string): string {
  if (typeof value !== "string" || value.length > 300 || !pattern.test(value)) throw new Error(`the Android table's ${what} is not in the expected form`);
  return value;
}

/** Checks a parsed table row by row: bounded sizes, plain text, names and levels in their patterns, sorted without repeats. */
export function checkAndroidTable(value: unknown): AndroidTable {
  if (!isRecord(value) || !isRecord(value.source) || !Array.isArray(value.permissions)) throw new Error("the Android table is not in the expected form");
  const s = value.source;
  const files = s.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > 8) throw new Error("the Android table's source files are not in the expected form");
  const source: TableSource = {
    name: plainField(s.name, /^[\p{L}\p{N} .,'()-]+$/u, "source name"),
    repository: plainField(s.repository, /^https:\/\/android\.googlesource\.com\/[A-Za-z0-9/_.-]+$/, "repository"),
    tag: plainField(s.tag, /^android-\d{1,3}\.\d+(?:\.\d+)?_r\d+$/, "tag"),
    commit: plainField(s.commit, COMMIT, "commit"),
    files: files.map((file) => plainField(file, /^[A-Za-z0-9_./-]+$/, "source file")),
    releaseRepository: plainField(s.releaseRepository, /^https:\/\/android\.googlesource\.com\/[A-Za-z0-9/_.-]+$/, "release repository"),
    releaseCommit: plainField(s.releaseCommit, COMMIT, "release commit"),
    releaseConfig: plainField(s.releaseConfig, /^[a-z0-9_]+$/, "release configuration"),
    retrieved: plainField(s.retrieved, /^\d{4}-\d{2}-\d{2}$/, "retrieval date"),
    license: plainField(s.license, /^Apache-2\.0$/, "license"),
  };
  const androidVersion = plainField(value.androidVersion, /^\d{1,3}$/, "Android version");
  if (androidVersionOf(source.tag) !== androidVersion) throw new Error("the Android table's version is not its tag's");
  if (typeof value.changes !== "string" || value.changes.length > 2_000 || /[\p{Cc}]/u.test(value.changes)) throw new Error("the Android table's statement of changes is not in the expected form");
  if (value.permissions.length > TABLE_ROW_LIMIT) throw new Error(`the Android table has more than ${TABLE_ROW_LIMIT} rows`);
  const permissions: TableRow[] = [];
  let previous = "";
  for (const row of value.permissions) {
    if (!isRecord(row) || Object.keys(row).length !== 3) throw new Error("an Android table row is not in the expected form");
    const { name, protectionLevel, label } = row;
    if (typeof name !== "string" || name.length > 255 || !PERMISSION_NAME.test(name)) throw new Error(`an Android table row named ${JSON.stringify(name).slice(0, 80)}`);
    if (name <= previous) throw new Error(`the Android table is not sorted at ${name}`);
    if (typeof protectionLevel !== "string" || !isProtectionLevel(protectionLevel)) throw new Error(`${name}: protection level not in the expected form`);
    if (label !== null && (typeof label !== "string" || !isPlainLabel(label))) throw new Error(`${name}: label not in the expected form`);
    permissions.push({ name, protectionLevel, label });
    previous = name;
  }
  return { source, androidVersion, changes: value.changes, permissions };
}

export const ANDROID_TABLE_PATH = new URL("../android/permissions.json", import.meta.url);

/** Reads the committed table. Throws when the file is missing or any row fails its check. */
export function readAndroidTable(path: string | URL = ANDROID_TABLE_PATH): AndroidTable {
  return checkAndroidTable(JSON.parse(readFileSync(path, "utf8")) as unknown);
}
