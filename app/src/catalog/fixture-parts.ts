/**
 * Splits a fixture `Catalog` into the per-origin parts a build is published
 * as, for tests and for the synthetic fixture build. It is the inverse of
 * `joinCatalog` for catalogs whose summaries and licenses are consistent with
 * their origins; the pipeline has its own, complete `splitCatalog`.
 */

import type { CatalogParts } from "../../../schema/join.ts";
import type { PartHeader } from "../../../schema/parts.ts";
import type { Catalog } from "./schema.ts";

export const FIXTURE_HEADER: PartHeader = {
  source: { name: "Synthetic fixture", url: "https://example.invalid/", commit: null, retrieved: "2026-11-11T00:00:00Z" },
  license: "CC0-1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  attribution: "Synthetic fixture written by Droid Atlas; not catalog data.",
  changes: "None.",
  warranty: "Provided without warranty.",
};

export function splitParts(catalog: Catalog): CatalogParts {
  const stated = <T extends string>(sourced: { value: string; origin: string } | null, origin: T): string | null =>
    (sourced?.origin === origin ? sourced.value : null);

  const indexPart = (origin: "fdroid" | "izzy", indexAt: string): CatalogParts["indexes"][number] => ({
    header: FIXTURE_HEADER,
    origin,
    indexAt,
    antiFeatures: Object.fromEntries(catalog.antiFeatures.flatMap((item) => item.definitions.filter((definition) => definition.origin === origin).map((definition) => [item.id, { name: definition.name, description: definition.description }]))),
    downloadSource: catalog.enrichment.downloads.find((source) => source.origin === origin) ?? null,
    apps: Object.fromEntries(catalog.apps.flatMap((app) => {
      const facts = app.index.find((index) => index.origin === origin);
      const downloads = app.downloads.find((stat) => stat.origin === origin) ?? null;
      return facts ? [[app.id, { facts, summary: stated(app.summary, origin), license: app.licenses.find((statement) => statement.origin === origin)?.value ?? null, downloads }]] : [];
    })),
  });

  return {
    atlas: {
      header: FIXTURE_HEADER,
      schema: catalog.schema,
      generatedAt: catalog.generatedAt,
      hash: catalog.hash,
      regions: catalog.regions,
      categories: catalog.categories,
      redirects: catalog.redirects,
      apps: catalog.apps.map(({ id, category, packages, repo, website, channels, icon, iconLarge, repoMissing, facets, evidence }) => (
        { id, category, packages, repo, website, channels, icon, iconLarge, repoMissing, facets, evidence }
      )),
    },
    sources: catalog.sources.map((info) => ({
      header: FIXTURE_HEADER,
      info,
      categories: catalog.sourceCategories.filter((category) => category.source === info.id),
      listings: catalog.apps.flatMap((app) => app.listings.filter((listing) => listing.source === info.id).map((listing) => ({ ...listing, app: app.id }))),
    })),
    indexes: [indexPart("fdroid", catalog.enrichment.fdroidIndexAt), indexPart("izzy", catalog.enrichment.izzyIndexAt)],
    github: {
      header: FIXTURE_HEADER,
      fetchedAt: catalog.enrichment.githubFetchedAt,
      downloadSource: catalog.enrichment.downloads.find((source) => source.origin === "github") ?? null,
      apps: Object.fromEntries(catalog.apps.flatMap((app) => (
        app.github ? [[app.id, { facts: app.github, description: stated(app.summary, "github"), license: app.licenses.find((statement) => statement.origin === "github")?.value ?? null, downloads: app.downloads.find((stat) => stat.origin === "github") ?? null }]] : []
      ))),
    },
  };
}
