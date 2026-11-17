import { describe, expect, test } from "vitest";
import { catalogPlaces } from "../router/browser.ts";
import { buildHash, parseHash } from "../router/route.ts";
import { buildVocabulary, parseQuery, storedQueryName } from "./filters.ts";
import { app, catalog, category, listing, sourceCategory } from "./fixtures.ts";
import { formerCategory } from "./former.ts";
import { buildModel } from "./model.ts";

const NOW = Date.parse("2026-11-11T00:00:00Z");

/**
 * A catalog shaped like the real one after the taxonomy: a source category
 * that maps on its own, two same-named ones of one region that map together
 * (shown as one before, at `system/power-management`), two that went
 * different ways, a catch-all, and one that maps into a category no app is
 * in; and two categories of Droid Atlas's own renamed since, one of whose
 * successors holds no app.
 */
const model = buildModel(catalog({
  regions: [{ id: "personal", name: "Personalization" }, { id: "system", name: "System & Tweaks" }, { id: "work", name: "Productivity" }],
  categories: [
    category(),
    category({ id: "battery-power", name: "Battery & Power", region: "system" }),
    category({ id: "display-tools", name: "Display Tools", region: "system" }),
    category({ id: "notes-journals", name: "Notes & Journals", region: "work" }),
    category({ id: "system-ui-gestures", name: "System UI & Gestures" }),
    category({ id: "scanners-pdf-tools", name: "Scanners & PDF Tools", region: "work" }),
    category({ id: "other-system-tools", name: "Other System Tools", region: "system", remainder: true }),
  ],
  sourceCategories: [
    sourceCategory(),
    sourceCategory({ id: "awesome-shizuku/power-management", source: "awesome-shizuku", name: "Power management", category: "battery-power", region: "system" }),
    sourceCategory({ id: "awesome-shizuku/closed-power-management", source: "awesome-shizuku", name: "Power management", section: "Closed-source apps", category: "battery-power", region: "system" }),
    sourceCategory({ id: "android-foss/apps-tools", name: "Tools…", category: "battery-power", region: "system" }),
    sourceCategory({ id: "awesome-shizuku/tools", source: "awesome-shizuku", name: "Tools", category: "launchers", region: "personal" }),
    sourceCategory({ id: "android-foss/apps-utilities", name: "Utilities", category: null, region: "system" }),
    sourceCategory({ id: "awesome-shizuku/display", source: "awesome-shizuku", name: "Display", category: "display-tools", region: "system" }),
  ],
  apps: [
    app({ id: "launcher", name: "Launcher" }),
    app({ id: "saver", name: "Saver", category: "battery-power", region: "system", listings: [listing({ source: "awesome-shizuku", category: "awesome-shizuku/power-management", name: "Saver" })] }),
    app({ id: "linker", name: "Linker", category: "notes-journals", region: "work", listings: [listing({ category: "android-foss/apps-utilities", name: "Linker" })] }),
    app({ id: "tweaker", name: "Tweaker", category: "system-ui-gestures" }),
  ],
  redirects: { "old-saver": "saver" },
}), NOW);
const vocabulary = buildVocabulary(model);
const places = catalogPlaces(model, vocabulary);
const lands = (hash: string): string => buildHash(places.normalize(parseHash(hash)));

describe("a category of the builds before Droid Atlas's own categories", () => {
  test("a source's category leads to the category it maps into", () => {
    expect(formerCategory(model, "android-foss/launcher")).toEqual({ category: "launchers" });
    expect(formerCategory(model, "awesome-shizuku/closed-power-management")).toEqual({ category: "battery-power" });
  });

  test("a catch-all, and a category whose successor holds no app, lead to their region", () => {
    expect(formerCategory(model, "android-foss/apps-utilities")).toEqual({ region: "system" });
    expect(formerCategory(model, "awesome-shizuku/display")).toEqual({ region: "system" });
  });

  test("same-named categories once shown as one lead to their one successor, or to their region when they went different ways", () => {
    expect(formerCategory(model, "system/power-management")).toEqual({ category: "battery-power" });
    expect(formerCategory(model, "system/tools")).toEqual({ region: "system" });
  });

  test("an id that was never a category leads nowhere", () => {
    expect(formerCategory(model, "nowhere/at-all")).toEqual({});
    expect(formerCategory(model, "launchers")).toEqual({});
  });
});

describe("a category of Droid Atlas's own renamed since", () => {
  test("leads to the category that replaced it", () => {
    expect(formerCategory(model, "interface-tweaks")).toEqual({ category: "system-ui-gestures" });
  });

  test("leads to its successor's region while the successor holds no app", () => {
    expect(formerCategory(model, "pdf-document-tools")).toEqual({ region: "work" });
  });

  test("is replaced at its old address, keeping what the address carried", () => {
    expect(lands("#/cat/interface-tweaks?sort=name")).toBe("#/cat/system-ui-gestures?sort=name");
    expect(lands("#/cat/pdf-document-tools")).toBe("#/region/work");
  });

  test("with a sheet open leads to that app's own category with the sheet", () => {
    expect(lands("#/cat/interface-tweaks?app=tweaker")).toBe("#/cat/system-ui-gestures?app=tweaker");
    expect(lands("#/cat/interface-tweaks?app=old-saver")).toBe("#/cat/battery-power?app=saver");
  });

  test("in a stored search filters by its successor under the successor's name", () => {
    expect(parseQuery(vocabulary, { f: "c:interface-tweaks,r:personal" }).filters).toEqual(["r:personal", "c:system-ui-gestures"]);
    expect(storedQueryName(vocabulary, { f: "c:interface-tweaks" }, "Interface Tweaks")).toBe("System UI & Gestures");
  });

  test("a current id is left as it is, and an unknown one stays as typed", () => {
    expect(lands("#/cat/system-ui-gestures?app=tweaker")).toBe("#/cat/system-ui-gestures?app=tweaker");
    const route = parseHash("#/cat/never-a-category");
    expect(places.normalize(route)).toBe(route);
    expect(places.exists(route)).toBe(false);
  });
});

describe("an old category address", () => {
  test("is replaced by its successor, keeping the sort and the search it carried", () => {
    expect(lands("#/cat/android-foss/launcher")).toBe("#/cat/launchers");
    expect(lands("#/cat/system/power-management?sort=stars&q=save")).toBe("#/cat/battery-power?q=save&sort=stars");
  });

  test("with no single successor is replaced by its region", () => {
    expect(lands("#/cat/android-foss/apps-utilities")).toBe("#/region/system");
  });

  test("with a sheet open leads to that app's own category with the sheet, wherever the app was placed", () => {
    expect(lands("#/cat/android-foss/apps-utilities?app=linker")).toBe("#/cat/notes-journals?app=linker");
    expect(lands("#/cat/awesome-shizuku/power-management?app=old-saver")).toBe("#/cat/battery-power?app=saver");
  });

  test("with the sheet of an app that is gone leads to the category without it", () => {
    expect(lands("#/cat/android-foss/launcher?app=gone")).toBe("#/cat/launchers");
  });

  test("that never was a category stays as typed, and is not found", () => {
    const route = parseHash("#/cat/nowhere/at-all");
    expect(places.normalize(route)).toBe(route);
    expect(places.exists(route)).toBe(false);
  });
});

describe("a stored search that names an old category", () => {
  test("filters by the successor", () => {
    expect(parseQuery(vocabulary, { f: "c:awesome-shizuku/power-management,r:system" }).filters).toEqual(["r:system", "c:battery-power"]);
  });

  test("keeps its name while every filter it was stored with exists", () => {
    expect(storedQueryName(vocabulary, { f: "r:system,c:battery-power" }, "Mine")).toBe("Mine");
    expect(storedQueryName(vocabulary, { q: "save", f: "" }, "Mine")).toBe("Mine");
  });

  test("is named by what it filters now when a filter was replaced or is gone", () => {
    expect(storedQueryName(vocabulary, { f: "r:system,c:awesome-shizuku/power-management" }, "System & Tweaks · Power management")).toBe("System & Tweaks · Battery & Power");
    expect(storedQueryName(vocabulary, { f: "r:system,c:android-foss/apps-utilities" }, "System & Tweaks · Utilities")).toBe("System & Tweaks");
  });

  test("is not shown when nothing of it is left", () => {
    expect(storedQueryName(vocabulary, { f: "c:android-foss/apps-utilities" }, "Utilities")).toBeNull();
  });
});
