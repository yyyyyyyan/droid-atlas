import { describe, expect, test } from "vitest";
import { app, catalog } from "../catalog/fixtures.ts";
import { buildModel, type Entry } from "../catalog/model.ts";
import { addPin, createPinsStore, removePin, STARTER_PINS } from "./pins.ts";
import { createSaved, createSavedStore, resolveSaved } from "./saved.ts";
import { createSettingsStore, DEFAULT_SETTINGS } from "./settings.ts";
import { createStore, STORAGE_PREFIX, type StorageBackend } from "./storage.ts";

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

const SAVED_KEY = `${STORAGE_PREFIX}saved`;

function modelWith(...ids: string[]) {
  const apps = ids.map((id) => app({ id, name: id, packages: [`org.example.${id}`], repo: { host: "github", url: `https://github.com/example/${id}`, slug: `example/${id}` } }));
  return buildModel(catalog({ apps }), 1_800_000_000_000);
}

function entry(model: ReturnType<typeof modelWith>, id: string): Entry {
  const found = model.byId.get(id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

describe("stores", () => {
  test("missing data gives the initial value and writes nothing", () => {
    const storage = new MemoryStorage();
    const store = createSettingsStore(storage);
    expect(store.value.value).toEqual(DEFAULT_SETTINGS);
    expect(store.status.value).toBe("ok");
    expect(storage.data.size).toBe(0);
  });

  test.each([
    ["not JSON", "{{{"],
    ["JSON of the wrong shape", JSON.stringify(["a", "b"])],
    ["a version that never existed", JSON.stringify({ v: 0, items: [] })],
    ["null", "null"],
  ])("corrupt data (%s) is set aside, reported, and replaced by the initial value", (_label, raw) => {
    const storage = new MemoryStorage();
    storage.setItem(SAVED_KEY, raw);
    const store = createSavedStore(storage);
    expect(store.value.value).toEqual({ v: 1, items: [] });
    expect(store.status.value).toBe("recovered");
    expect(storage.getItem(`${SAVED_KEY}.corrupt`)).toBe(raw);
    store.acknowledge();
    expect(store.status.value).toBe("ok");
  });

  test("data written by a newer version is neither shown, set aside nor overwritten", () => {
    const storage = new MemoryStorage();
    const newer = JSON.stringify({ v: 2, items: [{ key: "shape-this-build-cannot-read" }] });
    storage.setItem(SAVED_KEY, newer);
    const model = modelWith("alpha");
    const store = createSavedStore(storage);
    const saved = createSaved(model, store);
    expect(store.status.value).toBe("newer");
    expect(store.value.value).toEqual({ v: 1, items: [] });
    expect(saved.toggle(entry(model, "alpha"), 100)).toBe(true);
    expect(saved.has("alpha")).toBe(true);
    store.acknowledge();
    expect(store.status.value).toBe("newer");
    expect(storage.getItem(SAVED_KEY)).toBe(newer);
    expect(storage.getItem(`${SAVED_KEY}.corrupt`)).toBeNull();
  });

  test("a refresh that finds newer data keeps what this window holds; one that finds readable data again takes it", () => {
    const storage = new MemoryStorage();
    const store = createPinsStore(storage);
    addPin(store, { id: "mine", name: "Mine", q: "maps", f: "", sort: "" });
    const readable = storage.getItem(`${STORAGE_PREFIX}pins`) ?? "";
    storage.setItem(`${STORAGE_PREFIX}pins`, JSON.stringify({ v: 9, items: [] }));
    store.refresh();
    expect(store.status.value).toBe("newer");
    expect(store.value.value.items[0]?.id).toBe("mine");
    storage.setItem(`${STORAGE_PREFIX}pins`, readable);
    store.refresh();
    expect(store.status.value).toBe("ok");
    expect(store.value.value.items[0]?.id).toBe("mine");
  });

  test("settings stored before a preference existed get that preference's default", () => {
    const storage = new MemoryStorage();
    storage.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify({ v: 1, theme: "light" }));
    const store = createSettingsStore(storage);
    expect(store.status.value).toBe("ok");
    expect(store.value.value).toEqual({ ...DEFAULT_SETTINGS, theme: "light" });
  });

  test("damaged items inside otherwise good data are dropped one by one", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVED_KEY, JSON.stringify({ v: 1, items: [{ id: "a", savedAt: 5 }, { id: "" }, "junk", { id: "a", savedAt: 9 }, { id: "b", packages: "x", removedAt: "never" }] }));
    const store = createSavedStore(storage);
    expect(store.status.value).toBe("ok");
    expect(store.value.value.items).toEqual([
      { id: "a", packages: [], repo: null, savedAt: 5 },
      { id: "b", packages: [], repo: null, savedAt: 0 },
    ]);
  });

  test("storage that throws leaves a working in-memory store and says so", () => {
    const store = createSettingsStore(blocked);
    expect(store.status.value).toBe("unavailable");
    store.update((current) => ({ ...current, density: "compact" }));
    expect(store.value.value.density).toBe("compact");
    const none = createSettingsStore(null);
    expect(none.status.value).toBe("unavailable");
  });

  test("a change is applied to what is stored now, not to what this window last read", () => {
    const storage = new MemoryStorage();
    const tab = createPinsStore(storage);
    const installed = createPinsStore(storage);
    addPin(tab, { id: "from-tab", name: "Tab", q: "a", f: "", sort: "" });
    addPin(installed, { id: "from-app", name: "App", q: "b", f: "", sort: "" });
    const stored = JSON.parse(storage.getItem(`${STORAGE_PREFIX}pins`) ?? "{}") as { items: { id: string }[] };
    expect(stored.items.map((pin) => pin.id).slice(0, 2)).toEqual(["from-app", "from-tab"]);
    expect(tab.value.value.items.some((pin) => pin.id === "from-app")).toBe(false);
    tab.refresh();
    expect(tab.value.value.items.some((pin) => pin.id === "from-app")).toBe(true);
  });

  test("a generic store keeps values the parser accepts and nothing else", () => {
    const storage = new MemoryStorage();
    const store = createStore<number>({ key: "n", parse: (raw) => (typeof raw === "number" ? raw : null), initial: () => 0 }, storage);
    store.update((n) => n + 2);
    expect(storage.getItem(`${STORAGE_PREFIX}n`)).toBe("2");
    storage.setItem(`${STORAGE_PREFIX}n`, "\"two\"");
    store.refresh();
    expect(store.value.value).toBe(0);
    expect(store.status.value).toBe("recovered");
  });
});

describe("saved apps", () => {
  test("saving stores the id with the keys that let it survive an id change", () => {
    const storage = new MemoryStorage();
    const model = modelWith("alpha", "beta");
    const saved = createSaved(model, createSavedStore(storage));
    expect(saved.toggle(entry(model, "alpha"), 100)).toBe(true);
    expect(JSON.parse(storage.getItem(SAVED_KEY) ?? "{}")).toEqual({
      v: 1,
      items: [{ id: "alpha", packages: ["org.example.alpha"], repo: "https://github.com/example/alpha", savedAt: 100 }],
    });
    expect(saved.has("alpha")).toBe(true);
    expect(saved.has("beta")).toBe(false);
  });

  test("the list knows when each entry was saved, the latest save when it was saved again", () => {
    const model = modelWith("alpha", "beta");
    const saved = createSaved(model, createSavedStore(new MemoryStorage()));
    saved.toggle(entry(model, "alpha"), 100);
    saved.toggle(entry(model, "beta"), 200);
    saved.toggle(entry(model, "alpha"), 300);
    saved.toggle(entry(model, "alpha"), 400);
    expect([...saved.view.value.savedAt]).toEqual([["alpha", 400], ["beta", 200]]);
  });

  test("removal is a timestamp, and saving again revives the entry", () => {
    const model = modelWith("alpha");
    const store = createSavedStore(new MemoryStorage());
    const saved = createSaved(model, store);
    saved.toggle(entry(model, "alpha"), 100);
    expect(saved.toggle(entry(model, "alpha"), 200)).toBe(false);
    expect(store.value.value.items).toEqual([{ id: "alpha", packages: ["org.example.alpha"], repo: "https://github.com/example/alpha", savedAt: 100, removedAt: 200 }]);
    expect(saved.view.value.entries).toEqual([]);
    expect(saved.toggle(entry(model, "alpha"), 300)).toBe(true);
    expect(store.value.value.items).toEqual([{ id: "alpha", packages: ["org.example.alpha"], repo: "https://github.com/example/alpha", savedAt: 300 }]);
  });

  test("a removal can be taken back: the entry returns with its note, at the place it had in the list", () => {
    const model = modelWith("alpha", "beta", "gamma");
    const store = createSavedStore(new MemoryStorage());
    const saved = createSaved(model, store);
    saved.toggle(entry(model, "alpha"), 100);
    saved.toggle(entry(model, "beta"), 200);
    saved.toggle(entry(model, "gamma"), 300);
    saved.setNote(entry(model, "beta"), "check exif", 250);
    const before = store.value.value;

    expect(saved.toggle(entry(model, "beta"), 400)).toBe(false);
    expect(saved.view.value.entries.map((item) => item.app.id)).toEqual(["gamma", "alpha"]);
    saved.restore(400);
    expect(store.value.value).toEqual(before);
    expect(saved.view.value.entries.map((item) => item.app.id)).toEqual(["gamma", "beta", "alpha"]);
    expect(saved.view.value.notes.get("beta")).toBe("check exif");

    saved.restore(999);
    expect(store.value.value).toEqual(before);
    saved.forget("alpha", 500);
    expect(saved.has("alpha")).toBe(false);
    saved.restore(500);
    expect(store.value.value).toEqual(before);
  });

  test("the list is most recently saved first", () => {
    const model = modelWith("alpha", "beta", "gamma");
    const saved = createSaved(model, createSavedStore(new MemoryStorage()));
    saved.toggle(entry(model, "beta"), 100);
    saved.toggle(entry(model, "gamma"), 300);
    saved.toggle(entry(model, "alpha"), 200);
    expect(saved.view.value.entries.map((item) => item.app.id)).toEqual(["gamma", "alpha", "beta"]);
  });

  test("a save follows its app through a redirect, a package id and a repository", () => {
    const renamed = buildModel(catalog({
      apps: [
        app({ id: "new-id", name: "Renamed", packages: ["org.example.alpha"], repo: { host: "github", url: "https://github.com/example/alpha", slug: "example/alpha" } }),
        app({ id: "other", name: "Other", packages: ["org.example.other"], repo: { host: "github", url: "https://github.com/example/other", slug: "example/other" } }),
      ],
      redirects: { "redirected-id": "other" },
    }), 0);
    expect(resolveSaved(renamed, { id: "redirected-id", packages: [], repo: null, savedAt: 1 })?.app.id).toBe("other");
    expect(resolveSaved(renamed, { id: "old-id", packages: ["org.example.alpha"], repo: null, savedAt: 1 })?.app.id).toBe("new-id");
    expect(resolveSaved(renamed, { id: "old-id", packages: [], repo: "https://github.com/example/alpha", savedAt: 1 })?.app.id).toBe("new-id");
    expect(resolveSaved(renamed, { id: "old-id", packages: [], repo: null, savedAt: 1 })).toBeNull();
  });

  test("a repository shared by several apps identifies none of them", () => {
    const shared = "https://github.com/ente-io/ente";
    const model = buildModel(catalog({
      apps: [
        app({ id: "photos", name: "Photos", repo: { host: "github", url: shared, slug: "ente-io/ente" } }),
        app({ id: "auth", name: "Auth", repo: { host: "github", url: shared, slug: "ente-io/ente" } }),
      ],
    }), 0);
    expect(resolveSaved(model, { id: "gone", packages: [], repo: shared, savedAt: 1 })).toBeNull();
  });

  test("a saved app that left the catalogs is listed as missing and can be forgotten", () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVED_KEY, JSON.stringify({ v: 1, items: [{ id: "departed", packages: ["org.gone"], repo: null, savedAt: 5 }, { id: "alpha", packages: [], repo: null, savedAt: 9 }] }));
    const model = modelWith("alpha");
    const saved = createSaved(model, createSavedStore(storage));
    expect(saved.view.value.entries.map((item) => item.app.id)).toEqual(["alpha"]);
    expect(saved.view.value.missing.map((item) => item.id)).toEqual(["departed"]);
    saved.forget("departed", 50);
    expect(saved.view.value.missing).toEqual([]);
    expect(JSON.parse(storage.getItem(SAVED_KEY) ?? "{}").items[0]).toMatchObject({ id: "departed", removedAt: 50 });
  });

  test("a save made in the other window is not lost when this window saves", () => {
    const storage = new MemoryStorage();
    const model = modelWith("alpha", "beta");
    const here = createSaved(model, createSavedStore(storage));
    const there = createSaved(model, createSavedStore(storage));
    there.toggle(entry(model, "beta"), 100);
    here.toggle(entry(model, "alpha"), 200);
    expect(here.view.value.entries.map((item) => item.app.id)).toEqual(["alpha", "beta"]);
  });
});

describe("pins", () => {
  test("a first visit starts with the starter pins; removing them all leaves none", () => {
    const storage = new MemoryStorage();
    const store = createPinsStore(storage);
    expect(store.value.value.items.map((pin) => pin.id)).toEqual(STARTER_PINS.map((pin) => pin.id));
    for (const pin of STARTER_PINS) removePin(store, pin.id);
    expect(store.value.value.items).toEqual([]);
    expect(createPinsStore(storage).value.value.items).toEqual([]);
  });

  test("pinning the same query again moves it to the front instead of duplicating it", () => {
    const store = createPinsStore(new MemoryStorage());
    addPin(store, { id: "mine", name: "Mine", q: "maps", f: "", sort: "" });
    addPin(store, { id: "mine", name: "Mine again", q: "maps", f: "", sort: "" });
    expect(store.value.value.items.filter((pin) => pin.id === "mine")).toEqual([{ id: "mine", name: "Mine again", q: "maps", f: "", sort: "" }]);
  });
});
