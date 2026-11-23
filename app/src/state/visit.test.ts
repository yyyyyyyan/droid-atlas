import { describe, expect, test } from "vitest";
import { savedMarks } from "../catalog/facts.ts";
import { app, catalog } from "../catalog/fixtures.ts";
import { buildModel, type Entry } from "../catalog/model.ts";
import { STORAGE_PREFIX, type StorageBackend } from "./storage.ts";
import { createLastVisit, createVisitStore, parseVisit } from "./visit.ts";

class MemoryStorage implements StorageBackend {
  readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const blocked: StorageBackend = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

const KEY = `${STORAGE_PREFIX}lastVisit`;
const at = (iso: string): number => Date.parse(iso);
/** A catalog as `open` reads it: built at `iso`. */
const catalogOf = (iso: string): { generatedAt: string } => ({ generatedAt: iso });

/** One session of the app: a fresh boot over the same storage. */
function session(storage: StorageBackend | null) {
  return createLastVisit(createVisitStore(storage));
}

describe("the date of the catalog Saved was last opened with", () => {
  test("the first visit has no date to measure from, and stores one", () => {
    const storage = new MemoryStorage();
    const visit = session(storage);
    expect(visit.since.value).toBeNull();
    visit.open(catalogOf("2026-11-17T01:00:00Z"));
    expect(visit.since.value).toBeNull();
    expect(JSON.parse(storage.data.get(KEY) ?? "null")).toEqual({ v: 1, at: at("2026-11-17T01:00:00Z") });
  });

  test("the date read at the session's first visit holds for the whole session, while the new one is already stored", () => {
    const storage = new MemoryStorage();
    session(storage).open(catalogOf("2026-11-17T01:00:00Z"));
    const visit = session(storage);
    visit.open(catalogOf("2026-11-19T01:00:00Z"));
    expect(visit.since.value).toBe(at("2026-11-17T01:00:00Z"));
    visit.open(catalogOf("2026-11-20T01:00:00Z"));
    expect(visit.since.value).toBe(at("2026-11-17T01:00:00Z"));
    expect(parseVisit(JSON.parse(storage.data.get(KEY) ?? "null"))?.at).toBe(at("2026-11-19T01:00:00Z"));
  });

  test("the next session measures from what the last one stored", () => {
    const storage = new MemoryStorage();
    session(storage).open(catalogOf("2026-11-17T01:00:00Z"));
    session(storage).open(catalogOf("2026-11-19T01:00:00Z"));
    const next = session(storage);
    next.open(catalogOf("2026-11-19T01:00:00Z"));
    expect(next.since.value).toBe(at("2026-11-19T01:00:00Z"));
  });

  test("a tab still on an older catalog, opened after a newer one, neither moves the date back nor brings marks back", () => {
    const storage = new MemoryStorage();
    session(storage).open(catalogOf("2026-11-17T01:00:00Z"));
    const installed = session(storage);
    const tab = session(storage);
    installed.open(catalogOf("2026-11-19T01:00:00Z"));
    tab.open(catalogOf("2026-11-18T01:00:00Z"));
    expect(installed.since.value).toBe(at("2026-11-17T01:00:00Z"));
    expect(tab.since.value).toBe(at("2026-11-19T01:00:00Z"));
    expect(parseVisit(JSON.parse(storage.data.get(KEY) ?? "null"))?.at).toBe(at("2026-11-19T01:00:00Z"));
    const next = session(storage);
    next.open(catalogOf("2026-11-19T01:00:00Z"));
    expect(next.since.value).toBe(at("2026-11-19T01:00:00Z"));
  });

  test("a catalog with no readable build time stores nothing and leaves the session to the next opening", () => {
    const storage = new MemoryStorage();
    const visit = session(storage);
    visit.open(catalogOf("not a date"));
    expect(storage.data.has(KEY)).toBe(false);
    visit.open(catalogOf("2026-11-19T01:00:00Z"));
    expect(parseVisit(JSON.parse(storage.data.get(KEY) ?? "null"))?.at).toBe(at("2026-11-19T01:00:00Z"));
  });

  test("an older date never replaces a newer one: a tab on yesterday's catalog does not bring marks back", () => {
    const storage = new MemoryStorage();
    session(storage).open(catalogOf("2026-11-19T01:00:00Z"));
    const old = session(storage);
    old.open(catalogOf("2026-11-18T01:00:00Z"));
    expect(old.since.value).toBe(at("2026-11-19T01:00:00Z"));
    expect(parseVisit(JSON.parse(storage.data.get(KEY) ?? "null"))?.at).toBe(at("2026-11-19T01:00:00Z"));
  });

  test("a date another window stored during this session does not change this session's", () => {
    const storage = new MemoryStorage();
    session(storage).open(catalogOf("2026-11-17T01:00:00Z"));
    const here = session(storage);
    here.open(catalogOf("2026-11-18T01:00:00Z"));
    session(storage).open(catalogOf("2026-11-19T01:00:00Z"));
    expect(here.since.value).toBe(at("2026-11-17T01:00:00Z"));
  });

  test("with storage blocked, missing, unreadable or from a newer version, there is no date", () => {
    for (const storage of [blocked, null]) {
      const visit = session(storage);
      visit.open(catalogOf("2026-11-19T01:00:00Z"));
      expect(visit.since.value).toBeNull();
    }
    const corrupt = new MemoryStorage();
    corrupt.data.set(KEY, "{not json");
    const recovered = session(corrupt);
    recovered.open(catalogOf("2026-11-19T01:00:00Z"));
    expect(recovered.since.value).toBeNull();
    expect(corrupt.data.get(`${KEY}.corrupt`)).toBe("{not json");

    const newer = new MemoryStorage();
    newer.data.set(KEY, JSON.stringify({ v: 2, at: at("2026-11-17T01:00:00Z") }));
    const kept = session(newer);
    kept.open(catalogOf("2026-11-19T01:00:00Z"));
    expect(kept.since.value).toBeNull();
    expect(newer.data.get(KEY)).toBe(JSON.stringify({ v: 2, at: at("2026-11-17T01:00:00Z") }));
  });

  test("a stored value that is not a date is read as no date", () => {
    expect(parseVisit({ v: 1, at: "yesterday" })).toBeNull();
    expect(parseVisit({ v: 1, at: -5 })).toBeNull();
    expect(parseVisit({ v: 1, at: Number.NaN })).toBeNull();
    expect(parseVisit({ at: 5 })).toBeNull();
    expect(parseVisit({ v: 1, at: 5 })).toEqual({ v: 1, at: 5 });
  });
});

describe("release marks across visits", () => {
  const released = (iso: string) => app({
    id: "player", name: "Player",
    github: { stars: 1, pushedAt: iso, archived: false, movedTo: null, forkOf: null, release: { tag: "v2", publishedAt: iso, hasApk: true } },
  });
  const entryOf = (iso: string): { model: ReturnType<typeof buildModel>; entry: Entry } => {
    const model = buildModel(catalog({ apps: [released(iso)] }), at("2026-11-23T12:00:00Z"));
    return { model, entry: model.byId.get("player") as Entry };
  };
  const SAVED_LONG_AGO = at("2026-01-01T00:00:00Z");
  const texts = (iso: string, savedAt: number, since: number | null): string[] => {
    const { model, entry } = entryOf(iso);
    return savedMarks(model, entry, savedAt, since).map((chip) => chip.text);
  };

  test("first visit, the same session, the next session", () => {
    const storage = new MemoryStorage();
    const first = session(storage);
    first.open(catalogOf("2026-11-17T01:00:00Z"));
    expect(texts("2026-11-16T10:00:00Z", SAVED_LONG_AGO, first.since.value)).toEqual([]);

    const second = session(storage);
    second.open(catalogOf("2026-11-19T01:00:00Z"));
    expect(texts("2026-11-18T10:00:00Z", SAVED_LONG_AGO, second.since.value)).toEqual(["Released Nov 18"]);
    second.open(catalogOf("2026-11-19T01:00:00Z"));
    expect(texts("2026-11-18T10:00:00Z", SAVED_LONG_AGO, second.since.value)).toEqual(["Released Nov 18"]);

    const third = session(storage);
    third.open(catalogOf("2026-11-19T01:00:00Z"));
    expect(texts("2026-11-18T10:00:00Z", SAVED_LONG_AGO, third.since.value)).toEqual([]);
  });

  test("a release made after the clock time of the last visit, but before its catalog could show it, is marked", () => {
    const storage = new MemoryStorage();
    session(storage).open(catalogOf("2026-11-16T01:00:00Z"));
    /* Saved is opened at 20:00 on Nov 18, on the catalog built at 01:00 that day; the release is made at 10:00. */
    const evening = session(storage);
    evening.open(catalogOf("2026-11-18T01:00:00Z"));
    const nextDay = session(storage);
    nextDay.open(catalogOf("2026-11-19T01:00:00Z"));
    expect(nextDay.since.value).toBe(at("2026-11-18T01:00:00Z"));
    expect(texts("2026-11-18T10:00:00Z", SAVED_LONG_AGO, nextDay.since.value)).toEqual(["Released Nov 18"]);
  });

  test("an app saved after the last visit is marked only for a release later than its save", () => {
    const since = at("2026-11-17T01:00:00Z");
    const savedAt = at("2026-11-18T12:00:00Z");
    expect(texts("2026-11-18T10:00:00Z", savedAt, since)).toEqual([]);
    expect(texts("2026-11-18T14:00:00Z", savedAt, since)).toEqual(["Released Nov 18"]);
  });

  test("a release on the day of the visit is marked when it is later than the visit, to the second", () => {
    const since = at("2026-11-18T01:00:00Z");
    expect(texts("2026-11-18T00:30:00Z", SAVED_LONG_AGO, since)).toEqual([]);
    expect(texts("2026-11-18T01:00:00Z", SAVED_LONG_AGO, since)).toEqual([]);
    expect(texts("2026-11-18T01:00:01Z", SAVED_LONG_AGO, since)).toEqual(["Released Nov 18"]);
  });

  test("a release published at 18:00 that an index dates only by its day is not marked when Saved was last opened on the catalog built at 14:00 that day", () => {
    const storage = new MemoryStorage();
    session(storage).open(catalogOf("2026-11-17T14:00:00Z"));
    session(storage).open(catalogOf("2026-11-18T14:00:00Z"));
    const next = session(storage);
    next.open(catalogOf("2026-11-19T14:00:00Z"));
    expect(next.since.value).toBe(at("2026-11-18T14:00:00Z"));
    expect(texts("2026-11-18T00:00:00Z", SAVED_LONG_AGO, next.since.value)).toEqual([]);
  });

  test("a release an index dates only by its day is marked only when that whole day is later than the visit", () => {
    const since = at("2026-11-18T01:00:00Z");
    expect(texts("2026-11-18T00:00:00Z", SAVED_LONG_AGO, since)).toEqual([]);
    expect(texts("2026-11-19T00:00:00Z", SAVED_LONG_AGO, since)).toEqual(["Released Nov 19"]);
  });

  test("with no stored date there is no release mark", () => {
    expect(texts("2026-11-18T10:00:00Z", SAVED_LONG_AGO, null)).toEqual([]);
  });
});
