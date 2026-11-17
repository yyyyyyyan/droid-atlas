import { describe, expect, test } from "vitest";
import { americanSpelling, categoryAnswers, deriveSearch, type AppStatements } from "../../../schema/join.ts";
import { buildVocabulary, matchReason, parseQuery, runQuery } from "./filters.ts";
import { app, catalog, category, listing, sourceCategory } from "./fixtures.ts";
import { buildModel } from "./model.ts";
import type { App } from "./schema.ts";

const NOW = Date.parse("2026-11-11T00:00:00Z");

const SOURCES = [
  sourceCategory(),
  sourceCategory({ id: "android-foss/apps-synchronisation", name: "Synchronisation", category: "cloud-sync", region: "system" }),
  sourceCategory({ id: "android-foss/apps-utilities", name: "Utilities", category: null, region: "system" }),
];
const CLOUD = category({ id: "cloud-sync", name: "Cloud & Sync", region: "system" });
const ANSWERS = categoryAnswers(CLOUD, SOURCES);

/** Search text as the catalog builds it: the names the category answers to are part of it. */
function searchOf(name: string, summary: string, categoryNames: readonly string[]): string {
  const statements: AppStatements = { listings: [listing({ name })], fdroid: null, izzy: null, github: null, packages: [], repoSlug: null, categoryName: () => undefined };
  return deriveSearch(statements, { value: summary, origin: "fdroid" }, categoryNames);
}

const filed = (id: string, name: string, summary: string, source: string, own = "cloud-sync"): App => app({
  id, name, category: own, region: own === "cloud-sync" ? "system" : "personal",
  summary: { value: summary, origin: "fdroid" },
  search: searchOf(name, summary, own === "cloud-sync" ? ANSWERS : ["Launchers"]),
  listings: [listing({ name, category: source })],
});

const model = buildModel(catalog({
  categories: [category(), CLOUD],
  sourceCategories: SOURCES,
  apps: [
    filed("listed", "Nextbox", "A file client", "android-foss/apps-synchronisation"),
    filed("placed", "Linkbox", "Keeps bookmarks", "android-foss/apps-utilities"),
    filed("wordy", "Aaa Home", "Cloud wallpapers for your home screen", "android-foss/launcher", "launchers"),
  ],
}), NOW);
const vocabulary = buildVocabulary(model);
const find = (q: string): string[] => runQuery(vocabulary, model.entries, parseQuery(vocabulary, { q })).map((entry) => entry.app.id);
const entry = (id: string) => {
  const found = model.byId.get(id);
  if (!found) throw new Error(`no ${id}`);
  return found;
};

describe("a category in search", () => {
  test("answers to its own name, to the names of the source categories it takes in, and to their US spelling", () => {
    expect(americanSpelling("Synchronisation")).toBe("Synchronization");
    expect(ANSWERS).toEqual(["Cloud & Sync", "Synchronisation", "Synchronization"]);
    expect(model.categoryById.get("cloud-sync")?.takesIn).toEqual(["Synchronisation"]);
  });

  test("the interface's spelling finds what the source's spelling finds: every app of the category, placed ones too", () => {
    expect(find("synchronisation")).toEqual(["placed", "listed"]);
    expect(find("synchronization")).toEqual(find("synchronisation"));
  });

  test("an app placed out of a source's category still answers to that category's name in both spellings", () => {
    const statements: AppStatements = {
      listings: [listing({ name: "Newsbox", category: "android-foss/apps-synchronisation" })],
      fdroid: null, izzy: null, github: null, packages: [], repoSlug: null,
      categoryName: (id) => SOURCES.find((source) => source.id === id)?.name,
    };
    const text = deriveSearch(statements, null, ["RSS Readers"]);
    expect(text).toContain("synchronisation");
    expect(text).toContain("synchronization");
  });

  test("its own apps come before an app that only has the word in its summary", () => {
    expect(find("cloud")).toEqual(["placed", "listed", "wordy"]);
  });

  test("a row that shows the category's label gets no line for a match in it; a row without the label says where", () => {
    expect(matchReason(entry("listed"), "cloud", model, undefined, true)).toBeNull();
    expect(matchReason(entry("listed"), "cloud", model)).toMatchObject({ where: "Category", hit: "Cloud" });
  });

  test("a match by a name the category takes in says which, in the source's spelling", () => {
    expect(matchReason(entry("listed"), "synchronisation", model, undefined, true)).toMatchObject({ where: "Source category", hit: "Synchronisation" });
    expect(matchReason(entry("placed"), "synchronisation", model, undefined, true)).toMatchObject({ where: "Category includes", hit: "Synchronisation" });
    expect(matchReason(entry("placed"), "synchronization", model, undefined, true)).toEqual({ where: "Category includes", before: "Synchronisation", hit: "", after: "" });
    expect(matchReason(entry("listed"), "synchronization", model, undefined, true)).toEqual({ where: "Source category", before: "Synchronisation", hit: "", after: "" });
  });
});
