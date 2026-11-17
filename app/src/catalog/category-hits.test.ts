import { describe, expect, test } from "vitest";
import { categoriesNamed } from "./filters.ts";
import { app, catalog, category, listing, sourceCategory } from "./fixtures.ts";
import { buildModel } from "./model.ts";
import type { App } from "./schema.ts";

const NOW = Date.parse("2026-11-11T00:00:00Z");

const filed = (own: string, count: number, summary = "An app"): App[] => Array.from({ length: count }, (_, index) => app({
  id: `${own}-${index}`, name: `${own} ${index}`, category: own, region: "system",
  summary: { value: summary, origin: "fdroid" },
  listings: [listing({ name: `${own} ${index}` })],
}));

const model = buildModel(catalog({
  categories: [
    category(),
    category({ id: "cloud-sync", name: "Cloud & Sync", region: "system" }),
    category({ id: "notes", name: "Notes", region: "system" }),
    category({ id: "notes-journals", name: "Notes & Journals", region: "system" }),
    category({ id: "file-tools", name: "File Tools", region: "system" }),
    category({ id: "network-tools", name: "Network Tools", region: "system" }),
    category({ id: "developer-tools", name: "Developer Tools", region: "system" }),
    category({ id: "other-system-tools", name: "Other System Tools", region: "system", remainder: true }),
    category({ id: "icon-packs", name: "Icon Packs" }),
  ],
  sourceCategories: [
    sourceCategory(),
    sourceCategory({ id: "android-foss/apps-synchronisation", name: "Synchronisation", category: "cloud-sync", region: "system" }),
  ],
  apps: [
    ...filed("launchers", 3),
    ...filed("cloud-sync", 2),
    ...filed("notes", 1),
    ...filed("notes-journals", 3),
    ...filed("file-tools", 2),
    ...filed("network-tools", 5),
    ...filed("developer-tools", 4),
    ...filed("other-system-tools", 1, "A launcher for your home screen, with wallpapers"),
  ],
}), NOW);

const named = (text: string): string[] => categoriesNamed(model, text).map((hit) => hit.view.category.id);

describe("the categories a search names", () => {
  test("a category's own name, whole or as far as it is typed, from three letters on", () => {
    expect(named("Launchers")).toEqual(["launchers"]);
    expect(named("launch")).toEqual(["launchers"]);
    expect(named("la")).toEqual([]);
    expect(named("")).toEqual([]);
  });

  test("a word that only occurs in apps' summaries names no category, and neither does a category no app is in", () => {
    expect(named("wallpapers")).toEqual([]);
    expect(named("home screen")).toEqual([]);
    expect(named("icon packs")).toEqual([]);
  });

  test("every word must begin a word of one name; a sign between words is not a word", () => {
    expect(named("cloud & sync")).toEqual(["cloud-sync"]);
    expect(named("sync cloud")).toEqual(["cloud-sync"]);
    expect(named("cloud notes")).toEqual([]);
    expect(named("ync")).toEqual([]);
  });

  test("a source's name the category takes in finds it, in either spelling, and says which name", () => {
    expect(categoriesNamed(model, "synchronisation").map((hit) => [hit.view.category.id, hit.by])).toEqual([["cloud-sync", "Synchronisation"]]);
    expect(categoriesNamed(model, "Synchronization").map((hit) => [hit.view.category.id, hit.by])).toEqual([["cloud-sync", "Synchronisation"]]);
    expect(categoriesNamed(model, "sync")[0]?.by).toBeNull();
  });

  test("several: the one named in full first, then the larger, and never more than three", () => {
    expect(named("notes")).toEqual(["notes", "notes-journals"]);
    expect(named("tools")).toEqual(["network-tools", "developer-tools", "file-tools"]);
  });
});
