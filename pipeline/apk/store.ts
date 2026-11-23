/**
 * The package readings kept between runs: one JSON file, readings keyed by
 * the file they were read from, and the packages whose reading failed lately.
 *
 * The file is checked entry by entry when it is loaded: an entry that does
 * not match the shape of a reading is dropped, and the rest are kept. It is
 * written only after the whole of it passes the same check, and written by
 * rename, so the file on disk is always the last good one.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { PACKAGE_READING_FORMAT, type PackageReading } from "../../schema/package-reading.ts";
import { packageHost } from "./http.ts";

export const STORE_FORMAT = 1;

/** Why a package was not read. "not-stored": it was read, but the reading or its record failed the check of the store. */
export type FailureKind = "address" | "http" | "zip" | "manifest" | "unexpected" | "release-lookup" | "not-stored";

export interface StoreFailure {
  /** ISO time of the failed attempt. */
  at: string;
  kind: FailureKind;
}

export interface ReadingStore {
  format: typeof STORE_FORMAT;
  /** Key (`readingKey`) → the reading of that file. */
  readings: Record<string, PackageReading>;
  /** Work key → the last failed attempt; the package is not tried again for a while. */
  failures: Record<string, StoreFailure>;
}

export function emptyStore(): ReadingStore {
  return { format: STORE_FORMAT, readings: {}, failures: {} };
}

/** A file's key: its SHA-256 when the host states one, else its address, size and change time. */
export function readingKey(file: { sha256: string | null; url: string; size: number; updatedAt?: string | null }): string {
  return file.sha256 ? `sha256:${file.sha256}` : `asset:${file.url}@${file.size}@${file.updatedAt ?? ""}`;
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const FILE_NAME_RE = /^[A-Za-z0-9._+-]{1,255}$/;
const PRINTABLE_RE = /^[\x21-\x7e]{1,512}$/;
const VERSION_NAME_RE = /^[\x21-\x7e]([\x20-\x7e]{0,254}[\x21-\x7e])?$/;
const COMPONENT_TYPES = new Set(["activity", "activity-alias", "service", "receiver"]);
const TASKER_ROLES = new Set(["action-edit", "action-fire", "condition-edit", "condition-query", "event-edit"]);
const FAILURE_KINDS = new Set<string>(["address", "http", "zip", "manifest", "unexpected", "release-lookup", "not-stored"]);
const READING_KEY_RE = /^(sha256:[0-9a-f]{64}|asset:https:\/\/[\x21-\x7e]+)$/;
const WORK_KEY_RE = /^(sha256:[0-9a-f]{64}|asset:https:\/\/[\x21-\x7e]+|github:[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@[\x21-\x7e]+)$/;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function count(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function iso(value: unknown): boolean {
  return typeof value === "string" && ISO_RE.test(value) && Number.isFinite(Date.parse(value));
}

/** An `Unread`. */
function unread(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value["unread"] === "unexpected-value") return Object.keys(value).length === 1;
  return value["unread"] === "resource-reference" && typeof value["ref"] === "string" && /^0x[0-9a-f]{8}$/.test(value["ref"]);
}

/** A `Declared<string>`: printable text or an `Unread`. */
function declaredText(value: unknown): boolean {
  return typeof value === "string" ? PRINTABLE_RE.test(value) : unread(value);
}

function declaredFlag(value: unknown): boolean {
  return typeof value === "boolean" || unread(value);
}

function component(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value["type"] === "string" &&
    COMPONENT_TYPES.has(value["type"]) &&
    declaredText(value["name"]) &&
    (value["exported"] === null || declaredFlag(value["exported"])) &&
    (value["enabled"] === null || declaredFlag(value["enabled"])) &&
    (value["permission"] === null || declaredText(value["permission"]))
  );
}

function list(value: unknown, item: (entry: Json) => boolean): boolean {
  return Array.isArray(value) && value.every((entry) => isObject(entry) && item(entry));
}

function texts(value: unknown): boolean {
  return Array.isArray(value) && value.every(declaredText);
}

/** Problems with a stored reading; empty when it has the shape of a `PackageReading`. */
export function checkReading(value: unknown): string[] {
  if (!isObject(value)) return ["not an object"];
  const problems: string[] = [];
  const need = (ok: boolean, what: string): void => {
    if (!ok) problems.push(what);
  };
  need(value["format"] === PACKAGE_READING_FORMAT, "format");
  need(value["evidence"] === "statically-discovered", "evidence");
  const source = value["source"];
  const host = isObject(source) && typeof source["url"] === "string" ? packageHost(source["url"]) : null;
  need(isObject(source) && host !== null && source["host"] === host.host, "source");
  const file = value["file"];
  need(
    isObject(file) &&
      typeof file["name"] === "string" &&
      FILE_NAME_RE.test(file["name"]) &&
      count(file["sizeBytes"]) &&
      (file["sha256"] === null || (typeof file["sha256"] === "string" && SHA256_RE.test(file["sha256"]))),
    "file",
  );
  need(iso(value["readAt"]), "readAt");
  need(typeof value["package"] === "string" && PACKAGE_RE.test(value["package"]), "package");
  const version = value["version"];
  need(
    isObject(version) &&
      (version["name"] === null || (typeof version["name"] === "string" ? VERSION_NAME_RE.test(version["name"]) : unread(version["name"]))) &&
      (version["code"] === null || (count(version["code"]) && (version["code"] as number) <= 0x7fffffff) || unread(version["code"])),
    "version",
  );
  const manifest = value["manifest"];
  need(isObject(manifest) && typeof manifest["sha256"] === "string" && SHA256_RE.test(manifest["sha256"]) && count(manifest["sizeBytes"]), "manifest");
  const transfer = value["transfer"];
  need(isObject(transfer) && count(transfer["requests"]) && count(transfer["bytes"]), "transfer");
  const i = value["interfaces"];
  if (!isObject(i)) return [...problems, "interfaces"];
  need(Array.isArray(i["tiles"]) && i["tiles"].every(component), "interfaces.tiles");
  need(list(i["taskerPlugin"], (t) => typeof t["role"] === "string" && TASKER_ROLES.has(t["role"]) && component(t["component"])), "interfaces.taskerPlugin");
  need(
    list(i["shareTargets"], (s) => component(s["component"]) && typeof s["single"] === "boolean" && typeof s["multiple"] === "boolean" && texts(s["mimeTypes"])),
    "interfaces.shareTargets",
  );
  need(
    list(i["links"], (l) => component(l["component"]) && texts(l["schemes"]) && texts(l["hosts"]) && typeof l["browsable"] === "boolean"),
    "interfaces.links",
  );
  need(list(i["actions"], (a) => declaredText(a["action"]) && component(a["component"])), "interfaces.actions");
  const shizuku = i["shizuku"];
  need(isObject(shizuku) && typeof shizuku["permission"] === "boolean" && typeof shizuku["provider"] === "boolean", "interfaces.shizuku");
  return problems;
}

/** Whether a stored reading sits under the key its own file gives it. */
function keyFits(key: string, reading: unknown): boolean {
  if (!READING_KEY_RE.test(key) || !isObject(reading) || !isObject(reading["file"]) || !isObject(reading["source"])) return false;
  const sha256 = reading["file"]["sha256"];
  if (key.startsWith("sha256:")) return key === `sha256:${String(sha256)}`;
  return sha256 === null && key.startsWith(`asset:${String(reading["source"]["url"])}@${String(reading["file"]["sizeBytes"])}@`);
}

function checkFailure(value: unknown, now: number): boolean {
  return (
    isObject(value) &&
    iso(value["at"]) &&
    Date.parse(value["at"] as string) <= now &&
    typeof value["kind"] === "string" &&
    FAILURE_KINDS.has(value["kind"])
  );
}

/** Problems with one reading under its key; empty when the store may keep it. Messages name no key or value. */
export function readingProblems(key: string, reading: unknown): string[] {
  return keyFits(key, reading) ? checkReading(reading) : ["key does not fit the file of the reading"];
}

/** Whether a failure record may be kept under `key`: a well-formed key, a known kind, a time not after `now`. */
export function failureFits(key: string, failure: unknown, now: number = Date.now()): boolean {
  return WORK_KEY_RE.test(key) && checkFailure(failure, now);
}

export interface LoadedStore {
  store: ReadingStore;
  /** "missing": no file; "unreadable": not JSON or not a store; "read": loaded, perhaps with entries dropped. */
  status: "missing" | "unreadable" | "read";
  /** Entries dropped because they failed the check. */
  dropped: number;
}

/** Loads the store, keeping every entry that passes the check. Never throws on the file's content. */
export function loadStore(path: string, now: number = Date.now()): LoadedStore {
  if (!existsSync(path)) return { store: emptyStore(), status: "missing", dropped: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { store: emptyStore(), status: "unreadable", dropped: 0 };
  }
  if (!isObject(parsed) || parsed["format"] !== STORE_FORMAT || !isObject(parsed["readings"])) {
    return { store: emptyStore(), status: "unreadable", dropped: 0 };
  }
  const store = emptyStore();
  let dropped = 0;
  for (const [key, reading] of Object.entries(parsed["readings"])) {
    if (readingProblems(key, reading).length === 0) store.readings[key] = reading as PackageReading;
    else dropped++;
  }
  for (const [key, failure] of Object.entries(isObject(parsed["failures"]) ? parsed["failures"] : {})) {
    if (failureFits(key, failure, now)) store.failures[key] = failure as StoreFailure;
    else dropped++;
  }
  return { store, status: "read", dropped };
}

/** The number of entries that fail the check; 0 when the whole store passes. */
export function checkStore(store: ReadingStore, now: number = Date.now()): number {
  let failing = store.format === STORE_FORMAT ? 0 : 1;
  for (const [key, reading] of Object.entries(store.readings)) if (readingProblems(key, reading).length) failing++;
  for (const [key, failure] of Object.entries(store.failures)) if (!failureFits(key, failure, now)) failing++;
  return failing;
}

/** Removes every entry that fails the check and returns how many were removed. */
export function dropInvalid(store: ReadingStore, now: number = Date.now()): number {
  let removed = 0;
  for (const [key, reading] of Object.entries(store.readings)) {
    if (readingProblems(key, reading).length) {
      delete store.readings[key];
      removed++;
    }
  }
  for (const [key, failure] of Object.entries(store.failures)) {
    if (!failureFits(key, failure, now)) {
      delete store.failures[key];
      removed++;
    }
  }
  return removed;
}

/**
 * Writes the store if it passes the check; throws otherwise, naming only a
 * count, and leaves the file as it was. The file is first written beside the
 * directory that holds it, not inside, so a run cut short leaves nothing
 * partial in that directory.
 */
export function saveStore(path: string, store: ReadingStore, now: number = Date.now()): void {
  const failing = checkStore(store, now);
  if (failing) throw new Error(`package readings not saved: ${failing} entries fail the check`);
  const sorted: ReadingStore = {
    format: store.format,
    readings: Object.fromEntries(Object.entries(store.readings).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    failures: Object.fromEntries(Object.entries(store.failures).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
  };
  const absolute = resolve(path);
  const temporary = join(dirname(dirname(absolute)), `${basename(dirname(absolute))}.${basename(absolute)}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(sorted)}\n`);
  renameSync(temporary, absolute);
}
