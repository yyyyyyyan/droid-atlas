import { describe, expect, test } from "vitest";
import { app, catalog, category, listing, sourceCategory } from "./fixtures.ts";
import { buildModel, categoryNotes } from "./model.ts";
import type { App, SourceCategory } from "./schema.ts";

const NOW = Date.parse("2026-11-11T00:00:00Z");
const RISH = "Using rish, you can create a local shell with any terminal.";

const terminals = (overrides: Partial<SourceCategory>): SourceCategory =>
  sourceCategory({ source: "awesome-shizuku", name: "Terminals", section: "Apps", category: "terminals", region: "system", ...overrides });

const filed = (id: string, ...categories: string[]): App => app({
  id, name: id, category: "terminals", region: "system",
  listings: categories.map((categoryId, order) => listing({ name: id, category: categoryId, source: categoryId.startsWith("android-foss") ? "android-foss" : "awesome-shizuku", order })),
});

function notesOf(sourceCategories: SourceCategory[], apps: App[]) {
  const model = buildModel(catalog({
    categories: [category({ id: "terminals", name: "Terminals & Linux", region: "system" })],
    sourceCategories,
    apps,
  }), NOW);
  const view = model.categoryById.get("terminals");
  if (!view) throw new Error("no category");
  return categoryNotes(model, view);
}

describe("a source's note on a category page", () => {
  test("is shown once when two of the source's categories carry the same wording, named once", () => {
    const notes = notesOf(
      [terminals({ id: "awesome-shizuku/terminals", note: RISH }), terminals({ id: "awesome-shizuku/closed-terminals", section: "Closed-source apps", note: RISH })],
      [filed("a", "awesome-shizuku/terminals"), filed("b", "awesome-shizuku/closed-terminals")],
    );
    expect(notes).toEqual([{ text: RISH, source: "awesome-shizuku", on: ["Terminals"] }]);
  });

  test("stands only while every entry on the page is in the source's list the note is on", () => {
    const sources = [terminals({ id: "awesome-shizuku/terminals", note: RISH }), sourceCategory({ id: "android-foss/apps-terminals", name: "Terminals", category: "terminals", region: "system" })];
    expect(notesOf(sources, [filed("a", "awesome-shizuku/terminals")])).toHaveLength(1);
    expect(notesOf(sources, [filed("a", "awesome-shizuku/terminals"), filed("b", "android-foss/apps-terminals")])).toEqual([]);
    expect(notesOf(sources, [filed("a", "awesome-shizuku/terminals"), filed("both", "android-foss/apps-terminals", "awesome-shizuku/terminals")])).toHaveLength(1);
  });

  test("is gone when an app was placed on the page from elsewhere", () => {
    const placed = app({ id: "placed", name: "placed", category: "terminals", region: "system", listings: [listing({ name: "placed" })] });
    expect(notesOf([terminals({ id: "awesome-shizuku/terminals", note: RISH })], [filed("a", "awesome-shizuku/terminals"), placed])).toEqual([]);
  });

  test("two same-named categories with different notes are told apart by their heading", () => {
    const notes = notesOf(
      [terminals({ id: "awesome-shizuku/terminals", note: RISH }), terminals({ id: "awesome-shizuku/closed-terminals", section: "Closed-source apps", note: "These need a license." })],
      [filed("both", "awesome-shizuku/terminals", "awesome-shizuku/closed-terminals")],
    );
    expect(notes.map((note) => note.on)).toEqual([["Apps › Terminals"], ["Closed-source apps › Terminals"]]);
  });
});
