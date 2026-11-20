/** Every validation gate fails when it should, and the accepted baseline accepts exactly what it names. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Catalog } from "../../schema/catalog.ts";
import { joinCatalog, type CatalogParts } from "../../schema/join.ts";
import type { IconRecord } from "../../schema/parts.ts";
import { assembleCatalog } from "../emit.ts";
import { identify, NO_OVERRIDES } from "../identity.ts";
import { loadSpdxList } from "../lib/spdx.ts";
import { CATEGORIES, REGIONS } from "../taxonomy.ts";
import { HEADER_LICENSES, partHeaders, splitCatalog } from "../split.ts";
import { loadPrevious, upgradeParts, validate, type BaselineEntry, type ValidationContext } from "../validate.ts";
import { entry, fakeGithub, fakeIndex, fakeRepo, SOURCE_CATEGORIES } from "./fixtures.ts";

const spdx = loadSpdxList();

function makeBuild(previous: Catalog | null = null): { catalog: Catalog; parts: CatalogParts; context: ValidationContext } {
  const entries = [
    ...Array.from({ length: 12 }, (_, i) =>
      entry({ name: `Tool ${i}`, url: `https://github.com/ex/tool${i}`, order: i, channels: [{ type: "fdroid", pkg: `org.ex.tool${i}`, variant: null }] }),
    ),
    entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Shiz", url: "https://github.com/ex/shiz", description: "Listed text", license: "MIT" }),
  ];
  const fdroidPackages = Object.fromEntries(entries.slice(0, 12).map((_, i) => [`org.ex.tool${i}`, { summary: `Tool ${i} summary`, license: "GPL-3.0-or-later" }]));
  const identity = identify({
    entries,
    categories: SOURCE_CATEGORIES,
    fdroid: fakeIndex("fdroid", fdroidPackages),
    izzy: fakeIndex("izzy", {}),
    github: fakeGithub({ "ex/shiz": fakeRepo("ex/shiz", { description: "repo" }) }),
    previous,
    overrides: NO_OVERRIDES,
  });
  const icons: IconRecord[] = [];
  const catalog = assembleCatalog(
    {
      sources: [
        { id: "android-foss", name: "Android FOSS", url: "https://github.com/offa/android-foss", license: "GPL-3.0-only", licenseUrl: "https://github.com/offa/android-foss/blob/master/LICENSE", commit: "a".repeat(40), committedAt: "2026-01-01T00:00:00.000Z", entries: 12, anomalies: [] },
        { id: "awesome-shizuku", name: "awesome-shizuku", url: "https://github.com/timschneeb/awesome-shizuku", license: "CC-BY-SA-3.0", licenseUrl: "https://github.com/timschneeb/awesome-shizuku/blob/master/LICENSE", commit: "b".repeat(40), committedAt: "2026-01-01T00:00:00.000Z", entries: 1, anomalies: [] },
      ],
      enrichment: { fdroidIndexAt: "2026-01-01T00:00:00.000Z", izzyIndexAt: "2026-01-01T00:00:00.000Z", githubFetchedAt: "2026-01-02T00:00:00.000Z", downloads: [] },
      regions: [...REGIONS],
      categories: [...CATEGORIES],
      sourceCategories: SOURCE_CATEGORIES,
      antiFeatures: [],
      apps: identity.apps,
      redirects: identity.redirects,
    },
    identity.details,
    icons,
    "2026-01-03T00:00:00.000Z",
  );
  const headers = partHeaders({
    date: "2026-01-03",
    projectUrl: "https://droid-atlas.invalid/",
    projectContact: null,
    generatedAt: catalog.generatedAt,
    sources: catalog.sources.map((s) => ({ id: s.id, name: s.name, url: s.url, commit: s.commit, retrieved: s.committedAt, license: s.license })),
    fdroidRetrieved: "2026-01-01T00:00:00.000Z",
    izzyRetrieved: "2026-01-01T00:00:00.000Z",
    githubRetrieved: "2026-01-02T00:00:00.000Z",
    downloads: [],
  });
  const parts = splitCatalog(catalog, identity.statements, headers, { antiFeatures: { fdroid: {}, izzy: {} } });
  const context: ValidationContext = {
    sourceLines: { "android-foss": 1000, "awesome-shizuku": 1000 },
    enrichmentErrors: [],
    previous,
    churn: previous ? { created: identity.ids.created, retired: identity.ids.retired } : null,
    baseline: [],
    parts,
    icons,
    licenseTexts: new Set(HEADER_LICENSES),
    headerLicenses: HEADER_LICENSES,
    spdx,
  };
  return { catalog, parts, context };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function failedGates(catalog: Catalog, context: ValidationContext): string[] {
  return [...new Set(validate(catalog, context).checks.filter((c) => !c.passed && !c.accepted).map((c) => c.gate))];
}

test("a correct build passes every gate", () => {
  const { catalog, context } = makeBuild();
  const result = validate(catalog, context);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test("the parts join back into the catalog", () => {
  const { catalog, parts } = makeBuild();
  assert.deepStrictEqual(joinCatalog(parts), catalog);
});

test("schema gate: a package id outside the strict pattern", () => {
  const { catalog, context } = makeBuild();
  const broken = clone(catalog);
  broken.apps[0]!.packages = ["org.ex;end"];
  assert.ok(failedGates(broken, { ...context, parts: { ...context.parts } }).includes("schema"));
});

test("invariant gate: duplicate ids, dangling category, parent and redirect, an app with no listing", () => {
  const { catalog, context } = makeBuild();
  const cases: ((c: Catalog) => void)[] = [
    (c) => (c.apps[1]!.id = c.apps[0]!.id),
    (c) => (c.apps[0]!.listings[0]!.category = "android-foss/nowhere"),
    (c) => (c.apps[0]!.listings[0]!.parent = "no.such.app"),
    (c) => (c.redirects = { "old-id": "no.such.app" }),
    (c) => (c.apps[0]!.listings = []),
  ];
  for (const mutate of cases) {
    const broken = clone(catalog);
    mutate(broken);
    assert.ok(failedGates(broken, context).includes("invariant"), mutate.toString());
  }
});

test("enrichment gate: an upstream that could not be fetched", () => {
  const { catalog, context } = makeBuild();
  assert.ok(failedGates(catalog, { ...context, enrichmentErrors: ["GitHub: 3 repositories have no data"] }).includes("enrichment"));
});

test("round-trip gate: parts that do not join back into the catalog", () => {
  const { catalog, context } = makeBuild();
  const parts = clone(context.parts);
  parts.sources[0]!.listings[0]!.name = "Changed";
  assert.ok(failedGates(catalog, { ...context, parts }).includes("roundtrip"));
});

test("icon gates: an icon without a record, half an icon, a record for no icon or naming other files, an empty license", () => {
  const { catalog, context } = makeBuild();
  const broken = clone(catalog);
  const app = broken.apps[0]!;
  app.icon = "icons/0123456789abcdef.webp";
  app.iconLarge = "icons/fedcba9876543210.webp";
  assert.ok(failedGates(broken, context).includes("icons"));
  const record: IconRecord = {
    file: "icons/0123456789abcdef.webp",
    fileLarge: "icons/fedcba9876543210.webp",
    app: app.id,
    name: app.name,
    rule: "fdroid-index",
    original: { url: "https://f-droid.org/repo/x.png", sha256: "a".repeat(64) },
    revision: "2026-01-01T00:00:00.000Z",
    retrieved: "2026-01-01",
    author: "the Tool 0 developers",
    license: "Apache-2.0",
    project: null,
    changes: "resized",
  };
  const texts = new Set(HEADER_LICENSES);
  assert.ok(!failedGates(broken, { ...context, icons: [record] }).includes("icons"), "a project license is stated, its text is not required");
  assert.ok(!failedGates(broken, { ...context, icons: [{ ...record, license: "not stated" }] }).includes("icons"));
  assert.ok(failedGates(broken, { ...context, icons: [{ ...record, license: " " }] }).includes("icons"), "an empty license");
  assert.ok(failedGates(broken, { ...context, icons: [{ ...record, original: { ...record.original, url: "http://f-droid.org/x.png" } }] }).includes("icons"), "an original that is not https");
  assert.ok(failedGates(broken, { ...context, icons: [{ ...record, fileLarge: record.file }], licenseTexts: texts }).includes("icons"), "record names another file");
  const half = clone(broken);
  half.apps[0]!.iconLarge = null;
  assert.ok(failedGates(half, { ...context, icons: [record], licenseTexts: texts }).includes("icons"), "half an icon");
  assert.ok(failedGates(catalog, { ...context, icons: [record], licenseTexts: texts }).includes("icons"), "a record for an app without an icon");
});

test("invariant gate: a download figure of zero, an inverted period, two figures from one origin", () => {
  const { catalog, context } = makeBuild();
  const stat = { origin: "izzy" as const, count: 5, from: "2026-01-01", to: "2026-01-30" };
  const fine = clone(catalog);
  fine.apps[0]!.downloads = [stat];
  assert.ok(!failedGates(fine, context).includes("invariant"));
  const cases: ((c: Catalog) => void)[] = [
    (c) => (c.apps[0]!.downloads = [{ ...stat, count: 0 }]),
    (c) => (c.apps[0]!.downloads = [{ ...stat, from: "2026-02-01" }]),
    (c) => (c.apps[0]!.downloads = [{ ...stat, to: null }]),
    (c) => (c.apps[0]!.downloads = [stat, stat]),
  ];
  for (const mutate of cases) {
    const broken = clone(catalog);
    mutate(broken);
    assert.ok(failedGates(broken, context).includes("invariant"), mutate.toString());
  }
});

test("license gate: a header license with no text", () => {
  const { catalog, context } = makeBuild();
  assert.ok(failedGates(catalog, { ...context, licenseTexts: new Set(["CC0-1.0"]) }).includes("licenses"));
});

test("anomaly gate: more than 1% of a source's lines", () => {
  const { catalog, context } = makeBuild();
  const broken = clone(catalog);
  broken.sources[0]!.anomalies = Array.from({ length: 11 }, (_, i) => ({ file: "README.md", line: i, kind: "unrecognized-line", text: "x" }));
  assert.ok(failedGates(broken, context).includes("anomalies:android-foss"));
  broken.sources[0]!.anomalies.pop();
  assert.ok(!failedGates(broken, context).includes("anomalies:android-foss"));
});

test("comparison gates: a source's entries, a large category past a three-listing floor, a coverage ratio, id churn", () => {
  const before = makeBuild();
  const now = makeBuild(before.catalog);
  assert.deepEqual(validate(now.catalog, now.context).failures, []);

  const fewer = clone(now.catalog);
  fewer.sources[0]!.entries = 11;
  assert.ok(failedGates(fewer, now.context).includes("entries:android-foss"));

  const curated = clone(now.catalog);
  curated.apps = curated.apps.filter((a) => !["org.ex.tool0", "org.ex.tool1", "org.ex.tool2"].includes(a.id));
  assert.ok(!failedGates(curated, now.context).includes("category:android-foss/apps-tools"));

  const smaller = clone(now.catalog);
  smaller.apps = smaller.apps.filter((a) => !["org.ex.tool0", "org.ex.tool1", "org.ex.tool2", "org.ex.tool3"].includes(a.id));
  assert.ok(failedGates(smaller, now.context).includes("category:android-foss/apps-tools"));

  const emptier = clone(now.catalog);
  for (const app of emptier.apps) app.summary = null;
  assert.ok(failedGates(emptier, now.context).includes("coverage:summary"));

  assert.ok(failedGates(now.catalog, { ...now.context, churn: { created: ["a"], retired: [] } }).includes("churn:ids"));
});

test("an accepted-baseline entry accepts exactly the value it names, and is recorded", () => {
  const before = makeBuild();
  const now = makeBuild(before.catalog);
  const fewer = clone(now.catalog);
  fewer.sources[0]!.entries = 11;
  const baseline: BaselineEntry[] = [{ gate: "entries:android-foss", value: 11, date: "2026-01-03", reason: "upstream removed dead apps" }];
  const accepted = validate(fewer, { ...now.context, baseline });
  assert.ok(!accepted.failures.some((f) => f.startsWith("entries:")));
  assert.deepEqual(accepted.baselineUsed, baseline);
  fewer.sources[0]!.entries = 10;
  assert.ok(validate(fewer, { ...now.context, baseline }).failures.some((f) => f.startsWith("entries:android-foss")));
});

/** Writes parts as a data directory `loadPrevious` can read: version.json, a manifest, and each part checked by its sha256. */
function writeBuild(parts: CatalogParts): string {
  const dir = mkdtempSync(join(tmpdir(), "previous-"));
  const cdir = join(dir, "c", "0123456789abcdef");
  mkdirSync(join(cdir, "sources"), { recursive: true });
  const files: { path: string; role: string; sha256: string }[] = [];
  const put = (path: string, role: string, value: unknown): void => {
    const text = JSON.stringify(value);
    writeFileSync(join(cdir, path), text);
    files.push({ path, role, sha256: createHash("sha256").update(text).digest("hex") });
  };
  put("atlas.json", "atlas", parts.atlas);
  put("sources/github.json", "github", parts.github);
  parts.sources.forEach((source, i) => put(`sources/source-${i}.json`, "source", source));
  parts.indexes.forEach((index, i) => put(`sources/index-${i}.json`, "index", index));
  writeFileSync(join(cdir, "manifest.json"), JSON.stringify({ files }));
  writeFileSync(join(dir, "version.json"), JSON.stringify({ schema: parts.atlas.schema, manifest: "c/0123456789abcdef/manifest.json" }));
  return dir;
}

/** The parts as a format-1 build wrote them: no large icon, no download figures, no anti-feature definitions. */
function formatOne(parts: CatalogParts): CatalogParts {
  const strip = (record: object): object => Object.fromEntries(Object.entries(record).filter(([key]) => key !== "downloads"));
  const old = clone(parts) as unknown as { atlas: { schema: number; apps: Record<string, unknown>[] }; github: Record<string, unknown> & { apps: Record<string, object> }; indexes: (Record<string, unknown> & { apps: Record<string, object> })[] };
  old.atlas.schema = 1;
  for (const app of old.atlas.apps) delete app["iconLarge"];
  delete old.github["downloadSource"];
  old.github.apps = Object.fromEntries(Object.entries(old.github.apps).map(([id, r]) => [id, strip(r)]));
  for (const index of old.indexes) {
    delete index["downloadSource"];
    delete index["antiFeatures"];
    index.apps = Object.fromEntries(Object.entries(index.apps).map(([id, r]) => [id, strip(r)]));
  }
  return old as unknown as CatalogParts;
}

test("a format-1 previous build is read for its ids, redirects and counts; an unknown format asks for --bootstrap", async () => {
  const { catalog, parts } = makeBuild();
  const upgraded = joinCatalog(upgradeParts(formatOne(parts)));
  assert.deepEqual(upgraded.apps.map((a) => a.id), catalog.apps.map((a) => a.id));
  assert.deepEqual(upgraded.redirects, catalog.redirects);
  assert.deepEqual(upgraded.apps.map((a) => a.packages), catalog.apps.map((a) => a.packages));

  const previous = await loadPrevious(writeBuild(formatOne(parts)));
  assert.equal(previous.catalog.schema, catalog.schema);
  assert.deepEqual(previous.catalog.apps.map((a) => a.id), catalog.apps.map((a) => a.id));
  assert.deepEqual(previous.icons, [], "a format-1 build's icon records are not carried");
  assert.equal(previous.dataDir, null);
  const { context } = makeBuild(previous.catalog);
  assert.deepEqual(context.churn, { created: [], retired: [] });

  const future = clone(parts) as unknown as { atlas: { schema: number } };
  future.atlas.schema = 9;
  await assert.rejects(loadPrevious(writeBuild(future as unknown as CatalogParts)), /catalog format 9.*--bootstrap/);
});
