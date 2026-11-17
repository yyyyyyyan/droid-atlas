import { describe, expect, test } from "vitest";
import { app, catalog } from "../catalog/fixtures.ts";
import { buildModel, type Entry } from "../catalog/model.ts";
import { addPin, createPinsStore, MAX_PINS, mergePins, STARTER_PINS, type Pin } from "./pins.ts";
import { cleanNote, createSaved, createSavedStore, mergeSaved, NOTE_MAX_LENGTH, type SavedData, type SavedItem } from "./saved.ts";
import { createSettingsStore, DEFAULT_SETTINGS, PORTABLE_SETTINGS, type Settings } from "./settings.ts";
import { listenForStorageChanges, STORAGE_PREFIX, type StorageBackend } from "./storage.ts";
import {
  applyImport,
  buildExport,
  describeImport,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportFileName,
  MAX_IMPORT_BYTES,
  mergeSettings,
  readExport,
  serializeExport,
  type ExportFile,
  type TransferStores,
} from "./transfer.ts";

class MemoryStorage implements StorageBackend {
  readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function stores(storage: StorageBackend = new MemoryStorage()): TransferStores {
  return { saved: createSavedStore(storage), pins: createPinsStore(storage), settings: createSettingsStore(storage) };
}

function item(id: string, fields: Partial<SavedItem> = {}): SavedItem {
  return { id, packages: [`org.example.${id}`], repo: null, savedAt: 100, ...fields };
}

function saved(...items: SavedItem[]): SavedData {
  return { v: 1, items };
}

function modelWith(...ids: string[]) {
  return buildModel(catalog({ apps: ids.map((id) => app({ id, name: id, packages: [`org.example.${id}`], repo: null })) }), 1_800_000_000_000);
}

function entryOf(model: ReturnType<typeof modelWith>, id: string): Entry {
  const found = model.byId.get(id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

function exported(overrides: Partial<Record<keyof ExportFile, unknown>> = {}): string {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: "2026-11-11T10:00:00.000Z",
    catalog: null,
    saved: saved(item("alpha")),
    pins: { v: 1, items: [{ id: "mine", name: "Mine", q: "maps", f: "", sort: "" }] },
    settings: { v: 1, theme: "dark", density: "compact", resume: false },
    ...overrides,
  });
}

function read(text: string) {
  const result = readExport(text);
  if (!result.ok) throw new Error(`unexpected failure: ${result.reason}`);
  return result.file;
}

describe("notes on saved apps", () => {
  test("a note is stored with the time it was written, and clearing it is an edit too", () => {
    const model = modelWith("alpha");
    const store = createSavedStore(new MemoryStorage());
    const list = createSaved(model, store);
    list.toggle(entryOf(model, "alpha"), 100);
    list.setNote(entryOf(model, "alpha"), "  try on the tablet\nfirst ", 150);
    expect(store.value.value.items[0]).toMatchObject({ note: "try on the tablet first", noteAt: 150 });
    expect(list.view.value.notes.get("alpha")).toBe("try on the tablet first");
    list.setNote(entryOf(model, "alpha"), "   ", 180);
    expect(store.value.value.items[0]).toEqual({ id: "alpha", packages: ["org.example.alpha"], repo: null, savedAt: 100, noteAt: 180 });
    expect(list.view.value.notes.has("alpha")).toBe(false);
  });

  test("a note is cut to the limit and cannot be put on an app that is not saved", () => {
    const model = modelWith("alpha", "beta");
    const store = createSavedStore(new MemoryStorage());
    const list = createSaved(model, store);
    list.toggle(entryOf(model, "alpha"), 100);
    list.setNote(entryOf(model, "alpha"), "x".repeat(NOTE_MAX_LENGTH + 50), 150);
    expect(store.value.value.items[0]?.note).toHaveLength(NOTE_MAX_LENGTH);
    list.setNote(entryOf(model, "beta"), "not saved", 160);
    expect(store.value.value.items).toHaveLength(1);
    expect(cleanNote("a\n\n b\t c ")).toBe("a b c");
  });

  test("removing an app and saving it again brings its note back", () => {
    const model = modelWith("alpha");
    const store = createSavedStore(new MemoryStorage());
    const list = createSaved(model, store);
    list.toggle(entryOf(model, "alpha"), 100);
    list.setNote(entryOf(model, "alpha"), "keep me", 120);
    list.toggle(entryOf(model, "alpha"), 200);
    expect(list.view.value.notes.size).toBe(0);
    list.toggle(entryOf(model, "alpha"), 300);
    expect(store.value.value.items).toEqual([{ id: "alpha", packages: ["org.example.alpha"], repo: null, savedAt: 300, note: "keep me", noteAt: 120 }]);
  });

  test("setting the same note again writes nothing", () => {
    const storage = new MemoryStorage();
    const model = modelWith("alpha");
    const list = createSaved(model, createSavedStore(storage));
    list.toggle(entryOf(model, "alpha"), 100);
    list.setNote(entryOf(model, "alpha"), "same", 120);
    const before = storage.getItem(`${STORAGE_PREFIX}saved`);
    list.setNote(entryOf(model, "alpha"), "same", 999);
    expect(storage.getItem(`${STORAGE_PREFIX}saved`)).toBe(before);
  });
});

describe("merging saved apps", () => {
  test("apps only one side has are kept from both", () => {
    const { data, stats } = mergeSaved(saved(item("alpha")), saved(item("beta"), item("gamma", { removedAt: 300 })));
    expect(data.items.map((entry) => entry.id)).toEqual(["alpha", "beta", "gamma"]);
    expect(stats).toEqual({ added: 1, removed: 0, notes: 0 });
  });

  test("for the same app the most recent save or removal wins, whichever side made it", () => {
    const removedLater = mergeSaved(saved(item("alpha", { savedAt: 100 })), saved(item("alpha", { savedAt: 100, removedAt: 500 })));
    expect(removedLater.data.items[0]).toMatchObject({ id: "alpha", removedAt: 500 });
    expect(removedLater.stats).toEqual({ added: 0, removed: 1, notes: 0 });

    const savedAgainHere = mergeSaved(saved(item("alpha", { savedAt: 900 })), saved(item("alpha", { savedAt: 100, removedAt: 500 })));
    expect(savedAgainHere.data.items[0]).toEqual(item("alpha", { savedAt: 900 }));
    expect(savedAgainHere.stats).toEqual({ added: 0, removed: 0, notes: 0 });

    const revived = mergeSaved(saved(item("alpha", { savedAt: 100, removedAt: 200 })), saved(item("alpha", { savedAt: 700 })));
    expect(revived.data.items[0]).toEqual(item("alpha", { savedAt: 700 }));
    expect(revived.stats.added).toBe(1);
  });

  test("the more recently edited note wins, and an edit that cleared the note counts", () => {
    const newerInFile = mergeSaved(saved(item("alpha", { note: "old", noteAt: 10 })), saved(item("alpha", { note: "new", noteAt: 20 })));
    expect(newerInFile.data.items[0]).toMatchObject({ note: "new", noteAt: 20 });
    expect(newerInFile.stats.notes).toBe(1);

    const newerHere = mergeSaved(saved(item("alpha", { note: "mine", noteAt: 30 })), saved(item("alpha", { note: "theirs", noteAt: 20 })));
    expect(newerHere.data.items[0]).toMatchObject({ note: "mine", noteAt: 30 });
    expect(newerHere.stats.notes).toBe(0);

    const clearedLater = mergeSaved(saved(item("alpha", { note: "mine", noteAt: 30 })), saved(item("alpha", { noteAt: 40 })));
    expect(clearedLater.data.items[0]?.note).toBeUndefined();
    expect(clearedLater.data.items[0]?.noteAt).toBe(40);
  });

  test("a note from a file with no edit times is taken only where this device has none", () => {
    const filled = mergeSaved(saved(item("alpha")), saved(item("alpha", { note: "from the file" })));
    expect(filled.data.items[0]?.note).toBe("from the file");
    const kept = mergeSaved(saved(item("alpha", { note: "mine" })), saved(item("alpha", { note: "from the file" })));
    expect(kept.data.items[0]?.note).toBe("mine");
  });

  test("the same app under a new id is recognized by its package, and its keys are pooled", () => {
    const { data } = mergeSaved(
      saved({ id: "old-id", packages: ["org.example.app"], repo: null, savedAt: 100 }),
      saved({ id: "new-id", packages: ["org.example.app", "org.example.app.fdroid"], repo: "https://github.com/example/app", savedAt: 50 }),
    );
    expect(data.items).toEqual([{ id: "old-id", packages: ["org.example.app", "org.example.app.fdroid"], repo: "https://github.com/example/app", savedAt: 100 }]);
  });

  test("a shared repository alone does not make two saved items the same app", () => {
    const repo = "https://github.com/ente-io/ente";
    const { data } = mergeSaved(saved({ id: "photos", packages: [], repo, savedAt: 1 }), saved({ id: "auth", packages: [], repo, savedAt: 2 }));
    expect(data.items.map((entry) => entry.id)).toEqual(["photos", "auth"]);
  });

  test("merging the same file twice changes nothing the second time", () => {
    const incoming = saved(item("alpha", { note: "n", noteAt: 5 }), item("beta", { removedAt: 400 }));
    const once = mergeSaved(saved(item("gamma")), incoming);
    const twice = mergeSaved(once.data, incoming);
    expect(twice.data).toEqual(once.data);
    expect(twice.stats).toEqual({ added: 0, removed: 0, notes: 0 });
  });
});

describe("merging pins and settings", () => {
  const pin = (id: string, fields: Partial<Pin> = {}): Pin => ({ id, name: id, q: "", f: "", sort: "", ...fields });

  test("pins the device lacks are added after its own; the same id or the same question is not added twice", () => {
    const local = { v: 1 as const, items: [pin("a", { f: "shizuku,open" }), pin("b", { q: "maps" })] };
    const incoming = { v: 1 as const, items: [pin("a", { name: "renamed elsewhere" }), pin("x", { f: "open,shizuku" }), pin("y", { q: "Maps " }), pin("z", { q: "notes" })] };
    const merged = mergePins(local, incoming);
    expect(merged.data.items.map((entry) => entry.id)).toEqual(["a", "b", "z"]);
    expect(merged.data.items[0]?.name).toBe("a");
    expect(merged).toMatchObject({ added: 1, dropped: 0 });
  });

  test("pins beyond the limit are left out and counted", () => {
    const local = { v: 1 as const, items: Array.from({ length: MAX_PINS - 1 }, (_, index) => pin(`l${index}`, { q: `local ${index}` })) };
    const incoming = { v: 1 as const, items: [pin("i1", { q: "one" }), pin("i2", { q: "two" }), pin("i3", { q: "three" })] };
    const merged = mergePins(local, incoming);
    expect(merged.data.items).toHaveLength(MAX_PINS);
    expect(merged).toMatchObject({ added: 1, dropped: 2 });
  });

  test("a preference comes from the file only where this device still has the default", () => {
    const local: Settings = { ...DEFAULT_SETTINGS, theme: "light" };
    const merged = mergeSettings(local, { v: 1, theme: "dark", density: "compact", resume: false });
    expect(merged.data).toEqual({ ...DEFAULT_SETTINGS, theme: "light", density: "compact", resume: false });
    expect(merged.applied).toEqual(["density", "resume"]);
  });

  test("every preference that travels in an export is merged, and whether the introduction was seen never is", () => {
    const opposite = { v: 1 as const, theme: "dark" as const, density: "compact" as const, resume: false };
    const merged = mergeSettings({ ...DEFAULT_SETTINGS, introSeen: true }, opposite);
    expect([...merged.applied].sort()).toEqual([...PORTABLE_SETTINGS].sort());
    for (const key of PORTABLE_SETTINGS) expect(merged.data[key]).toBe(opposite[key]);
    expect(merged.data.introSeen).toBe(true);
  });
});

describe("the export file", () => {
  test("holds everything kept on the device, including removals and notes, and reads back the same", () => {
    const all = stores();
    all.saved.update(() => saved(item("alpha", { note: "n", noteAt: 7 }), item("beta", { removedAt: 300 })));
    addPin(all.pins, { id: "mine", name: "Mine", q: "maps", f: "", sort: "" });
    all.settings.update((current) => ({ ...current, theme: "dark", introSeen: true }));
    const file = buildExport(all, Date.UTC(2026, 10, 11, 10), { hash: "abc", generatedAt: "2026-11-11T05:00:00Z" });
    expect(file).toMatchObject({ format: EXPORT_FORMAT, version: 1, exportedAt: "2026-11-11T10:00:00.000Z", catalog: { hash: "abc" } });
    expect(file.settings).toEqual({ v: 1, theme: "dark", density: "comfortable", resume: true });

    const parsed = read(serializeExport(file));
    expect(parsed.saved).toEqual(all.saved.value.value);
    expect(parsed.pins?.items.map((entry) => entry.id)).toEqual(["mine", ...STARTER_PINS.map((entry) => entry.id)]);
    expect(parsed.settings).toEqual(file.settings);
    expect(parsed.skipped).toEqual([]);
  });

  test("the file name carries the local date", () => {
    expect(exportFileName("atlas-export", new Date(2026, 0, 5, 9).getTime())).toBe("atlas-export-2026-01-05.json");
  });
});

describe("reading a file", () => {
  test.each([
    ["an empty file", ""],
    ["text that is not JSON", "saved apps: alpha, beta"],
    ["JSON cut off part-way", exported().slice(0, 80)],
  ])("%s is refused as not JSON", (_label, text) => {
    expect(readExport(text)).toEqual({ ok: false, reason: "not-json" });
  });

  test.each([
    ["JSON that is not an object", "[1, 2, 3]"],
    ["another app's JSON", JSON.stringify({ name: "package", version: "1.0.0" })],
    ["a stored value rather than an export", JSON.stringify(saved(item("alpha")))],
    ["null", "null"],
  ])("%s is refused as not an export", (_label, text) => {
    expect(readExport(text)).toEqual({ ok: false, reason: "not-export" });
  });

  test("a file from a newer version is refused, with nothing read from it", () => {
    expect(readExport(exported({ version: EXPORT_VERSION + 1 }))).toEqual({ ok: false, reason: "newer" });
  });

  test.each([
    ["no version", exported({ version: undefined })],
    ["a version that is not a whole number", exported({ version: "1" })],
    ["a version before the first", exported({ version: 0 })],
  ])("a file with %s is refused as unreadable", (_label, text) => {
    expect(readExport(text)).toEqual({ ok: false, reason: "unreadable" });
  });

  test("a file larger than any export can be is not parsed at all", () => {
    expect(readExport(" ".repeat(MAX_IMPORT_BYTES + 1))).toEqual({ ok: false, reason: "too-large" });
  });

  test("a file from an older version is upgraded step by step before it is read", () => {
    const old = JSON.stringify({ format: EXPORT_FORMAT, version: 1, bookmarks: ["alpha", "beta"] });
    const upgrade1 = (file: Record<string, unknown>) => ({ ...file, version: 2, savedIds: file.bookmarks });
    const upgrade2 = (file: Record<string, unknown>) => ({
      ...file,
      version: 3,
      saved: { v: 1, items: (file.savedIds as string[]).map((id) => ({ id, packages: [], repo: null, savedAt: 1 })) },
    });
    const result = readExport(old, { 1: upgrade1, 2: upgrade2 }, 3);
    expect(result.ok && result.file.saved?.items.map((entry) => entry.id)).toEqual(["alpha", "beta"]);
    expect(readExport(old, { 2: upgrade2 }, 3)).toEqual({ ok: false, reason: "unreadable" });
    expect(readExport(old, { 1: () => { throw new Error("bad file"); }, 2: upgrade2 }, 3)).toEqual({ ok: false, reason: "unreadable" });
  });

  test("a file written before notes and newer preferences existed imports with their defaults", () => {
    const parsed = read(exported({
      saved: { v: 1, items: [{ id: "alpha", savedAt: 5 }] },
      settings: { v: 1, theme: "dark" },
    }));
    expect(parsed.saved?.items).toEqual([{ id: "alpha", packages: [], repo: null, savedAt: 5 }]);
    expect(parsed.settings).toEqual({ v: 1, theme: "dark", density: "comfortable", resume: true });
  });

  test("a file that lacks a section imports the sections it has", () => {
    const parsed = read(exported({ pins: undefined, settings: null }));
    expect(parsed.saved?.items).toHaveLength(1);
    expect(parsed.pins).toBeNull();
    expect(parsed.settings).toBeNull();
    expect(parsed.skipped).toEqual([]);
  });

  test("a section this version cannot read is skipped and named, and the rest is read", () => {
    const parsed = read(exported({ saved: { v: 2, entries: {} }, pins: "none" }));
    expect(parsed.saved).toBeNull();
    expect(parsed.pins).toBeNull();
    expect(parsed.settings?.theme).toBe("dark");
    expect(parsed.skipped).toEqual(["saved apps", "pinned queries"]);
  });

  test("damaged items inside a readable section are dropped one by one", () => {
    const parsed = read(exported({ saved: { v: 1, items: [{ id: "alpha", savedAt: 5, note: 42 }, "junk", { id: "" }, { id: "beta", note: "ok", noteAt: "soon" }] } }));
    expect(parsed.saved?.items).toEqual([
      { id: "alpha", packages: [], repo: null, savedAt: 5 },
      { id: "beta", packages: [], repo: null, savedAt: 0, note: "ok" },
    ]);
  });
});

describe("importing", () => {
  test("an import merges with what is on the device and says what changed", () => {
    const storage = new MemoryStorage();
    const all = stores(storage);
    all.saved.update(() => saved(item("alpha", { note: "mine", noteAt: 50 }), item("local-only")));
    all.settings.update((current) => ({ ...current, theme: "light" }));
    const summary = applyImport(all, read(exported({
      saved: saved(item("alpha", { note: "older", noteAt: 10 }), item("beta", { note: "from file", noteAt: 5 })),
    })));
    expect(all.saved.value.value.items.map((entry) => entry.id)).toEqual(["alpha", "local-only", "beta"]);
    expect(all.saved.value.value.items[0]?.note).toBe("mine");
    expect(all.pins.value.value.items.map((entry) => entry.id)).toEqual([...STARTER_PINS.map((entry) => entry.id), "mine"]);
    expect(all.settings.value.value).toMatchObject({ theme: "light", density: "compact", resume: false });
    expect(summary).toMatchObject({ saved: { added: 1, removed: 0, notes: 1, inFile: 2 }, pins: { added: 1, dropped: 0, inFile: 1 }, settings: ["density", "resume"], notKept: false });
    expect(describeImport(summary)).toBe("Imported: 1 saved app added; 1 note updated; 1 pin added; settings updated.");
    expect(JSON.parse(storage.getItem(`${STORAGE_PREFIX}saved`) ?? "{}").items).toHaveLength(3);
  });

  test("importing the same file again reports that nothing is new", () => {
    const all = stores();
    const file = read(exported());
    applyImport(all, file);
    const again = applyImport(all, file);
    expect(again).toMatchObject({ saved: { added: 0, notes: 0 }, pins: { added: 0 }, settings: [] });
    expect(describeImport(again)).toBe("Nothing new in that file.");
  });

  test("an import merges into what is stored now, not into what this window last read", () => {
    const storage = new MemoryStorage();
    const here = stores(storage);
    const otherWindow = stores(storage);
    otherWindow.saved.update(() => saved(item("saved-in-the-other-window")));
    applyImport(here, read(exported()));
    const stored = JSON.parse(storage.getItem(`${STORAGE_PREFIX}saved`) ?? "{}") as SavedData;
    expect(stored.items.map((entry) => entry.id)).toEqual(["saved-in-the-other-window", "alpha"]);
  });

  test("when the browser keeps nothing, the import still applies for the session and says it will not last", () => {
    const all: TransferStores = { saved: createSavedStore(null), pins: createPinsStore(null), settings: createSettingsStore(null) };
    const summary = applyImport(all, read(exported()));
    expect(all.saved.value.value.items).toHaveLength(1);
    expect(summary.notKept).toBe(true);
    expect(describeImport(summary)).toMatch(/lasts only until the page is closed\.$/);
  });

  test("sections that were skipped are named in the summary", () => {
    const summary = applyImport(stores(), read(exported({ saved: { v: 3 }, pins: undefined, settings: undefined })));
    expect(describeImport(summary)).toBe("Nothing new in that file. Not read: saved apps.");
  });
});

describe("two windows on one storage", () => {
  test("a change made in the other window arrives through the storage event and replaces what this one holds", () => {
    const storage = new MemoryStorage();
    const listeners: ((event: StorageEvent) => void)[] = [];
    const target = { addEventListener: (_type: string, listener: (event: StorageEvent) => void) => listeners.push(listener) } as unknown as Pick<Window, "addEventListener">;
    const here = createSavedStore(storage);
    listenForStorageChanges(target);
    const key = `${STORAGE_PREFIX}saved`;
    storage.setItem(key, JSON.stringify(saved(item("from-the-other-window"))));
    expect(here.value.value.items).toEqual([]);
    for (const listener of listeners) listener({ key } as StorageEvent);
    expect(here.value.value.items.map((entry) => entry.id)).toEqual(["from-the-other-window"]);

    storage.setItem(key, JSON.stringify(saved()));
    for (const listener of listeners) listener({ key: `${STORAGE_PREFIX}unrelated` } as StorageEvent);
    expect(here.value.value.items).toHaveLength(1);
    for (const listener of listeners) listener({ key: null } as StorageEvent);
    expect(here.value.value.items).toEqual([]);
  });

  test("a note written here is not lost when the other window saves another app in between", () => {
    const storage = new MemoryStorage();
    const model = modelWith("alpha", "beta");
    const here = createSaved(model, createSavedStore(storage));
    const there = createSaved(model, createSavedStore(storage));
    here.toggle(entryOf(model, "alpha"), 100);
    there.toggle(entryOf(model, "beta"), 150);
    here.setNote(entryOf(model, "alpha"), "written here", 200);
    const stored = JSON.parse(storage.getItem(`${STORAGE_PREFIX}saved`) ?? "{}") as SavedData;
    expect(stored.items.map((entry) => [entry.id, entry.note])).toEqual([["beta", undefined], ["alpha", "written here"]]);
  });
});
