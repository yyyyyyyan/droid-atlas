/**
 * The state of the loaded catalog, for the Data health page: how old it is,
 * what each source contributed, what the parser could not read, and which
 * entries point at something that is gone. Computed from the catalog itself.
 */

import type { LoadedCatalog } from "./load.ts";
import type { Entry, Model } from "./model.ts";
import type { Anomaly, DownloadSource, SourceInfo } from "./schema.ts";

const DAY_MS = 86_400_000;
/** The catalog is rebuilt daily; past this many days something upstream of the reader has stopped. */
export const STALE_AFTER_DAYS = 3;

/** A publisher whose newest figures are older than this many days has stopped publishing, whatever it still answers. */
export const DOWNLOADS_BEHIND_AFTER_DAYS = 21;

/** One origin's download figures: who publishes them, how many apps have one, and how old the newest are. */
export interface DownloadHealth {
  source: DownloadSource;
  /** Apps with a figure from this origin. */
  apps: number;
  /** The last day the newest figures count; null for running totals, which have no such day. */
  newest: number | null;
  ageDays: number | null;
  /** True when the publisher has published nothing for longer than `DOWNLOADS_BEHIND_AFTER_DAYS`. */
  behind: boolean;
  /** When the publisher was last read. */
  retrieved: number | null;
}

export interface SourceHealth {
  info: SourceInfo;
  /** Entries of this source the app shows, counted from the catalog rather than taken from the source's own figure. */
  listed: number;
  anomalies: Anomaly[];
}

export interface CatalogHealth {
  generatedAt: number | null;
  ageDays: number | null;
  stale: boolean;
  hash: string;
  schema: number;
  /** False when the files could not be checked against the manifest (no digest on an insecure origin). */
  verified: boolean;
  sources: SourceHealth[];
  downloads: DownloadHealth[];
  anomalyCount: number;
  apps: number;
  resources: number;
  withIcon: number;
  /** Entries a catalog links to a repository listing that no longer exists. */
  staleLinks: Entry[];
  /** Entries whose GitHub repository no longer exists. */
  repoGone: Entry[];
  archived: Entry[];
  /** Ids the catalog has retired, with or without a successor. */
  redirects: number;
}

export function catalogHealth(model: Model, build: Pick<LoadedCatalog, "verified">, now: number = model.now): CatalogHealth {
  const { catalog } = model;
  const parsed = Date.parse(catalog.generatedAt);
  const generatedAt = Number.isFinite(parsed) ? parsed : null;
  const ageDays = generatedAt === null ? null : Math.max(0, Math.floor((now - generatedAt) / DAY_MS));
  const sources = catalog.sources.map((info): SourceHealth => ({
    info,
    listed: model.entries.filter((entry) => entry.sources.has(info.id)).length,
    anomalies: Array.isArray(info.anomalies) ? info.anomalies : [],
  }));
  const time = (text: string | null): number | null => {
    const value = text === null ? Number.NaN : Date.parse(text);
    return Number.isFinite(value) ? value : null;
  };
  const downloads = model.downloadSources.map((source): DownloadHealth => {
    const newest = time(source.newest);
    const age = newest === null ? null : Math.max(0, Math.floor((now - newest) / DAY_MS));
    return {
      source,
      apps: model.entries.filter((entry) => entry.downloads[source.origin] !== undefined).length,
      newest,
      ageDays: age,
      behind: age !== null && age > DOWNLOADS_BEHIND_AFTER_DAYS,
      retrieved: time(source.retrieved),
    };
  });
  const resources = model.entries.filter((entry) => entry.resource).length;
  return {
    generatedAt,
    ageDays,
    stale: ageDays !== null && ageDays > STALE_AFTER_DAYS,
    hash: catalog.hash,
    schema: catalog.schema,
    verified: build.verified,
    sources,
    downloads,
    anomalyCount: sources.reduce((sum, source) => sum + source.anomalies.length, 0),
    apps: model.entries.length - resources,
    resources,
    withIcon: model.entries.filter((entry) => entry.app.icon).length,
    staleLinks: model.entries.filter((entry) => entry.app.facets.staleLink),
    repoGone: model.entries.filter((entry) => entry.app.repoMissing),
    archived: model.entries.filter((entry) => entry.app.facets.archived === true),
    redirects: Object.keys(catalog.redirects).length,
  };
}
