/**
 * Saved apps, kept on the device.
 *
 * A saved app is stored with its keys (`packages`, `repo`) as well as its id,
 * so the save survives an id change, and removal is a timestamp rather than a
 * deletion, so an import or the other window can merge instead of overwrite.
 * A saved app may carry a short note of the reader's own, with the time it
 * was last edited so that two copies of the list can agree on the newer one.
 */

import { computed, type ReadonlySignal } from "@preact/signals";
import type { Entry, Model } from "../catalog/model.ts";
import { createStore, isRecord, type StorageBackend, type Store } from "./storage.ts";

export const NOTE_MAX_LENGTH = 280;

export interface SavedItem {
  id: string;
  packages: string[];
  /** Canonical repository URL, when the app has one. */
  repo: string | null;
  savedAt: number;
  removedAt?: number;
  /** The reader's own note. Absent when there is none. */
  note?: string;
  noteAt?: number;
}

export interface SavedData {
  v: 1;
  items: SavedItem[];
}

function time(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** A note as it is stored: line breaks and runs of spaces collapsed, trimmed, cut to the limit. */
export function cleanNote(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX_LENGTH);
}

function parseItem(raw: unknown): SavedItem | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  const item: SavedItem = {
    id: raw.id,
    packages: Array.isArray(raw.packages) ? raw.packages.filter((pkg): pkg is string => typeof pkg === "string") : [],
    repo: typeof raw.repo === "string" ? raw.repo : null,
    savedAt: time(raw.savedAt) ?? 0,
  };
  const removedAt = time(raw.removedAt);
  if (removedAt !== null) item.removedAt = removedAt;
  const note = typeof raw.note === "string" ? cleanNote(raw.note) : "";
  if (note) item.note = note;
  const noteAt = time(raw.noteAt);
  if (noteAt !== null) item.noteAt = noteAt;
  return item;
}

export function parseSaved(raw: unknown): SavedData | null {
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.items)) return null;
  const items: SavedItem[] = [];
  for (const candidate of raw.items) {
    const item = parseItem(candidate);
    if (item && !items.some((other) => other.id === item.id)) items.push(item);
  }
  return { v: 1, items };
}

export function createSavedStore(backend?: StorageBackend | null): Store<SavedData> {
  const options = { key: "saved", version: 1, parse: parseSaved, initial: (): SavedData => ({ v: 1, items: [] }) };
  return backend === undefined ? createStore(options) : createStore(options, backend);
}

/** Finds the catalog entry a saved item refers to today: by id (following redirects), then package id, then repository. */
export function resolveSaved(model: Model, item: SavedItem): Entry | null {
  const direct = model.resolve(item.id);
  if (direct) return direct;
  if (item.packages.length) {
    const byPackage = model.entries.find((entry) => entry.app.packages.some((pkg) => item.packages.includes(pkg)));
    if (byPackage) return byPackage;
  }
  if (item.repo) {
    const byRepo = model.entries.filter((entry) => entry.app.repo?.url === item.repo);
    if (byRepo.length === 1) return byRepo[0] ?? null;
  }
  return null;
}

/** When the item last changed between saved and removed. */
function lastAction(item: SavedItem): number {
  return Math.max(item.savedAt, item.removedAt ?? 0);
}

/** Two records of the same app: the same id, or a package id in common. A shared repository proves nothing (monorepos). */
function sameApp(a: SavedItem, b: SavedItem): boolean {
  return a.id === b.id || a.packages.some((pkg) => b.packages.includes(pkg));
}

function mergeItem(local: SavedItem, incoming: SavedItem): SavedItem {
  const winner = lastAction(incoming) > lastAction(local) ? incoming : local;
  const merged: SavedItem = {
    id: local.id,
    packages: [...new Set([...local.packages, ...incoming.packages])],
    repo: local.repo ?? incoming.repo,
    savedAt: winner.savedAt,
  };
  if (winner.removedAt !== undefined) merged.removedAt = winner.removedAt;
  const localAt = local.noteAt ?? 0;
  const incomingAt = incoming.noteAt ?? 0;
  /* The newer edit wins, and an edit that emptied the note is an edit. With no times to compare, a note beats no note and this device's beats the file's. */
  const noteFrom = incomingAt > localAt || (incomingAt === localAt && !local.note && incoming.note) ? incoming : local;
  if (noteFrom.note) merged.note = noteFrom.note;
  if (noteFrom.noteAt !== undefined) merged.noteAt = noteFrom.noteAt;
  return merged;
}

export interface SavedMergeStats {
  /** Apps that are saved after the merge and were not before. */
  added: number;
  /** Apps that were saved here and that the incoming list removed more recently. */
  removed: number;
  /** Notes taken from the incoming list. */
  notes: number;
}

/**
 * Merges another copy of the saved list into this one. Nothing is lost that
 * is newer here: for each app the most recent save or removal wins, and so
 * does the most recently edited note.
 */
export function mergeSaved(local: SavedData, incoming: SavedData): { data: SavedData; stats: SavedMergeStats } {
  const items = local.items.map((item) => ({ ...item }));
  const stats: SavedMergeStats = { added: 0, removed: 0, notes: 0 };
  for (const candidate of incoming.items) {
    const index = items.findIndex((item) => sameApp(item, candidate));
    const existing = index === -1 ? undefined : items[index];
    if (!existing) {
      items.push({ ...candidate });
      if (candidate.removedAt === undefined) stats.added += 1;
      if (candidate.removedAt === undefined && candidate.note) stats.notes += 1;
      continue;
    }
    const merged = mergeItem(existing, candidate);
    const wasSaved = existing.removedAt === undefined;
    const isSaved = merged.removedAt === undefined;
    if (!wasSaved && isSaved) stats.added += 1;
    if (wasSaved && !isSaved) stats.removed += 1;
    if (isSaved && (merged.note ?? "") !== (existing.note ?? "")) stats.notes += 1;
    items[index] = merged;
  }
  return { data: { v: 1, items }, stats };
}

export interface SavedView {
  /** Saved entries the catalog still has, most recently saved first. */
  entries: Entry[];
  ids: Set<string>;
  /** The reader's note per saved entry id, for the entries that have one. */
  notes: Map<string, string>;
  /** When each saved entry was saved, by entry id. */
  savedAt: Map<string, number>;
  /** Saved items whose app has left every catalog. */
  missing: SavedItem[];
  /** Saved items found under another id than the one they were saved with: the catalog renamed or merged them. */
  moved: { from: string; entry: Entry }[];
}

export interface Saved {
  readonly view: ReadonlySignal<SavedView>;
  readonly store: Store<SavedData>;
  has(entryId: string): boolean;
  /** Returns true when the entry is saved after the call. */
  toggle(entry: Entry, now: number): boolean;
  /** Sets or clears the note of a saved entry. Does nothing when the entry is not saved. */
  setNote(entry: Entry, text: string, now: number): void;
  forget(itemId: string, now: number): void;
  /** Takes back the removal made at `removedAt`: what it removed is saved again as it was, note and place in the list included. */
  restore(removedAt: number): void;
}

export function createSaved(model: Model, store: Store<SavedData>): Saved {
  const view = computed<SavedView>(() => {
    const active = store.value.value.items.filter((item) => item.removedAt === undefined).sort((a, b) => b.savedAt - a.savedAt);
    const entries: Entry[] = [];
    const ids = new Set<string>();
    const notes = new Map<string, string>();
    const savedAt = new Map<string, number>();
    const missing: SavedItem[] = [];
    const moved: { from: string; entry: Entry }[] = [];
    for (const item of active) {
      const entry = resolveSaved(model, item);
      if (!entry) {
        missing.push(item);
        continue;
      }
      if (entry.app.id !== item.id) moved.push({ from: item.id, entry });
      if (item.note && !notes.has(entry.app.id)) notes.set(entry.app.id, item.note);
      if (!ids.has(entry.app.id)) {
        ids.add(entry.app.id);
        entries.push(entry);
        savedAt.set(entry.app.id, item.savedAt);
      }
    }
    return { entries, ids, notes, savedAt, missing, moved };
  });

  const matches = (entry: Entry) => (item: SavedItem): boolean => resolveSaved(model, item) === entry;

  return {
    view,
    store,
    has: (entryId) => view.value.ids.has(entryId),
    toggle(entry, now) {
      let saved = false;
      store.update((current) => {
        const same = matches(entry);
        const existing = current.items.find((item) => item.removedAt === undefined && same(item));
        if (existing) {
          return { v: 1, items: current.items.map((item) => (item.removedAt === undefined && same(item) ? { ...item, removedAt: now } : item)) };
        }
        saved = true;
        const fresh: SavedItem = { id: entry.app.id, packages: [...entry.app.packages], repo: entry.app.repo?.url ?? null, savedAt: now };
        /* Saving again brings back the note the app had when it was removed. */
        const previous = current.items.filter(same).sort((a, b) => (b.noteAt ?? 0) - (a.noteAt ?? 0)).find((item) => item.note);
        if (previous?.note) {
          fresh.note = previous.note;
          if (previous.noteAt !== undefined) fresh.noteAt = previous.noteAt;
        }
        return { v: 1, items: [fresh, ...current.items.filter((item) => !same(item))] };
      });
      return saved;
    },
    setNote(entry, text, now) {
      const note = cleanNote(text);
      store.update((current) => {
        const same = matches(entry);
        let done = false;
        const items = current.items.map((item) => {
          if (done || item.removedAt !== undefined || !same(item) || (item.note ?? "") === note) return item;
          done = true;
          const next: SavedItem = { ...item, noteAt: now };
          if (note) next.note = note;
          else delete next.note;
          return next;
        });
        return done ? { v: 1, items } : current;
      });
    },
    forget(itemId, now) {
      store.update((current) => ({
        v: 1,
        items: current.items.map((item) => (item.id === itemId && item.removedAt === undefined ? { ...item, removedAt: now } : item)),
      }));
    },
    restore(removedAt) {
      store.update((current) => {
        if (!current.items.some((item) => item.removedAt === removedAt)) return current;
        return {
          v: 1,
          items: current.items.map((item) => {
            if (item.removedAt !== removedAt) return item;
            const { removedAt: _removed, ...kept } = item;
            return kept;
          }),
        };
      });
    },
  };
}
