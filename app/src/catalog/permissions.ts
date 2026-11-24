/**
 * An app's permission names as the sheet shows them: each index's list,
 * grouped by how Android grants each name.
 *
 * The groups come only from Android's own statement of each permission's
 * protection level (the "android" part, `schema/parts.ts`), for the Android
 * version that part names. Each heading is true of every level put under it;
 * Android's reference for `R.attr.protectionLevel` and its permissions
 * overview are what the headings say:
 *
 * - runtime: base level `dangerous`. Android asks the person while the app
 *   runs ("runtime permissions").
 * - special: the `appop` flag. Android's "special permissions".
 * - install: base level `normal`. Granted when the app is installed.
 * - developer: base level `signature` or `internal` with the `development`
 *   flag: such a permission can also be granted with developer tools.
 * - role: the same bases with `role`: granted to the holder of a role.
 * - signer: the same bases with `knownSigner`: granted to apps signed with a
 *   key Android lists.
 * - builtin: the same bases with no flag but those that grant to apps of the
 *   device itself (platform-signed, privileged, preinstalled, the installer,
 *   a platform module…).
 * - other: a name Android's statement has no level for: another app's or a
 *   vendor's permission, one defined in a module, one this Android version
 *   does not define, or a level no heading above is true of.
 *
 * A name that begins with one of the app's package ids and a dot is the
 * app's own, and is counted apart from the groups.
 */

import type { AndroidPermission } from "../../../schema/parts.ts";
import { isRecord } from "./load.ts";
import { originName, type Entry, type Model } from "./model.ts";

export type IndexOrigin = "fdroid" | "izzy";

/** Android's statements as the app holds them, for the version and release tag the part names. */
export interface AndroidStatements {
  version: string;
  tag: string;
  permissions: ReadonlyMap<string, AndroidPermission>;
}

export type GroupId = "runtime" | "special" | "install" | "developer" | "role" | "signer" | "builtin" | "other";

/** The groups in the order the sheet shows them, with their headings. */
export const GROUPS: readonly { id: GroupId; heading: string }[] = [
  { id: "runtime", heading: "Asked for while it runs" },
  { id: "special", heading: "Special access" },
  { id: "install", heading: "Granted at install" },
  { id: "developer", heading: "Granted with developer tools" },
  { id: "role", heading: "Granted with a role" },
  { id: "signer", heading: "Granted by signing key" },
  { id: "builtin", heading: "Granted to built-in apps" },
  { id: "other", heading: "Other names" },
];

/** Flags that grant a signature or internal permission only to apps of the device itself. */
const BUILT_IN_FLAGS = new Set([
  "privileged", "system", "preinstalled", "installer", "verifier", "setup", "oem", "vendorPrivileged", "textClassifier",
  "configurator", "incidentReportApprover", "appPredictor", "companion", "retailDemo", "recents", "module",
]);

/** The group of a level as Android states it; "other" when there is no statement or no heading is true of it. */
export function groupOf(level: string | undefined): GroupId {
  if (level === undefined) return "other";
  const words = new Set(level.split("|"));
  if (words.has("dangerous")) return "runtime";
  if (words.has("appop")) return "special";
  if (words.has("normal")) return "install";
  const base = ["signature", "signatureOrSystem", "internal"].filter((word) => words.delete(word));
  if (base.length !== 1) return "other";
  if (words.has("development")) return "developer";
  if (words.has("role")) return "role";
  if (words.has("knownSigner")) return "signer";
  return [...words].every((word) => BUILT_IN_FLAGS.has(word)) ? "builtin" : "other";
}

const NAME = /^[\x21-\x7e]{1,255}$/;
const LEVEL = /^[A-Za-z0-9|]{1,200}$/;
const MOST_STATEMENTS = 5_000;
const LONGEST_LABEL = 200;

/**
 * Reads the android part. Rows that are not a printable name with a level
 * word list and a plain label are left out; anything else about the part
 * that is not as expected leaves no statements at all.
 */
export function readAndroidStatements(value: unknown): AndroidStatements | null {
  if (!isRecord(value) || !isRecord(value.android) || !isRecord(value.permissions)) return null;
  const { version, tag } = value.android;
  if (typeof version !== "string" || !/^\d{1,3}$/.test(version) || typeof tag !== "string" || !/^android-[0-9._r]{1,40}$/.test(tag)) return null;
  const entries = Object.entries(value.permissions);
  if (entries.length > MOST_STATEMENTS) return null;
  const permissions = new Map<string, AndroidPermission>();
  for (const [name, statement] of entries) {
    if (!NAME.test(name) || !isRecord(statement)) continue;
    const { protectionLevel, label } = statement;
    if (typeof protectionLevel !== "string" || !LEVEL.test(protectionLevel)) continue;
    const plain = typeof label === "string" && label.length > 0 && label.length <= LONGEST_LABEL && !/[\p{Cc}\p{Cf}]/u.test(label);
    permissions.set(name, { protectionLevel, label: plain ? label : null });
  }
  return { version, tag, permissions };
}

/** A name as the index states it, with Android's label for it where Android has one. */
export interface ShownName {
  name: string;
  label: string | null;
}

export interface NameGroup {
  id: GroupId;
  heading: string;
  names: ShownName[];
}

/** One index's list, or two indexes' identical lists, as the sheet shows it. */
export interface PermissionList {
  /** Display names of the indexes that list exactly these names, F-Droid first. */
  sources: string[];
  /** Every group that holds a name, in `GROUPS` order. */
  groups: NameGroup[];
  /** Names under one of the app's package ids. */
  own: string[];
  /** How many of the names the index counts are not in its list (not shown by the build, or past the most it keeps). */
  hidden: number;
}

/** What one index states: its names for the app, as the build keeps them, and its count. */
export interface LoadedNames {
  origin: IndexOrigin;
  names: readonly string[];
  count: number;
}

/** The indexes to ask for an entry's names: those that count at least one. */
export function permissionOrigins(entry: Entry): IndexOrigin[] {
  return entry.app.index.filter((index) => index.permissionCount > 0).map((index) => index.origin);
}

/** The count one index states for the app; 0 when it states none. */
export function countOf(entry: Entry, origin: IndexOrigin): number {
  return entry.app.index.find((index) => index.origin === origin)?.permissionCount ?? 0;
}

/** Whether each list says whose it is: when the app is in more than one index, so no list can be read as another index's. */
export function permissionListsCredited(entry: Entry): boolean {
  return entry.app.index.length > 1;
}

/** The app's package ids, from its record and from each index. */
export function packagesOf(entry: Entry): string[] {
  return [...new Set([...entry.app.packages, ...entry.app.index.map((index) => index.pkg)])];
}

function isOwn(name: string, packages: readonly string[]): boolean {
  return packages.some((pkg) => name.startsWith(`${pkg}.`));
}

function shown(name: string, android: AndroidStatements | null): ShownName {
  return { name, label: android?.permissions.get(name)?.label ?? null };
}

/** One list's names in groups, with the app's own apart. Without Android's statements every name is in "other". */
export function groupNames(names: readonly string[], packages: readonly string[], android: AndroidStatements | null): { groups: NameGroup[]; own: string[] } {
  const own: string[] = [];
  const byGroup = new Map<GroupId, ShownName[]>();
  for (const name of names) {
    if (isOwn(name, packages)) {
      own.push(name);
      continue;
    }
    const id = groupOf(android?.permissions.get(name)?.protectionLevel);
    byGroup.set(id, [...(byGroup.get(id) ?? []), shown(name, android)]);
  }
  const groups = GROUPS.flatMap(({ id, heading }) => {
    const members = byGroup.get(id);
    return members ? [{ id, heading, names: members }] : [];
  });
  return { groups, own };
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, at) => name === b[at]);
}

function fdroidFirst<T extends { origin: IndexOrigin }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.origin === b.origin ? 0 : a.origin === "fdroid" ? -1 : 1));
}

/**
 * The lists the sheet shows when the names are open. Indexes that list
 * exactly the same names and leave out as many share one list naming both,
 * F-Droid first; an index whose list is empty and complete is left out.
 */
export function permissionLists(model: Model, entry: Entry, loaded: readonly LoadedNames[], android: AndroidStatements | null): PermissionList[] {
  const packages = packagesOf(entry);
  const lists: (PermissionList & { names: readonly string[] })[] = [];
  for (const { origin, names, count } of fdroidFirst(loaded)) {
    const hidden = Math.max(0, count - names.length);
    if (names.length === 0 && hidden === 0) continue;
    const same = lists.find((list) => list.hidden === hidden && sameNames(list.names, names));
    if (same) same.sources.push(originName(model, origin));
    else lists.push({ sources: [originName(model, origin)], names, hidden, ...groupNames(names, packages, android) });
  }
  return lists.map(({ sources, groups, own, hidden }) => ({ sources, groups, own, hidden }));
}

/** The line under a list that is shorter than its count. */
export function namesNotShown(hidden: number): string {
  return `${hidden} ${hidden === 1 ? "name" : "names"} not shown`;
}

/** The fold that holds the app's own names. */
export function ownNamesLine(count: number): string {
  return `${count} under the app's package name`;
}

/** What the closed row says of the names one or more indexes list that Android asks for while the app runs. */
export interface RuntimeSummary {
  /** Display names of the indexes whose lists give this summary, F-Droid first. */
  sources: string[];
  names: ShownName[];
}

/**
 * For each index whose names are on the device and complete, the names
 * Android asks for while the app runs. Indexes that give the same names
 * share one summary. An index that counts none, or whose list is shorter
 * than its count, gives none: a summary of part of a list would understate it.
 */
export function runtimeSummaries(model: Model, entry: Entry, loaded: readonly LoadedNames[], android: AndroidStatements | null): RuntimeSummary[] {
  if (!android) return [];
  const packages = packagesOf(entry);
  const summaries: (RuntimeSummary & { key: string })[] = [];
  for (const { origin, names, count } of fdroidFirst(loaded)) {
    if (count === 0 || names.length < count) continue;
    const runtime = groupNames(names, packages, android).groups.find((group) => group.id === "runtime")?.names ?? [];
    const key = runtime.map((item) => item.name).join("\n");
    const same = summaries.find((summary) => summary.key === key);
    if (same) same.sources.push(originName(model, origin));
    else summaries.push({ sources: [originName(model, origin)], names: runtime, key });
  }
  return summaries.map(({ sources, names }) => ({ sources, names }));
}

/** The closed row's line for one summary. */
export function runtimeLine(count: number): string {
  return count === 0 ? "Declares none asked for while it runs" : `Declares ${count} asked for while it runs`;
}

/** Who states the groups and labels: Android, with the version. */
export function androidCredit(android: AndroidStatements): string {
  return `Android ${android.version}`;
}

/** What the Sources page says once about the levels: whose statement and which version, and what a declaration is. */
export function levelsNote(android: AndroidStatements): string {
  return `As Android ${android.version} states them. Other versions can differ. A declared permission is not always used.`;
}
