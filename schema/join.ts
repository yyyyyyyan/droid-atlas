/**
 * Joins the per-origin parts of a build (`parts.ts`) into the in-memory
 * `Catalog` (`catalog.ts`).
 *
 * Pure: no Node or browser API, no I/O, so the app runs it at start and the
 * pipeline runs it in validation. The rules for the fields no part stores
 * directly are documented at the top of `parts.ts`; the `derive*` functions
 * below are those rules, and the pipeline builds its catalog with the same
 * functions, which is what lets `joinCatalog(splitCatalog(c))` equal `c`.
 */
import type { AntiFeature, App, Catalog, DownloadSource, DownloadStat, GithubFacts, IndexFacts, Listing, SourceCategory, Sourced, SourceId, SourceInfo } from "./catalog.ts";
import type { AtlasPart, GithubPart, IndexPart, SourcePart } from "./parts.ts";

/** Source priority for the primary listing and for listing order. */
export const SOURCE_PRIORITY: readonly SourceId[] = ["android-foss", "awesome-shizuku", "droid-atlas"];

export interface CatalogParts {
  atlas: AtlasPart;
  sources: SourcePart[];
  /** The F-Droid and IzzyOnDroid parts, in any order. */
  indexes: IndexPart[];
  github: GithubPart;
}

/** What one index states about one app. */
export interface IndexStatement {
  facts: IndexFacts;
  summary: string | null;
  license: string | null;
  downloads: DownloadStat | null;
}

/** What GitHub states about one app's repository. */
export interface GithubStatement {
  facts: GithubFacts;
  description: string | null;
  license: string | null;
  downloads: DownloadStat | null;
}

/** Everything the derived fields of one app are computed from. */
export interface AppStatements {
  /** Already in listing order (see `sortListings`). */
  listings: Listing[];
  fdroid: IndexStatement | null;
  izzy: IndexStatement | null;
  github: GithubStatement | null;
  packages: string[];
  repoSlug: string | null;
  categoryName: (id: string) => string | undefined;
}

function priority(source: SourceId): number {
  const index = SOURCE_PRIORITY.indexOf(source);
  return index === -1 ? SOURCE_PRIORITY.length : index;
}

/** Stable sort by source priority, then `order`. Listings that tie keep their relative order. */
export function sortListings<T extends Pick<Listing, "source" | "order">>(listings: T[]): T[] {
  return listings
    .map((listing, position) => ({ listing, position }))
    .sort((a, b) => priority(a.listing.source) - priority(b.listing.source) || a.listing.order - b.listing.order || a.position - b.position)
    .map((x) => x.listing);
}

/** Lower-cases and removes diacritics, so "Café" and "cafe" match. */
export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function present(text: string | null | undefined): text is string {
  return typeof text === "string" && text.length > 0;
}

export function deriveName(statements: AppStatements): string {
  return statements.listings[0]?.name ?? "";
}

/** F-Droid's summary, IzzyOnDroid's, the primary awesome-shizuku listing's description, GitHub's description. */
export function deriveSummary(statements: AppStatements): Sourced<string> | null {
  if (present(statements.fdroid?.summary)) return { value: statements.fdroid.summary, origin: "fdroid" };
  if (present(statements.izzy?.summary)) return { value: statements.izzy.summary, origin: "izzy" };
  const shizuku = statements.listings.find((l) => l.source === "awesome-shizuku");
  if (present(shizuku?.description)) return { value: shizuku.description, origin: "awesome-shizuku" };
  if (present(statements.github?.description)) return { value: statements.github.description, origin: "github" };
  return null;
}

/** F-Droid's license, IzzyOnDroid's, the first listing's that states one, GitHub's. */
export function deriveLicense(statements: AppStatements): Sourced<string> | null {
  if (present(statements.fdroid?.license)) return { value: statements.fdroid.license, origin: "fdroid" };
  if (present(statements.izzy?.license)) return { value: statements.izzy.license, origin: "izzy" };
  const listing = statements.listings.find((l) => present(l.license));
  if (listing && present(listing.license)) return { value: listing.license, origin: listing.source };
  if (present(statements.github?.license)) return { value: statements.github.license, origin: "github" };
  return null;
}

export function deriveIndex(statements: AppStatements): IndexFacts[] {
  return [statements.fdroid?.facts, statements.izzy?.facts].filter((f): f is IndexFacts => f !== undefined);
}

/** F-Droid's figure, IzzyOnDroid's, GitHub's, where each exists. */
export function deriveDownloads(statements: AppStatements): DownloadStat[] {
  return [statements.fdroid?.downloads, statements.izzy?.downloads, statements.github?.downloads].filter(
    (d): d is DownloadStat => d !== null && d !== undefined,
  );
}

/**
 * Every anti-feature key the apps' index facts carry, sorted, with each
 * index's definition of it, F-Droid first. The label is the first
 * definition's name, or the bare key when no index defines it.
 */
export function deriveAntiFeatures(apps: readonly Pick<App, "index">[], indexes: readonly Pick<IndexPart, "origin" | "antiFeatures">[]): AntiFeature[] {
  const used = new Set(apps.flatMap((app) => app.index.flatMap((facts) => facts.antiFeatures)));
  const ordered = [...indexes].sort((a, b) => (a.origin === b.origin ? 0 : a.origin === "fdroid" ? -1 : 1));
  return [...used]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((id) => {
      const definitions = ordered.flatMap((index) => {
        const definition = Object.hasOwn(index.antiFeatures, id) ? index.antiFeatures[id] : undefined;
        return definition ? [{ origin: index.origin, name: definition.name, description: definition.description }] : [];
      });
      return { id, name: definitions[0]?.name ?? id, definitions };
    });
}

/** A source's spelling as the interface, which is in US English, would spell it ("Synchronisation" as "Synchronization"). */
export function americanSpelling(text: string): string {
  return text.replace(/isation/g, "ization");
}

/**
 * The names a category answers to in search: its own, then those of the
 * source categories it takes in, as each source spells them and in US
 * spelling. So the name a person knows from a source finds the whole
 * category, and so does the interface's own spelling of it.
 */
export function categoryAnswers(category: { id: string; name: string }, sourceCategories: readonly { category: string | null; name: string }[]): string[] {
  const names = sourceCategories.filter((source) => source.category === category.id).map((source) => source.name);
  return [category.name, ...names, ...names.map(americanSpelling)];
}

/**
 * Names, summary, listing descriptions, the names the app's category answers
 * to, its listings' source category names in the source's spelling and in
 * US spelling, package ids and repository slug, folded.
 */
export function deriveSearch(statements: AppStatements, summary: Sourced<string> | null, categoryNames: readonly string[]): string {
  const parts = [
    ...statements.listings.map((l) => l.name),
    summary?.value ?? "",
    ...statements.listings.map((l) => l.description ?? ""),
    ...categoryNames,
    ...statements.listings.flatMap((l) => {
      const name = statements.categoryName(l.category) ?? "";
      return [name, americanSpelling(name)];
    }),
    ...statements.packages,
    statements.repoSlug ?? "",
  ];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const part of parts) {
    const folded = foldText(part);
    if (folded && !seen.has(folded)) {
      seen.add(folded);
      kept.push(folded);
    }
  }
  return kept.join(" ");
}

function joinApp(
  atlas: AtlasPart["apps"][number],
  listings: Listing[],
  indexes: Map<string, IndexPart>,
  github: GithubPart,
  categoryName: (id: string) => string | undefined,
  category: { region: string; answers: string[] } | undefined,
): App {
  const statements: AppStatements = {
    listings,
    fdroid: indexes.get("fdroid")?.apps[atlas.id] ?? null,
    izzy: indexes.get("izzy")?.apps[atlas.id] ?? null,
    github: github.apps[atlas.id] ?? null,
    packages: atlas.packages,
    repoSlug: atlas.repo?.slug ?? null,
    categoryName,
  };
  const summary = deriveSummary(statements);
  return {
    id: atlas.id,
    name: deriveName(statements),
    category: atlas.category,
    region: category?.region ?? "",
    listings,
    packages: atlas.packages,
    repo: atlas.repo,
    website: atlas.website,
    channels: atlas.channels,
    summary,
    icon: atlas.icon,
    iconLarge: atlas.iconLarge,
    license: deriveLicense(statements),
    index: deriveIndex(statements),
    github: statements.github?.facts ?? null,
    downloads: deriveDownloads(statements),
    repoMissing: atlas.repoMissing,
    facets: atlas.facets,
    evidence: atlas.evidence,
    search: deriveSearch(statements, summary, category?.answers ?? []),
  };
}

export function joinCatalog(parts: CatalogParts): Catalog {
  const sources = [...parts.sources].sort((a, b) => priority(a.info.id) - priority(b.info.id));
  const sourceCategories: SourceCategory[] = sources.flatMap((s) => s.categories);
  const names = new Map(sourceCategories.map((c) => [c.id, c.name]));
  const categoryName = (id: string): string | undefined => names.get(id);
  const categories = new Map(parts.atlas.categories.map((c) => [c.id, { region: c.region, answers: categoryAnswers(c, sourceCategories) }]));

  const listingsByApp = new Map<string, Listing[]>();
  for (const source of sources) {
    for (const { app, ...listing } of source.listings) {
      const list = listingsByApp.get(app) ?? [];
      list.push(listing);
      listingsByApp.set(app, list);
    }
  }
  const indexes = new Map(parts.indexes.map((p) => [p.origin, p]));
  const infos: SourceInfo[] = sources.map((s) => s.info);
  const apps = parts.atlas.apps.map((atlas) =>
    joinApp(atlas, sortListings(listingsByApp.get(atlas.id) ?? []), indexes, parts.github, categoryName, categories.get(atlas.category)),
  );
  const downloads = [indexes.get("fdroid")?.downloadSource, indexes.get("izzy")?.downloadSource, parts.github.downloadSource].filter(
    (d): d is DownloadSource => d !== null && d !== undefined,
  );

  return {
    schema: parts.atlas.schema,
    generatedAt: parts.atlas.generatedAt,
    hash: parts.atlas.hash,
    sources: infos,
    enrichment: {
      fdroidIndexAt: indexes.get("fdroid")?.indexAt ?? "",
      izzyIndexAt: indexes.get("izzy")?.indexAt ?? "",
      githubFetchedAt: parts.github.fetchedAt,
      downloads,
    },
    regions: parts.atlas.regions,
    categories: parts.atlas.categories,
    sourceCategories,
    antiFeatures: deriveAntiFeatures(apps, parts.indexes),
    apps,
    redirects: parts.atlas.redirects,
  };
}
