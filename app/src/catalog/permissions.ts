/**
 * An app's permission names as the sheet shows them: each index's list,
 * grouped by how Android grants each name.
 *
 * The groups are Droid Atlas's, made only from the protection level Android
 * states for each permission (the "android" part, `schema/parts.ts`), for the
 * Android version that part names. Each heading is true of every level put
 * under it, and where Android's permissions overview names the type it is
 * that name:
 *
 * - runtime: base level `dangerous`, Android's "runtime permissions", asked
 *   for while the app runs.
 * - special: the `appop` flag, Android's "special permissions", which a
 *   person allows in Settings.
 * - normal: base level `normal` without `appop`, Android's "normal
 *   permissions", granted when the app is installed.
 * - developer: base level `signature` or `internal` with the `development`
 *   flag: such a permission can also be granted with developer tools.
 * - role: the same bases with `role`: granted to the holder of a role.
 * - signer: the same bases with `knownSigner`: granted to apps signed with a
 *   key Android lists.
 * - builtin: the same bases with no flag but those that grant to apps of the
 *   device itself (platform-signed, privileged, preinstalled, the installer,
 *   a platform module…).
 * - earlier: a name the app declares only up to an API level below the one
 *   Android's statements are for (`maxSdkVersion`). It is in no group above,
 *   since the level stated is for a version the declaration does not reach.
 * - other: a name Android's statement has no level for: another app's or a
 *   vendor's permission, one defined in a module, one this Android version
 *   does not define, or a level no heading above is true of.
 *
 * A name that begins with one of the app's package ids and a dot is the
 * app's own, and is counted apart from the groups.
 */

import type { AndroidPermission } from "../../../schema/parts.ts";
import { androidName, plural } from "../lib/format.ts";
import { isRecord } from "./load.ts";
import { originName, type Entry, type Model } from "./model.ts";

export type IndexOrigin = "fdroid" | "izzy";

/** Android's statements as the app holds them, for the version, API level and release tag the part names. */
export interface AndroidStatements {
  version: string;
  apiLevel: number;
  tag: string;
  permissions: ReadonlyMap<string, AndroidPermission>;
}

export type GroupId = "runtime" | "special" | "normal" | "developer" | "role" | "signer" | "builtin" | "earlier" | "other";

/** The groups in the order the sheet shows them, with their headings. */
export const GROUPS: readonly { id: GroupId; heading: string }[] = [
  { id: "runtime", heading: "Runtime permissions" },
  { id: "special", heading: "Special permissions" },
  { id: "normal", heading: "Normal permissions" },
  { id: "developer", heading: "Granted with developer tools" },
  { id: "role", heading: "Granted with a role" },
  { id: "signer", heading: "Granted by signing key" },
  { id: "builtin", heading: "Granted to built-in apps" },
  { id: "earlier", heading: "For earlier Android versions" },
  { id: "other", heading: "Other names" },
];

/** Flags that grant a signature or internal permission only to apps of the device itself. */
const BUILT_IN_FLAGS = new Set(
  "privileged system preinstalled installer verifier setup oem vendorPrivileged textClassifier configurator incidentReportApprover appPredictor companion retailDemo recents module".split(" "),
);

/** The group of a level as Android states it; "other" when there is no statement or no heading is true of it. */
export function groupOf(level: string | undefined): Exclude<GroupId, "earlier"> {
  if (level === undefined) return "other";
  const words = new Set(level.split("|"));
  if (words.has("dangerous")) return "runtime";
  if (words.has("appop")) return "special";
  if (words.has("normal")) return "normal";
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
  const { version, apiLevel, tag } = value.android;
  if (typeof version !== "string" || !/^\d{1,3}$/.test(version) || typeof tag !== "string" || !/^android-[0-9._r]{1,40}$/.test(tag)) return null;
  if (typeof apiLevel !== "number" || !Number.isInteger(apiLevel) || apiLevel < 1 || apiLevel > 1000) return null;
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
  return { version, apiLevel, tag, permissions };
}

/** A name as the index states it, with Android's label for it where Android has one, and the API level the app declares it up to. */
export interface ShownName {
  name: string;
  label: string | null;
  /** Shown only below the API level of Android's statements, or when there are none: a cap at or above it changes nothing. */
  upTo: number | null;
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

/** What one index states: its names for the app as the build keeps them, their caps, and its count. */
export interface LoadedNames {
  origin: IndexOrigin;
  names: readonly string[];
  caps: Readonly<Record<string, number>>;
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

/** One list's names in groups, with the app's own apart. Without Android's statements every name is in "other". */
export function groupNames(
  names: readonly string[],
  caps: Readonly<Record<string, number>>,
  packages: readonly string[],
  android: AndroidStatements | null,
): { groups: NameGroup[]; own: string[] } {
  const own: string[] = [];
  const byGroup = new Map<GroupId, ShownName[]>();
  for (const name of names) {
    if (isOwn(name, packages)) {
      own.push(name);
      continue;
    }
    const cap = Object.hasOwn(caps, name) ? (caps[name] ?? null) : null;
    const below = cap !== null && (!android || cap < android.apiLevel);
    const id = android && below ? "earlier" : groupOf(android?.permissions.get(name)?.protectionLevel);
    const shown = { name, label: id === "earlier" ? null : (android?.permissions.get(name)?.label ?? null), upTo: below ? cap : null };
    byGroup.set(id, [...(byGroup.get(id) ?? []), shown]);
  }
  const groups = GROUPS.flatMap(({ id, heading }) => {
    const members = byGroup.get(id);
    return members ? [{ id, heading, names: members }] : [];
  });
  return { groups, own };
}

/**
 * What each index's names make, F-Droid first, leaving out an index they make
 * nothing for. Indexes whose names make the same key share one, naming both.
 */
function byIndex<T>(model: Model, loaded: readonly LoadedNames[], make: (item: LoadedNames) => [key: string, made: T] | null): (T & { sources: string[] })[] {
  const keys: string[] = [];
  const out: (T & { sources: string[] })[] = [];
  for (const item of [...loaded].sort((a, b) => (a.origin === b.origin ? 0 : a.origin === "fdroid" ? -1 : 1))) {
    const made = make(item);
    if (!made) continue;
    const source = originName(model, item.origin);
    const at = keys.indexOf(made[0]);
    if (at >= 0) out[at]?.sources.push(source);
    else {
      keys.push(made[0]);
      out.push({ ...made[1], sources: [source] });
    }
  }
  return out;
}

/**
 * The lists the sheet shows when the names are open. Indexes that list
 * exactly the same names with the same caps and leave out as many share one
 * list naming both, F-Droid first; an index whose list is empty and complete
 * is left out.
 */
export function permissionLists(model: Model, entry: Entry, loaded: readonly LoadedNames[], android: AndroidStatements | null): PermissionList[] {
  const packages = packagesOf(entry);
  return byIndex(model, loaded, (item) => {
    const hidden = Math.max(0, item.count - item.names.length);
    if (item.names.length === 0 && hidden === 0) return null;
    const key = `${item.names.map((name) => `${name} ${item.caps[name] ?? ""}`).join("\n")}\n${hidden}`;
    return [key, { hidden, ...groupNames(item.names, item.caps, packages, android) }];
  });
}

/** The line under a list that is shorter than its count. */
export function namesNotShown(hidden: number): string {
  return `${plural(hidden, "name")} not shown`;
}

/** The fold that holds the app's own names, as its button reads closed and open. */
export function ownNamesToggle(count: number, open: boolean): string {
  return `${open ? "Hide" : "Show"} ${plural(count, "name")} under the app's package`;
}

/** "Up to Android 4.3", in the form the Requires row uses for a version. */
export function upToLine(apiLevel: number): string {
  return `Up to ${androidName(apiLevel)}`;
}

/** What the closed row says of one index's list, or of two identical ones: the names a person grants themselves. */
export interface RowSummary {
  /** Display names of the indexes whose lists give this summary, F-Droid first. */
  sources: string[];
  runtime: ShownName[];
  special: ShownName[];
  /**
   * Whether Android's statements give a level for every name of the list
   * that is not the app's own, so that a kind with no name in it is one the
   * app does not declare. The app's own names do not count against it: they
   * are permissions the app defines for others to hold, not grants it asks
   * of the system. A name the app declares only for earlier versions does not
   * either, since on this version it is not declared.
   */
  whole: boolean;
}

/**
 * For each index whose names are on the device and complete, the names in
 * the two groups a person grants themselves: runtime and special
 * permissions. Indexes that give the same names share one summary. An index
 * that counts none, or whose list is shorter than its count, gives none: a
 * summary of part of a list could state a "no" that is not true. Nor does a
 * list that holds neither kind and a name Android states nothing about: that
 * name, another app's permission, may be of either kind, so there is nothing
 * the row can say. In each kind, names Android has a label for come first,
 * each part in the list's order.
 */
export function rowSummaries(model: Model, entry: Entry, loaded: readonly LoadedNames[], android: AndroidStatements | null): RowSummary[] {
  if (!android) return [];
  const packages = packagesOf(entry);
  return byIndex(model, loaded, (item) => {
    if (item.count === 0 || item.names.length < item.count) return null;
    const { groups } = groupNames(item.names, item.caps, packages, android);
    const of = (id: GroupId): ShownName[] => {
      const names = groups.find((group) => group.id === id)?.names ?? [];
      return [...names.filter((shown) => shown.label), ...names.filter((shown) => !shown.label)];
    };
    const runtime = of("runtime");
    const special = of("special");
    const whole = of("other").every((shown) => android.permissions.has(shown.name));
    if (!whole && runtime.length + special.length === 0) return null;
    return [`${[...runtime, ...special].map((shown) => shown.name).join("\n")}\n${runtime.length} ${whole}`, { runtime, special, whole }];
  });
}

/**
 * The closed row's line for one summary. Of a whole list it states both
 * kinds, so that each "no" is true; otherwise only the kinds it found.
 */
export function summaryLine(runtime: number, special: number, whole: boolean): string {
  if (runtime > 0 && special > 0) return `Declares ${runtime} runtime and ${plural(special, "special permission")}`;
  if (!whole) return `Declares ${runtime > 0 ? plural(runtime, "runtime permission") : plural(special, "special permission")}`;
  if (runtime === 0 && special === 0) return "Declares no runtime or special permissions";
  if (runtime === 0) return `Declares no runtime and ${plural(special, "special permission")}`;
  return `Declares ${runtime} runtime and ${special === 0 ? "no special permissions" : plural(special, "special permission")}`;
}

/**
 * Whether "Show names" has anything to open: some list the sheet has read
 * holds a name. Every shard is of one build, so lists read empty for indexes
 * that count names mean a build that keeps none. When no counting index's
 * shard has been read, the names may be there and are offered.
 */
export function namesOffered(read: readonly LoadedNames[]): boolean {
  return read.length === 0 || read.some((item) => item.names.length > 0);
}

/** Who states the levels and labels: Android, with the version. */
export function androidCredit(android: AndroidStatements): string {
  return `Android ${android.version}`;
}

/** The line where the groups are read: what a declaration is, and that the levels are one version's. */
export const LEVELS_CAVEAT = "A declared permission is not always used. Other versions can differ.";

/** What the Sources page says once about the levels: whose statement, which version and configuration, and the caveat. */
export function levelsNote(android: AndroidStatements): string {
  return `As Android ${android.version} states them in its release's default configuration. ${LEVELS_CAVEAT}`;
}
