/**
 * The catalog as the views use it: every app wrapped in an `Entry` with the
 * values lists sort and filter on, plus the region and category indexes.
 * Built once, in a single pass, when the catalog arrives.
 */

import { categoryAnswers, sortListings } from "../../../schema/join.ts";
import { compareText, fold, parseTime, withinDays } from "../lib/format.ts";
import { indexFacts, type FactIndex } from "./fact-tokens.ts";
import type { AntiFeature, App, Catalog, Category, DownloadOrigin, DownloadSource, DownloadStat, Listing, Origin, Region, SourceCategory, SourceId, SourceInfo } from "./schema.ts";

export const RECENT_DAYS = 90;

export interface Entry {
  app: App;
  /** Position by name, with diacritics folded; sorting by name is an integer comparison. */
  nameRank: number;
  foldedName: string;
  /** The text the search runs on, as the catalog provides it: already lower-cased with diacritics folded. */
  text: string;
  /** Listings in priority order; the first is the primary one. */
  listings: Listing[];
  /** The Droid Atlas category the app is filed under; null only when the catalog names one it does not define. */
  category: Category | null;
  /** The names the category answers to in search (`categoryAnswers`), folded. */
  categoryText: string;
  sources: Set<SourceId>;
  /** A guide, site or further-reading link rather than an installable app. */
  resource: boolean;
  /** When the app most recently entered one of the catalogs. */
  addedAt: number | null;
  releasedAt: number | null;
  releaseOrigin: Origin | null;
  stars: number | null;
  /** The download figure each origin publishes for the app. Figures of different origins count different things. */
  downloads: Partial<Record<DownloadOrigin, DownloadStat>>;
  isNew: boolean;
  isFresh: boolean;
  /** Keys of the anti-features either index flags, without duplicates. */
  antiFeatures: string[];
}

export interface CategoryView {
  category: Category;
  /** By name. */
  entries: Entry[];
  /** The names of the source categories that map into it, as the sources spell them. */
  takesIn: string[];
  /** Every name the category answers to in search (`categoryAnswers`), folded. */
  text: string;
}

export interface RegionView {
  region: Region;
  /** By name. */
  entries: Entry[];
  /** Largest first, the remainder last. */
  categories: CategoryView[];
  /** A few apps with icons, for recognizing the region on the map. */
  sample: Entry[];
}

export interface Model {
  catalog: Catalog;
  now: number;
  entries: Entry[];
  byId: Map<string, Entry>;
  regions: RegionView[];
  regionById: Map<string, RegionView>;
  /**
   * The categories that hold an entry, in the catalog's reading order. A
   * category that holds none, such as a remainder nobody's app has landed
   * in, is not here, so no list, chip or count shows it.
   */
  categories: CategoryView[];
  categoryById: Map<string, CategoryView>;
  /** Each source's own categories, by id: what a listing names, shown as the source's wording. */
  sourceCategoryById: Map<string, SourceCategory>;
  sourceById: Map<SourceId, SourceInfo>;
  /** Every anti-feature some entry carries, by key, with each index's own definition. */
  antiFeatures: Map<string, AntiFeature>;
  /** Who publishes download figures in this build, in the catalog's order. */
  downloadSources: DownloadSource[];
  /** Follows `Catalog.redirects` from a retired id to the app that replaced it. */
  resolve(id: string): Entry | null;
  /** The entries by repository owner and by license (`fact-tokens.ts`), indexed the first time they are asked for. */
  facts(): FactIndex;
}

function latestRelease(app: App): { at: number; origin: Origin } | null {
  let best: { at: number; origin: Origin } | null = null;
  for (const index of app.index) {
    const at = parseTime(index.updatedAt);
    if (at !== null && (!best || at > best.at)) best = { at, origin: index.origin };
  }
  const github = parseTime(app.github?.release?.publishedAt);
  if (github !== null && (!best || github > best.at)) best = { at: github, origin: "github" };
  return best;
}

export function buildModel(catalog: Catalog, now: number): Model {
  const categoryInfo = new Map(catalog.categories.map((category) => [category.id, category]));
  const answers = new Map(catalog.categories.map((category) => [category.id, categoryAnswers(category, catalog.sourceCategories)]));
  const categoryText = new Map([...answers].map(([id, names]) => [id, fold(names.join(" "))]));
  const sourceById = new Map(catalog.sources.map((source) => [source.id, source]));

  const entries = catalog.apps.map((app): Entry => {
    const listings = sortListings([...app.listings]);
    const sources = new Set<SourceId>();
    let addedAt: number | null = null;
    for (const listing of listings) {
      sources.add(listing.source);
      const added = parseTime(listing.added);
      if (added !== null && (addedAt === null || added > addedAt)) addedAt = added;
    }
    const release = latestRelease(app);
    return {
      app,
      nameRank: 0,
      foldedName: fold(app.name),
      text: app.search,
      listings,
      category: categoryInfo.get(app.category) ?? null,
      categoryText: categoryText.get(app.category) ?? "",
      sources,
      resource: listings.length > 0 && listings.every((listing) => listing.kind === "resource"),
      addedAt,
      releasedAt: release?.at ?? null,
      releaseOrigin: release?.origin ?? null,
      stars: app.github?.stars ?? null,
      downloads: Object.fromEntries(app.downloads.map((stat) => [stat.origin, stat])),
      isNew: withinDays(addedAt, now, RECENT_DAYS),
      isFresh: withinDays(release?.at ?? null, now, RECENT_DAYS),
      antiFeatures: [...new Set(app.index.flatMap((index) => index.antiFeatures))],
    };
  });

  const byName = [...entries].sort((a, b) => compareText(a.foldedName, b.foldedName) || compareText(a.app.id, b.app.id));
  byName.forEach((entry, rank) => {
    entry.nameRank = rank;
  });

  const byId = new Map(entries.map((entry) => [entry.app.id, entry]));

  const inCategory = new Map<string, Entry[]>();
  for (const entry of byName) {
    if (!entry.category) continue;
    inCategory.set(entry.category.id, [...(inCategory.get(entry.category.id) ?? []), entry]);
  }
  const categories: CategoryView[] = catalog.categories.flatMap((category) => {
    const held = inCategory.get(category.id);
    const names = answers.get(category.id) ?? [];
    return held?.length ? [{ category, entries: held, takesIn: [...new Set(names.slice(1, (names.length + 1) / 2))], text: categoryText.get(category.id) ?? "" }] : [];
  });

  const regions: RegionView[] = [];
  for (const region of catalog.regions) {
    const inRegion = byName.filter((entry) => entry.app.region === region.id);
    if (!inRegion.length) continue;
    regions.push({
      region,
      entries: inRegion,
      categories: categories
        .filter((view) => view.category.region === region.id)
        .sort((a, b) => Number(a.category.remainder) - Number(b.category.remainder) || b.entries.length - a.entries.length || compareText(a.category.name, b.category.name)),
      sample: inRegion.filter((entry) => entry.app.icon).sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0)).slice(0, 9),
    });
  }

  let facts: FactIndex | null = null;
  const resolve = (id: string): Entry | null => {
    let current: string | null = id;
    for (let hops = 0; current !== null && hops < 8; hops += 1) {
      const entry = byId.get(current);
      if (entry) return entry;
      current = Object.hasOwn(catalog.redirects, current) ? catalog.redirects[current] ?? null : null;
    }
    return null;
  };

  return {
    catalog,
    now,
    entries: byName,
    byId,
    regions,
    regionById: new Map(regions.map((view) => [view.region.id, view])),
    categories,
    categoryById: new Map(categories.map((view) => [view.category.id, view])),
    sourceCategoryById: new Map(catalog.sourceCategories.map((category) => [category.id, category])),
    sourceById,
    antiFeatures: new Map(catalog.antiFeatures.map((feature) => [feature.id, feature])),
    downloadSources: catalog.enrichment.downloads,
    resolve,
    facts: () => {
      facts ??= indexFacts(byName);
      return facts;
    },
  };
}

/** A note a source attaches to one or more of its categories, as a category page shows it. */
export interface CategoryNote {
  text: string;
  source: SourceId;
  /** The source's categories the note stands on, as the source names them; with their heading where two of them share a name. */
  on: string[];
}

/**
 * The source notes that still fit a category's page (docs/COPY.md § A
 * source's note). A note speaks of its source's own list ("below, you can
 * find…"), so it stands only while every entry on the page is listed in a
 * source category that carries it. One wording is shown once, however many
 * of the source's categories carry it.
 */
export function categoryNotes(model: Model, view: CategoryView): CategoryNote[] {
  const noted = model.catalog.sourceCategories.filter((source) => source.category === view.category.id && source.note !== null);
  const byWording = new Map<string, SourceCategory[]>();
  for (const source of noted) {
    const key = `${source.source} ${source.note}`;
    byWording.set(key, [...(byWording.get(key) ?? []), source]);
  }
  const notes: CategoryNote[] = [];
  for (const group of byWording.values()) {
    const [first] = group;
    const ids = new Set(group.map((source) => source.id));
    if (!first || !view.entries.every((entry) => entry.listings.some((listing) => ids.has(listing.category)))) continue;
    const label = (source: SourceCategory): string =>
      source.section && noted.some((other) => other.name === source.name && !ids.has(other.id)) ? `${source.section} › ${source.name}` : source.name;
    notes.push({ text: first.note ?? "", source: first.source, on: [...new Set(group.map(label))] });
  }
  return notes;
}

const ORIGIN_NAMES: Record<string, string> = { fdroid: "F-Droid", izzy: "IzzyOnDroid", github: "GitHub" };

/** The display name of whoever states a fact: an index, GitHub, or one of the catalogs. */
export function originName(model: Model, origin: Origin): string {
  return ORIGIN_NAMES[origin] ?? model.sourceById.get(origin as SourceId)?.name ?? origin;
}
