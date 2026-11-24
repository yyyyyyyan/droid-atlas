/**
 * Checks a value against the shapes in `schema/catalog.ts` at run time,
 * including the strict package and slug patterns. Returns one message per
 * problem, with a path to it; an empty list means the value matches.
 *
 * Kept by hand beside the schema: a change there that is not mirrored here is
 * caught by the test that round-trips a built catalog through this check.
 */
import { CATALOG_SCHEMA_VERSION } from "../schema/catalog.ts";

type Check = (value: unknown, path: string, errors: string[]) => void;

const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SLUG_SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;
const ID_RE = /^[A-Za-z0-9._-]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fail = (errors: string[], path: string, message: string): void => {
  errors.push(`${path}: ${message}`);
};

const string: Check = (v, p, e) => {
  if (typeof v !== "string") fail(e, p, "expected a string");
};
const nonEmpty: Check = (v, p, e) => {
  if (typeof v !== "string" || !v.trim()) fail(e, p, "expected a non-empty string");
};
const boolean: Check = (v, p, e) => {
  if (typeof v !== "boolean") fail(e, p, "expected a boolean");
};
const count: Check = (v, p, e) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(e, p, "expected a non-negative integer");
};
const iso: Check = (v, p, e) => {
  if (typeof v !== "string" || !ISO_RE.test(v) || !Number.isFinite(Date.parse(v))) fail(e, p, "expected an ISO timestamp");
};
const date: Check = (v, p, e) => {
  if (typeof v !== "string" || !DATE_RE.test(v)) fail(e, p, "expected an ISO date");
};
const httpUrl: Check = (v, p, e) => {
  try {
    if (typeof v !== "string" || !["http:", "https:"].includes(new URL(v).protocol)) throw new Error();
  } catch {
    fail(e, p, "expected an http(s) URL");
  }
};
const pkg: Check = (v, p, e) => {
  if (typeof v !== "string" || !PACKAGE_RE.test(v)) fail(e, p, `package id ${JSON.stringify(v)} does not match the schema pattern`);
};
const id: Check = (v, p, e) => {
  if (typeof v !== "string" || !ID_RE.test(v)) fail(e, p, `id ${JSON.stringify(v)} is not URL-safe`);
};
const nullable =
  (check: Check): Check =>
  (v, p, e) => {
    if (v !== null) check(v, p, e);
  };
const oneOf =
  (...values: string[]): Check =>
  (v, p, e) => {
    if (typeof v !== "string" || !values.includes(v)) fail(e, p, `expected one of ${values.join(", ")}`);
  };
const list =
  (check: Check): Check =>
  (v, p, e) => {
    if (!Array.isArray(v)) return fail(e, p, "expected an array");
    v.forEach((item, i) => check(item, `${p}[${i}]`, e));
  };
const object =
  (shape: Record<string, Check>): Check =>
  (v, p, e) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return fail(e, p, "expected an object");
    const record = v as Record<string, unknown>;
    for (const [key, check] of Object.entries(shape)) {
      if (!(key in record)) fail(e, `${p}.${key}`, "missing");
      else check(record[key], `${p}.${key}`, e);
    }
    for (const key of Object.keys(record)) if (!(key in shape)) fail(e, `${p}.${key}`, "not in the schema");
  };

const SOURCES = ["android-foss", "awesome-shizuku", "droid-atlas"];
const ORIGINS = [...SOURCES, "fdroid", "izzy", "github"];
const origin = oneOf(...ORIGINS);
const sourced = (value: Check): Check => object({ value, origin });
const OPENNESS = ["open-source", "source-available", "closed-source"];
const PRICING = ["free", "paid", "iap", "trial"];

const repo: Check = (v, p, e) => {
  object({ host: oneOf("github", "gitlab", "codeberg", "sourcehut", "other"), url: httpUrl, slug: nullable(string) })(v, p, e);
  const r = v as { host?: string; slug?: string | null };
  if (r && r.host !== "other") {
    const segments = typeof r.slug === "string" ? r.slug.split("/") : [];
    if (segments.length < 2 || !segments.every((s) => SLUG_SEGMENT_RE.test(s))) fail(e, `${p}.slug`, "does not match the schema pattern");
  } else if (r && r.slug !== null) {
    fail(e, `${p}.slug`, "must be null for host other");
  }
};

const anomaly = object({ file: nonEmpty, line: count, kind: nonEmpty, text: string });
const sourceInfo = object({
  id: oneOf(...SOURCES),
  name: nonEmpty,
  url: httpUrl,
  license: nonEmpty,
  licenseUrl: httpUrl,
  commit: (v, p, e) => {
    if (typeof v !== "string" || !/^[0-9a-f]{40}$/.test(v)) fail(e, p, "expected a commit sha");
  },
  committedAt: iso,
  entries: count,
  anomalies: list(anomaly),
});
const sourceCategory = object({
  id: nonEmpty,
  source: oneOf(...SOURCES),
  name: nonEmpty,
  section: nullable(nonEmpty),
  category: nullable(nonEmpty),
  region: nonEmpty,
  order: count,
  note: nullable(nonEmpty),
});
const category = object({ id: nonEmpty, name: nonEmpty, region: nonEmpty, remainder: boolean });
const listing = object({
  source: oneOf(...SOURCES),
  category: nonEmpty,
  kind: oneOf("app", "resource"),
  order: count,
  name: nonEmpty,
  url: httpUrl,
  description: nullable(nonEmpty),
  tags: list(oneOf("recommended", "paid", "iap", "trial", "ads", "root", "source-available", "closed-source", "archived")),
  license: nullable(nonEmpty),
  added: nullable(date),
  parent: nullable(id),
  extraLinks: list(object({ name: string, url: httpUrl })),
});
const channel = object({ type: oneOf("fdroid", "izzy", "play"), pkg, variant: nullable(nonEmpty), listed: nullable(boolean) });
/** Reasons by anti-feature key: each key one the facts flag, each reason a non-empty string. */
const antiFeatureReasons: Check = (v, p, e) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail(e, p, "expected an object");
  for (const [key, reason] of Object.entries(v)) nonEmpty(reason, `${p}.${key}`, e);
};
const indexFactsShape = object({
  origin: oneOf("fdroid", "izzy"),
  pkg,
  version: nullable(string),
  updatedAt: nullable(iso),
  addedAt: nullable(iso),
  minSdk: nullable(count),
  targetSdk: nullable(count),
  sizeBytes: nullable(count),
  author: nullable(string),
  antiFeatures: list(nonEmpty),
  antiFeatureReasons,
  permissionCount: count,
  declaresShizuku: boolean,
  declaresInternet: boolean,
});
const indexFacts: Check = (v, p, e) => {
  indexFactsShape(v, p, e);
  const facts = v as { antiFeatures?: unknown; antiFeatureReasons?: unknown } | null;
  if (!facts || !Array.isArray(facts.antiFeatures) || !facts.antiFeatureReasons || typeof facts.antiFeatureReasons !== "object") return;
  for (const key of Object.keys(facts.antiFeatureReasons)) {
    if (!facts.antiFeatures.includes(key)) fail(e, `${p}.antiFeatureReasons.${key}`, "gives a reason for an anti-feature the facts do not flag");
  }
};
const githubFacts = object({
  stars: count,
  pushedAt: string,
  archived: boolean,
  movedTo: nullable(nonEmpty),
  forkOf: nullable(nonEmpty),
  release: nullable(object({ tag: string, publishedAt: string, hasApk: boolean })),
});
const DOWNLOAD_ORIGINS = ["fdroid", "izzy", "github"];
const downloadStat = object({ origin: oneOf(...DOWNLOAD_ORIGINS), count: count, from: nullable(date), to: nullable(date) });
const downloadSource = object({ origin: oneOf(...DOWNLOAD_ORIGINS), name: nonEmpty, url: httpUrl, license: nullable(nonEmpty), retrieved: iso, newest: nullable(date) });
const antiFeature = object({
  id: nonEmpty,
  name: nonEmpty,
  definitions: list(object({ origin: oneOf("fdroid", "izzy"), name: nonEmpty, description: nullable(nonEmpty) })),
});
const facets = object({
  shizuku: boolean,
  root: boolean,
  paid: boolean,
  recommended: boolean,
  fork: boolean,
  staleLink: boolean,
  onFdroid: boolean,
  onIzzy: boolean,
  openness: nullable(oneOf(...OPENNESS)),
  noInternet: nullable(boolean),
  apkOnGithub: nullable(boolean),
  noAntiFeatures: nullable(boolean),
  archived: nullable(boolean),
});
const evidence = object({
  shizuku: list(origin),
  root: list(origin),
  archived: list(origin),
  noInternet: list(origin),
  openness: list(sourced(oneOf(...OPENNESS))),
  pricing: list(sourced(oneOf(...PRICING))),
});
const app = object({
  id,
  name: nonEmpty,
  category: nonEmpty,
  region: nonEmpty,
  listings: list(listing),
  packages: list(pkg),
  repo: nullable(repo),
  website: nullable(httpUrl),
  channels: list(channel),
  summary: nullable(sourced(nonEmpty)),
  icon: nullable(string),
  iconLarge: nullable(string),
  license: nullable(sourced(nonEmpty)),
  index: list(indexFacts),
  github: nullable(githubFacts),
  downloads: list(downloadStat),
  repoMissing: boolean,
  facets,
  evidence,
  search: (v, p, e) => {
    if (typeof v !== "string" || v !== v.toLowerCase()) fail(e, p, "expected lower-cased text");
  },
});
const catalog = object({
  schema: (v, p, e) => {
    if (v !== CATALOG_SCHEMA_VERSION) fail(e, p, `expected ${CATALOG_SCHEMA_VERSION}`);
  },
  generatedAt: iso,
  hash: (v, p, e) => {
    if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) fail(e, p, "expected a sha256 hex digest");
  },
  sources: list(sourceInfo),
  enrichment: object({ fdroidIndexAt: iso, izzyIndexAt: iso, githubFetchedAt: iso, downloads: list(downloadSource) }),
  regions: list(object({ id: nonEmpty, name: nonEmpty })),
  categories: list(category),
  sourceCategories: list(sourceCategory),
  antiFeatures: list(antiFeature),
  apps: list(app),
  redirects: (v, p, e) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return fail(e, p, "expected an object");
    for (const [key, value] of Object.entries(v)) {
      id(key, `${p} key`, e);
      nullable(id)(value, `${p}.${key}`, e);
    }
  },
});

export function checkCatalogShape(value: unknown): string[] {
  const errors: string[] = [];
  catalog(value, "catalog", errors);
  return errors;
}

export function isPackagePattern(value: string): boolean {
  return PACKAGE_RE.test(value);
}
