import { describe, expect, test } from "vitest";
import {
  allChips,
  antiFeatureLabel,
  measureWidth,
  META_FLOOR,
  metaWidth,
  nameWidth,
  compactTags,
  detailsSource,
  downloadPeriod,
  factsFor,
  hasStatistics,
  isClosedWithPrivilege,
  privilegeWarning,
  rowChips,
  rowLine,
  rowMeasure,
  sharedChipKeys,
  sortNote,
  summaryShown,
  statisticsFor,
  termChips,
} from "./facts.ts";
import {
  GROUPS,
  antiFeatureName,
  antiFeatureNote,
  buildVocabulary,
  countOptions,
  describeQuery,
  effectiveSort,
  markMatches,
  matchReason,
  parseQuery,
  queryId,
  queryParams,
  runQuery,
  searchWords,
  sortDef,
  toggleFilter,
} from "./filters.ts";
import { descriptionBlocks, descriptionSize } from "./description.ts";
import { app, catalog, listing, sourceCategory } from "./fixtures.ts";
import { buildModel, type Entry, type Model } from "./model.ts";
import type { AntiFeature, App } from "./schema.ts";

const NOW = Date.parse("2026-11-11T00:00:00Z");
const DAY = 86_400_000;

function modelOf(apps: App[], redirects: Record<string, string | null> = {}): Model {
  return buildModel(catalog({ apps, redirects }), NOW);
}

function names(entries: readonly Entry[]): string[] {
  return entries.map((entry) => entry.app.name);
}

const shizukuListing = listing({ source: "awesome-shizuku", category: "awesome-shizuku/system", description: "Freezes apps.", tags: ["root", "paid"] });

const APPS: App[] = [
  app({
    id: "launcher-one", name: "Lawnchair", search: "lawnchair launcher home screen",
    facets: { onFdroid: true, noInternet: false, openness: "open-source", noAntiFeatures: true, archived: false, apkOnGithub: true },
    github: { stars: 9000, pushedAt: "2026-11-01T00:00:00Z", archived: false, movedTo: null, forkOf: null, release: { tag: "v15", publishedAt: "2026-11-05T00:00:00Z", hasApk: true } },
    listings: [listing({ name: "Lawnchair", added: "2021-01-01T00:00:00Z" })],
  }),
  app({
    id: "launcher-two", name: "Élan Launcher", search: "elan launcher minimal",
    facets: { noInternet: true, openness: "open-source", noAntiFeatures: false },
    evidence: { noInternet: ["izzy"], openness: [{ value: "open-source", origin: "android-foss" }] },
    index: [{
      origin: "izzy", pkg: "org.elan.launcher", version: "2.0", updatedAt: "2026-01-01T00:00:00Z", addedAt: null, minSdk: 26, targetSdk: 35,
      sizeBytes: 3_000_000, author: "Elan", antiFeatures: ["Tracking", "NonFreeNet"], permissionCount: 4, declaresShizuku: false, declaresInternet: false,
    }],
    github: null,
    listings: [listing({ name: "Élan Launcher", order: 1, added: "2026-10-20T00:00:00Z" })],
  }),
  app({
    id: "freezer", name: "Hail", search: "hail freeze apps launcher shortcuts", category: "system-tools", region: "system",
    facets: { shizuku: true, root: true, paid: true, openness: "closed-source" },
    evidence: {
      shizuku: ["awesome-shizuku", "fdroid"], root: ["awesome-shizuku"],
      openness: [{ value: "closed-source", origin: "awesome-shizuku" }, { value: "open-source", origin: "fdroid" }],
      pricing: [{ value: "iap", origin: "awesome-shizuku" }],
    },
    github: null,
    listings: [shizukuListing],
  }),
  app({
    id: "unknown", name: "Mystery", search: "mystery", category: "system-tools", region: "system",
    github: null,
    listings: [listing({ source: "awesome-shizuku", category: "awesome-shizuku/system", name: "Mystery", order: 1 })],
  }),
];

describe("model", () => {
  const model = modelOf(APPS, { "old-freezer": "freezer", "older-freezer": "old-freezer", gone: null, loop: "loop" });

  test("entries are ordered by name with diacritics folded", () => {
    expect(names(model.entries)).toEqual(["Élan Launcher", "Hail", "Lawnchair", "Mystery"]);
  });

  test("regions and categories come from each app's one category, by name, and empty ones are left out", () => {
    expect(model.regions.map((view) => [view.region.id, view.entries.length])).toEqual([["personal", 2], ["system", 2]]);
    expect(model.categories.map((view) => view.category.id)).toEqual(["launchers", "system-tools"]);
    expect(names(model.categoryById.get("launchers")?.entries ?? [])).toEqual(["Élan Launcher", "Lawnchair"]);
  });

  test("an app listed by two catalogs is in its one category and region, and keeps one primary listing", () => {
    const both = app({
      id: "both", name: "Both",
      listings: [
        listing({ source: "awesome-shizuku", category: "awesome-shizuku/system", name: "Both (Shizuku)" }),
        listing({ source: "android-foss", category: "android-foss/launcher", name: "Both" }),
      ],
    });
    const joined = modelOf([both]);
    const entry = joined.byId.get("both");
    expect(entry?.category?.id).toBe("launchers");
    expect(entry?.listings[0]?.source).toBe("android-foss");
    expect([...(entry?.sources ?? [])].sort()).toEqual(["android-foss", "awesome-shizuku"]);
    expect(joined.categories.map((view) => view.entries.length)).toEqual([1]);
    expect(joined.regions.map((view) => view.region.id)).toEqual(["personal"]);
  });

  test("retired ids resolve through redirects; removed and looping ids resolve to nothing", () => {
    expect(model.resolve("freezer")?.app.id).toBe("freezer");
    expect(model.resolve("older-freezer")?.app.id).toBe("freezer");
    expect(model.resolve("gone")).toBeNull();
    expect(model.resolve("loop")).toBeNull();
    expect(model.resolve("constructor")).toBeNull();
  });

  test("new and fresh are measured against the 90-day window", () => {
    const entry = (id: string): Entry | undefined => model.byId.get(id);
    expect(entry("launcher-two")?.isNew).toBe(true);
    expect(entry("launcher-one")?.isNew).toBe(false);
    expect(entry("launcher-one")?.isFresh).toBe(true);
    expect(entry("launcher-two")?.isFresh).toBe(false);
    expect(entry("launcher-one")?.releaseOrigin).toBe("github");
    expect(entry("unknown")?.releasedAt).toBeNull();
    expect(NOW - (entry("launcher-two")?.addedAt ?? 0)).toBeLessThan(90 * DAY);
  });
});

describe("a long description", () => {
  const SUMMARY = "A trusted assistant for your Android, to keep it clean and tidy.";

  test("loses an opening line that only repeats the summary, whatever its case or closing punctuation", () => {
    const text = `${SUMMARY}\n\nSD Maid finds what apps leave behind.`;
    expect(descriptionBlocks(text, SUMMARY)).toEqual([{ kind: "text", text: "SD Maid finds what apps leave behind." }]);
    expect(descriptionBlocks(`\n  a trusted assistant for your android, to keep it clean and tidy\nMore.`, SUMMARY)).toEqual([{ kind: "text", text: "More." }]);
    expect(descriptionBlocks(text, null)).toHaveLength(2);
    expect(descriptionBlocks(text, "Another summary")).toHaveLength(2);

    const wrapped = [
      "Termux combines powerful terminal emulation with an extensive Linux package",
      "collection.",
      "",
      "Website: https://example.org",
      "Source: https://example.org/source",
    ].join("\n");
    expect(descriptionBlocks(wrapped, null), "a paragraph wrapped at a column is one paragraph; lines kept short on purpose stay apart").toEqual([
      { kind: "text", text: "Termux combines powerful terminal emulation with an extensive Linux package collection." },
      { kind: "text", text: "Website: https://example.org\nSource: https://example.org/source" },
    ]);
    expect(descriptionBlocks("**Anti-uninstall**: Prevents unauthorized removal", null), "the source's own marks are shown, never interpreted").toEqual([
      { kind: "text", text: "**Anti-uninstall**: Prevents unauthorized removal" },
    ]);
    expect(descriptionBlocks(SUMMARY, SUMMARY)).toEqual([]);
  });

  test("becomes paragraphs and lists: lines that begin with a star or a dash are items, a blank line ends a block", () => {
    const text = [
      "Features:",
      "",
      "* Upload and view assets",
      "* Multi-user supported",
      "  across devices",
      "- Auto backup",
      "",
      "Line one",
      "line two",
      "",
      "**Not a bullet**",
      "-not one either",
      "• A dot item",
    ].join("\r\n");
    expect(descriptionBlocks(text, null)).toEqual([
      { kind: "text", text: "Features:" },
      { kind: "list", items: ["Upload and view assets", "Multi-user supported across devices", "Auto backup"] },
      { kind: "text", text: "Line one\nline two" },
      { kind: "text", text: "**Not a bullet**\n-not one either" },
      { kind: "list", items: ["A dot item"] },
    ]);
    expect(descriptionBlocks("", null)).toEqual([]);
    expect(descriptionBlocks("\n\n", SUMMARY)).toEqual([]);
  });

  test("is measured by what there is to read", () => {
    const blocks = descriptionBlocks("One\ntwo\n\n* three\n* four", null);
    expect(descriptionSize(blocks)).toEqual({ characters: 15, lines: 4 });
  });

  test("is never markup: tags stay text", () => {
    expect(descriptionBlocks("<b>Bold</b> <script>alert(1)</script>", null)).toEqual([{ kind: "text", text: "<b>Bold</b> <script>alert(1)</script>" }]);
  });
});

describe("Droid Atlas categories", () => {
  const remainder = app({
    id: "leftover", name: "Leftover", category: "other-system-tools", region: "system",
    listings: [listing({ source: "awesome-shizuku", category: "awesome-shizuku/system", name: "Leftover", order: 2 })],
  });

  test("a category with no app, a remainder above all, is in no list, chip, filter or count", () => {
    const model = modelOf(APPS);
    expect(model.categoryById.has("other-system-tools")).toBe(false);
    expect(model.categoryById.has("system-ui-gestures")).toBe(false);
    expect(model.regionById.get("system")?.categories.map((view) => view.category.id)).toEqual(["system-tools"]);
    const vocabulary = buildVocabulary(model);
    expect(vocabulary.byKey.has("c:other-system-tools")).toBe(false);
    expect(model.regions.reduce((sum, view) => sum + view.entries.length, 0)).toBe(APPS.length);
  });

  test("a remainder shows once it holds an app, after the region's other categories", () => {
    const model = modelOf([...APPS, remainder, { ...remainder, id: "leftover-2", name: "Leftover 2" }]);
    expect(model.regionById.get("system")?.categories.map((view) => [view.category.id, view.entries.length])).toEqual([["system-tools", 2], ["other-system-tools", 2]]);
    expect(buildVocabulary(model).byKey.has("c:other-system-tools")).toBe(true);
  });

  test("a filter naming a category the catalog lacks is dropped, and one naming a source's category is read as its successor", () => {
    const vocabulary = buildVocabulary(modelOf(APPS));
    expect(parseQuery(vocabulary, { f: "c:android-foss/launcher,c:system/automation,c:launchers" }).filters).toEqual(["c:launchers"]);
  });

  test("a search that matches an entry's own category is marked in the row's label, and says so only where the row has no label", () => {
    const model = modelOf(APPS);
    const entry = model.byId.get("freezer");
    if (!entry) throw new Error("no freezer");
    expect(matchReason(entry, "system", model)?.where).toBe("Category");
    expect(matchReason(entry, "system", model, undefined, true)).toBeNull();
  });
});

describe("filters", () => {
  const model = modelOf(APPS);
  const vocabulary = buildVocabulary(model);
  const run = (params: Record<string, string>): string[] => names(runQuery(vocabulary, model.entries, parseQuery(vocabulary, params)));

  test("a fact is offered only when some entry carries it", () => {
    expect(vocabulary.byKey.has("shizuku")).toBe(true);
    expect(vocabulary.byKey.has("stale")).toBe(false);
    expect(vocabulary.byKey.has("source-available")).toBe(false);
    expect(vocabulary.lenses.map((lens) => lens.key)).toEqual(["shizuku", "root", "no-internet", "fdroid", "apk", "clean", "new", "fresh"]);
  });

  test("a facet no source states matches neither the fact nor its opposite", () => {
    expect(run({ f: "no-internet" })).toEqual(["Élan Launcher"]);
    expect(run({ f: "clean" })).toEqual(["Lawnchair"]);
    expect(run({ f: "anti" })).toEqual(["Élan Launcher"]);
    expect(run({ f: "active" })).toEqual(["Lawnchair"]);
    expect(run({ f: "clean" })).not.toContain("Mystery");
    expect(run({ f: "anti" })).not.toContain("Mystery");
  });

  test("facts narrow; choices inside one group widen", () => {
    expect(run({ f: "shizuku,root" })).toEqual(["Hail"]);
    expect(run({ f: "shizuku,no-internet" })).toEqual([]);
    expect(run({ f: "open,closed" })).toEqual(["Élan Launcher", "Hail", "Lawnchair"]);
    expect(run({ f: "r:personal,c:system-tools" })).toEqual(["Élan Launcher", "Hail", "Lawnchair", "Mystery"]);
    expect(run({ f: "r:personal,open,no-internet" })).toEqual(["Élan Launcher"]);
    expect(run({ f: "s:awesome-shizuku" })).toEqual(["Hail", "Mystery"]);
  });

  test("search puts name matches first and folds diacritics", () => {
    expect(run({ q: "launcher" })).toEqual(["Élan Launcher", "Lawnchair", "Hail"]);
    expect(run({ q: "elan" })).toEqual(["Élan Launcher"]);
    expect(run({ q: "ÉLAN" })).toEqual(["Élan Launcher"]);
    expect(run({ q: "la" })).toEqual(["Lawnchair", "Élan Launcher", "Hail"]);
    expect(run({ q: "launcher minimal" })).toEqual(["Élan Launcher"]);
    expect(run({ q: "nothing-matches-this" })).toEqual([]);
  });

  test("sorts put entries without the value last", () => {
    expect(run({ sort: "stars" })).toEqual(["Lawnchair", "Élan Launcher", "Hail", "Mystery"]);
    expect(run({ sort: "release" })).toEqual(["Lawnchair", "Élan Launcher", "Hail", "Mystery"]);
    expect(run({ sort: "added" })).toEqual(["Élan Launcher", "Lawnchair", "Hail", "Mystery"]);
  });

  test("the default sort is best match with text, the list's own order otherwise", () => {
    expect(effectiveSort(parseQuery(vocabulary, { q: "x" }))).toBe("match");
    expect(effectiveSort(parseQuery(vocabulary, {}))).toBe("name");
    expect(effectiveSort(parseQuery(vocabulary, {}), { natural: "saved" })).toBe("saved");
    expect(effectiveSort(parseQuery(vocabulary, { sort: "match" }))).toBe("name");
    expect(effectiveSort(parseQuery(vocabulary, { sort: "saved" }))).toBe("name");
    const reversed = [...model.entries].reverse();
    expect(names(runQuery(vocabulary, reversed, parseQuery(vocabulary, {}), { natural: "saved" }))).toEqual(names(reversed));
  });

  test("the query round-trips through its URL parameters in canonical order", () => {
    const query = parseQuery(vocabulary, { q: "two words", f: "r:system,bogus,root,shizuku,root", sort: "stars" });
    expect(query.filters).toEqual(["shizuku", "root", "r:system"]);
    expect(queryParams(query)).toEqual({ q: "two words", f: "shizuku,root,r:system", sort: "stars" });
    expect(parseQuery(vocabulary, { sort: "sideways" }).sort).toBeNull();
    expect(queryParams(parseQuery(vocabulary, {}))).toEqual({ q: null, f: null, sort: null });
  });

  test("tokens a page implies are dropped from its query", () => {
    expect(parseQuery(vocabulary, { f: "shizuku,root" }, ["shizuku"]).filters).toEqual(["root"]);
  });

  test("toggling keeps canonical order, and identity ignores case of the text", () => {
    const start = parseQuery(vocabulary, { f: "root" });
    const added = toggleFilter(vocabulary, start, "shizuku");
    expect(added.filters).toEqual(["shizuku", "root"]);
    expect(toggleFilter(vocabulary, added, "root").filters).toEqual(["shizuku"]);
    expect(queryId(parseQuery(vocabulary, { q: " Maps " }))).toBe(queryId(parseQuery(vocabulary, { q: "maps" })));
    expect(queryId(parseQuery(vocabulary, { q: "maps" }))).not.toBe(queryId(parseQuery(vocabulary, { q: "maps", sort: "stars" })));
    expect(describeQuery(vocabulary, parseQuery(vocabulary, { q: "maps", f: "shizuku" }))).toBe("Shizuku · “maps”");
  });

  test("option counts say what switching each token on would give", () => {
    const query = parseQuery(vocabulary, { f: "open" });
    const counts = countOptions(vocabulary, model.entries, query, ["shizuku", "no-internet", "open", "closed", "r:system"]);
    expect(Object.fromEntries(counts)).toEqual({ shizuku: 0, "no-internet": 1, open: 2, closed: 1, "r:system": 0 });
    const text = countOptions(vocabulary, model.entries, parseQuery(vocabulary, { q: "launcher" }), ["shizuku", "r:personal"]);
    expect(Object.fromEntries(text)).toEqual({ shizuku: 1, "r:personal": 2 });
  });

  test("a result says where the search matched only when the row itself does not show it", () => {
    const entry = (id: string): Entry => {
      const found = model.byId.get(id);
      if (!found) throw new Error(`no entry ${id}`);
      return found;
    };
    const found = modelOf([
      app({
        id: "one", name: "Tidy", summary: { value: "Keeps folders in order", origin: "fdroid" }, packages: ["org.example.tidy"],
        repo: { host: "github", url: "https://github.com/broomworks/tidy", slug: "broomworks/tidy" },
        listings: [
          listing({ name: "Tidy", description: "A small helper that sorts downloads into folders by kind, and empties the recycle bin on a schedule you choose." }),
          listing({ source: "awesome-shizuku", category: "awesome-shizuku/system", name: "Tidy Up", order: 1 }),
        ],
      }),
    ]).entries[0];
    if (!found) throw new Error("no entry");

    expect(matchReason(entry("launcher-one"), "lawnchair")).toBeNull();
    expect(matchReason(found, "folders order")).toBeNull();
    expect(matchReason(found, "")).toBeNull();
    expect(matchReason(found, "recycle")).toEqual({ where: "Description", before: "…and empties the ", hit: "recycle", after: " bin on a schedule you choose." });
    expect(matchReason(found, "tidy helper")).toMatchObject({ where: "Description", before: "A small ", hit: "helper" });
    expect(matchReason(found, "up")).toMatchObject({ where: "Also listed as", before: "Tidy ", hit: "Up", after: "" });
    expect(matchReason(found, "org.example")).toMatchObject({ where: "Package", hit: "org.example" });
    expect(matchReason(found, "broomworks")).toMatchObject({ where: "Repository", before: "", hit: "broomworks", after: "/tidy" });
    expect(matchReason(found, "launcher")).toMatchObject({ where: "Category", hit: "Launcher" });
    expect(matchReason(found, "system")).toBeNull();
    const sources = { sourceCategoryById: new Map([["awesome-shizuku/system", sourceCategory({ name: "System tweaks" })]]), categoryById: new Map() };
    expect(matchReason(found, "tweaks", sources)).toMatchObject({ where: "Source category", before: "System ", hit: "tweaks" });
    expect(matchReason(entry("launcher-two"), "elan")).toBeNull();

    const long = modelOf([app({ id: "long", name: "Long", summary: { value: `${"Words that fill the first line and the second of a row. ".repeat(2)}Then a rare one: zeppelin.`, origin: "fdroid" } })]).entries[0];
    if (!long) throw new Error("no entry");
    expect(matchReason(long, "words")).toBeNull();
    expect(matchReason(long, "zeppelin")).toMatchObject({ where: "Summary", hit: "zeppelin" });
    expect(matchReason(long, "zeppelin", undefined, 200), "a row wide enough to show the word says nothing more").toBeNull();
    expect(matchReason(long, "second", undefined, 30)).toMatchObject({ where: "Summary", hit: "second" });
  });

  test("how much of a summary a row shows follows the width of the row and the lines it gives the summary", () => {
    const text = "Open-source workstation with native windows, external displays, desktops and terminal integration";
    expect(summaryShown("Terminal emulator", 258, 2)).toBe(17);
    expect(summaryShown(text, 2000, 1)).toBe(text.length);
    const two = summaryShown(text, 258, 2);
    const one = summaryShown(text, 258, 1);
    expect(one).toBeGreaterThan(25);
    expect(one).toBeLessThan(45);
    expect(two).toBeGreaterThan(one + 25);
    expect(two).toBeLessThan(text.length);
    expect(summaryShown(text, 194, 2)).toBeLessThan(two);
    expect(summaryShown(text, 420, 2)).toBe(text.length);
  });

  test("the words of a search are marked where they begin a word, and inside words only when nowhere else", () => {
    const marks = (text: string, query: string): string => markMatches(text, searchWords(query)).map((part) => (part.hit ? `[${part.text}]` : part.text)).join("");
    expect(marks("Signal-Foss", "sig")).toBe("[Sig]nal-Foss");
    expect(marks("Material Design, with a signature look", "sig")).toBe("Material Design, with a [sig]nature look");
    expect(marks("Material Design for all", "sig")).toBe("Material De[sig]n for all");
    expect(marks("Élan Launcher", "elan lau")).toBe("[Élan] [Lau]ncher");
    expect(marks("org.fossify.gallery", "fossify")).toBe("org.[fossify].gallery");
    expect(marks("Music  player, music box", "music")).toBe("[Music]  player, [music] box");
    expect(marks("Nothing here", "absent")).toBe("Nothing here");
    expect(marks("Anything", "")).toBe("Anything");
    expect(marks("", "word")).toBe("");
    expect(markMatches("Offﬁce suite", ["ffi"]).filter((part) => part.hit).map((part) => part.text)).toEqual(["fﬁ"]);
  });

  test("best match ranks a word that begins a word above the same letters inside one", () => {
    const ranked = modelOf([
      app({ id: "a", name: "Amaze", search: "amaze file manager with material design", summary: { value: "File manager with Material Design", origin: "fdroid" } }),
      app({ id: "b", name: "Design Lab", summary: { value: "Sketches", origin: "fdroid" } }),
      app({ id: "c", name: "Verifier", search: "verifier checks an apk signature", summary: { value: "Checks an APK signature", origin: "fdroid" } }),
      app({ id: "d", name: "Signal-Foss", summary: { value: "Messenger", origin: "fdroid" } }),
      app({ id: "e", name: "Open Sigma", summary: { value: "Statistics", origin: "fdroid" } }),
      app({ id: "f", name: "Keys", search: "keys org.example.sigtool", packages: ["org.example.sigtool"], summary: { value: "Key store", origin: "fdroid" } }),
      app({ id: "g", name: "Sig", summary: { value: "Short", origin: "fdroid" } }),
    ]);
    const words = buildVocabulary(ranked);
    expect(names(runQuery(words, ranked.entries, parseQuery(words, { q: "sig" })))).toEqual(["Sig", "Signal-Foss", "Open Sigma", "Verifier", "Keys", "Design Lab", "Amaze"]);
    expect(names(runQuery(words, ranked.entries, parseQuery(words, { q: "open sig" })))).toEqual(["Open Sigma"]);
  });
});

describe("facts", () => {
  const ANTI_FEATURES: AntiFeature[] = [
    { id: "NonFreeNet", name: "Non-Free Network Services", definitions: [{ origin: "fdroid", name: "Non-Free Network Services", description: "This app promotes or depends entirely on a non-free network service" }] },
    {
      id: "Tracking", name: "Tracking",
      definitions: [
        { origin: "fdroid", name: "Tracking", description: "This app tracks and reports your activity" },
        { origin: "izzy", name: "Tracking", description: "This app tracks and reports your activity to somewhere, even if it can be turned off." },
      ],
    },
  ];
  const model = buildModel(catalog({ apps: APPS, antiFeatures: ANTI_FEATURES }), NOW);
  const hail = model.byId.get("freezer") as Entry;
  const elan = model.byId.get("launcher-two") as Entry;
  const lawnchair = model.byId.get("launcher-one") as Entry;
  const mystery = model.byId.get("unknown") as Entry;
  const none: ReadonlySet<string> = new Set();
  const texts = (chips: { text: string }[]): string[] => chips.map((chip) => chip.text);

  test("closed-source, paid and privileged-access labels always show, whatever the page or a filter already says", () => {
    expect(texts(termChips(hail))).toEqual(["Closed source", "In-app buys", "Root", "Shizuku"]);
    expect(texts(rowChips(model, hail, none))).toEqual(["Closed source", "In-app buys", "Root"]);
    expect(rowChips(model, hail, new Set(["shizuku", "root", "closed", "paid"])).map((chip) => chip.key)).toEqual(["closed", "paid", "root"]);
  });

  test("closed source with privileged access is raised above an ordinary caution, and the sheet says why", () => {
    expect(isClosedWithPrivilege(hail)).toBe(true);
    expect(termChips(hail)[0]).toMatchObject({ key: "closed", tone: "alert" });
    expect(privilegeWarning(hail)).toBe("Closed source, with root and Shizuku access.");
    expect(privilegeWarning({ ...hail, app: { ...hail.app, facets: { ...hail.app.facets, root: false } } })).toBe("Closed source, with ADB-level access through Shizuku.");
    expect(privilegeWarning({ ...hail, app: { ...hail.app, facets: { ...hail.app.facets, shizuku: false } } })).toBe("Closed source, with root access.");

    const closedOnly = { ...hail, app: { ...hail.app, facets: { ...hail.app.facets, shizuku: false, root: false } } };
    expect(isClosedWithPrivilege(closedOnly)).toBe(false);
    expect(termChips(closedOnly)[0]).toMatchObject({ key: "closed", tone: "caution" });
    expect(privilegeWarning(closedOnly)).toBeNull();
    expect(privilegeWarning(elan)).toBeNull();
    expect(privilegeWarning(mystery)).toBeNull();
  });

  test("an archived project is labeled on every row, even when the list is already filtered to archived ones", () => {
    const archived = { ...hail, app: { ...hail.app, facets: { ...hail.app.facets, archived: true } } };
    expect(rowChips(model, archived, new Set(["archived"])).map((chip) => [chip.text, chip.title]).at(-1)).toEqual(["Root +1", "Also: Archived"]);
    const short = { ...archived, app: { ...archived.app, facets: { ...archived.app.facets, paid: false, root: false } } };
    expect(texts(rowChips(model, short, new Set(["archived"])))).toEqual(["Closed source", "Archived", "Shizuku"]);
    const unstated = { ...hail, app: { ...hail.app, facets: { ...hail.app.facets, archived: null } } };
    expect(termChips(unstated).some((chip) => chip.key === "archived")).toBe(false);
  });

  test("an anti-feature is named in plain words, never by the index's key", () => {
    expect(texts(rowChips(model, elan, none))).toEqual(["Tracking +1", "No internet"]);
    expect(rowChips(model, elan, none)[0]?.title).toBe("Anti-features: Tracking; Non-free network services");
    expect(antiFeatureLabel(model, "NonFreeNet")).toBe("Non-free network services");
    expect(antiFeatureLabel(model, "SomethingNew")).toBe("SomethingNew");
    for (const entry of model.entries) {
      for (const chip of allChips(model, entry)) expect(chip.text).not.toMatch(/NonFree|TetheredNet|NoSourceSince/);
    }
  });

  test("a row skips the plain facts the page or the whole list already states, and shows nothing for an entry nobody describes", () => {
    expect(texts(rowChips(model, elan, new Set(["no-internet"])))).toEqual(["Tracking +1"]);
    expect(rowChips(model, mystery, none)).toEqual([]);
  });

  test("a row's line is what the list's width leaves beside the icon and the save button", () => {
    expect(rowLine(384)).toBe(258);
    expect(rowLine(336)).toBe(210);
    expect(rowLine(320)).toBe(194);
    expect(rowLine(600, true)).toBe(466);
    expect(rowLine(0)).toBeGreaterThan(100);
  });

  test("chips are chosen to fit beside the category's whole name: a plain fact that does not fit is left out, at any width", () => {
    const beside = (width: number, category: string): number => rowLine(width) - metaWidth(category);
    expect(texts(rowChips(model, elan, none, beside(384, "Launcher")))).toEqual(["Tracking +1", "No internet"]);
    expect(texts(rowChips(model, elan, none, beside(320, "Launcher")))).toEqual(["Tracking +1"]);
    expect(rowChips(model, lawnchair, none, beside(320, "Podcast & Audio Book Player")).filter((chip) => chip.tone === "neutral" || chip.tone === "good")).toEqual([]);
  });

  test("a caution is never left out: the first is shown where it does not fit, and the rest are counted", () => {
    const long = "Podcast & Audio Book Player";
    const fit = (width: number, entry: Entry) => rowChips(model, entry, none, rowLine(width) - metaWidth(long), rowLine(width) - META_FLOOR);
    expect(texts(fit(384, elan))).toEqual(["Tracking +1"]);
    const crowded = fit(384, hail);
    expect(crowded[0]?.text).toBe("Closed source");
    expect(crowded.at(-1)?.text).toMatch(/^\+\d$/);
    expect(crowded.at(-1)?.title).toContain("Root");
    expect(crowded).toHaveLength(2);
    expect(fit(320, hail).map((chip) => [chip.text, chip.title])).toEqual([
      ["Closed source +2", "Also: In-app buys, Root"],
    ]);

    const stale = { ...elan, app: { ...elan.app, facets: { ...elan.app.facets, staleLink: true } } };
    expect(rowChips(model, stale, none, 100).map((chip) => [chip.text, chip.title])).toEqual([
      ["Tracking +2", "Anti-features: Tracking; Non-free network services. Also: Stale link"],
    ]);
  });

  test("a compact row leaves out the labels that would run past its line, and never the first", () => {
    expect(texts(compactTags(model, hail, none))).toHaveLength(3);
    expect(texts(compactTags(model, hail, none, 3, 200))).toEqual(texts(compactTags(model, hail, none)).slice(0, 2));
    expect(texts(compactTags(model, hail, none, 3, 10))).toEqual(texts(compactTags(model, hail, none)).slice(0, 1));
  });

  test("a caution too long for a narrow row is said shorter, and one that fits nowhere is counted; it is never cut and never dropped", () => {
    const wordy = { ...elan, antiFeatures: ["NonFreeNet", "Tracking"] };
    const named = rowChips(model, wordy, none, 40, 200);
    expect(named[0]?.text).toBe(allChips(model, wordy).find((chip) => chip.key === "anti")?.text);
    const brief = rowChips(model, wordy, none, 40, 120);
    expect(brief.map((chip) => [chip.text, chip.title])).toEqual([["Anti-features 2", "Anti-features: Non-free network services; Tracking"]]);
    expect(texts(rowChips(model, { ...elan, antiFeatures: ["NonFreeNet"] }, none, 40, 95))).toEqual(["Anti-feature"]);
    expect(rowChips(model, wordy, none, 40, 60).map((chip) => [chip.text, chip.tone])).toEqual([["1 caution", "caution"]]);
    expect(texts(rowChips(model, hail, none, 40, 60))).toEqual(["3 cautions"]);
    expect(rowChips(model, hail, none, 40, 60)[0]?.title).toBe("Closed source, In-app buys, Root");
  });

  test("a name is measured before it is laid out, so one that does not fit a line can take two", () => {
    const long = "android-realtime-voice-isolation";
    expect(nameWidth(long)).toBeLessThanOrEqual(rowLine(384));
    expect(nameWidth(long)).toBeGreaterThan(rowLine(336));
    expect(nameWidth("AntennaPod")).toBeLessThan(rowLine(320));
    expect(nameWidth("WWWWMMMM")).toBeGreaterThan(nameWidth("iiiillll"));
    expect(nameWidth("开源阅读器")).toBeGreaterThan(nameWidth("abcde"));
    expect(nameWidth("")).toBe(0);
  });

  test("a plain fact every entry of a list shares is not repeated on its rows; a caution always is", () => {
    const shizuku = (id: string, extra: Partial<App["facets"]> = {}): App => app({ id, name: id, github: null, facets: { shizuku: true, ...extra } });
    const all = buildModel(catalog({ apps: [shizuku("a"), shizuku("b"), shizuku("c", { openness: "closed-source" })] }), NOW);
    expect([...sharedChipKeys(all, all.entries)]).toEqual(["shizuku"]);
    const closed = buildModel(catalog({ apps: [shizuku("a", { openness: "closed-source" }), shizuku("b", { openness: "closed-source" })] }), NOW);
    expect([...sharedChipKeys(closed, closed.entries)]).toEqual(["shizuku"]);
    expect([...sharedChipKeys(all, all.entries.slice(0, 1))]).toEqual([]);
    expect([...sharedChipKeys(model, model.entries)]).toEqual([]);
  });

  test("a compact row carries at most three worded labels: cautions, then access, then where to get it", () => {
    expect(texts(compactTags(model, hail, none))).toEqual(["Closed source", "In-app buys", "Root"]);
    expect(texts(compactTags(model, lawnchair, none))).toEqual(["F-Droid"]);
    expect(texts(compactTags(model, lawnchair, new Set(["fdroid"])))).toEqual([]);
    expect(compactTags(model, mystery, none)).toEqual([]);
  });

  test("every detail names who states it, and sources that disagree share one row that shows both answers", () => {
    const facts = factsFor(model, hail);
    expect(facts.every((fact) => fact.lines.length > 0 && fact.lines.every((line) => line.sources.length > 0 || line.value === "Unknown"))).toBe(true);
    expect(new Set(facts.map((fact) => fact.key)).size).toBe(facts.length);
    const lines = (label: string): [string, string[]][] => facts.filter((fact) => fact.label === label).flatMap((fact) => fact.lines.map((line): [string, string[]] => [line.value, line.sources]));
    expect(facts.filter((fact) => fact.label === "Code")).toHaveLength(1);
    expect(lines("Code")).toEqual([["Closed source", ["awesome-shizuku"]], ["Open source", ["F-Droid"]]]);
    expect(facts.filter((fact) => fact.label === "Shizuku")).toHaveLength(1);
    expect(lines("Shizuku")).toEqual([["Requests the permission", ["F-Droid"]], ["Listed", ["awesome-shizuku"]]]);
    expect(lines("Root")).toEqual([["Uses root access", ["awesome-shizuku"]]]);
    expect(lines("Price")).toEqual([["In-app purchases", ["awesome-shizuku"]]]);
  });

  test("an entry no source describes has no detail that could read as a claim: what no index states is “Unknown”, with nobody named", () => {
    expect(factsFor(model, mystery).map((fact) => [fact.label, fact.lines.map((line) => [line.value, line.sources])])).toEqual([
      ["Permissions", [["Unknown", []]]],
      ["Anti-features", [["Unknown", []]]],
    ]);
    expect(detailsSource(factsFor(model, mystery))).toBeNull();
    expect(detailsSource(factsFor(model, hail))).toBe("awesome-shizuku");
    const facts = factsFor(model, elan);
    expect(facts.find((fact) => fact.label === "Network")?.lines).toMatchObject([{ value: "No internet permission", sources: ["IzzyOnDroid"] }]);
  });

  test("an anti-feature is explained by the definition of the index that flags it", () => {
    const flagged = factsFor(model, elan).filter((fact) => fact.label === "Anti-feature").flatMap((fact) => fact.lines);
    expect(flagged.map((line) => [line.value, line.detail, line.sources])).toEqual([
      ["Tracking", "This app tracks and reports your activity to somewhere, even if it can be turned off", ["IzzyOnDroid"]],
      ["Non-free network services", "This app promotes or depends entirely on a non-free network service", ["IzzyOnDroid"]],
    ]);
  });

  test("two indexes that agree are one line naming both, and two that differ are two lines of one row", () => {
    const index = (origin: "fdroid" | "izzy", sizeBytes: number) => ({
      origin, pkg: "org.example.app", version: "1.2", updatedAt: "2026-11-01T00:00:00Z", addedAt: null, minSdk: 26, targetSdk: null,
      sizeBytes, author: null, antiFeatures: [], permissionCount: 3, declaresShizuku: false, declaresInternet: true,
    });
    const both = modelOf([app({ id: "both", index: [index("fdroid", 93 * 1_048_576), index("izzy", 22 * 1_048_576)], github: null })]);
    const facts = factsFor(both, both.byId.get("both") as Entry);
    expect(facts.find((fact) => fact.label === "Permissions")?.lines).toMatchObject([{ value: "3", sources: ["F-Droid", "IzzyOnDroid"] }]);
    expect(detailsSource(facts)).toBe("F-Droid, IzzyOnDroid");
    expect(facts.find((fact) => fact.label === "Requires")?.lines).toMatchObject([{ value: "Android 8.0+", sources: ["F-Droid", "IzzyOnDroid"] }]);
    expect(facts.filter((fact) => fact.label === "APK size")).toHaveLength(1);
    expect(facts.find((fact) => fact.label === "APK size")?.lines.map((line) => [line.value, line.sources])).toEqual([["93\u00a0MB", ["F-Droid"]], ["22\u00a0MB", ["IzzyOnDroid"]]]);
    expect(facts.some((fact) => fact.label === "Version" || fact.label === "Last release" || fact.label === "Download")).toBe(false);
  });
});

describe("statistics and the value a sorted row shows", () => {
  const downloads = [
    { origin: "fdroid" as const, count: 12_340, from: "2026-10-13", to: "2026-11-11" },
    { origin: "github" as const, count: 987, from: null, to: null },
  ];
  const subject = app({
    id: "counted", name: "Counted",
    index: [
      { origin: "fdroid", pkg: "org.counted", version: "12.19.0", updatedAt: "2026-11-09T00:00:00Z", addedAt: null, minSdk: null, targetSdk: null, sizeBytes: null, author: null, antiFeatures: [], permissionCount: 1, declaresShizuku: false, declaresInternet: true },
      { origin: "izzy", pkg: "org.counted", version: "12.20.0", updatedAt: "2026-11-10T00:00:00Z", addedAt: null, minSdk: null, targetSdk: null, sizeBytes: null, author: null, antiFeatures: [], permissionCount: 1, declaresShizuku: false, declaresInternet: true },
    ],
    github: { stars: 12_345, pushedAt: "2026-11-08T00:00:00Z", archived: false, movedTo: null, forkOf: null, release: { tag: "v12.20.0", publishedAt: "2026-11-10T12:00:00Z", hasApk: true } },
    downloads,
    listings: [listing({ name: "Counted", added: "2026-11-05T00:00:00Z" })],
  });
  const data = catalog({
    apps: [subject, app({ id: "bare", name: "Bare", github: null })],
    enrichment: {
      fdroidIndexAt: "2026-11-10T00:00:00Z", izzyIndexAt: "2026-11-10T00:00:00Z", githubFetchedAt: "2026-11-10T00:00:00Z",
      downloads: [{ origin: "fdroid", name: "F-Droid", url: "https://f-droid.org/", license: null, retrieved: "2026-11-11T00:00:00Z", newest: "2026-11-09" }],
    },
  });
  const model = buildModel(data, NOW);
  const vocabulary = buildVocabulary(model);
  const counted = model.byId.get("counted") as Entry;
  const bare = model.byId.get("bare") as Entry;

  test("each figure names its source, and each source's release is its own line", () => {
    const statistics = statisticsFor(model, counted);
    expect(statistics.stars).toEqual({ count: 12_345, source: "GitHub" });
    expect(statistics.activity).toMatchObject({ what: "Last commit", source: "GitHub", at: Date.parse("2026-11-08T00:00:00Z") });
    expect(statistics.releases.map((release) => [release.source, release.version, release.note])).toEqual([
      ["F-Droid", "12.19.0", null],
      ["IzzyOnDroid", "12.20.0", null],
      ["GitHub", "v12.20.0", "APK attached"],
    ]);
    expect(hasStatistics(statistics)).toBe(true);
    expect(hasStatistics(statisticsFor(model, bare))).toBe(false);
  });

  test("downloads are per source: its name, its figure and its period, nothing else, and never a sum", () => {
    const { downloads: figures } = statisticsFor(model, counted);
    expect(figures).toEqual([
      { origin: "fdroid", source: "F-Droid", count: 12_340, period: "Oct 13 – Nov 11, 2026" },
      { origin: "github", source: "GitHub", count: 987, period: "running total" },
    ]);
    expect(JSON.stringify(statisticsFor(model, counted))).not.toContain(String(12_340 + 987));
    expect(downloadPeriod({ origin: "izzy", count: 1, from: null, to: "2026-11-11" })).toBe("up to Nov 11, 2026");
  });

  test("a running total is dated by its start, not as a window that ends on the day it was read", () => {
    const stat = { origin: "github" as const, count: 987, from: "2026-10-19", to: "2026-11-13" };
    expect(downloadPeriod(stat, true)).toBe("since Oct 19, 2026");
    expect(downloadPeriod(stat)).toBe("Oct 19 – Nov 13, 2026");
    expect(downloadPeriod({ ...stat, from: null, to: null }, true)).toBe("running total");
  });

  test("a download sort exists only for a source that publishes figures here, and is named after it", () => {
    expect([...vocabulary.sorts.keys()]).toEqual(["match", "name", "stars", "release", "added", "saved", "dl-fdroid", "dl-github"]);
    expect(sortDef(vocabulary, "dl-fdroid")).toEqual({ id: "dl-fdroid", label: "F-Droid downloads", short: "F-Droid downloads", measure: true });
    expect(parseQuery(vocabulary, { sort: "dl-izzy" }).sort).toBeNull();
    expect(parseQuery(vocabulary, { sort: "dl-github" }).sort).toBe("dl-github");
    expect(names(runQuery(vocabulary, model.entries, parseQuery(vocabulary, { sort: "dl-fdroid" })))).toEqual(["Counted", "Bare"]);
  });

  test("a row shows the value its list is sorted by, and nothing when no source gives one", () => {
    expect(rowMeasure(model, counted, "stars")).toMatchObject({ kind: "stars", text: "12k", label: "12,345 GitHub stars" });
    expect(rowMeasure(model, counted, "release")).toMatchObject({ kind: "release", text: "today", label: "Latest release Nov 10, 2026, on GitHub" });
    expect(rowMeasure(model, counted, "added")).toMatchObject({ kind: "added", text: "6d ago", label: "Added to the catalogs on Nov 5, 2026" });
    expect(rowMeasure(model, counted, "dl-fdroid")).toMatchObject({ kind: "downloads", text: "12k", label: "12,340 downloads from F-Droid, Oct 13 – Nov 11, 2026" });
    expect(rowMeasure(model, counted, "dl-izzy")).toBeNull();
    expect(rowMeasure(model, counted, "name")).toBeNull();
    for (const sort of ["stars", "release", "dl-fdroid", "dl-github"] as const) expect(rowMeasure(model, bare, sort)).toBeNull();
  });

  test("a list sorted by one source's downloads states the period above its rows, and nothing else", () => {
    expect(sortNote(model, model.entries, "dl-fdroid")).toBe("Oct 13 – Nov 11, 2026");
    expect(sortNote(model, model.entries, "stars")).toBeNull();
    expect(sortNote(model, model.entries, "name")).toBeNull();
    expect(sortNote(model, [bare], "dl-fdroid")).toBeNull();
    const later = buildModel(data, Date.parse("2027-01-30T12:00:00Z"));
    expect(sortNote(later, later.entries, "dl-fdroid")).toBe("Oct 13 – Nov 11, 2026");
    const earlier = counted.downloads.fdroid;
    if (!earlier) throw new Error("no figure");
    const other: Entry = { ...counted, downloads: { fdroid: { ...earlier, from: "2026-09-01", to: "2026-09-30" } } };
    expect(sortNote(model, [counted, other], "dl-fdroid"), "figures of different periods: the span they cover").toBe("Sep 1 – Nov 11, 2026");
    expect(rowMeasure(model, counted, "dl-fdroid")?.since).toBeUndefined();
  });

  test("a running total says on its row since when it has been counted, and the note says what the date is", () => {
    const running = buildModel(
      catalog({
        apps: [
          app({ id: "this-year", name: "This year", downloads: [{ origin: "github", count: 987, from: "2026-10-03", to: "2026-11-11" }] }),
          app({ id: "long-ago", name: "Long ago", downloads: [{ origin: "github", count: 45_600, from: "2024-03-09", to: "2026-11-11" }] }),
        ],
        enrichment: {
          fdroidIndexAt: "2026-11-10T00:00:00Z", izzyIndexAt: "2026-11-10T00:00:00Z", githubFetchedAt: "2026-11-10T00:00:00Z",
          downloads: [{ origin: "github", name: "GitHub release assets", url: "https://docs.github.com/", license: null, retrieved: "2026-11-11T00:00:00Z", newest: null }],
        },
      }),
      NOW,
    );
    const recent = rowMeasure(running, running.byId.get("this-year") as Entry, "dl-github");
    expect(recent).toMatchObject({ text: "987", since: "Oct 3", label: "987 downloads from GitHub, since Oct 3, 2026" });
    expect(rowMeasure(running, running.byId.get("long-ago") as Entry, "dl-github")).toMatchObject({ text: "46k", since: "Mar 2024" });
    expect(sortNote(running, running.entries, "dl-github"), "each row shows its own start, and the line says what it is").toBe("Since each app’s latest release");
    expect(sortNote(running, [bare], "dl-github")).toBeNull();
    expect(statisticsFor(running, running.byId.get("this-year") as Entry).downloads).toEqual([{ origin: "github", source: "GitHub", count: 987, period: "since Oct 3, 2026" }]);
    expect(measureWidth(recent as NonNullable<typeof recent>)).toBeGreaterThan(measureWidth({ kind: "stars", text: "987", label: "" }));
  });
});

describe("anti-features one by one", () => {
  const index = (origin: "fdroid" | "izzy", antiFeatures: string[]) => ({
    origin, pkg: "org.example.app", version: "1", updatedAt: null, addedAt: null, minSdk: null, targetSdk: null,
    sizeBytes: null, author: null, antiFeatures, permissionCount: 0, declaresShizuku: false, declaresInternet: true,
  });
  const model = buildModel(
    catalog({
      antiFeatures: [
        { id: "Ads", name: "Ads", definitions: [{ origin: "fdroid", name: "Ads", description: "This app contains advertising" }] },
        { id: "NonFreeNet", name: "Non-Free Network Services", definitions: [{ origin: "fdroid", name: "Non-Free Network Services", description: "This app promotes or depends entirely on a non-free network service" }] },
        { id: "NSFW", name: "NSFW", definitions: [] },
      ],
      apps: [
        app({ id: "clean", name: "Clean", github: null, index: [index("fdroid", [])], facets: { noAntiFeatures: true } }),
        app({ id: "net", name: "Net", github: null, index: [index("fdroid", ["NonFreeNet"])], facets: { noAntiFeatures: false } }),
        app({ id: "both", name: "Both", github: null, index: [index("fdroid", ["Ads"]), index("izzy", ["Ads", "NonFreeNet"])], facets: { noAntiFeatures: false } }),
        app({ id: "unchecked", name: "Unchecked", github: null }),
      ],
    }),
    NOW,
  );
  const vocabulary = buildVocabulary(model);
  const run = (f: string): string[] => names(runQuery(vocabulary, model.entries, parseQuery(vocabulary, { f })));

  test("each anti-feature some entry carries is a filter with a plain name, most common first", () => {
    const defs = vocabulary.defs.filter((def) => def.antiFeature?.polarity === "with");
    expect(defs.map((def) => [def.key, def.label])).toEqual([
      ["af:NonFreeNet", "Non-free network services"],
      ["af:Ads", "Ads"],
    ]);
    expect(vocabulary.byKey.has("af:NSFW")).toBe(false);
    expect(vocabulary.byKey.get("no:Ads")).toMatchObject({ short: "Without ads", group: "anti" });
  });

  test("with it, without it, and none at all are three different questions; an entry no index lists answers none of them", () => {
    expect(run("af:NonFreeNet")).toEqual(["Both", "Net"]);
    expect(run("no:NonFreeNet")).toEqual(["Clean"]);
    expect(run("no:Ads")).toEqual(["Clean", "Net"]);
    expect(run("clean")).toEqual(["Clean"]);
    expect(run("anti")).toEqual(["Both", "Net"]);
    for (const token of ["af:Ads", "no:Ads", "af:NonFreeNet", "no:NonFreeNet", "clean", "anti"]) expect(run(token)).not.toContain("Unchecked");
  });

  test("they combine with each other and with every other filter", () => {
    expect(run("af:NonFreeNet,no:Ads")).toEqual(["Net"]);
    expect(run("af:NonFreeNet,af:Ads")).toEqual(["Both"]);
    expect(run("no:NonFreeNet,no:Ads")).toEqual(["Clean"]);
  });

  test("choosing one side of an anti-feature drops the other side of the same one, and no other filter", () => {
    const withNet = toggleFilter(vocabulary, parseQuery(vocabulary, { f: "no:NonFreeNet,no:Ads" }), "af:NonFreeNet");
    expect(withNet.filters).toEqual(["af:NonFreeNet", "no:Ads"]);
    expect(toggleFilter(vocabulary, withNet, "af:NonFreeNet").filters).toEqual(["no:Ads"]);
  });

  test("each side is counted as the list it would give if chosen, replacing the other side", () => {
    const query = parseQuery(vocabulary, { f: "no:Ads" });
    const counts = countOptions(vocabulary, model.entries, query, ["af:Ads", "no:Ads", "af:NonFreeNet", "no:NonFreeNet", "clean"]);
    expect(Object.fromEntries(counts)).toEqual({ "af:Ads": 1, "no:Ads": 2, "af:NonFreeNet": 1, "no:NonFreeNet": 1, clean: 1 });
  });

  test("names follow the index's own, in sentence case, with abbreviations kept", () => {
    expect(antiFeatureName({ id: "x", name: "Non-Free Network Services", definitions: [] })).toBe("Non-free network services");
    expect(antiFeatureName({ id: "x", name: "NSFW", definitions: [] })).toBe("NSFW");
    expect(antiFeatureName({ id: "x", name: "Signed Using An Unsafe Algorithm", definitions: [] })).toBe("Signed using an unsafe algorithm");
  });

  describe("a list narrowed by one says whose statement it is and what is left out", () => {
    const wider = buildModel(
      catalog({
        antiFeatures: model.catalog.antiFeatures,
        apps: [
          ...model.catalog.apps,
          app({ id: "privileged", name: "Privileged", github: null, facets: { shizuku: true } }),
          app({ id: "guide", name: "Guide", github: null, listings: [listing({ name: "Guide", kind: "resource" })] }),
        ],
      }),
      NOW,
    );
    const words = buildVocabulary(wider);
    const note = (params: Record<string, string>, implied: string[] = [], base: readonly Entry[] = wider.entries): string | null =>
      antiFeatureNote(wider, words, base, parseQuery(words, params, implied), implied);

    test("a list no anti-feature filter narrows says nothing", () => {
      expect(note({})).toBeNull();
      expect(note({ f: "shizuku", q: "priv" })).toBeNull();
      expect(note({}, ["shizuku"])).toBeNull();
    });

    test("the quick filter, Any, With and Without each name the indexes and count the apps neither lists; a guide is not one", () => {
      const line = "F-Droid and IzzyOnDroid flag anti-features, so 2 apps listed by neither are left out.";
      for (const f of ["clean", "anti", "af:Ads", "no:Ads", "no:NonFreeNet,af:Ads"]) expect(note({ f }), f).toBe(line);
      expect(note({}, ["clean"]), "on the filter's own page").toBe(line);
    });

    test("the count is of what the list would otherwise hold: the other filters, the search and the page all narrow it", () => {
      expect(note({ f: "clean,shizuku" })).toBe("F-Droid and IzzyOnDroid flag anti-features, so 1 app listed by neither is left out.");
      expect(note({ f: "clean", q: "unch" })).toBe("F-Droid and IzzyOnDroid flag anti-features, so 1 app listed by neither is left out.");
      expect(note({ f: "shizuku" }, ["clean"])).toBe("F-Droid and IzzyOnDroid flag anti-features, so 1 app listed by neither is left out.");
      const indexed = wider.entries.filter((entry) => entry.app.index.length > 0);
      expect(note({ f: "clean" }, [], indexed), "nothing is left out of a list every app of which an index lists").toBe("F-Droid and IzzyOnDroid flag anti-features.");
      expect(note({ f: "clean", q: "net" })).toBe("F-Droid and IzzyOnDroid flag anti-features.");
    });

    test("a catalog with one index names that one", () => {
      const single = buildModel(
        catalog({
          apps: [
            app({ id: "clean", name: "Clean", github: null, index: [index("fdroid", [])], facets: { noAntiFeatures: true } }),
            app({ id: "unchecked", name: "Unchecked", github: null }),
          ],
        }),
        NOW,
      );
      const only = buildVocabulary(single);
      expect(antiFeatureNote(single, only, single.entries, parseQuery(only, { f: "clean" }))).toBe("F-Droid flags anti-features, so 1 app it does not list is left out.");
    });

    test("the filter panel's hint says the same without a number", () => {
      expect(GROUPS.find((group) => group.id === "anti")?.hint).toBe("F-Droid and IzzyOnDroid flag these, so apps listed by neither are left out.");
      expect(GROUPS.filter((group) => group.hint !== null).map((group) => group.id)).toEqual(["anti"]);
    });
  });
});
