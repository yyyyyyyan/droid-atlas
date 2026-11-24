/**
 * An independent reading of the build the suite serves (`<site>/data`, see site.ts).
 *
 * The suite does not import the app's join, model or filters: it reads the
 * parts with its own small code so that a count or a link the app shows can be
 * compared with a value computed another way. Where the architecture fixes a
 * rule (source priority, summary order, what search looks at), this follows
 * the rule as written in `docs/ARCHITECTURE.md` and `schema/parts.ts`.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { siteDir } from "../site.ts";

export const DATA_ROOT = join(siteDir(), "data");

export type SourceId = "android-foss" | "awesome-shizuku" | "droid-atlas";

export interface Channel { type: "fdroid" | "izzy" | "play"; pkg: string; variant: string | null; listed: boolean | null }
export interface Repo { host: "github" | "gitlab" | "codeberg" | "sourcehut" | "other"; url: string; slug: string | null }

export interface Listing {
  app: string;
  source: SourceId;
  category: string;
  kind: "app" | "resource";
  order: number;
  name: string;
  url: string;
  description: string | null;
  tags: string[];
  license: string | null;
  added: string | null;
  parent: string | null;
  extraLinks: { name: string; url: string }[];
}

export interface Facets {
  shizuku: boolean;
  root: boolean;
  paid: boolean;
  recommended: boolean;
  fork: boolean;
  staleLink: boolean;
  onFdroid: boolean;
  onIzzy: boolean;
  openness: "open-source" | "source-available" | "closed-source" | null;
  noInternet: boolean | null;
  apkOnGithub: boolean | null;
  noAntiFeatures: boolean | null;
  archived: boolean | null;
}

export interface AtlasApp {
  id: string;
  /** The Droid Atlas category the app is filed under. */
  category: string;
  packages: string[];
  repo: Repo | null;
  website: string | null;
  channels: Channel[];
  icon: string | null;
  iconLarge: string | null;
  repoMissing: boolean;
  facets: Facets;
  evidence: Record<string, unknown>;
}

export interface GithubFacts {
  stars: number;
  pushedAt: string;
  archived: boolean;
  movedTo: string | null;
  forkOf: string | null;
  release: { tag: string; publishedAt: string; hasApk: boolean } | null;
}

/** A download figure as one origin publishes it; `from` and `to` are null for a running total. */
export interface DownloadStat { origin: "fdroid" | "izzy" | "github"; count: number; from: string | null; to: string | null }

export interface IndexRecord {
  facts: {
    origin: "fdroid" | "izzy";
    pkg: string;
    version: string | null;
    antiFeatures: string[];
    antiFeatureReasons: Record<string, string>;
    permissionCount: number;
    declaresShizuku: boolean;
    declaresInternet: boolean;
    updatedAt: string | null;
  };
  summary: string | null;
  license: string | null;
  downloads: DownloadStat | null;
}

/** An anti-feature as one index defines it, in its own words. */
export interface AntiFeatureDefinition { name: string; description: string | null }

export interface IndexPart { header: Header; antiFeatures: Record<string, AntiFeatureDefinition>; downloadSource?: DownloadSource; apps: Record<string, IndexRecord> }

/** A Droid Atlas category: where the app files an app. */
export interface Category { id: string; name: string; region: string; remainder: boolean }

/** A category as one source names it, with the Droid Atlas category it maps into (null for a catch-all). */
export interface SourceCategory { id: string; source: SourceId; name: string; section: string | null; category: string | null; region: string; order: number; note: string | null }

export interface Header {
  source: { name: string; url: string; commit: string | null; retrieved: string };
  license: string;
  licenseUrl: string | null;
  attribution: string;
  changes: string;
  warranty: string;
}

export interface ManifestFile { path: string; role: string; origin: string; sha256: string; bytes: number; license: string; attribution: string }

export interface App {
  id: string;
  atlas: AtlasApp;
  listings: Listing[];
  name: string;
  summary: string | null;
  github: GithubFacts | null;
  githubDescription: string | null;
  fdroid: IndexRecord | null;
  izzy: IndexRecord | null;
  /** The figure each origin publishes for the app, F-Droid's first; origins with none are absent. */
  downloads: DownloadStat[];
  /** The app's one category and one region, as sets so a check reads the same for either. */
  categories: Set<string>;
  regions: Set<string>;
  sources: Set<SourceId>;
  /** Folded text search looks at: names, summary, listing descriptions, the category's and the sources' category names, package ids, repository slug. */
  searchText: string;
}

/** Who publishes one origin's download figures. `newest` is the last day its figures count, or null for running totals. */
export interface DownloadSource { origin: string; name: string; retrieved: string; newest: string | null }

export interface Build {
  dataRoot: string;
  version: { schema: number; hash: string; manifest: string; generatedAt: string };
  dir: string;
  manifest: { schema: number; hash: string; files: ManifestFile[]; detailsShards: number };
  atlas: { header: Header; apps: AtlasApp[]; redirects: Record<string, string | null>; regions: { id: string; name: string }[]; categories: Category[] };
  sources: { header: Header; info: { id: SourceId; name: string; entries: number; commit: string }; categories: SourceCategory[]; listings: Listing[] }[];
  fdroid: IndexPart;
  izzy: IndexPart;
  github: { header: Header; downloadSource?: DownloadSource; apps: Record<string, { facts: GithubFacts; description: string | null; license: string | null; downloads: DownloadStat | null }> };
  apps: App[];
  byId: Map<string, App>;
  categories: Map<string, Category>;
  sourceCategories: Map<string, SourceCategory>;
}

const PRIORITY: SourceId[] = ["android-foss", "awesome-shizuku", "droid-atlas"];

export function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

let cached: Build | null = null;

export function loadBuild(dataRoot: string = DATA_ROOT): Build {
  if (cached && cached.dataRoot === dataRoot) return cached;
  const version = readJson<Build["version"]>(join(dataRoot, "version.json"));
  const dir = join(dataRoot, dirname(version.manifest));
  const manifest = readJson<Build["manifest"]>(join(dataRoot, version.manifest));
  const fileOf = (role: string, origin?: string): string => {
    const file = manifest.files.find((f) => f.role === role && (origin === undefined || f.origin === origin));
    if (!file) throw new Error(`manifest lists no ${role} file${origin ? ` for ${origin}` : ""}`);
    return join(dir, file.path);
  };
  const atlas = readJson<Build["atlas"]>(fileOf("atlas"));
  const sources = manifest.files.filter((f) => f.role === "source").map((f) => readJson<Build["sources"][number]>(join(dir, f.path)));
  const fdroid = readJson<Build["fdroid"]>(fileOf("index", "fdroid"));
  const izzy = readJson<Build["izzy"]>(fileOf("index", "izzy"));
  const github = readJson<Build["github"]>(fileOf("github"));

  const categories = new Map(atlas.categories.map((category) => [category.id, category]));
  const sourceCategories = new Map<string, SourceCategory>();
  for (const source of sources) for (const category of source.categories) sourceCategories.set(category.id, category);
  /** The names of the source categories a category takes in: it answers to them in search, in the source's spelling and in US spelling. */
  const takenIn = (categoryId: string): string[] => [...sourceCategories.values()].filter((source) => source.category === categoryId).map((source) => source.name);
  const listingsByApp = new Map<string, Listing[]>();
  for (const source of sources) {
    for (const listing of source.listings) {
      const list = listingsByApp.get(listing.app) ?? [];
      list.push(listing);
      listingsByApp.set(listing.app, list);
    }
  }

  const apps = atlas.apps.map((atlasApp): App => {
    const listings = [...(listingsByApp.get(atlasApp.id) ?? [])]
      .sort((a, b) => PRIORITY.indexOf(a.source) - PRIORITY.indexOf(b.source) || a.order - b.order);
    const fd = fdroid.apps[atlasApp.id] ?? null;
    const iz = izzy.apps[atlasApp.id] ?? null;
    const gh = github.apps[atlasApp.id] ?? null;
    const shizukuListing = listings.find((l) => l.source === "awesome-shizuku");
    const summary = fd?.summary || iz?.summary || shizukuListing?.description || gh?.description || null;
    const category = categories.get(atlasApp.category);
    const parts = [
      ...listings.map((l) => l.name),
      summary ?? "",
      ...listings.map((l) => l.description ?? ""),
      category?.name ?? "",
      ...takenIn(atlasApp.category),
      ...takenIn(atlasApp.category).map((name) => name.replace(/isation/g, "ization")),
      ...listings.map((l) => sourceCategories.get(l.category)?.name ?? ""),
      ...listings.map((l) => (sourceCategories.get(l.category)?.name ?? "").replace(/isation/g, "ization")),
      ...atlasApp.packages,
      atlasApp.repo?.slug ?? "",
    ];
    return {
      id: atlasApp.id,
      atlas: atlasApp,
      listings,
      name: listings[0]?.name ?? "",
      summary,
      github: gh?.facts ?? null,
      githubDescription: gh?.description ?? null,
      fdroid: fd,
      izzy: iz,
      downloads: [fd?.downloads, iz?.downloads, gh?.downloads].filter((stat): stat is DownloadStat => stat !== null && stat !== undefined),
      categories: new Set([atlasApp.category]),
      regions: new Set(category ? [category.region] : []),
      sources: new Set(listings.map((l) => l.source)),
      searchText: parts.map(fold).filter(Boolean).join(" "),
    };
  });

  cached = {
    dataRoot, version, dir, manifest, atlas, sources, fdroid, izzy, github, apps,
    byId: new Map(apps.map((app) => [app.id, app])),
    categories,
    sourceCategories,
  };
  return cached;
}

const descriptionsByBuild = new WeakMap<Build, Map<string, string[]>>();

/** The long descriptions the details parts hold for an app, from every origin: what a sheet's Read more can show, which `build.apps` does not carry. */
export function descriptionsOf(build: Build, appId: string): string[] {
  let byApp = descriptionsByBuild.get(build);
  if (!byApp) {
    byApp = new Map();
    for (const file of build.manifest.files.filter((f) => f.role === "details")) {
      const shard = readJson<Record<string, { description?: string }>>(join(build.dir, file.path));
      for (const [id, entry] of Object.entries(shard)) {
        if (typeof entry.description === "string") byApp.set(id, [...(byApp.get(id) ?? []), entry.description]);
      }
    }
    descriptionsByBuild.set(build, byApp);
  }
  return byApp.get(appId) ?? [];
}

/** The facts the filter tokens stand for, as `docs/ARCHITECTURE.md` and the app's filter blurbs define them. */
export const FILTER_TESTS: Record<string, (app: App) => boolean> = {
  shizuku: (a) => a.atlas.facets.shizuku,
  root: (a) => a.atlas.facets.root,
  "no-internet": (a) => a.atlas.facets.noInternet === true,
  open: (a) => a.atlas.facets.openness === "open-source",
  "source-available": (a) => a.atlas.facets.openness === "source-available",
  closed: (a) => a.atlas.facets.openness === "closed-source",
  paid: (a) => a.atlas.facets.paid,
  fdroid: (a) => a.atlas.facets.onFdroid,
  izzy: (a) => a.atlas.facets.onIzzy,
  apk: (a) => a.atlas.facets.apkOnGithub === true,
  clean: (a) => a.atlas.facets.noAntiFeatures === true,
  anti: (a) => a.atlas.facets.noAntiFeatures === false,
  active: (a) => a.atlas.facets.archived === false,
  archived: (a) => a.atlas.facets.archived === true,
  stale: (a) => a.atlas.facets.staleLink,
  fork: (a) => a.atlas.facets.fork,
  recommended: (a) => a.atlas.facets.recommended,
};

/** The `owner:` token of an app: its repository's forge and owner, the owner in lower case; null for a repository on no named forge, for none, and for an owner segment the slug rule (`schema/catalog.ts` `Repo`) does not allow. */
export function ownerToken(app: App): string | null {
  const { repo } = app.atlas;
  const owner = repo?.slug?.split("/")[0];
  return repo && repo.host !== "other" && owner && /^[A-Za-z0-9._~-]{1,100}$/.test(owner) ? `owner:${repo.host}/${owner.toLowerCase()}` : null;
}

/** Every license a source states for an app, verbatim: F-Droid's, IzzyOnDroid's, each listing's, GitHub's. */
export function licenseStatements(app: App): { value: string; origin: string }[] {
  const stated = [
    { value: app.fdroid?.license, origin: "fdroid" },
    { value: app.izzy?.license, origin: "izzy" },
    ...app.listings.map((listing) => ({ value: listing.license, origin: listing.source as string })),
    { value: loadBuild().github.apps[app.id]?.license, origin: "github" },
  ];
  return stated.filter((statement): statement is { value: string; origin: string } => typeof statement.value === "string" && statement.value !== "");
}

/**
 * Every license statement the sources made on 2026-11-24, written out with
 * the license lists it belongs to, as docs/ARCHITECTURE.md § Facts that lead
 * to lists defines them: one license in its spellings is one list, and a
 * statement that there is no license is in none. Written by hand, so a fault
 * in the app's folding rule shows as a difference.
 */
export const LICENSE_LISTS: Readonly<Record<string, readonly string[]>> = {
  "GPL-3.0": ["GPL-3.0"], "GPL-3.0-only": ["GPL-3.0"], "GPL-3.0-or-later": ["GPL-3.0"],
  "AGPL-3.0": ["AGPL-3.0"], "AGPL-3.0-only": ["AGPL-3.0"], "AGPL-3.0-or-later": ["AGPL-3.0"],
  "GPL-2.0": ["GPL-2.0"], "GPL-2.0-only": ["GPL-2.0"], "GPL-2.0-or-later": ["GPL-2.0"],
  "LGPL-3.0": ["LGPL-3.0"], "LGPL-3.0-only": ["LGPL-3.0"], "LGPL-3.0-or-later": ["LGPL-3.0"],
  "LGPL-2.1": ["LGPL-2.1"], "LGPL-2.1-only": ["LGPL-2.1"], "LGPL-2.1-or-later": ["LGPL-2.1"],
  "MIT": ["MIT"], "Apache-2.0": ["Apache-2.0"], "Apache 2.0": ["Apache-2.0"],
  "BSD-3-Clause": ["BSD-3-Clause"], "BSD 3-Clause": ["BSD-3-Clause"], "BSD-2-Clause": ["BSD-2-Clause"], "BSD-4-Clause": ["BSD-4-Clause"],
  "BSD-3-Clause-Clear": ["BSD-3-Clause-Clear"], "MPL-2.0": ["MPL-2.0"], "Modified MPL-2.0": ["Modified MPL-2.0"],
  "Unlicense": ["Unlicense"], "OSL-3.0": ["OSL-3.0"], "ISC": ["ISC"], "CC0-1.0": ["CC0-1.0"], "CC-BY-4.0": ["CC-BY-4.0"],
  "CC-BY-NC-ND-4.0": ["CC-BY-NC-ND-4.0"], "EPL-2.0": ["EPL-2.0"], "EUPL-1.2": ["EUPL-1.2"],
  "PolyForm-Noncommercial-1.0.0": ["PolyForm-Noncommercial-1.0.0"],
  "Apache-2.0 OR GPL-3.0-or-later": ["Apache-2.0", "GPL-3.0"],
  "Proprietary": [], "Propietary": [], "No license": [],
};

/** The `license:` token of each list the suite follows, written out. */
export const LICENSE_TOKENS: Readonly<Record<string, string>> = { "GPL-3.0": "license:gpl-3.0", "MIT": "license:mit", "Apache-2.0": "license:apache-2.0", "AGPL-3.0": "license:agpl-3.0" };

/** Statements in the build under test that `LICENSE_LISTS` does not know: a source has written a license in a way the table predates. */
export function unlistedLicenses(build: Build): string[] {
  return [...new Set(build.apps.flatMap((app) => licenseStatements(app).map((statement) => statement.value)))].filter((value) => !Object.hasOwn(LICENSE_LISTS, value));
}

/** The license lists an app belongs to, as `LICENSE_LISTS` gives them. */
export function licenseLists(app: App): string[] {
  return [...new Set(licenseStatements(app).flatMap((statement) => LICENSE_LISTS[statement.value] ?? []))];
}

/** The keys of the anti-features either index flags on an app. */
export function antiFeaturesOf(app: App): string[] {
  return [...new Set([...(app.fdroid?.facts.antiFeatures ?? []), ...(app.izzy?.facts.antiFeatures ?? [])])];
}

/** Every anti-feature some app in the build carries, with the explanation of the index that defines it, F-Droid's first. */
export function antiFeaturesUsed(build: Build): { id: string; description: string | null; with: number; without: number }[] {
  const ids = [...new Set(build.apps.flatMap(antiFeaturesOf))].sort();
  return ids.map((id) => {
    const definition = build.fdroid.antiFeatures[id] ?? build.izzy.antiFeatures[id];
    return {
      id,
      description: definition?.description ?? null,
      with: build.apps.filter((app) => antiFeaturesOf(app).includes(id)).length,
      without: build.apps.filter((app) => (app.fdroid !== null || app.izzy !== null) && !antiFeaturesOf(app).includes(id)).length,
    };
  });
}

/**
 * Text words must all occur in the searchable text; plain facts must all hold; region, category, source and openness tokens are alternatives within their group.
 * `af:<key>` holds for an app an index flags with that anti-feature, and `no:<key>` for one some index carries without flagging it.
 * `owner:` holds as `ownerToken` says, and `license:` as `LICENSE_LISTS` and `LICENSE_TOKENS` write it out.
 */
export function matchingApps(build: Build, text: string, filters: string[]): App[] {
  const words = fold(text).split(/\s+/).filter(Boolean);
  const groups = new Map<string, ((app: App) => boolean)[]>();
  const strict: ((app: App) => boolean)[] = [];
  for (const key of filters) {
    if (key.startsWith("r:")) groups.set("place", [...(groups.get("place") ?? []), (a) => a.regions.has(key.slice(2))]);
    else if (key.startsWith("c:")) groups.set("place", [...(groups.get("place") ?? []), (a) => a.categories.has(key.slice(2))]);
    else if (key.startsWith("s:")) groups.set("source", [...(groups.get("source") ?? []), (a) => a.sources.has(key.slice(2) as SourceId)]);
    else if (key.startsWith("af:")) strict.push((a) => antiFeaturesOf(a).includes(key.slice(3)));
    else if (key.startsWith("no:")) strict.push((a) => (a.fdroid !== null || a.izzy !== null) && !antiFeaturesOf(a).includes(key.slice(3)));
    else if (key.startsWith("owner:")) strict.push((a) => ownerToken(a) === key);
    else if (key.startsWith("license:")) {
      const list = Object.keys(LICENSE_TOKENS).find((name) => LICENSE_TOKENS[name] === key);
      if (!list) throw new Error(`no written-out list for ${key}`);
      strict.push((a) => licenseLists(a).includes(list));
    }
    else if (key === "open" || key === "source-available" || key === "closed") {
      const test = FILTER_TESTS[key];
      if (test) groups.set("terms", [...(groups.get("terms") ?? []), test]);
    } else {
      const test = FILTER_TESTS[key];
      if (!test) throw new Error(`no independent definition for filter ${key}`);
      strict.push(test);
    }
  }
  return build.apps.filter((app) =>
    words.every((word) => app.searchText.includes(word))
    && strict.every((test) => test(app))
    && [...groups.values()].every((alternatives) => alternatives.some((test) => test(app))),
  );
}

export function countMatches(build: Build, text: string, filters: string[]): number {
  return matchingApps(build, text, filters).length;
}

/** A guide, site or further-reading link rather than an app. */
export function isLink(app: App): boolean {
  return app.listings.length > 0 && app.listings.every((listing) => listing.kind === "resource");
}

/** What a filtered list's bar says: "8 of 1,281 apps", or "8 of 1,294" when links are among the results. */
export function filteredCount(build: Build, matches: readonly App[]): string {
  const found = matches.length.toLocaleString("en");
  if (matches.some(isLink)) return `${found} of ${build.apps.length.toLocaleString("en")}`;
  return `${found} of ${build.apps.filter((app) => !isLink(app)).length.toLocaleString("en")} apps`;
}

/** What the whole catalog's list says: its apps and its links apart. */
export function wholeCount(build: Build): string {
  const links = build.apps.filter(isLink).length;
  const apps = build.apps.length - links;
  const plural = (count: number, one: string): string => `${count.toLocaleString("en")} ${count === 1 ? one : `${one}s`}`;
  return links === 0 ? plural(apps, "app") : `${plural(apps, "app")} and ${plural(links, "link")}`;
}

/** The category a share link `#/app/<id>` lands on: the one the app is filed under. */
export function primaryCategory(app: App): string {
  return app.atlas.category;
}

/** `#/cat/<id>?app=<id>`, the canonical form of an open sheet over the app's category. */
export function sheetHash(app: App): string {
  return `#/cat/${primaryCategory(app)}?app=${app.id}`;
}

/** Deterministic pseudo-random generator for seeded samples (mulberry32). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sample<T>(items: readonly T[], count: number, seed: number): T[] {
  const random = seeded(seed);
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length) {
    const index = Math.floor(random() * pool.length);
    picked.push(pool.splice(index, 1)[0] as T);
  }
  return picked;
}

/** What one index's details shards hold for an app: its long description and its permission names, where there are any. */
export function detailsOf(build: Build, appId: string, origin: "fdroid" | "izzy"): { description?: string; permissions?: string[] } {
  for (const file of build.manifest.files) {
    if (file.role !== "details" || file.origin !== origin) continue;
    const shard = readJson<Record<string, { description?: string; permissions?: string[] }>>(join(build.dir, file.path));
    if (Object.hasOwn(shard, appId)) return shard[appId] ?? {};
  }
  return {};
}

/** The permission names one index lists for an app, read from that index's details shards; empty when it lists none. */
export function permissionNamesOf(build: Build, appId: string, origin: "fdroid" | "izzy"): string[] {
  return detailsOf(build, appId, origin).permissions ?? [];
}

/** Android's statements about the permissions apps declare, as the build's android part carries them. */
export interface AndroidPart {
  android: { version: string; tag: string; commit: string };
  permissions: Record<string, { protectionLevel: string; label: string | null }>;
}

/** The build's android part; null when it has none. */
export function androidPartOf(build: Build): AndroidPart | null {
  const file = build.manifest.files.find((f) => f.role === "android");
  return file ? readJson<AndroidPart>(join(build.dir, file.path)) : null;
}
