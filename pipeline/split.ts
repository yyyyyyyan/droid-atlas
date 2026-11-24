/**
 * Splits the in-memory catalog into the per-origin parts it is published as
 * (`schema/parts.ts`). The inverse of `joinCatalog`: validation checks that
 * `joinCatalog(splitCatalog(c))` equals `c` on every build.
 *
 * Each origin's text goes only into that origin's part. A GitHub repository
 * description is kept only for apps whose summary it is, which is when no
 * licensed text exists (docs/LICENSING.md §2.F).
 */
import type { Catalog, DownloadOrigin, DownloadSource, SourceId } from "../schema/catalog.ts";
import type { AppStatements, CatalogParts } from "../schema/join.ts";
import type { AntiFeatureDefinition, AtlasApp, GithubPart, IndexPart, PartHeader, SourcePart } from "../schema/parts.ts";

export interface PartHeaders {
  atlas: PartHeader;
  sources: Partial<Record<SourceId, PartHeader>>;
  fdroid: PartHeader;
  izzy: PartHeader;
  github: PartHeader;
}

/** What the index parts carry beyond the catalog: each index's own anti-feature definitions. */
export interface SplitExtras {
  antiFeatures: Record<"fdroid" | "izzy", Record<string, AntiFeatureDefinition>>;
}

export function splitCatalog(catalog: Catalog, statements: Map<string, AppStatements>, headers: PartHeaders, extras: SplitExtras): CatalogParts {
  const atlasApps: AtlasApp[] = catalog.apps.map((app) => ({
    id: app.id,
    category: app.category,
    packages: app.packages,
    repo: app.repo,
    website: app.website,
    channels: app.channels,
    icon: app.icon,
    iconLarge: app.iconLarge,
    repoMissing: app.repoMissing,
    facets: app.facets,
    evidence: app.evidence,
  }));

  const sources: SourcePart[] = catalog.sources.map((info) => {
    const header = headers.sources[info.id];
    if (!header) throw new Error(`no header for source ${info.id}`);
    return {
      header,
      info,
      categories: catalog.sourceCategories.filter((c) => c.source === info.id),
      listings: catalog.apps.flatMap((app) => app.listings.filter((l) => l.source === info.id).map((l) => ({ ...l, app: app.id }))),
    };
  });

  const index = (origin: "fdroid" | "izzy", header: PartHeader, indexAt: string): IndexPart => {
    const apps: IndexPart["apps"] = {};
    for (const app of catalog.apps) {
      const statement = statements.get(app.id)?.[origin];
      if (statement) apps[app.id] = { facts: statement.facts, summary: statement.summary, license: statement.license, downloads: statement.downloads };
    }
    return { header, origin, indexAt, antiFeatures: extras.antiFeatures[origin], downloadSource: downloadSource(origin), apps };
  };
  const downloadSource = (origin: DownloadOrigin): DownloadSource | null => catalog.enrichment.downloads.find((d) => d.origin === origin) ?? null;

  const github: GithubPart = { header: headers.github, fetchedAt: catalog.enrichment.githubFetchedAt, downloadSource: downloadSource("github"), apps: {} };
  for (const app of catalog.apps) {
    const statement = statements.get(app.id)?.github;
    if (!statement) continue;
    github.apps[app.id] = {
      facts: statement.facts,
      description: app.summary?.origin === "github" ? statement.description : null,
      license: statement.license,
      downloads: statement.downloads,
    };
  }

  return {
    atlas: {
      header: headers.atlas,
      schema: catalog.schema,
      generatedAt: catalog.generatedAt,
      hash: catalog.hash,
      regions: catalog.regions,
      categories: catalog.categories,
      apps: atlasApps,
      redirects: catalog.redirects,
    },
    sources,
    indexes: [index("fdroid", headers.fdroid, catalog.enrichment.fdroidIndexAt), index("izzy", headers.izzy, catalog.enrichment.izzyIndexAt)],
    github,
  };
}

export interface HeaderInputs {
  date: string;
  projectUrl: string;
  /** Where removal and correction requests go; null until the project has a contact address. */
  projectContact: string | null;
  generatedAt: string;
  sources: { id: SourceId; name: string; url: string; commit: string; retrieved: string; license: string }[];
  fdroidRetrieved: string;
  izzyRetrieved: string;
  githubRetrieved: string;
  /** Publishers of the download figures each part carries; an origin is absent when its part carries none. */
  downloads: DownloadSource[];
}

/** How Droid Atlas made each origin's download figure from what the publisher offers. */
const DOWNLOAD_SUMS: Record<DownloadOrigin, string> = {
  fdroid: "the hits on each app's APK files summed over F-Droid's front-end download servers and the last four weeks they all cover completely.",
  izzy: "each app's daily counts summed over the last 30 days published.",
  github: "the download counts of the latest release's .apk assets, summed.",
};

const WARRANTY = "Provided without warranty; see the license.";
const LICENSE_URLS: Record<string, string> = {
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
  "GPL-3.0-only": "https://www.gnu.org/licenses/gpl-3.0.html",
  "CC-BY-SA-3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
};

const SOURCE_TEXT: Record<SourceId, { attribution: string; changes: (date: string) => string }> = {
  "android-foss": {
    attribution: "Android FOSS by offa and contributors",
    changes: (date) =>
      `Modified by Droid Atlas on ${date}: entries extracted from the README into JSON; relative links made absolute and every link checked to be http(s); first-seen dates computed from the repository's git history; each category mapped to a Droid Atlas category; guides and further-reading entries marked as resources; entries grouped into apps.`,
  },
  "awesome-shizuku": {
    attribution: "awesome-shizuku by timschneeb and contributors",
    changes: (date) =>
      `Adapted by Droid Atlas on ${date}: entries extracted from Markdown into JSON, tags normalized, Markdown formatting reduced to plain text, category notes attached to their categories, category → Droid Atlas category mapping added, first-seen dates computed from the repository's git history; descriptions otherwise verbatim.`,
  },
  "droid-atlas": {
    attribution: "Droid Atlas",
    changes: (date) => `Compiled by Droid Atlas on ${date}.`,
  },
};

/** The license and provenance header of every part (docs/LICENSING.md §1.2). */
export function partHeaders(input: HeaderInputs): PartHeaders & { icons: PartHeader } {
  const sources: PartHeaders["sources"] = {};
  for (const s of input.sources) {
    const text = SOURCE_TEXT[s.id];
    sources[s.id] = {
      source: { name: s.name, url: s.url, commit: s.commit, retrieved: s.retrieved },
      license: s.license,
      licenseUrl: LICENSE_URLS[s.license] ?? null,
      attribution: text.attribution,
      changes: text.changes(input.date),
      warranty: WARRANTY,
    };
  }
  const figures = (origin: DownloadOrigin): { attribution: string; changes: string } => {
    const source = input.downloads.find((d) => d.origin === origin);
    if (!source) return { attribution: "", changes: "" };
    return {
      attribution: ` Download figures from ${source.name} (${source.url}), retrieved ${source.retrieved.slice(0, 10)}; the publisher states no license for them.`,
      changes: ` Download figures: ${DOWNLOAD_SUMS[origin]}`,
    };
  };
  const indexHeader = (origin: "fdroid" | "izzy", name: string, url: string, retrieved: string, dataSource: string, dataLicense: string): PartHeader => ({
    source: { name, url, commit: null, retrieved },
    license: "LicenseRef-per-record",
    licenseUrl: null,
    attribution: `${name} (${url}). Index data is from ${dataSource} under ${dataLicense}; each summary and description is the app's own text under the license in its record, and may also be under ${dataLicense}.${figures(origin).attribution}`,
    changes: `Extracted by Droid Atlas on ${input.date}: only the apps Droid Atlas lists; HTML reduced to plain text; descriptions longer than 4000 characters cut to an excerpt ending in “…” (full text at the source); summaries longer than 600 characters cut the same way; permission lists reduced to a count, booleans and at most 500 distinct names in alphabetical order; anti-feature reasons kept in English only, Markdown reduced to plain text, any longer than 600 characters cut to an excerpt ending in “…”.${figures(origin).changes}`,
    warranty: WARRANTY,
  });
  return {
    atlas: {
      source: { name: "Droid Atlas", url: input.projectUrl, commit: null, retrieved: input.generatedAt },
      license: "CC0-1.0",
      licenseUrl: LICENSE_URLS["CC0-1.0"] ?? null,
      attribution: "Droid Atlas",
      changes: `Compiled by Droid Atlas on ${input.date}: which listings are the same app, Droid Atlas's regions and categories and the category of each app, and facets computed from the sources' statements. Contains no text from any source.`,
      warranty: WARRANTY,
    },
    sources,
    fdroid: indexHeader("fdroid", "F-Droid", "https://f-droid.org", input.fdroidRetrieved, "fdroiddata", "AGPL-3.0-only"),
    izzy: indexHeader("izzy", "IzzyOnDroid", "https://apt.izzysoft.de/fdroid/", input.izzyRetrieved, "IzzyOnDroid repodata", "AGPL-3.0-or-later"),
    github: {
      source: { name: "GitHub", url: "https://github.com", commit: null, retrieved: input.githubRetrieved },
      license: "NOASSERTION",
      licenseUrl: null,
      attribution: "Repository facts from GitHub; descriptions © their repository owners, shown only where no licensed description exists.",
      changes: `Collected by Droid Atlas on ${input.date} through the GitHub GraphQL API: stars, last push, archived state, current name, fork parent, latest release and whether it has an APK.${figures("github").changes}`,
      warranty: WARRANTY,
    },
    icons: {
      source: { name: "Each app's index entry, repository, website or store listing, as each record states", url: input.projectUrl, commit: null, retrieved: input.generatedAt },
      license: "CC0-1.0",
      licenseUrl: LICENSE_URLS["CC0-1.0"] ?? null,
      attribution: `Each icon © its app's authors; a record's license is the app project's as a source states it, not necessarily the icon's. To have an icon removed, ${input.projectContact ? `write to ${input.projectContact}` : `open an issue at ${input.projectUrl}`}; it leaves the next build.`,
      changes: `Icons fitted into a transparent square and resized to 192 and 384 px WebP by Droid Atlas on ${input.date}; nothing else altered. The records themselves are CC0-1.0.`,
      warranty: WARRANTY,
    },
  };
}

/** Licenses the part headers and manifest name, which must ship with texts. */
export const HEADER_LICENSES = ["AGPL-3.0-only", "AGPL-3.0-or-later", "CC-BY-SA-3.0", "CC0-1.0", "GPL-3.0-only"];
