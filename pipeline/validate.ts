/**
 * Release gates (docs/ARCHITECTURE.md § Validation gates). A failure here
 * stops the build before anything is written, so the last good catalog stays
 * live.
 *
 * Comparison gates can be accepted for one specific value by an entry in
 * `pipeline/accepted-baseline.json`; schema, invariant and enrichment gates
 * cannot.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { App, Catalog, CatalogVersion, Listing, SourceCategory } from "../schema/catalog.ts";
import { CATALOG_SCHEMA_VERSION } from "../schema/catalog.ts";
import { joinCatalog, sortListings, type CatalogParts } from "../schema/join.ts";
import type { AtlasPart, GithubPart, IconRecord, IconsPart, IndexPart, Manifest, SourcePart } from "../schema/parts.ts";
import { HttpError, isTransient, retry } from "./lib/retry.ts";
import type { SpdxList } from "./lib/spdx.ts";
import { checkCatalogShape } from "./schema-check.ts";
import { CATEGORIES, mappingsOf, mapSourceCategory, regionOfMapping, resolveCategory } from "./taxonomy.ts";

const ICON_PATH_RE = /^icons\/[0-9a-f]{16}\.webp$/;

export const LIMITS = {
  /** Largest allowed fall in a source's entries or a category's listings, as a fraction. */
  countDrop: 0.05,
  /** Categories smaller than this in the previous catalog are not compared. */
  categoryMinimum: 10,
  /** Largest allowed fall in a coverage ratio, in percentage points. */
  coverageDropPoints: 5,
  /** Anomalies allowed as a fraction of a source's lines. */
  anomalyShare: 0.01,
  /** New plus retired ids allowed as a fraction of the previous catalog's apps. */
  idChurn: 0.03,
} as const;

export interface BaselineEntry {
  gate: string;
  value: number;
  date: string;
  reason: string;
}

export interface GateCheck {
  gate: string;
  value: number;
  /** The previous value or limit it was compared with, for the report. */
  against: number | null;
  passed: boolean;
  /** True when it failed but an accepted-baseline entry matched. */
  accepted: boolean;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  failures: string[];
  checks: GateCheck[];
  baselineUsed: BaselineEntry[];
}

export interface ValidationContext {
  /** Lines inside each source's parsed body, the denominator of the anomaly gate. */
  sourceLines: Record<string, number>;
  /** Upstream fetches that failed after retries, or caches that were incomplete. */
  enrichmentErrors: string[];
  previous: Catalog | null;
  /** Ids created and retired against the previous catalog. */
  churn: { created: string[]; retired: string[] } | null;
  baseline: BaselineEntry[];
  /** The parts the catalog will be published as; they must join back into it. */
  parts: CatalogParts;
  icons: IconRecord[];
  /** SPDX ids with a license text that will ship. */
  licenseTexts: Set<string>;
  /** Licenses named by part headers and the manifest. */
  headerLicenses: string[];
  spdx: SpdxList;
}

/** Differences between the catalog and its parts joined back together, as paths. */
export function roundTrip(catalog: Catalog, parts: CatalogParts): string[] {
  const joined = joinCatalog(parts);
  if (isDeepStrictEqual(joined, catalog)) return [];
  const errors: string[] = [];
  const compare = (a: unknown, b: unknown, path: string): void => {
    if (errors.length >= 10 || isDeepStrictEqual(a, b)) return;
    if (a && b && typeof a === "object" && typeof b === "object") {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      }
      return;
    }
    errors.push(`${path}: built ${JSON.stringify(a)?.slice(0, 80)}, joined ${JSON.stringify(b)?.slice(0, 80)}`);
  };
  compare(catalog, joined, "catalog");
  return errors.length ? errors : ["catalog: differs after the round trip"];
}

/**
 * Every app with an icon has both files and one record naming them, every
 * record belongs to an app with that icon, and every record states a license
 * ("not stated" when no source states one).
 */
export function iconErrors(catalog: Catalog, records: IconRecord[]): string[] {
  const errors: string[] = [];
  const byApp = new Map(records.map((r) => [r.app, r]));
  for (const app of catalog.apps) {
    const record = byApp.get(app.id);
    if ((app.icon === null) !== (app.iconLarge === null)) errors.push(`${app.id}: icon and iconLarge must be both set or both null`);
    if (app.icon === null) {
      if (record) errors.push(`${app.id}: a record but no icon`);
      continue;
    }
    if (!record) errors.push(`${app.id}: icon ${app.icon} has no record`);
    else if (record.file !== app.icon || record.fileLarge !== app.iconLarge) errors.push(`${app.id}: record names ${record.file}, ${record.fileLarge}`);
  }
  const ids = new Set(catalog.apps.map((a) => a.id));
  for (const record of records) {
    if (!ids.has(record.app)) errors.push(`${record.file}: record for unknown app ${record.app}`);
    if (!record.license.trim()) errors.push(`${record.file}: empty license; "not stated" when no source states one`);
    if (!/^https:\/\//.test(record.original.url)) errors.push(`${record.file}: original ${record.original.url} is not https`);
    if (!/^[0-9a-f]{64}$/.test(record.original.sha256)) errors.push(`${record.file}: original sha256 ${record.original.sha256}`);
  }
  return errors;
}

/** Rounds a measurement so a baseline entry can name it exactly. */
function measure(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function invariants(catalog: Catalog): string[] {
  const errors: string[] = [];
  const appIds = new Set<string>();
  for (const app of catalog.apps) {
    if (appIds.has(app.id)) errors.push(`duplicate app id ${app.id}`);
    appIds.add(app.id);
  }
  const regionIds = new Set(catalog.regions.map((r) => r.id));
  const categoryRegion = new Map<string, string>();
  const categoryNames = new Set<string>();
  const remainders = new Set<string>();
  for (const category of catalog.categories) {
    if (categoryRegion.has(category.id)) errors.push(`duplicate category id ${category.id}`);
    if (categoryNames.has(category.name)) errors.push(`duplicate category name ${category.name}`);
    if (!regionIds.has(category.region)) errors.push(`category ${category.id}: unknown region ${category.region}`);
    if (category.remainder && remainders.has(category.region)) errors.push(`region ${category.region}: more than one remainder`);
    if (category.remainder) remainders.add(category.region);
    categoryRegion.set(category.id, category.region);
    categoryNames.add(category.name);
  }
  const sourceCategoryIds = new Set<string>();
  const sourceIds = new Set(catalog.sources.map((s) => s.id));
  for (const category of catalog.sourceCategories) {
    if (sourceCategoryIds.has(category.id)) errors.push(`duplicate source category id ${category.id}`);
    sourceCategoryIds.add(category.id);
    if (!sourceIds.has(category.source)) errors.push(`source category ${category.id}: unknown source ${category.source}`);
    if (!category.id.startsWith(`${category.source}/`)) errors.push(`source category ${category.id}: id does not start with its source`);
    if (category.category !== null && !categoryRegion.has(category.category)) errors.push(`source category ${category.id}: unknown category ${category.category}`);
    if (!regionIds.has(category.region)) errors.push(`source category ${category.id}: unknown region ${category.region}`);
    if (category.category !== null && categoryRegion.get(category.category) !== category.region) errors.push(`source category ${category.id}: region ${category.region} is not its category's`);
  }
  for (const app of catalog.apps) {
    if (!app.listings.length) errors.push(`app ${app.id}: no listing`);
    const region = categoryRegion.get(app.category);
    if (region === undefined) errors.push(`app ${app.id}: unknown category ${app.category}`);
    else if (app.region !== region) errors.push(`app ${app.id}: region ${app.region} is not its category's (${region})`);
    for (const listing of app.listings) {
      if (!sourceCategoryIds.has(listing.category)) errors.push(`app ${app.id}: dangling category ${listing.category}`);
      if (!sourceIds.has(listing.source)) errors.push(`app ${app.id}: unknown source ${listing.source}`);
      if (listing.parent !== null && !appIds.has(listing.parent)) errors.push(`app ${app.id}: dangling parent ${listing.parent}`);
      if (listing.parent === app.id) errors.push(`app ${app.id}: listing is its own parent`);
    }
    for (const path of [app.icon, app.iconLarge]) {
      if (path !== null && !ICON_PATH_RE.test(path)) errors.push(`app ${app.id}: icon path ${path}`);
    }
    for (const stat of app.downloads) {
      if (stat.count < 1) errors.push(`app ${app.id}: a ${stat.origin} download figure of ${stat.count}`);
      if ((stat.from === null) !== (stat.to === null) || (stat.from !== null && stat.to !== null && stat.from > stat.to)) errors.push(`app ${app.id}: ${stat.origin} download period ${stat.from}–${stat.to}`);
    }
    if (new Set(app.downloads.map((d) => d.origin)).size !== app.downloads.length) errors.push(`app ${app.id}: two download figures from one origin`);
  }
  for (const [from, to] of Object.entries(catalog.redirects)) {
    if (appIds.has(from)) errors.push(`redirect from a current id ${from}`);
    if (to !== null && !appIds.has(to)) errors.push(`redirect ${from} → dangling ${to}`);
  }
  for (const source of catalog.sources) {
    const listed = catalog.apps.reduce((n, app) => n + app.listings.filter((l) => l.source === source.id).length, 0);
    if (listed !== source.entries) errors.push(`source ${source.id}: ${source.entries} entries but ${listed} listings`);
  }
  return errors;
}

/** Share of installable apps, in percent, for which a field is present. */
export function coverage(catalog: Catalog): Record<string, number> {
  const apps = catalog.apps.filter((a) => a.listings.some((l) => l.kind === "app"));
  const share = (test: (app: App) => boolean): number => (apps.length ? (100 * apps.filter(test).length) / apps.length : 0);
  return {
    summary: measure(share((a) => a.summary !== null)),
    index: measure(share((a) => a.index.length > 0)),
    github: measure(share((a) => a.github !== null)),
    icon: measure(share((a) => a.icon !== null)),
  };
}

function categoryCounts(catalog: Catalog): Map<string, number> {
  const counts = new Map<string, number>();
  for (const app of catalog.apps) for (const l of app.listings) counts.set(l.category, (counts.get(l.category) ?? 0) + 1);
  return counts;
}

export function validate(catalog: Catalog, context: ValidationContext): ValidationResult {
  const checks: GateCheck[] = [];
  const failures: string[] = [];
  const baselineUsed: BaselineEntry[] = [];
  const hard = (gate: string, errors: string[]): void => {
    checks.push({ gate, value: errors.length, against: 0, passed: errors.length === 0, accepted: false, detail: errors.slice(0, 20).join("; ") });
    for (const error of errors) failures.push(`${gate}: ${error}`);
  };
  const soft = (gate: string, value: number, against: number | null, passed: boolean, detail: string): void => {
    let accepted = false;
    if (!passed) {
      const entry = context.baseline.find((b) => b.gate === gate && Math.abs(b.value - value) < 1e-9);
      if (entry) {
        accepted = true;
        baselineUsed.push(entry);
      } else {
        failures.push(`${gate}: ${detail} (accept with {"gate": "${gate}", "value": ${value}} in accepted-baseline.json)`);
      }
    }
    checks.push({ gate, value, against, passed, accepted, detail });
  };

  hard("schema", checkCatalogShape(catalog));
  hard("invariant", invariants(catalog));
  hard("enrichment", context.enrichmentErrors);
  hard("roundtrip", roundTrip(catalog, context.parts));
  hard("icons", iconErrors(catalog, context.icons));
  hard(
    "licenses",
    context.headerLicenses.filter((id) => !context.licenseTexts.has(id)).map((id) => `no text for ${id}, which a part header names`),
  );

  for (const source of catalog.sources) {
    const lines = context.sourceLines[source.id] ?? 0;
    const limit = Math.floor(lines * LIMITS.anomalyShare);
    soft(
      `anomalies:${source.id}`,
      source.anomalies.length,
      limit,
      source.anomalies.length <= limit,
      `${source.anomalies.length} anomalies in ${lines} lines (limit ${limit})`,
    );
  }

  const previous = context.previous;
  if (previous) {
    for (const before of previous.sources) {
      const now = catalog.sources.find((s) => s.id === before.id)?.entries ?? 0;
      soft(
        `entries:${before.id}`,
        now,
        before.entries,
        now >= before.entries * (1 - LIMITS.countDrop),
        `${before.entries} → ${now} entries`,
      );
    }
    const beforeCounts = categoryCounts(previous);
    const nowCounts = categoryCounts(catalog);
    for (const [category, before] of [...beforeCounts].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (before < LIMITS.categoryMinimum) continue;
      const now = nowCounts.get(category) ?? 0;
      soft(`category:${category}`, now, before, now >= before * (1 - LIMITS.countDrop), `${before} → ${now} listings`);
    }
    const beforeCoverage = coverage(previous);
    const nowCoverage = coverage(catalog);
    for (const [metric, before] of Object.entries(beforeCoverage)) {
      const now = nowCoverage[metric] ?? 0;
      soft(`coverage:${metric}`, now, before, now >= before - LIMITS.coverageDropPoints, `${before}% → ${now}% of apps`);
    }
    if (context.churn) {
      const changed = context.churn.created.length + context.churn.retired.length;
      const share = previous.apps.length ? changed / previous.apps.length : 0;
      soft(
        "churn:ids",
        measure(100 * share, 2),
        100 * LIMITS.idChurn,
        share <= LIMITS.idChurn,
        `${context.churn.created.length} new and ${context.churn.retired.length} retired ids of ${previous.apps.length}`,
      );
    }
  }

  return { ok: failures.length === 0, failures, checks, baselineUsed };
}

export function readBaseline(path: string): BaselineEntry[] {
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const list = Array.isArray(parsed) ? parsed : (parsed as { accepted?: unknown })?.accepted;
  if (!Array.isArray(list)) throw new Error(`${path}: expected {"accepted": [...]}`);
  return list.map((entry, i) => {
    const e = entry as Partial<BaselineEntry>;
    if (typeof e.gate !== "string" || typeof e.value !== "number" || typeof e.date !== "string" || typeof e.reason !== "string" || !e.reason.trim()) {
      throw new Error(`${path}: entry ${i} needs gate, value, date and a reason`);
    }
    return { gate: e.gate, value: e.value, date: e.date, reason: e.reason };
  });
}

async function readText(location: string): Promise<string> {
  if (/^https?:\/\//i.test(location)) {
    return retry(
      async () => {
        const response = await fetch(location, { cache: "no-store", headers: { "user-agent": "droid-atlas-pipeline" } });
        if (!response.ok) throw new HttpError(location, response.status);
        return response.text();
      },
      { retryable: isTransient },
    );
  }
  return readFileSync(location, "utf8");
}

function locate(base: string, relative: string): string {
  return /^https?:\/\//i.test(base) ? new URL(relative, base).href : resolve(dirname(base), relative);
}

/**
 * Loads the previous good build from a data directory or its `version.json`
 * (a local path or an http(s) URL): the manifest it names, then the atlas,
 * source, index and GitHub parts, each checked against the manifest's
 * sha256, joined with `joinCatalog`. A bare catalog JSON is accepted too, for
 * tests and hand-made baselines.
 */
/** Older catalog formats a previous build may be in; `upgradeParts` brings each to the current one. */
export const READABLE_FORMATS: readonly number[] = [1, 2];

/**
 * The parts of an older build in the current format, for what a previous
 * build is read for (ids, redirects, the regression gates). Format 1 lacks
 * what format 2 added, filled with "none" (no download figures or
 * anti-feature definitions, the list icon as the large one). Format 2 lacks
 * the taxonomy of format 3: its source categories are mapped and its apps
 * filed by today's table, without placements. Parts already in the current
 * format are returned unchanged.
 */
export function upgradeParts(parts: CatalogParts): CatalogParts {
  const format = parts.atlas.schema as number;
  if (format === CATALOG_SCHEMA_VERSION) return withRegions(parts);
  const two = format === 1 ? formatOneToTwo(parts) : parts;
  return formatTwoToThree(two);
}

/** A format-3 build made before source categories carried their region gets it from today's table. */
function withRegions(parts: CatalogParts): CatalogParts {
  if (parts.sources.every((source) => source.categories.every((category) => typeof category.region === "string"))) return parts;
  return {
    ...parts,
    sources: parts.sources.map((source) => ({
      ...source,
      categories: source.categories.map((category) => ({ ...category, region: category.region ?? regionOfMapping(mapSourceCategory(category)) })),
    })),
  };
}

function formatOneToTwo(parts: CatalogParts): CatalogParts {
  const withoutFigures = <T extends object>(apps: Record<string, T>): Record<string, T & { downloads: null }> =>
    Object.fromEntries(Object.entries(apps).map(([id, record]) => [id, { ...record, downloads: null }]));
  return {
    atlas: { ...parts.atlas, apps: parts.atlas.apps.map((app) => ({ ...app, iconLarge: app.iconLarge ?? app.icon })) },
    github: { ...parts.github, downloadSource: null, apps: withoutFigures(parts.github.apps) },
    sources: parts.sources,
    indexes: parts.indexes.map((index) => ({ ...index, antiFeatures: index.antiFeatures ?? {}, downloadSource: null, apps: withoutFigures(index.apps) })),
  };
}

function formatTwoToThree(parts: CatalogParts): CatalogParts {
  const sources = parts.sources.map((source) => ({
    ...source,
    categories: source.categories.map((category: SourceCategory) => {
      const mapping = mapSourceCategory(category);
      return { ...category, category: mapping.category, region: regionOfMapping(mapping) };
    }),
  }));
  const mappings = mappingsOf(sources.flatMap((source) => source.categories));
  const listed = new Map<string, Pick<Listing, "source" | "order" | "category">[]>();
  for (const source of sources) for (const listing of source.listings) listed.set(listing.app, [...(listed.get(listing.app) ?? []), listing]);
  const apps = parts.atlas.apps.map(({ region: _region, ...app }: AtlasPart["apps"][number] & { region?: string }) => ({
    ...app,
    category: resolveCategory(app.id, sortListings(listed.get(app.id) ?? []).map((l) => l.category), mappings, new Map()).category,
  }));
  return { ...parts, sources, atlas: { ...parts.atlas, schema: CATALOG_SCHEMA_VERSION, categories: [...CATEGORIES], apps } };
}

export interface PreviousBuild {
  catalog: Catalog;
  from: string;
  /** The previous build's icon records; empty for a bare catalog. */
  icons: IconRecord[];
  /** The local data directory the previous build is in; null when it was read from a URL or a bare catalog. */
  dataDir: string | null;
}

export async function loadPrevious(location: string): Promise<PreviousBuild> {
  let target = location;
  if (!/^https?:\/\//i.test(target) && existsSync(target) && statSync(target).isDirectory()) target = join(target, "version.json");
  const parsed = JSON.parse(await readText(target)) as Partial<CatalogVersion> & Partial<Catalog>;
  let catalog: Partial<Catalog> = parsed;
  let from = target;
  let icons: IconRecord[] = [];
  let dataDir: string | null = null;
  if (typeof parsed.manifest === "string") {
    if (!/^c\/[0-9a-f]+\/manifest\.json$/.test(parsed.manifest)) throw new Error(`${target}: unexpected manifest path ${parsed.manifest}`);
    from = locate(target, parsed.manifest);
    const manifest = JSON.parse(await readText(from)) as Manifest;
    const load = async <T>(role: string): Promise<T[]> => {
      const files = manifest.files.filter((f) => f.role === role);
      return Promise.all(
        files.map(async (file) => {
          if (!/^[a-z0-9/_.-]+$/.test(file.path) || file.path.includes("..")) throw new Error(`${from}: unexpected path ${file.path}`);
          const text = await readText(locate(from, file.path));
          if (createHash("sha256").update(text).digest("hex") !== file.sha256) throw new Error(`${from}: ${file.path} does not match its sha256`);
          return JSON.parse(text) as T;
        }),
      );
    };
    const [atlas] = await load<AtlasPart>("atlas");
    const [github] = await load<GithubPart>("github");
    if (!atlas || !github) throw new Error(`${from}: the manifest lists no atlas or GitHub part`);
    const format = atlas.schema as number;
    if (format !== CATALOG_SCHEMA_VERSION && !READABLE_FORMATS.includes(format)) {
      throw new Error(`${from}: the previous build is catalog format ${String(format)}, which this pipeline cannot read (it reads formats ${[...READABLE_FORMATS, CATALOG_SCHEMA_VERSION].join(", ")}); run with --bootstrap instead`);
    }
    const parts = upgradeParts({ atlas, github, sources: await load<SourcePart>("source"), indexes: await load<IndexPart>("index") });
    catalog = joinCatalog(parts);
    if (format === CATALOG_SCHEMA_VERSION) {
      const [iconsPart] = await load<IconsPart>("icons");
      icons = Array.isArray(iconsPart?.icons) ? iconsPart.icons : [];
      if (!/^https?:\/\//i.test(target)) dataDir = dirname(target);
    }
  }
  if (catalog.schema !== CATALOG_SCHEMA_VERSION || !Array.isArray(catalog.apps)) throw new Error(`${from}: not a schema ${CATALOG_SCHEMA_VERSION} catalog; run with --bootstrap instead`);
  const errors = checkCatalogShape(catalog);
  if (errors.length) throw new Error(`${from}: previous catalog does not match the schema: ${errors.slice(0, 5).join("; ")}`);
  return { catalog: catalog as Catalog, from, icons, dataDir };
}
