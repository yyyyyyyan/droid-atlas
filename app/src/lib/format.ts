/** Small, pure formatting helpers shared by rows, the sheet and the filters. */

import { foldText } from "../../../schema/join.ts";

const DAY_MS = 86_400_000;

const SDK_TO_ANDROID: Record<number, string> = {
  21: "5.0", 22: "5.1", 23: "6", 24: "7.0", 25: "7.1", 26: "8.0", 27: "8.1", 28: "9", 29: "10",
  30: "11", 31: "12", 32: "12L", 33: "13", 34: "14", 35: "15", 36: "16", 37: "17",
};

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

/**
 * Lower-cases and strips diacritics, so "Élan" is found by "elan". It is the
 * catalog's own folding, the one `App.search` was made with, so a query and
 * the text it is matched against are always folded the same way.
 */
export const fold = foldText;

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
}

/**
 * The part of an entry id most likely to be the app's name: what follows the
 * last dot, dash, slash or underscore (`com.orgzly` gives `orgzly`). Null when
 * that leaves nothing worth searching for.
 */
export function nameInId(id: string): string | null {
  const parts = id.split(/[./_-]+/).filter(Boolean);
  const last = parts.at(-1) ?? "";
  return last.length >= 3 ? last : null;
}

export function timeAgo(timestamp: number, now: number): string {
  const days = Math.floor((now - timestamp) / DAY_MS);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${(days / 365).toFixed(days < 730 ? 1 : 0)}y ago`;
}

export function withinDays(timestamp: number | null, now: number, days: number): boolean {
  return timestamp !== null && now - timestamp < days * DAY_MS && timestamp <= now + DAY_MS;
}

export function compactNumber(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1e6) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1e6).toFixed(1)}M`;
}

export function fileSize(bytes: number): string {
  const megabytes = bytes / 1_048_576;
  return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)}\u00a0MB`;
}

/** The Android version an API level is, "Android 4.3", or "API level 18" when it is not known. */
export function androidName(sdk: number): string {
  const version = SDK_TO_ANDROID[sdk];
  return version ? `Android ${version}` : `API level ${sdk}`;
}

export function androidVersion(sdk: number): string {
  return `${androidName(sdk)}+`;
}

/** The locale dates and numbers are written in: the interface is in American English. */
const LOCALE = "en-US";

const DATE = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A calendar date the American way: "Nov 12, 2026", read in UTC: right for a
 * day stored as an ISO date (the days download figures count), which parses
 * to its midnight UTC. A catalog's build time goes through `formatDay`.
 */
export function formatDate(timestamp: number): string {
  return DATE.format(timestamp);
}

/**
 * The day an instant fell on where the reader is: a catalog's build, a
 * commit, a reading. Built at 01:00 UTC, a catalog is of the day before in
 * the Americas. `timeZone` is for tests; the app leaves it to the reader's.
 */
export function formatDay(timestamp: number, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric", timeZone }).format(timestamp);
}

const DAY_OF_YEAR = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" });
const MONTH_OF_YEAR = new Intl.DateTimeFormat(LOCALE, { month: "short", year: "numeric", timeZone: "UTC" });

/** A date in as few letters as say it: "Nov 12" within the year of `now`, "Nov 2025" outside it. */
export function shortDate(timestamp: number, now: number): string {
  const sameYear = new Date(timestamp).getUTCFullYear() === new Date(now).getUTCFullYear();
  return (sameYear ? DAY_OF_YEAR : MONTH_OF_YEAR).format(timestamp);
}

/** Two dates as one period: "Oct 13 – Nov 11, 2026", repeating only what differs. */
export function formatDateRange(from: number, to: number): string {
  /* The formatter sets thin spaces around the dash; ordinary ones keep the text searchable and copyable as typed. */
  return DATE.formatRange(from, to).replace(/[\u2009\u202f]/g, " ");
}

/** Milliseconds for an ISO date, or null when the string is absent or not a date. */
export function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

const LICENSE_NAMES: Record<string, string> = {
  "CC-BY-SA-3.0": "CC BY-SA 3.0",
  "CC-BY-SA-4.0": "CC BY-SA 4.0",
  "CC0-1.0": "CC0 1.0",
  "GPL-3.0": "GPL-3.0",
  "GPL-3.0-only": "GPL-3.0",
  "GPL-3.0-or-later": "GPL-3.0 or later",
  "AGPL-3.0-only": "AGPL-3.0",
  "AGPL-3.0-or-later": "AGPL-3.0 or later",
};

/** An SPDX license identifier in the form people write it. Unknown identifiers are shown as they are. */
export function licenseName(spdx: string): string {
  return LICENSE_NAMES[spdx] ?? spdx;
}

/**
 * Up to two characters that stand for a name where it has no icon: the
 * initials of its first two words ("AG Displays" gives "AD"), or the first
 * two letters of a single word ("BlissLauncher" gives "Bl").
 */
export function monogram(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const [first, second] = words;
  if (!first) return "?";
  const initial = (word: string): string => [...word][0] ?? "";
  if (second) return (initial(first) + initial(second)).toUpperCase();
  const letters = [...first];
  return (letters[0] ?? "").toUpperCase() + (letters[1] ?? "").toLowerCase();
}

/** A date and time to the minute, in the reader's own time zone: build and index times are instants, read where the reader is. */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(LOCALE, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}

/** A file size at the scale it is read at: bytes, kB or MB. */
export function byteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} kB`;
  return fileSize(bytes);
}
