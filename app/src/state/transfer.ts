/**
 * Export and import of what the reader keeps on the device: saved apps with
 * their notes, pinned queries and preferences, as one versioned JSON file.
 *
 * Import merges; it never replaces. Saved apps and notes follow the most
 * recent change, pins are added when the device does not have them, and a
 * preference is taken from the file only where the device still has the
 * default, so a choice made here is never overturned by a file.
 *
 * The file is read defensively: it is someone's file by the time it comes
 * back, possibly edited, truncated, or written by a newer version.
 */

import { mergePins, parsePins, type PinsData } from "./pins.ts";
import { mergeSaved, parseSaved, type SavedData, type SavedMergeStats } from "./saved.ts";
import { DEFAULT_SETTINGS, PORTABLE_SETTINGS, parseSettings, type PortableSetting, type Settings } from "./settings.ts";
import { isRecord, type Store } from "./storage.ts";

/** Identifies the file as ours. An identifier, not the product's display name: it must survive a rename. */
export const EXPORT_FORMAT = "droid-atlas-export";
export const EXPORT_VERSION = 1;
/** Larger than any real export by orders of magnitude; anything bigger is not ours and is not parsed. */
export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;

export type PortableSettings = Pick<Settings, PortableSetting> & { v: 1 };

export interface ExportFile {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  /** The catalog the device had when it exported: informative only, never used on import. */
  catalog: { hash: string; generatedAt: string } | null;
  saved: SavedData;
  pins: PinsData;
  settings: PortableSettings;
}

export interface TransferStores {
  saved: Store<SavedData>;
  pins: Store<PinsData>;
  settings: Store<Settings>;
}

export function buildExport(stores: TransferStores, now: number, catalog: ExportFile["catalog"]): ExportFile {
  const settings = stores.settings.value.peek();
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    catalog,
    saved: stores.saved.value.peek(),
    pins: stores.pins.value.peek(),
    settings: { v: 1, theme: settings.theme, density: settings.density, resume: settings.resume },
  };
}

export function serializeExport(file: ExportFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** `<prefix>-2026-11-11.json`, dated in the device's own time zone. */
export function exportFileName(prefix: string, now: number): string {
  const date = new Date(now);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${prefix}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

export type ImportFailure = "too-large" | "not-json" | "not-export" | "newer" | "unreadable";

export const IMPORT_FAILURE_TEXT: Record<ImportFailure, string> = {
  "too-large": "Not an export of this app.",
  "not-json": "That file cannot be read.",
  "not-export": "Not an export of this app.",
  newer: "From a newer version of the app. Reload, then import again.",
  unreadable: "That file cannot be read.",
};

/** The sections of a file that could be read. A section is null when the file has none or it is unreadable. */
export interface ParsedImport {
  exportedAt: string | null;
  saved: SavedData | null;
  pins: PinsData | null;
  settings: PortableSettings | null;
  /** Sections the file carries that this version cannot read (written in a newer shape). */
  skipped: string[];
}

export type ReadResult = { ok: true; file: ParsedImport } | { ok: false; reason: ImportFailure };

/** Upgrades a file from the version it is keyed by to the next one. */
export type Migration = (file: Record<string, unknown>) => Record<string, unknown>;

/** Version 1 is the first format, so there is nothing to upgrade from yet. A version 2 adds `1: upgradeFrom1` here. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

function section<T>(raw: unknown, parse: (value: unknown) => T | null, name: string, skipped: string[]): T | null {
  if (raw === undefined || raw === null) return null;
  let parsed: T | null = null;
  try {
    parsed = parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed === null) skipped.push(name);
  return parsed;
}

export function readExport(text: string, migrations: Readonly<Record<number, Migration>> = MIGRATIONS, current: number = EXPORT_VERSION): ReadResult {
  if (text.length > MAX_IMPORT_BYTES) return { ok: false, reason: "too-large" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!isRecord(json) || json.format !== EXPORT_FORMAT) return { ok: false, reason: "not-export" };
  if (typeof json.version !== "number" || !Number.isInteger(json.version)) return { ok: false, reason: "unreadable" };
  if (json.version > current) return { ok: false, reason: "newer" };

  let file: Record<string, unknown> = json;
  for (let version = json.version; version < current; version += 1) {
    const upgrade = migrations[version];
    if (!upgrade) return { ok: false, reason: "unreadable" };
    try {
      file = upgrade(file);
    } catch {
      return { ok: false, reason: "unreadable" };
    }
    if (!isRecord(file)) return { ok: false, reason: "unreadable" };
  }

  const skipped: string[] = [];
  const settings = section(file.settings, parseSettings, "settings", skipped);
  return {
    ok: true,
    file: {
      exportedAt: typeof file.exportedAt === "string" ? file.exportedAt : null,
      saved: section(file.saved, parseSaved, "saved apps", skipped),
      pins: section(file.pins, parsePins, "pinned queries", skipped),
      settings: settings && { v: 1, theme: settings.theme, density: settings.density, resume: settings.resume },
      skipped,
    },
  };
}

/** Takes a preference from the file only where this device still has the default. Returns the keys that changed. */
export function mergeSettings(local: Settings, incoming: PortableSettings): { data: Settings; applied: PortableSetting[] } {
  const applied = PORTABLE_SETTINGS.filter((key) => local[key] === DEFAULT_SETTINGS[key] && incoming[key] !== local[key]);
  const taken = (key: PortableSetting): boolean => applied.includes(key);
  const data: Settings = {
    ...local,
    theme: taken("theme") ? incoming.theme : local.theme,
    density: taken("density") ? incoming.density : local.density,
    resume: taken("resume") ? incoming.resume : local.resume,
  };
  return { data, applied };
}

export interface ImportSummary {
  saved: SavedMergeStats & { inFile: number };
  pins: { added: number; dropped: number; inFile: number };
  settings: PortableSetting[];
  skipped: string[];
  /** True when the device's stored data could not be written (private mode, or data from a newer version). */
  notKept: boolean;
}

/**
 * Merges a parsed file into the stores. Each store re-reads what is stored
 * before merging, so an import in one window does not undo a save made in
 * another a moment earlier.
 */
export function applyImport(stores: TransferStores, file: ParsedImport): ImportSummary {
  const summary: ImportSummary = {
    saved: { added: 0, removed: 0, notes: 0, inFile: file.saved?.items.filter((item) => item.removedAt === undefined).length ?? 0 },
    pins: { added: 0, dropped: 0, inFile: file.pins?.items.length ?? 0 },
    settings: [],
    skipped: file.skipped,
    notKept: false,
  };
  const { saved, pins, settings } = file;
  if (saved) {
    stores.saved.update((current) => {
      const merged = mergeSaved(current, saved);
      Object.assign(summary.saved, merged.stats);
      return merged.data;
    });
  }
  if (pins) {
    stores.pins.update((current) => {
      const merged = mergePins(current, pins);
      summary.pins.added = merged.added;
      summary.pins.dropped = merged.dropped;
      return merged.data;
    });
  }
  if (settings) {
    stores.settings.update((current) => {
      const merged = mergeSettings(current, settings);
      summary.settings = merged.applied;
      return merged.data;
    });
  }
  summary.notKept = [stores.saved, stores.pins, stores.settings].some((store) => store.status.peek() === "unavailable" || store.status.peek() === "newer");
  return summary;
}

/** One or two sentences saying what an import changed, in the reader's terms. */
export function describeImport(summary: ImportSummary): string {
  const count = (value: number, one: string, many: string): string => `${value.toLocaleString("en")} ${value === 1 ? one : many}`;
  const parts: string[] = [];
  if (summary.saved.added) parts.push(`${count(summary.saved.added, "saved app", "saved apps")} added`);
  if (summary.saved.removed) parts.push(`${count(summary.saved.removed, "app", "apps")} removed`);
  if (summary.saved.notes) parts.push(`${count(summary.saved.notes, "note", "notes")} updated`);
  if (summary.pins.added) parts.push(`${count(summary.pins.added, "pin", "pins")} added`);
  if (summary.settings.length) parts.push("settings updated");
  const changed = parts.length ? `Imported: ${parts.join("; ")}.` : "Nothing new in that file.";
  const extras: string[] = [];
  if (summary.pins.dropped) extras.push(`${count(summary.pins.dropped, "pin was", "pins were")} left out because the pin list is full.`);
  if (summary.skipped.length) extras.push(`Not read: ${summary.skipped.join(", ")}.`);
  if (summary.notKept) extras.push("This browser is not storing changes, so the import lasts only until the page is closed.");
  return [changed, ...extras].join(" ");
}
