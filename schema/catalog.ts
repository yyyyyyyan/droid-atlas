/**
 * The catalog contract between the pipeline and the app.
 *
 * The pipeline writes these shapes; the app reads them and nothing else.
 *
 * Two kinds of field need care:
 * - **Facts and facets** are stated by a named source or are absent. For these,
 *   `null` (or an empty origin list) means "no source says", never "no".
 * - **Structural fields** (`section`, `note`, `variant`, `website`, `movedTo`,
 *   `parent`) use `null` to mean "there is none".
 */

export const CATALOG_SCHEMA_VERSION = 3;

/** A catalog whose entries Droid Atlas lists. "droid-atlas" is reserved for hand-picked entries. */
export type SourceId = "android-foss" | "awesome-shizuku" | "droid-atlas";

/** Where a fact or a piece of text came from. */
export type Origin = SourceId | "fdroid" | "izzy" | "github";

/**
 * How a fact is known, beside who says so (`Origin`). The four levels never
 * merge: a fact read from a package is not documented, and a documented
 * interface is not verified. docs/ARCHITECTURE.md § Evidence levels maps each
 * fact the catalog carries to its level.
 */
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

/**
 * - `documented`: the app's own project says so.
 * - `statically-discovered`: read from the app's package or source by a tool, without running it.
 * - `reported`: someone other than the project says so.
 * - `experimentally-verified`: the app was run and the result observed.
 */
export const EVIDENCE_LEVELS = ["documented", "statically-discovered", "reported", "experimentally-verified"] as const;

export interface SourceInfo {
  id: SourceId;
  name: string;
  url: string;
  /** SPDX identifier of the license the list itself is published under. */
  license: string;
  licenseUrl: string;
  /** Commit of the upstream list this build was made from. */
  commit: string;
  committedAt: string;
  entries: number;
  /** Upstream lines the parser could not interpret. Shown in the app, never dropped silently. */
  anomalies: Anomaly[];
}

export interface Anomaly {
  /** Path of the upstream file within its repository. */
  file: string;
  line: number;
  kind: string;
  text: string;
}

export interface EnrichmentInfo {
  fdroidIndexAt: string;
  izzyIndexAt: string;
  githubFetchedAt: string;
  /** Who publishes each origin's download figures; an origin with no figures in this build is absent. */
  downloads: DownloadSource[];
}

/** The publisher of one origin's download figures. */
export interface DownloadSource {
  origin: DownloadOrigin;
  name: string;
  url: string;
  /** SPDX identifier the publisher states for the data, or null when it states none. */
  license: string | null;
  /** When the figures were last confirmed current (ISO timestamp). */
  retrieved: string;
  /**
   * Last day the publisher's newest figures count (ISO date), or null for an
   * origin whose figures are running totals (GitHub). A publisher can stop
   * publishing while it stays reachable, so this, not `retrieved`, says how
   * old the figures are.
   */
  newest: string | null;
}

/** Droid Atlas's own top-level grouping of its categories. Presentation, not a source claim. */
export interface Region {
  id: string;
  name: string;
}

/**
 * A category of Droid Atlas's own taxonomy (docs/TAXONOMY.md): where the app
 * files an app, whatever each source calls its category. Presentation, not a
 * source claim. The catalog lists every category of the table in reading
 * order; one that holds no app in a build is not shown.
 */
export interface Category {
  /** A slug, stable across builds. */
  id: string;
  /** US English, by the naming rule in docs/COPY.md. */
  name: string;
  region: string;
  /** Holds the apps of its region that nobody has placed yet; at most one per region. */
  remainder: boolean;
}

/** A category exactly as one source names it: a fact about that source's listings, shown as the source's wording. */
export interface SourceCategory {
  /** `<source>/<slug>`, stable across builds. */
  id: string;
  source: SourceId;
  name: string;
  /** Upstream grouping above the category, when the source has one ("Apps", "Games", "Vendor-specific"). */
  section: string | null;
  /** The Droid Atlas category it maps into, or null for a catch-all, whose apps are placed one by one. */
  category: string | null;
  /** The region of `category`; for a catch-all, the region whose remainder holds its apps until they are placed. */
  region: string;
  /** Position of the category in the upstream document. */
  order: number;
  /** A note the source attaches to the whole category, quoted with attribution. */
  note: string | null;
}

/** Annotations a source puts on an entry, normalized across sources. */
export type ListingTag =
  | "recommended"
  | "paid"
  | "iap"
  | "trial"
  | "ads"
  | "root"
  | "source-available"
  | "closed-source"
  | "archived";

/** One appearance of an app in one source. Text here is that source's own wording. */
export interface Listing {
  source: SourceId;
  /** Id of the source's own category (`SourceCategory`). */
  category: string;
  /** "resource" marks guides, sites and further-reading links that are not installable apps. */
  kind: "app" | "resource";
  /** Position within the category in the upstream document. */
  order: number;
  /** The name as this source spells it. */
  name: string;
  /** The link this source gives for the entry. */
  url: string;
  description: string | null;
  tags: ListingTag[];
  /** License as stated by this source, verbatim. */
  license: string | null;
  /** ISO date the entry first appeared in this source, from its git history. */
  added: string | null;
  /** Id of the app this entry is nested under in the source, if any. */
  parent: string | null;
  /** Further links this source attaches to the entry. */
  extraLinks: { name: string; url: string }[];
}

export type ChannelType = "fdroid" | "izzy" | "play";

/** A place the app can be obtained from. */
export interface Channel {
  type: ChannelType;
  /** Matches `^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$`; anything else is rejected by the pipeline. */
  pkg: string;
  /** Label for an alternative build of the same app ("Beta", "F-Droid build"), otherwise null. */
  variant: string | null;
  /** False when a source links it but the repository no longer has it; null when it cannot be checked (Play). */
  listed: boolean | null;
}

export interface Repo {
  host: "github" | "gitlab" | "codeberg" | "sourcehut" | "other";
  /** Canonical web URL, following renames where the forge reports them. */
  url: string;
  /** `owner/name` for the four named forges, each segment matching `[A-Za-z0-9._~-]+`; null for "other". */
  slug: string | null;
}

export interface Sourced<T> {
  value: T;
  origin: Origin;
}

export type Openness = "open-source" | "source-available" | "closed-source";
export type Pricing = "free" | "paid" | "iap" | "trial";

export interface GithubFacts {
  stars: number;
  pushedAt: string;
  archived: boolean;
  /** `owner/name` the repository now lives at, when it differs from the linked one. */
  movedTo: string | null;
  /** `owner/name` of the repository this one was forked from. Forks are separate apps, never merged with their parent. */
  forkOf: string | null;
  release: { tag: string; publishedAt: string; hasApk: boolean } | null;
}

/** Origins that publish download figures. */
export type DownloadOrigin = "fdroid" | "izzy" | "github";

/**
 * A download figure as one source publishes it. Sources count different
 * things over different periods, so figures from two origins are never added
 * or compared; what each origin counts is `DOWNLOAD_MEANING`.
 */
export interface DownloadStat {
  origin: DownloadOrigin;
  /** At least 1: a source that publishes nothing for the app gives no figure, never a zero. */
  count: number;
  /** First and last day counted (ISO dates, UTC). Both null when the source reports a running total. */
  from: string | null;
  to: string | null;
}

/** What a `DownloadStat` of each origin counts, in one sentence the app can show beside the figure and its period. */
export const DOWNLOAD_MEANING: Readonly<Record<DownloadOrigin, string>> = {
  fdroid:
    "Requests for the app's APK files to F-Droid's own download servers; third-party mirrors are not counted, and F-Droid omits any file requested fewer than 100 times in a week on a server.",
  izzy: "Successful APK downloads from the IzzyOnDroid servers that report statistics, counted from their logs.",
  github: "Downloads of the APK files attached to the latest GitHub release, as GitHub counts them since each file was uploaded.",
};

/**
 * An anti-feature key with each index's own definition of it. The indexes
 * word some keys differently (IzzyOnDroid's `NonFreeDep` also covers non-free
 * libraries), so an app's flag is explained by the definition of the index
 * that flags it (`IndexFacts.origin`).
 */
export interface AntiFeature {
  /** The index's own key, e.g. `NonFreeNet`; both indexes spell a key the same way. */
  id: string;
  /** A short label: F-Droid's name when F-Droid defines the key, else IzzyOnDroid's, else the key itself. */
  name: string;
  /** Each index's English definition, F-Droid first; empty when neither index defines a key it uses. */
  definitions: { origin: "fdroid" | "izzy"; name: string; description: string | null }[];
}

/** Pixel sizes of the two files of a self-hosted icon: list rows and the app sheet. */
export const ICON_PIXELS = { list: 192, large: 384 } as const;

/** Facts read from one repository index for the app's latest version there. */
export interface IndexFacts {
  origin: "fdroid" | "izzy";
  pkg: string;
  version: string | null;
  updatedAt: string | null;
  addedAt: string | null;
  minSdk: number | null;
  targetSdk: number | null;
  sizeBytes: number | null;
  author: string | null;
  /** Keys of the anti-features the index flags on the latest version, sorted; each is defined in `Catalog.antiFeatures`. */
  antiFeatures: string[];
  /**
   * The index's own sentence on why it flags an anti-feature, by key, in
   * English and plain text; a key the index gives no reason for has no entry.
   */
  antiFeatureReasons: Record<string, string>;
  permissionCount: number;
  declaresShizuku: boolean;
  declaresInternet: boolean;
}

/**
 * What the filters run on, computed once in the pipeline so the app, the tests
 * and the build report agree.
 *
 * `shizuku`, `root`, `paid`, `recommended`, `fork` and `staleLink` are true
 * when at least one source says so and false otherwise: no source ever states
 * their negative. The three-state fields are null when no source can tell.
 */
export interface Facets {
  shizuku: boolean;
  root: boolean;
  paid: boolean;
  recommended: boolean;
  fork: boolean;
  staleLink: boolean;
  onFdroid: boolean;
  onIzzy: boolean;
  /** The most restrictive openness any source states. */
  openness: Openness | null;
  noInternet: boolean | null;
  apkOnGithub: boolean | null;
  noAntiFeatures: boolean | null;
  archived: boolean | null;
}

/**
 * Who says what, for the claims the app must attribute. A manifest that
 * requests the Shizuku permission appears here as "fdroid" or "izzy"; a
 * catalog that lists the app as a Shizuku app appears as that catalog. Sources
 * may disagree on openness and pricing; every statement is kept.
 */
export interface Evidence {
  shizuku: Origin[];
  root: Origin[];
  archived: Origin[];
  noInternet: Origin[];
  openness: Sourced<Openness>[];
  pricing: Sourced<Pricing>[];
}

export interface App {
  /**
   * Stable, URL-safe id. Assigned once and kept for good: the pipeline carries
   * ids forward from the previous catalog, and an id that has to change is
   * recorded in `Catalog.redirects`.
   */
  id: string;
  name: string;
  /**
   * The one Droid Atlas category the app is filed under: a reviewed
   * placement, else that of the first listing, by source priority
   * (android-foss, awesome-shizuku, droid-atlas) then `order`, whose source
   * category is not a catch-all (`pipeline/taxonomy.ts`).
   */
  category: string;
  /** Region of `category`. */
  region: string;
  /** At least one, each in its source's own category. */
  listings: Listing[];
  /** Verified Android package ids, most authoritative first. */
  packages: string[];
  repo: Repo | null;
  /** Project website when it differs from the repository. */
  website: string | null;
  channels: Channel[];
  summary: Sourced<string> | null;
  /**
   * Self-hosted icon for list rows: `icons/<16 hex>.webp`, a square WebP of
   * `ICON_PIXELS.list` pixels named by the start of its own SHA-256, relative
   * to the data root. Null when no source gave a usable icon.
   */
  icon: string | null;
  /**
   * The same icon at `ICON_PIXELS.large` pixels for the app sheet, named the
   * same way. Equal to `icon` when the original is too small to gain from it;
   * null exactly when `icon` is.
   */
  iconLarge: string | null;
  license: Sourced<string> | null;
  /** Every license a source states, verbatim and in the order `license` is chosen by; `license` is the first. */
  licenses: Sourced<string>[];
  /** One entry per repository index that carries the app; F-Droid first. */
  index: IndexFacts[];
  github: GithubFacts | null;
  /** Download figures: F-Droid's, then IzzyOnDroid's, then GitHub's; at most one per origin. */
  downloads: DownloadStat[];
  /** True when a source links a GitHub repository that no longer exists. */
  repoMissing: boolean;
  facets: Facets;
  evidence: Evidence;
  /** Lower-cased text the app searches: names, summary, descriptions, the category's and the sources' category names, package ids, repository slug. */
  search: string;
}

export interface Catalog {
  schema: typeof CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  /** Changes whenever anything other than `generatedAt` changes. */
  hash: string;
  sources: SourceInfo[];
  enrichment: EnrichmentInfo;
  regions: Region[];
  /** Droid Atlas's categories, in reading order. */
  categories: Category[];
  /** Each source's own categories, by source priority, then upstream order. */
  sourceCategories: SourceCategory[];
  /** Every anti-feature some app's `index` carries, sorted by id. */
  antiFeatures: AntiFeature[];
  apps: App[];
  /** Retired id → the id that replaced it, or null when the app left every catalog. */
  redirects: Record<string, string | null>;
}

/**
 * The one mutable file the site serves. Everything it leads to is immutable
 * and lives under a directory named after the catalog hash, so a client can
 * never pair data from two builds. The files themselves are described in
 * `parts.ts`.
 */
export interface CatalogVersion {
  schema: typeof CATALOG_SCHEMA_VERSION;
  generatedAt: string;
  hash: string;
  /** Path of the build manifest relative to the data root, e.g. `c/3fa9c1d2/manifest.json`. */
  manifest: string;
}

/** Shard index for an app id: FNV-1a (32-bit) of the id, modulo the shard count. */
export function detailsShard(id: string, shards: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % shards;
}

/** One details shard: long text loaded on demand, keyed by app id. All text in a shard comes from one origin. */
export type DetailsShard = Record<string, { description: string }>;
