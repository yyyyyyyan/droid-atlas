/**
 * Builds the Droid Atlas catalog.
 *
 *   node build.ts (--previous <dir|version.json, path or URL> | --bootstrap)
 *                 [--offline] [--out <dir>] [--cache <dir>] [--generated-at <iso>]
 *                 [--sources android-foss,awesome-shizuku] [--no-icons] [--project-url <url>]
 *                 [--project-contact <address>] [--icon-api-budget <n>] [--icon-web-budget <n>]
 *
 * Without --previous or --bootstrap, the data directory's own version.json is
 * the previous build when it exists; otherwise the build refuses to guess.
 *
 * Stages: sources → enrichment → identity → icons → license texts → split
 * into per-origin parts → validate → emit. Nothing reaches the output
 * directory unless validation passes; the report is written either way.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Catalog, DownloadSource, SourceCategory, SourceId, SourceInfo } from "../schema/catalog.ts";
import { deriveAntiFeatures, deriveDownloads, type CatalogParts } from "../schema/join.ts";
import type { IconsPart } from "../schema/parts.ts";
import { assembleCatalog, emit, type EmitResult, type UpstreamSnapshot } from "./emit.ts";
import { fdroidDownloads, GITHUB_DOWNLOAD_SOURCE, izzyDownloads } from "./enrich/downloads.ts";
import { FDROID, parseFdroidIndex } from "./enrich/fdroid.ts";
import { githubToken, loadGithub } from "./enrich/github.ts";
import { IZZY, parseIzzyIndex } from "./enrich/izzy.ts";
import { buildIcons, DEFAULT_BUDGETS, discoveryTarget, projectOf, readIconPolicy } from "./icons.ts";
import { githubSlugsFor, identify, readOverrides } from "./identity.ts";
import { cachedDownload } from "./lib/download.ts";
import { cloneRetrievedAt, firstSeenDates, headCommit, syncClone } from "./lib/git.ts";
import { licenseTexts, listedLicenseIds, loadSpdxList } from "./lib/spdx.ts";
import { CATEGORIES, loadPlacements, mapSourceCategory, regionOfMapping, REGIONS } from "./taxonomy.ts";
import { taxonomyReport, writeReport, type BuildReport, type SourceReport } from "./report.ts";
import { ANDROID_FOSS, parseAndroidFoss } from "./sources/android-foss.ts";
import { AWESOME_SHIZUKU, parseAwesomeShizuku } from "./sources/awesome-shizuku.ts";
import type { ParsedSource, SourceEntry } from "./sources/types.ts";
import { HEADER_LICENSES, partHeaders, splitCatalog } from "./split.ts";
import { loadPrevious, readBaseline, validate } from "./validate.ts";

const PIPELINE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(PIPELINE, "..");
/** Placeholder until the public project URL is decided; the reserved TLD makes it obviously unset. */
export const DEFAULT_PROJECT_URL = "https://droid-atlas.invalid/";

interface SourceSpec {
  info: {
    id: SourceId;
    name: string;
    url: string;
    remote: string;
    license: string;
    licenseUrl: string;
    files: readonly string[];
  };
  attribution: string;
  parse: (read: (file: string) => string) => ParsedSource;
}

const SPECS: SourceSpec[] = [
  { info: ANDROID_FOSS, attribution: "Android FOSS by offa and contributors", parse: (read) => parseAndroidFoss(read("README.md")) },
  { info: AWESOME_SHIZUKU, attribution: "awesome-shizuku by timschneeb and contributors", parse: (read) => parseAwesomeShizuku(read) },
];

export interface BuildOutcome {
  /** Process exit code: 0 when the build passed validation and was written. */
  code: number;
  catalog: Catalog;
  parts: CatalogParts;
  report: BuildReport;
}

function budget(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d{1,6}$/.test(value)) throw new Error(`a request budget must be a whole number, not ${value}`);
  return Number(value);
}

let tokenLookup: { token: string | null } | null = null;

/** The GitHub token when one is configured, looked up once; icon discovery runs without one, at the anonymous rate limit. */
function optionalGithubToken(): string | null {
  if (!tokenLookup) {
    try {
      tokenLookup = { token: githubToken() };
    } catch {
      tokenLookup = { token: null };
    }
  }
  return tokenLookup.token;
}

function log(text: string): void {
  process.stderr.write(`${text}\n`);
}

/**
 * How the report names the build it was compared with: the address for a
 * published one, and for a local one its hash and date, because the report is
 * published with the site and a local path says where the builder keeps files.
 */
function describePrevious(previous: { catalog: Catalog; from: string }): string {
  if (/^https?:\/\//i.test(previous.from)) return previous.from;
  return `local build ${previous.catalog.hash.slice(0, 16)} of ${previous.catalog.generatedAt}`;
}

export async function build(argv: string[]): Promise<BuildOutcome> {
  const { values } = parseArgs({
    args: argv,
    options: {
      offline: { type: "boolean", default: false },
      previous: { type: "string" },
      bootstrap: { type: "boolean", default: false },
      out: { type: "string", default: join(ROOT, "app", "public", "data") },
      cache: { type: "string", default: join(ROOT, ".cache") },
      baseline: { type: "string", default: join(PIPELINE, "accepted-baseline.json") },
      "icon-policy": { type: "string", default: join(PIPELINE, "icon-policy.json") },
      "identity-overrides": { type: "string", default: join(PIPELINE, "identity-overrides.json") },
      placements: { type: "string", default: join(PIPELINE, "placements.json") },
      "project-url": { type: "string", default: DEFAULT_PROJECT_URL },
      "project-contact": { type: "string" },
      "generated-at": { type: "string" },
      sources: { type: "string", default: SPECS.map((s) => s.info.id).join(",") },
      "no-icons": { type: "boolean", default: false },
      "icon-api-budget": { type: "string" },
      "icon-web-budget": { type: "string" },
    },
  });
  const offline = values.offline;
  const outDir = resolve(values.out);
  const cacheDir = resolve(values.cache);
  mkdirSync(cacheDir, { recursive: true });
  const generatedAt = values["generated-at"] ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(generatedAt)) throw new Error("--generated-at must be a UTC ISO timestamp");
  const wanted = new Set(values.sources.split(",").map((s) => s.trim()));
  const specs = SPECS.filter((s) => wanted.has(s.info.id));
  if (!specs.length) throw new Error(`--sources names no known source (${SPECS.map((s) => s.info.id).join(", ")})`);
  if (values.bootstrap && values.previous) throw new Error("--bootstrap and --previous are exclusive");
  const previousLocation = values.bootstrap ? null : (values.previous ?? (existsSync(join(outDir, "version.json")) ? outDir : null));
  if (!values.bootstrap && previousLocation === null) {
    throw new Error("no previous build: pass --previous <path-or-url>, or --bootstrap for a first build");
  }

  const timings: Record<string, number> = {};
  const started = performance.now();
  const time = async <T>(stage: string, run: () => T | Promise<T>): Promise<T> => {
    const begin = performance.now();
    try {
      return await run();
    } finally {
      timings[stage] = Math.round(performance.now() - begin);
      log(`${stage}: ${timings[stage]} ms`);
    }
  };
  const enrichmentErrors: string[] = [];
  const spdx = loadSpdxList();
  const iconPolicyFile = readIconPolicy(values["icon-policy"]);
  const overrides = readOverrides(values["identity-overrides"]);

  const previous = previousLocation ? await time("previous", () => loadPrevious(previousLocation)) : null;

  const parsed = await time("sources", () =>
    Promise.all(
      specs.map(async (spec) => {
        const dir = join(cacheDir, spec.info.id);
        await syncClone(spec.info.remote, dir, offline, log);
        const head = headCommit(dir);
        const read = (file: string): string => readFileSync(join(dir, file), "utf8");
        const result = spec.parse(read);
        const firstSeen = firstSeenDates(dir, [...spec.info.files]);
        for (const entry of result.entries) entry.added = firstSeen.get(entry.historyKey) ?? null;
        const snapshot: UpstreamSnapshot = {
          source: spec.info.id,
          commit: head.sha,
          files: spec.info.files.map((path) => ({ path, content: read(path) })),
          license: spec.info.license,
          attribution: spec.attribution,
        };
        return { spec, head, result, snapshot, retrieved: cloneRetrievedAt(dir, head) };
      }),
    ),
  );

  const [fdroidDownload, izzyDownload] = await time("indexes", () =>
    Promise.all([
      cachedDownload(FDROID.indexUrl, join(cacheDir, FDROID.cacheFile), offline, log),
      cachedDownload(IZZY.indexUrl, join(cacheDir, IZZY.cacheFile), offline, log),
    ]),
  );
  const [fdroid, izzy] = await time("index parse", () => [
    parseFdroidIndex(JSON.parse(fdroidDownload.text)),
    parseIzzyIndex(JSON.parse(izzyDownload.text)),
  ]);

  const entries: SourceEntry[] = parsed.flatMap((p) => p.result.entries);
  const githubSlugs = githubSlugsFor(entries, fdroid, izzy);
  const github = await time("github", () =>
    loadGithub(githubSlugs, { cacheFile: join(cacheDir, "github-repos.json"), offline, now: () => new Date(), log }),
  );
  if (github.unresolved.length) {
    enrichmentErrors.push(`GitHub: ${github.unresolved.length} repositories have no data${offline ? " in the cache" : ""} (${github.unresolved.slice(0, 5).join(", ")}…)`);
  }
  if (!github.fetchedAt) enrichmentErrors.push("GitHub: no fetch time; the cache is missing");

  const placements = loadPlacements(values.placements);
  const sourceCategories: SourceCategory[] = parsed.flatMap((p) =>
    p.result.categories.map((c) => {
      const mapping = mapSourceCategory(c);
      return { id: c.id, source: c.source, name: c.name, section: c.section, category: mapping.category, region: regionOfMapping(mapping), order: c.order, note: c.note };
    }),
  );

  const identity = await time("identity", () =>
    identify({ entries, categories: sourceCategories, placements, fdroid, izzy, github, previous: previous?.catalog ?? null, overrides }),
  );

  const downloads = await time("downloads", async () => {
    const options = { cacheDir: join(cacheDir, "downloads"), offline, now: () => new Date(generatedAt), log };
    return { fdroid: await fdroidDownloads(options), izzy: await izzyDownloads(options) };
  });
  for (const app of identity.apps) {
    const statements = identity.statements.get(app.id);
    if (!statements) continue;
    if (statements.fdroid) statements.fdroid.downloads = downloads.fdroid?.byPackage.get(statements.fdroid.facts.pkg) ?? null;
    if (statements.izzy) statements.izzy.downloads = downloads.izzy?.byPackage.get(statements.izzy.facts.pkg) ?? null;
    app.downloads = deriveDownloads(statements);
  }
  const githubFigures = identity.apps.some((app) => app.downloads.some((d) => d.origin === "github"));
  const downloadSources = [downloads.fdroid?.source, downloads.izzy?.source, githubFigures ? GITHUB_DOWNLOAD_SOURCE(github.fetchedAt) : undefined].filter(
    (s): s is DownloadSource => s !== undefined,
  );

  const icons = await time("icons", () =>
    buildIcons(
      identity.apps.map((app) => ({ app, index: identity.iconSources.get(app.id) ?? [], target: discoveryTarget(app, identity.githubRepos.get(app.id) ?? null), project: projectOf(app) })),
      {
        cacheDir: join(cacheDir, "icons"),
        offline,
        enabled: !values["no-icons"],
        policy: iconPolicyFile,
        log,
        githubToken: optionalGithubToken,
        budgets: {
          githubApi: budget(values["icon-api-budget"], DEFAULT_BUDGETS.githubApi),
          web: budget(values["icon-web-budget"], DEFAULT_BUDGETS.web),
        },
        previous: previous ? { records: previous.icons, dataDir: previous.dataDir } : null,
      },
    ),
  );
  const iconLicenseIds = [...new Set(icons.records.flatMap((record) => listedLicenseIds(record.license, spdx)))];
  const licenses = await time("licenses", () =>
    licenseTexts([...HEADER_LICENSES, ...iconLicenseIds], spdx, { cacheDir: join(cacheDir, "spdx"), offline, token: githubToken }),
  );
  for (const app of identity.apps) {
    app.icon = icons.paths.get(app.id) ?? null;
    app.iconLarge = icons.largePaths.get(app.id) ?? null;
  }

  const sources: SourceInfo[] = parsed.map(({ spec, head, result }) => ({
    id: spec.info.id,
    name: spec.info.name,
    url: spec.info.url,
    license: spec.info.license,
    licenseUrl: spec.info.licenseUrl,
    commit: head.sha,
    committedAt: head.committedAt,
    entries: result.entries.length,
    anomalies: result.anomalies,
  }));
  const catalog: Catalog = assembleCatalog(
    {
      sources,
      enrichment: { fdroidIndexAt: fdroid.timestamp, izzyIndexAt: izzy.timestamp, githubFetchedAt: github.fetchedAt, downloads: downloadSources },
      regions: [...REGIONS],
      categories: [...CATEGORIES],
      sourceCategories,
      antiFeatures: deriveAntiFeatures(identity.apps, [fdroid, izzy].map((index) => ({ origin: index.origin, antiFeatures: index.antiFeatures }))),
      apps: identity.apps,
      redirects: identity.redirects,
    },
    identity.details,
    icons.records,
    generatedAt,
  );

  const headers = partHeaders({
    date: generatedAt.slice(0, 10),
    projectUrl: values["project-url"],
    projectContact: values["project-contact"]?.trim() || null,
    generatedAt,
    sources: parsed.map((p) => ({ id: p.spec.info.id, name: p.spec.info.name, url: p.spec.info.url, commit: p.head.sha, retrieved: p.retrieved, license: p.spec.info.license })),
    fdroidRetrieved: fdroidDownload.retrieved,
    izzyRetrieved: izzyDownload.retrieved,
    githubRetrieved: github.fetchedAt,
    downloads: downloadSources,
  });
  const parts = await time("split", () => splitCatalog(catalog, identity.statements, headers, { antiFeatures: { fdroid: fdroid.antiFeatures, izzy: izzy.antiFeatures } }));
  const iconsPart: IconsPart = { header: headers.icons, icons: icons.records };

  const validation = await time("validate", () =>
    validate(catalog, {
      sourceLines: Object.fromEntries(parsed.map((p) => [p.spec.info.id, p.result.lines])),
      enrichmentErrors,
      previous: previous?.catalog ?? null,
      churn: previous ? { created: identity.ids.created, retired: identity.ids.retired } : null,
      baseline: readBaseline(values.baseline),
      parts,
      icons: icons.records,
      licenseTexts: new Set(licenses.texts.keys()),
      headerLicenses: HEADER_LICENSES,
      spdx,
    }),
  );

  let emitted: EmitResult | null = null;
  if (validation.ok) {
    emitted = await time("emit", () => {
      const keep = new Set((previous?.catalog.apps ?? []).flatMap((a) => [a.icon, a.iconLarge]).filter((i): i is string => i !== null));
      icons.write(outDir, keep);
      return emit(outDir, {
        catalog,
        parts,
        icons: iconsPart,
        details: identity.details,
        upstream: parsed.map((p) => p.snapshot),
        licenses: licenses.texts,
      });
    });
  }
  timings["total"] = Math.round(performance.now() - started);

  const sourceReports: SourceReport[] = parsed.map(({ spec, result }) => ({
    id: spec.info.id,
    lines: result.lines,
    entries: result.entries.length,
    resources: result.entries.filter((e) => e.kind === "resource").length,
    categories: result.categories.length,
    anomalies: result.anomalies,
    skipped: result.skipped,
    notes: result.notes,
    unknownTokens: result.unknownTokens,
  }));
  const report: BuildReport = {
    generatedAt,
    offline,
    ok: validation.ok,
    previous: previous ? describePrevious(previous) : null,
    projectUrl: values["project-url"],
    validation,
    catalog,
    emitted,
    sources: sourceReports,
    identity,
    taxonomy: taxonomyReport(catalog, identity.filing, placements),
    icons: icons.report,
    licenses: { shipped: [...licenses.texts.keys()].sort(), missing: licenses.missing, list: `SPDX ${spdx.licenseListVersion}` },
    github: { fetched: github.fetched, fetchedAt: github.fetchedAt, unresolved: github.unresolved, queried: githubSlugs.length },
    indexes: { fdroid: { at: fdroid.timestamp, packages: fdroid.packages.size }, izzy: { at: izzy.timestamp, packages: izzy.packages.size } },
    timings,
  };
  writeReport(outDir, report);

  if (!validation.ok) {
    log("validation failed; nothing was published:");
    for (const failure of validation.failures.slice(0, 40)) log(`  - ${failure}`);
    return { code: 1, catalog, parts, report };
  }
  log(`wrote ${catalog.apps.length} apps (${emitted?.version.manifest}) to ${outDir} in ${timings["total"]} ms`);
  return { code: 0, catalog, parts, report };
}

if (import.meta.main) {
  try {
    process.exitCode = (await build(process.argv.slice(2))).code;
  } catch (error) {
    log(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  }
}
