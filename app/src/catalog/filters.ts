/**
 * The query model behind every list: free text, combinable filter tokens and a
 * sort. A query round-trips through three URL parameters (`q`, `f`, `sort`),
 * which is also what a pin stores.
 *
 * Tokens come from the schema's `Facets`, plus one per region, category and
 * source, and two per anti-feature the indexes flag (entries with it, and
 * entries an index lists without it). Tokens inside a choice group (openness,
 * place, source) widen each other; everything else narrows. A fact that no
 * source states is never counted as "no": the tests below only ever match a
 * stated value. A list narrowed by such a fact says whose statement it is
 * and how many apps it leaves out for want of one (`antiFeatureNote`).
 */

import { americanSpelling } from "../../../schema/join.ts";
import { fold } from "../lib/format.ts";
import { formerCategory } from "./former.ts";
import { originName, type CategoryView, type Entry, type Model } from "./model.ts";
import type { AntiFeature, DownloadOrigin, SourceId } from "./schema.ts";

export type GroupId = "access" | "terms" | "get" | "health" | "anti" | "time" | "region" | "category" | "source";

export interface FilterDef {
  key: string;
  group: GroupId;
  /** Tokens sharing a choice group are alternatives (OR); tokens without one must all hold (AND). */
  choice: "terms" | "place" | "source" | null;
  label: string;
  /** For chips, where space is tight. */
  short: string;
  /** In the filter sheet, under a group heading that already says the rest. */
  panel?: string;
  test(entry: Entry): boolean;
  /** Offered on Explore as a way in. */
  lens: boolean;
  /** Set on the two tokens of one anti-feature: its key, and whether the token asks for the flag or for its stated absence. */
  antiFeature?: { id: string; polarity: "with" | "without" };
}

export interface GroupDef {
  id: GroupId;
  label: string;
  /** A sentence under the group's heading in the filter panel: whose statement its filters rest on. */
  hint: string | null;
}

export const GROUPS: GroupDef[] = [
  { id: "access", label: "Access", hint: null },
  { id: "terms", label: "Source and price", hint: null },
  { id: "get", label: "Where to get it", hint: null },
  { id: "health", label: "Health", hint: null },
  { id: "anti", label: "Anti-features", hint: "F-Droid and IzzyOnDroid flag these, so apps listed by neither are left out." },
  { id: "time", label: "Recent", hint: null },
  { id: "source", label: "Catalog", hint: null },
  { id: "region", label: "Region", hint: null },
  { id: "category", label: "Category", hint: null },
];

const DOWNLOAD_ORIGINS: DownloadOrigin[] = ["fdroid", "izzy", "github"];

export type DownloadSortId = `dl-${DownloadOrigin}`;
export type SortId = "match" | "name" | "release" | "added" | "stars" | "saved" | DownloadSortId;

export interface SortDef {
  id: SortId;
  /** What the choice is called where there is room. */
  label: string;
  /** For the control in a list's bar. */
  short: string;
  /** True when the sort is by a value worth showing on each row. */
  measure: boolean;
}

const BASE_SORTS: SortDef[] = [
  { id: "match", label: "Best match", short: "Best match", measure: false },
  { id: "name", label: "Name", short: "Name", measure: false },
  { id: "stars", label: "GitHub stars", short: "Stars", measure: true },
  { id: "release", label: "Recently updated", short: "Updated", measure: true },
  { id: "added", label: "Recently added", short: "Added", measure: true },
  { id: "saved", label: "Recently saved", short: "Saved", measure: false },
];

export function downloadSortId(origin: DownloadOrigin): DownloadSortId {
  return `dl-${origin}`;
}

/** The origin a download sort is about, or null for every other sort. */
export function downloadSortOrigin(sort: SortId): DownloadOrigin | null {
  return DOWNLOAD_ORIGINS.find((origin) => sort === downloadSortId(origin)) ?? null;
}

export interface Query {
  text: string;
  /** Token keys in vocabulary order, without duplicates or unknown keys. */
  filters: string[];
  /** Null means the default for the list and the query. */
  sort: SortId | null;
}

export const EMPTY_QUERY: Query = { text: "", filters: [], sort: null };

export interface Vocabulary {
  defs: FilterDef[];
  byKey: Map<string, FilterDef>;
  lenses: FilterDef[];
  /** Every sort this catalog supports: a download sort exists only for an origin that publishes figures here. */
  sorts: Map<SortId, SortDef>;
  /** The token that a category token of the builds before Droid Atlas's own categories stands for now, when that category has one successor. */
  former(key: string): string | undefined;
}

type FactSpec = Omit<FilterDef, "choice" | "lens"> & { choice?: FilterDef["choice"]; lens?: boolean };

const FACTS: FactSpec[] = [
  {
    key: "shizuku", group: "access", label: "Works with Shizuku", short: "Shizuku",
    test: (e) => e.app.facets.shizuku, lens: true,
  },
  {
    key: "root", group: "access", label: "Uses root", short: "Root",
    test: (e) => e.app.facets.root, lens: true,
  },
  {
    key: "no-internet", group: "access", label: "No internet permission", short: "No internet",
    test: (e) => e.app.facets.noInternet === true, lens: true,
  },
  {
    key: "open", group: "terms", choice: "terms", label: "Open source", short: "Open source",
    test: (e) => e.app.facets.openness === "open-source",
  },
  {
    key: "source-available", group: "terms", choice: "terms", label: "Source-available", short: "Source-available",
    test: (e) => e.app.facets.openness === "source-available",
  },
  {
    key: "closed", group: "terms", choice: "terms", label: "Closed source", short: "Closed source",
    test: (e) => e.app.facets.openness === "closed-source",
  },
  {
    key: "paid", group: "terms", label: "Paid or with purchases", short: "Paid",
    test: (e) => e.app.facets.paid,
  },
  {
    key: "fdroid", group: "get", label: "On F-Droid", short: "F-Droid", panel: "F-Droid",
    test: (e) => e.app.facets.onFdroid, lens: true,
  },
  {
    key: "izzy", group: "get", label: "On IzzyOnDroid", short: "IzzyOnDroid", panel: "IzzyOnDroid",
    test: (e) => e.app.facets.onIzzy, lens: true,
  },
  {
    key: "apk", group: "get", label: "APK on GitHub releases", short: "GitHub APK",
    test: (e) => e.app.facets.apkOnGithub === true, lens: true,
  },
  {
    key: "active", group: "health", label: "Not archived", short: "Not archived",
    test: (e) => e.app.facets.archived === false,
  },
  {
    key: "archived", group: "health", label: "Archived", short: "Archived",
    test: (e) => e.app.facets.archived === true,
  },
  {
    key: "stale", group: "health", label: "Stale listing link", short: "Stale link",
    test: (e) => e.app.facets.staleLink,
  },
  {
    key: "gone", group: "health", label: "Repository gone", short: "Repo gone",
    test: (e) => e.app.repoMissing,
  },
  {
    key: "fork", group: "health", label: "Fork", short: "Fork",
    test: (e) => e.app.facets.fork,
  },
  {
    key: "recommended", group: "health", label: "Recommended", short: "Recommended",
    test: (e) => e.app.facets.recommended,
  },
  {
    key: "clean", group: "anti", label: "No anti-features", short: "No anti-features", panel: "None",
    test: (e) => e.app.facets.noAntiFeatures === true, lens: true,
  },
  {
    key: "anti", group: "anti", label: "Any anti-feature", short: "Anti-features", panel: "Any",
    test: (e) => e.app.facets.noAntiFeatures === false,
  },
  {
    key: "new", group: "time", label: "Added in 90 days", short: "Added in 90 days",
    test: (e) => e.isNew, lens: true,
  },
  {
    key: "fresh", group: "time", label: "Released in 90 days", short: "Released in 90 days",
    test: (e) => e.isFresh, lens: true,
  },
];

/**
 * An anti-feature's name as a phrase in running text: the index's own name,
 * in sentence case ("Non-free network services"). An all-capitals word is an
 * abbreviation and stays as it is.
 */
export function antiFeatureName(feature: AntiFeature): string {
  const words = feature.name.split(" ").map((word, index) => {
    if (word.length > 1 && word === word.toUpperCase()) return word;
    const lower = word.toLowerCase();
    return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return words.join(" ");
}

/** The first index definition's sentence for an anti-feature, or null when no index defines the key it uses. */
export function antiFeatureMeaning(feature: AntiFeature, origin?: "fdroid" | "izzy"): string | null {
  const definition = feature.definitions.find((candidate) => candidate.origin === origin) ?? feature.definitions[0];
  return definition?.description?.replace(/\.$/, "") ?? null;
}

function antiFeatureDefs(feature: AntiFeature): FilterDef[] {
  const name = antiFeatureName(feature);
  return [
    {
      key: `af:${feature.id}`, group: "anti", choice: null, label: name, short: name,
      test: (e) => e.antiFeatures.includes(feature.id), lens: false,
      antiFeature: { id: feature.id, polarity: "with" },
    },
    {
      key: `no:${feature.id}`, group: "anti", choice: null, label: `Without: ${name}`, short: `Without ${name.charAt(0).toLowerCase()}${name.slice(1)}`,
      test: (e) => e.app.index.length > 0 && !e.antiFeatures.includes(feature.id), lens: false,
      antiFeature: { id: feature.id, polarity: "without" },
    },
  ];
}

function downloadSort(model: Model, origin: DownloadOrigin): SortDef {
  const name = originName(model, origin);
  return {
    id: downloadSortId(origin),
    label: `${name} downloads`,
    short: `${name} downloads`,
    measure: true,
  };
}

/** Facts are offered only when at least one entry carries them, so no filter exists for a claim the data never makes. */
export function buildVocabulary(model: Model): Vocabulary {
  const defs: FilterDef[] = [];
  for (const spec of FACTS) {
    if (!model.entries.some(spec.test)) continue;
    defs.push({ ...spec, choice: spec.choice ?? null, lens: spec.lens ?? false });
  }
  const flagged = [...model.antiFeatures.values()]
    .map((feature) => ({ feature, count: model.entries.filter((entry) => entry.antiFeatures.includes(feature.id)).length }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.feature.id.localeCompare(b.feature.id, "en"));
  for (const { feature } of flagged) defs.push(...antiFeatureDefs(feature));
  defs.sort((a, b) => GROUPS.findIndex((group) => group.id === a.group) - GROUPS.findIndex((group) => group.id === b.group));

  if (model.catalog.sources.length > 1) {
    for (const source of model.catalog.sources) {
      const id: SourceId = source.id;
      defs.push({
        key: `s:${id}`, group: "source", choice: "source", label: source.name, short: source.name,
        test: (e) => e.sources.has(id), lens: false,
      });
    }
  }
  for (const view of model.regions) {
    const id = view.region.id;
    defs.push({
      key: `r:${id}`, group: "region", choice: "place", label: view.region.name, short: view.region.name,
      test: (e) => e.app.region === id, lens: false,
    });
  }
  const sorted = [...model.categories].sort((a, b) => a.category.name.localeCompare(b.category.name, "en"));
  for (const view of sorted) {
    const { id, name } = view.category;
    defs.push({
      key: `c:${id}`, group: "category", choice: "place", label: name, short: name,
      test: (e) => e.category?.id === id, lens: false,
    });
  }

  const sorts = new Map<SortId, SortDef>(BASE_SORTS.map((sort) => [sort.id, sort]));
  for (const origin of DOWNLOAD_ORIGINS) {
    if (model.entries.some((entry) => entry.downloads[origin] !== undefined)) sorts.set(downloadSortId(origin), downloadSort(model, origin));
  }
  const former = (key: string): string | undefined => {
    const category = key.startsWith("c:") ? formerCategory(model, key.slice(2)).category : undefined;
    return category && `c:${category}`;
  };
  return { defs, byKey: new Map(defs.map((def) => [def.key, def])), lenses: defs.filter((def) => def.lens), sorts, former };
}

/** The definition of a sort this catalog supports; a sort it does not support reads as the name sort. */
export function sortDef(vocabulary: Vocabulary, id: SortId): SortDef {
  const found = vocabulary.sorts.get(id) ?? vocabulary.sorts.get("name");
  if (!found) throw new Error("the vocabulary has no name sort");
  return found;
}

function readSort(vocabulary: Vocabulary, value: string | undefined): SortId | null {
  return value !== undefined && vocabulary.sorts.has(value as SortId) ? (value as SortId) : null;
}

function tokensOf(params: Readonly<Record<string, string>>): string[] {
  return (params.f ?? "").split(",").map((token) => token.trim()).filter(Boolean);
}

/**
 * Reads a query from URL parameters. A category token of an earlier build
 * is read as its successor; tokens and sorts the catalog no longer has, and
 * tokens the page already implies, are dropped.
 */
export function parseQuery(vocabulary: Vocabulary, params: Readonly<Record<string, string>>, implied: readonly string[] = []): Query {
  const wanted = new Set(tokensOf(params).map((token) => (vocabulary.byKey.has(token) ? token : vocabulary.former(token) ?? token)));
  const filters = vocabulary.defs.filter((def) => wanted.has(def.key) && !implied.includes(def.key)).map((def) => def.key);
  return { text: params.q ?? "", filters, sort: readSort(vocabulary, params.sort) };
}

export function queryParams(query: Query): { q: string | null; f: string | null; sort: string | null } {
  return { q: query.text || null, f: query.filters.join(",") || null, sort: query.sort };
}

export function isEmptyQuery(query: Query): boolean {
  return query.text.trim() === "" && query.filters.length === 0;
}

/**
 * Switches a token on or off. The two tokens of one anti-feature contradict
 * each other, so switching one on switches the other off.
 */
export function toggleFilter(vocabulary: Vocabulary, query: Query, key: string): Query {
  const on = query.filters.includes(key);
  const about = vocabulary.byKey.get(key)?.antiFeature?.id;
  const kept = query.filters.filter((other) => other !== key && (on || about === undefined || vocabulary.byKey.get(other)?.antiFeature?.id !== about));
  const keys = on ? kept : [...kept, key];
  return { ...query, filters: vocabulary.defs.filter((def) => keys.includes(def.key)).map((def) => def.key) };
}

/** A stable identity for "the same question", used to match pins. Sort is part of it. */
export function queryId(query: Query): string {
  return [fold(query.text.trim()), query.filters.join(","), query.sort ?? ""].join("|");
}

/**
 * The name a stored query is shown under: the one it was given while every
 * filter it was stored with still exists; otherwise what it filters now, so
 * an old name never stands over a different list; null when nothing of it
 * is left.
 */
export function storedQueryName(vocabulary: Vocabulary, params: Readonly<Record<string, string>>, name: string): string | null {
  if (tokensOf(params).every((token) => vocabulary.byKey.has(token))) return name;
  const query = parseQuery(vocabulary, params);
  return isEmptyQuery(query) ? null : describeQuery(vocabulary, query);
}

export function describeQuery(vocabulary: Vocabulary, query: Query): string {
  const parts = query.filters.map((key) => vocabulary.byKey.get(key)?.short ?? key);
  if (query.text.trim()) parts.push(`“${query.text.trim()}”`);
  return parts.join(" · ") || "Everything";
}

function predicate(vocabulary: Vocabulary, keys: readonly string[], skipChoice: FilterDef["choice"] = null): (entry: Entry) => boolean {
  const strict: FilterDef[] = [];
  const choices = new Map<string, FilterDef[]>();
  for (const key of keys) {
    const def = vocabulary.byKey.get(key);
    if (!def) continue;
    if (def.choice === null) strict.push(def);
    else if (def.choice !== skipChoice) choices.set(def.choice, [...(choices.get(def.choice) ?? []), def]);
  }
  const groups = [...choices.values()];
  return (entry) => strict.every((def) => def.test(entry)) && groups.every((defs) => defs.some((def) => def.test(entry)));
}

/** The words of a search as matching uses them: folded like the catalog's own search text, split at white space. */
export function searchWords(text: string): string[] {
  return fold(text).split(/\s+/).filter(Boolean);
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** Whether `word` occurs in folded `text` where a word begins: at the start, or after anything that is not a letter or digit. */
function startsWord(text: string, word: string): boolean {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (at === 0 || !WORD_CHARACTER.test(text[at - 1] ?? "")) return true;
  }
  return false;
}

/** A category a search names, and the source's name it was found by when that is not the category's own. */
export interface CategoryHit {
  view: CategoryView;
  by: string | null;
}

const MOST_HITS = 3;

/**
 * The categories a search names: every word of it begins a word of a name
 * the category answers to (its own, or a source's it takes in, in either
 * spelling). A word that only occurs in apps' summaries names no category.
 * A category named in full comes first, then one found by its own name,
 * then the larger; at most three, and none for fewer than three letters.
 */
export function categoriesNamed(model: Model, text: string): CategoryHit[] {
  const words = searchWords(text).filter((word) => WORD_CHARACTER.test(word));
  if (words.join("").length < 3) return [];
  const all = (folded: string): boolean => words.every((word) => startsWord(folded, word));
  const rank = (hit: CategoryHit): number => (fold(hit.view.category.name) === fold(text) ? 0 : hit.by === null ? 1 : 2);
  return model.categories
    .filter((view) => all(view.text))
    .map((view) => ({
      view,
      by: all(fold(view.category.name)) ? null : view.takesIn.find((name) => all(fold(`${name} ${americanSpelling(name)}`))) ?? null,
    }))
    .sort((a, b) => rank(a) - rank(b) || b.view.entries.length - a.view.entries.length)
    .slice(0, MOST_HITS);
}

/** A stretch of a text, and whether a search matched it. */
export interface MarkedText {
  text: string;
  hit: boolean;
}

/** `text` folded one character at a time, with the position in `text` each folded character came from. */
function foldWithPositions(text: string): { folded: string; from: number[] } {
  let folded = "";
  const from: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const piece = (text[index] ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (let unit = 0; unit < piece.length; unit += 1) from.push(index);
    folded += piece;
  }
  return { folded, from };
}

/**
 * `text` cut into the stretches a search matched and the stretches between,
 * so a row can mark the match where it shows it. A word of the search that
 * begins a word of the text is marked only there; one found only inside
 * words is marked wherever it is, which is what tells the reader why an
 * entry such as "Design" answers "sig".
 */
export function markMatches(text: string, words: readonly string[]): MarkedText[] {
  if (!text || words.length === 0) return [{ text, hit: false }];
  const { folded, from } = foldWithPositions(text);
  const marked = new Array<boolean>(text.length).fill(false);
  for (const word of words) {
    const found: number[] = [];
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) found.push(at);
    const starts = found.filter((at) => at === 0 || !WORD_CHARACTER.test(folded[at - 1] ?? ""));
    for (const at of starts.length > 0 ? starts : found) {
      const first = from[at] ?? 0;
      const last = from[at + word.length - 1] ?? first;
      for (let index = first; index <= last; index += 1) marked[index] = true;
    }
  }
  const parts: MarkedText[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const hit = marked[index] === true;
    const current = parts.at(-1);
    if (current && current.hit === hit) current.text += text[index] ?? "";
    else parts.push({ text: text[index] ?? "", hit });
  }
  return parts;
}

/** Where a search matched, when it is not somewhere the row already shows: the place, and the text around the match. */
export interface MatchReason {
  /** "Summary", "Description", "Category", "Source category", "Category includes", "Package", "Repository", "Also listed as". */
  where: string;
  before: string;
  hit: string;
  after: string;
}

const SNIPPET_BEFORE = 22;
const SNIPPET_AFTER = 60;

function snippet(where: string, text: string, word: string): MatchReason | null {
  const folded = fold(text);
  const at = folded.indexOf(word);
  if (at === -1) return null;
  /* Folding can change a text's length; then positions do not carry over, and the text is shown from its start without a highlight. */
  if (folded.length !== text.length) return { where, before: text.slice(0, SNIPPET_AFTER), hit: "", after: "" };
  const start = Math.max(0, at - SNIPPET_BEFORE);
  /* A snippet that starts mid-text starts at a word. */
  const space = start > 0 ? text.indexOf(" ", start) : -1;
  const cut = space !== -1 && space < at ? space + 1 : start;
  return {
    where,
    before: (cut > 0 ? "…" : "") + text.slice(cut, at),
    hit: text.slice(at, at + word.length),
    after: text.slice(at + word.length, at + word.length + SNIPPET_AFTER),
  };
}

/** How much of a summary a row can be counted on to show: its first line and most of its second on the narrowest phone. */
const SUMMARY_SHOWN = 70;

/**
 * Why an entry is among the results of a text search, when neither its name
 * nor the part of its summary a row shows contains the words: the first
 * other place one of them was found. Null when the row itself shows the
 * match, and for an empty search.
 *
 * @param model where the names of sources' categories are looked up; without it they are not searched
 * @param summaryShown how many characters of the summary the row shows without this line
 * @param labeled whether the row shows the entry's category, where the match is then marked
 */
export function matchReason(
  entry: Entry,
  text: string,
  model?: Pick<Model, "sourceCategoryById" | "categoryById">,
  summaryShown = SUMMARY_SHOWN,
  labeled = false,
): MatchReason | null {
  const words = searchWords(text);
  const summary = entry.app.summary?.value ?? "";
  const shown = `${entry.foldedName} ${fold(summary.slice(0, summaryShown))} ${labeled && entry.category ? fold(entry.category.name) : ""}`;
  const hidden = words.find((word) => !shown.includes(word));
  if (!hidden) return null;
  const later = snippet("Summary", summary, hidden);
  if (later) return later;
  for (const listing of entry.listings) {
    const found = listing.description ? snippet("Description", listing.description, hidden) : null;
    if (found) return found;
  }
  for (const listing of entry.listings) {
    const found = listing.name !== entry.app.name ? snippet("Also listed as", listing.name, hidden) : null;
    if (found) return found;
  }
  for (const pkg of entry.app.packages) {
    const found = snippet("Package", pkg, hidden);
    if (found) return found;
  }
  const inRepository = entry.app.repo?.slug ? snippet("Repository", entry.app.repo.slug, hidden) : null;
  if (inRepository) return inRepository;
  const inCategory = entry.category ? snippet("Category", entry.category.name, hidden) : null;
  if (inCategory) return inCategory;
  /* A source's name found only in the interface's spelling of it is shown as the source spells it, unmarked. */
  const named = (where: string, name: string | undefined): MatchReason | null =>
    name ? snippet(where, name, hidden) ?? (fold(americanSpelling(name)).includes(hidden) ? { where, before: name, hit: "", after: "" } : null) : null;
  for (const listing of entry.listings) {
    const found = named("Source category", model?.sourceCategoryById.get(listing.category)?.name);
    if (found) return found;
  }
  for (const name of model?.categoryById.get(entry.category?.id ?? "")?.takesIn ?? []) {
    const found = named("Category includes", name);
    if (found) return found;
  }
  return null;
}

/**
 * How well an entry answers the query; lower is better. An exact name comes
 * first, then a name that starts with the query. After those an entry ranks
 * by its weakest word: one that begins a word of the name, then of a name
 * its category answers to, then of the summary, then of anything else
 * search looks at, and only then a word found inside another word ("sig" in
 * "Design"), in the name before elsewhere.
 */
function matchScore(entry: Entry, words: string[]): number {
  const name = entry.foldedName;
  if (name === words.join(" ")) return 0;
  if (name.startsWith(words[0] ?? "") && words.every((word) => name.includes(word))) return 1;
  const summary = fold(entry.app.summary?.value ?? "");
  let weakest = 2;
  for (const word of words) {
    let level = 7;
    if (startsWord(name, word)) level = 2;
    else if (startsWord(entry.categoryText, word)) level = 3;
    else if (startsWord(summary, word)) level = 4;
    else if (startsWord(entry.text, word)) level = 5;
    else if (name.includes(word)) level = 6;
    weakest = Math.max(weakest, level);
  }
  return weakest;
}

function matchesText(entry: Entry, words: string[]): boolean {
  return words.every((word) => entry.text.includes(word) || entry.foldedName.includes(word));
}

type Comparator = (a: Entry, b: Entry) => number;

/** Largest first; entries with no value come last, and ties fall back to the name. */
function descending(value: (entry: Entry) => number | null): Comparator {
  return (a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va === vb) return a.nameRank - b.nameRank;
    if (va === null) return 1;
    if (vb === null) return -1;
    return vb - va;
  };
}

const byName: Comparator = (a, b) => a.nameRank - b.nameRank;

function comparatorFor(sort: SortId): Comparator {
  const origin = downloadSortOrigin(sort);
  if (origin) return descending((entry) => entry.downloads[origin]?.count ?? null);
  if (sort === "release") return descending((entry) => entry.releasedAt);
  if (sort === "added") return descending((entry) => entry.addedAt);
  if (sort === "stars") return descending((entry) => entry.stars);
  return byName;
}

export interface RunOptions {
  /** The order `scope` arrives in, when it is a sort choice of its own (the saved list's "recently saved"). */
  natural?: SortId;
}

/** The sort a query ends up with: the chosen one, else best match while there is text, else the list's own default. */
export function effectiveSort(query: Query, options: RunOptions = {}): SortId {
  if (query.sort === "match") return query.text.trim() ? "match" : options.natural ?? "name";
  if (query.sort === "saved") return options.natural === "saved" ? "saved" : "name";
  if (query.sort) return query.sort;
  if (query.text.trim()) return "match";
  return options.natural ?? "name";
}

export function runQuery(vocabulary: Vocabulary, scope: readonly Entry[], query: Query, options: RunOptions = {}): Entry[] {
  const words = searchWords(query.text);
  const passes = predicate(vocabulary, query.filters);
  const filtered = scope.filter((entry) => passes(entry) && (words.length === 0 || matchesText(entry, words)));
  const sort = effectiveSort(query, options);
  if (sort === options.natural) return filtered;
  if (sort === "match") {
    const scores = new Map(filtered.map((entry) => [entry, matchScore(entry, words)]));
    return filtered.sort((a, b) => (scores.get(a) ?? 0) - (scores.get(b) ?? 0) || a.nameRank - b.nameRank);
  }
  return filtered.sort(comparatorFor(sort));
}

/**
 * What a list narrowed by an anti-feature filter says above its rows: whose
 * statement the filter rests on, and how many apps are left out of the list
 * because no index lists them, so nobody has stated anything about them.
 * The count is of what the list would otherwise hold: the apps of `base`
 * that pass the search text and every other filter in force. Null when no
 * anti-feature filter is in force.
 *
 * @param base the list before the page's own filter (`implied`) cut it down
 */
export function antiFeatureNote(model: Model, vocabulary: Vocabulary, base: readonly Entry[], query: Query, implied: readonly string[] = []): string | null {
  const keys = [...implied, ...query.filters];
  const about = (key: string): boolean => vocabulary.byKey.get(key)?.group === "anti";
  if (!keys.some(about)) return null;
  const stated = new Set(model.entries.flatMap((entry) => entry.app.index.map((index) => index.origin)));
  const names = (["fdroid", "izzy"] as const).filter((origin) => stated.has(origin)).map((origin) => originName(model, origin));
  if (names.length === 0) return null;
  const words = searchWords(query.text);
  const passes = predicate(vocabulary, keys.filter((key) => !about(key)));
  const unknown = base.filter((entry) => !entry.resource && entry.app.index.length === 0 && passes(entry) && (words.length === 0 || matchesText(entry, words))).length;
  const who = `${names.join(" and ")} ${names.length === 1 ? "flags" : "flag"} anti-features`;
  if (unknown === 0) return `${who}.`;
  const apps = `${unknown.toLocaleString("en")} ${unknown === 1 ? "app" : "apps"} ${names.length === 1 ? "it does not list" : "listed by neither"}`;
  return `${who}, so ${apps} ${unknown === 1 ? "is" : "are"} left out.`;
}

/**
 * For each token, how many results the query would have with it switched on.
 * A token in a choice group is counted against the query without that group's
 * other choices, because choosing it widens the group rather than narrowing
 * it; a token of an anti-feature is counted without the same anti-feature's
 * other token, because choosing it replaces that one.
 */
export function countOptions(vocabulary: Vocabulary, scope: readonly Entry[], query: Query, keys: Iterable<string>): Map<string, number> {
  const words = searchWords(query.text);
  const textual = words.length ? scope.filter((entry) => matchesText(entry, words)) : scope;
  const current = textual.filter(predicate(vocabulary, query.filters));
  const bases = new Map<string, Entry[]>();
  const counts = new Map<string, number>();
  for (const key of keys) {
    const def = vocabulary.byKey.get(key);
    if (!def) continue;
    let base: readonly Entry[] = current;
    if (def.choice !== null) {
      let cached = bases.get(def.choice);
      if (!cached) {
        cached = textual.filter(predicate(vocabulary, query.filters, def.choice));
        bases.set(def.choice, cached);
      }
      base = cached;
    } else if (def.antiFeature) {
      const about = def.antiFeature.id;
      const others = query.filters.filter((other) => vocabulary.byKey.get(other)?.antiFeature?.id !== about);
      if (others.length !== query.filters.length) base = textual.filter(predicate(vocabulary, others));
    }
    let count = 0;
    for (const entry of base) if (def.test(entry)) count += 1;
    counts.set(key, count);
  }
  return counts;
}
