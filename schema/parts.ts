/**
 * The files a build is published as.
 *
 * `Catalog` in `catalog.ts` is what the app works with in memory. On disk the
 * same information is split by origin, because the sources are published under
 * licenses that do not combine into one file (see docs/LICENSING.md). Each
 * part carries its own license header; the app fetches the parts a manifest
 * lists and joins them with `joinCatalog` from `join.ts`.
 *
 * Invariant, enforced by a pipeline test: `joinCatalog(splitCatalog(c))`
 * equals `c`.
 *
 * `joinCatalog` fills the fields of `App` that no part stores directly:
 * - `name`: the name in the primary listing.
 * - `region`: the region of the app's category.
 * - `listings`: every source's listings for the app, by source priority
 *   (android-foss, awesome-shizuku, droid-atlas), then `order`.
 * - `summary`: the first of F-Droid's summary, IzzyOnDroid's summary, the
 *   primary awesome-shizuku listing's description, GitHub's repository
 *   description; with its origin.
 * - `license`: the first of F-Droid's, IzzyOnDroid's, a listing's stated
 *   license, GitHub's; with its origin.
 * - `licenses`: every one of those statements, in the same order.
 * - `index`: the F-Droid entry, then the IzzyOnDroid entry, where present.
 * - `github`: the GitHub part's facts.
 * - `downloads`: the F-Droid, IzzyOnDroid and GitHub parts' figures for the
 *   app, in that order, where present.
 * `Catalog.antiFeatures`: every key some app's index facts carry, defined by
 * the F-Droid part when it defines the key, else by the IzzyOnDroid part.
 * `Catalog.enrichment.downloads`: the `downloadSource` of each part that
 * has one, in the same order.
 * - `search`: lower-cased names, summary, listing descriptions, the app's
 *   category name and its listings' source category names, package ids and
 *   repository slug, diacritics folded.
 * `Catalog.sources`, `sourceCategories` and `enrichment` are gathered from the parts.
 */
import type {
  App,
  Category,
  DownloadSource,
  DownloadStat,
  GithubFacts,
  IndexFacts,
  Listing,
  Region,
  SourceCategory,
  SourceId,
  SourceInfo,
} from "./catalog.ts";
import { CATALOG_SCHEMA_VERSION } from "./catalog.ts";

/** License and provenance statement that opens every part. */
export interface PartHeader {
  /** The upstream this part was made from; `commit` is null where the upstream has none. */
  source: { name: string; url: string; commit: string | null; retrieved: string };
  /** SPDX identifier, or `LicenseRef-per-record` when each record states its own. */
  license: string;
  licenseUrl: string | null;
  attribution: string;
  /** What Droid Atlas changed, with the date, as the source's license requires. */
  changes: string;
  warranty: string;
}

/**
 * Droid Atlas's own contribution: which listings are the same app, its
 * regions and categories and where each app is filed, and the computed
 * facets. Facts and our own judgments only; no text from any source.
 */
export interface AtlasPart {
  header: PartHeader;
  schema: typeof CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  hash: string;
  regions: Region[];
  categories: Category[];
  apps: AtlasApp[];
  redirects: Record<string, string | null>;
}

export type AtlasApp = Pick<
  App,
  "id" | "category" | "packages" | "repo" | "website" | "channels" | "icon" | "iconLarge" | "repoMissing" | "facets" | "evidence"
>;

/** One catalog, in its own words: its categories, each with the Droid Atlas category it maps into, and its entries. */
export interface SourcePart {
  header: PartHeader;
  info: SourceInfo;
  categories: SourceCategory[];
  /** Each listing names the app it belongs to; the listing order within an app follows source priority, then `order`. */
  listings: (Listing & { app: string })[];
}

/** An anti-feature definition in the index's own English words. */
export interface AntiFeatureDefinition {
  name: string;
  description: string | null;
}

/** What one repository index states about the apps it carries, keyed by app id. */
export interface IndexPart {
  header: PartHeader;
  origin: "fdroid" | "izzy";
  indexAt: string;
  /** Every anti-feature the index defines, by key. */
  antiFeatures: Record<string, AntiFeatureDefinition>;
  /** Publisher of the download figures below; null when this build has none from it. */
  downloadSource: DownloadSource | null;
  apps: Record<string, { facts: IndexFacts; summary: string | null; license: string | null; downloads: DownloadStat | null }>;
}

/** What GitHub states about each app's repository, keyed by app id. */
export interface GithubPart {
  header: PartHeader;
  fetchedAt: string;
  /** Publisher of the download figures below; null when this build has none. */
  downloadSource: DownloadSource | null;
  apps: Record<string, { facts: GithubFacts; description: string | null; license: string | null; downloads: DownloadStat | null }>;
}

/**
 * How an icon was found, most trustworthy first. The report counts icons by
 * rule, and a class of source can be vetoed by its rule.
 *
 * - `fdroid-index`, `izzy-index`: the package's icon in that repository index.
 * - `repo-fastlane`: `fastlane/metadata/android/<locale>/images/icon.png` in the project's repository.
 * - `repo-metadata`: `metadata/<locale>/images/icon.png` in the project's repository.
 * - `repo-launcher`: the highest-density launcher icon under `res/mipmap-*`.
 * - `readme-logo`: an image the README marks as the project's logo or icon.
 * - `site-icon`: the icon the project's website declares (web manifest, `apple-touch-icon`, a large `rel=icon`).
 * - `store-listing`: the icon of the app's store listing.
 * - `forge-avatar`: the avatar of a repository or organization that is the project's own.
 */
export type IconRule =
  | "fdroid-index"
  | "izzy-index"
  | "repo-fastlane"
  | "repo-metadata"
  | "repo-launcher"
  | "readme-logo"
  | "site-icon"
  | "store-listing"
  | "forge-avatar";

/** Where one self-hosted icon came from and who it belongs to. */
export interface IconRecord {
  /** `App.icon`: the list-size file. */
  file: string;
  /** `App.iconLarge`: the sheet-size file; equal to `file` when the original is small. */
  fileLarge: string;
  /** Id of the app the icon is shown for. */
  app: string;
  /** The app's name as Droid Atlas shows it. */
  name: string;
  rule: IconRule;
  /** The exact file downloaded and the SHA-256 of its bytes. */
  original: { url: string; sha256: string };
  /** Repository commit the file was read at, or the index's timestamp; null when the source has no revision. */
  revision: string | null;
  /** ISO date the original was downloaded. */
  retrieved: string;
  /** The app's author or project, as the source names it; "the <name> developers" when no source names one. */
  author: string;
  /** The project's license as a source states it, verbatim; "not stated" when none does. Not necessarily the icon's own license. */
  license: string;
  /** The project's repository or website, for the credit's link. */
  project: string | null;
  /** What Droid Atlas changed in the image. */
  changes: string;
}

export interface IconsPart {
  header: PartHeader;
  icons: IconRecord[];
}

export type PartRole = "atlas" | "source" | "index" | "github" | "icons" | "details" | "upstream";

export interface ManifestFile {
  /** Path relative to the directory holding the manifest. */
  path: string;
  role: PartRole;
  /** The origin the file's content comes from. */
  origin: SourceId | "fdroid" | "izzy" | "github" | "droid-atlas";
  sha256: string;
  bytes: number;
  /** SPDX identifier, or `LicenseRef-per-record`. */
  license: string;
  attribution: string;
}

/** Lists every file of one build. The app loads the atlas, source, index and github parts at start; the rest on demand. */
export interface Manifest {
  schema: typeof CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  hash: string;
  files: ManifestFile[];
  /** Details live at `details/<origin>/<n>.json`; an app's shard is `detailsShard(app.id, detailsShards)`. */
  detailsShards: number;
}
