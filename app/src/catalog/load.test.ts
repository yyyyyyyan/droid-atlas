import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { splitParts } from "./fixture-parts.ts";
import { app, catalog } from "./fixtures.ts";
import { CatalogError, createOnDemand, dataUrl, isIconRecord, loadBuild, sha256, type Digest, type Fetch, type LoadedBuild, type ManifestFile } from "./load.ts";
import { CATALOG_SCHEMA_VERSION, detailsShard } from "./schema.ts";
import { loadCatalog } from "./source.ts";

const ROOT = "https://atlas.example/data/";
const HASH = "testhash";

function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function listed(path: string, role: ManifestFile["role"], origin: ManifestFile["origin"], text: string): ManifestFile {
  return { path, role, origin, sha256: digestOf(text), bytes: text.length, license: "CC0-1.0", attribution: "Test" };
}

interface Site {
  files: Map<string, string>;
  requests: { url: string; init?: RequestInit }[];
  fetcher: Fetch;
}

/** A static site: URL to body. A missing URL answers 404; `offline` makes every request reject. */
function site(files: Record<string, string>, options: { offline?: boolean } = {}): Site {
  const map = new Map(Object.entries(files));
  const requests: Site["requests"] = [];
  return {
    files: map,
    requests,
    fetcher: async (url, init) => {
      requests.push({ url, init });
      if (options.offline) throw new TypeError("Failed to fetch");
      const body = map.get(url);
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
    },
  };
}

const SUBJECT = catalog({
  apps: [app({
    summary: { value: "An example.", origin: "fdroid" },
    license: { value: "MIT", origin: "fdroid" },
    index: [{
      origin: "fdroid", pkg: "org.example.app", version: "1.0", updatedAt: null, addedAt: null, minSdk: null, targetSdk: null,
      sizeBytes: null, author: null, antiFeatures: [], antiFeatureReasons: {}, permissionCount: 1, declaresShizuku: false, declaresInternet: true,
    }],
  })],
});

interface Overrides {
  /** Replaces the body served for a part, without touching the manifest's hash for it. */
  served?: Record<string, string>;
  /** Replaces a part and its manifest entry, so the bytes match but the content is wrong. */
  replaced?: Record<string, string>;
  manifestPatch?: Record<string, unknown>;
  versionPatch?: Record<string, unknown>;
}

function published(overrides: Overrides = {}): Site {
  const parts = splitParts(SUBJECT);
  const bodies: Record<string, string> = {
    "atlas.json": JSON.stringify(parts.atlas),
    "sources/github.json": JSON.stringify(parts.github),
    ...Object.fromEntries(parts.sources.map((part) => [`sources/${part.info.id}.json`, JSON.stringify(part)])),
    ...Object.fromEntries(parts.indexes.map((part) => [`sources/${part.origin}.json`, JSON.stringify(part)])),
    ...overrides.replaced,
  };
  const roleOf = (path: string): ManifestFile["role"] => (
    path === "atlas.json" ? "atlas" : path.endsWith("github.json") ? "github" : /(fdroid|izzy)\.json$/.test(path) ? "index" : "source"
  );
  const shard = detailsShard("example", 4);
  const fdroid = JSON.stringify({ example: { description: "From F-Droid…" } });
  const izzy = JSON.stringify({ example: { description: "From IzzyOnDroid" }, other: { description: "  " } });
  const icons = JSON.stringify({ header: {}, icons: [ICON_RECORD, { file: "icons/b.webp", package: "org.b", repo: "fdroid", app: "B", author: "Bea", license: "MIT" }, { ...ICON_RECORD, file: "icons/c.webp", original: "https://example.org/c.png" }, "icons/d.webp", null] });
  const manifest = {
    schema: CATALOG_SCHEMA_VERSION,
    generatedAt: "2026-11-11T00:00:00Z",
    hash: HASH,
    detailsShards: 4,
    files: [
      ...Object.entries(bodies).map(([path, body]) => listed(path, roleOf(path), "droid-atlas", body)),
      listed("../../upstream/android-foss/abc.md", "upstream", "android-foss", "# README"),
      listed(`details/izzy/${shard}.json`, "details", "izzy", izzy),
      listed(`details/fdroid/${shard}.json`, "details", "fdroid", fdroid),
      listed("icons.json", "icons", "droid-atlas", icons),
    ],
    ...overrides.manifestPatch,
  };
  const version = { schema: CATALOG_SCHEMA_VERSION, generatedAt: "2026-11-11T00:00:00Z", hash: HASH, manifest: `c/${HASH}/manifest.json`, ...overrides.versionPatch };
  return site({
    [`${ROOT}version.json`]: JSON.stringify(version),
    [`${ROOT}c/${HASH}/manifest.json`]: JSON.stringify(manifest),
    ...Object.fromEntries(Object.entries({ ...bodies, ...overrides.served }).map(([path, body]) => [`${ROOT}c/${HASH}/${path}`, body])),
    [`${ROOT}c/${HASH}/details/fdroid/${shard}.json`]: fdroid,
    [`${ROOT}c/${HASH}/details/izzy/${shard}.json`]: izzy,
    [`${ROOT}c/${HASH}/icons.json`]: icons,
  });
}

async function failure(run: Promise<unknown>): Promise<CatalogError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof CatalogError) return error;
    throw error;
  }
  throw new Error("expected the load to fail");
}

const ICON_RECORD = {
  file: "icons/a.webp",
  fileLarge: "icons/a-large.webp",
  app: "org.a",
  name: "A",
  rule: "fdroid-index",
  original: { url: "https://f-droid.org/repo/icons/org.a.1.png", sha256: "0".repeat(64) },
  revision: "2026-11-11T13:48:33.394Z",
  retrieved: "2026-11-11",
  author: "Ann",
  license: "MIT",
  project: "https://github.com/ann/a",
  changes: "downscaled to 192 px WebP; metadata removed",
};

describe("loading a build", () => {
  test("version.json is fetched past the HTTP cache, then the manifest, then the catalog's parts and nothing else", async () => {
    const source = published();
    const loaded = await loadCatalog(ROOT, "version.json", source.fetcher, sha256);
    expect(source.requests.slice(0, 2).map((request) => request.url)).toEqual([`${ROOT}version.json`, `${ROOT}c/${HASH}/manifest.json`]);
    expect(source.requests[0]?.init).toEqual({ cache: "no-cache" });
    expect(source.requests.slice(2).map((request) => request.url.replace(`${ROOT}c/${HASH}/`, "")).sort()).toEqual([
      "atlas.json", "sources/android-foss.json", "sources/awesome-shizuku.json", "sources/fdroid.json", "sources/github.json", "sources/izzy.json",
    ]);
    expect(loaded.base).toBe(`${ROOT}c/${HASH}/`);
    expect(loaded.verified).toBe(true);
  });

  test("the parts are joined into the catalog they were split from", async () => {
    const loaded = await loadCatalog(ROOT, "version.json", published().fetcher, sha256);
    expect(loaded.catalog.hash).toBe(HASH);
    expect(loaded.catalog.sources.map((source) => source.id)).toEqual(["android-foss", "awesome-shizuku"]);
    expect(loaded.catalog.categories).toEqual(SUBJECT.categories);
    const [joined] = loaded.catalog.apps;
    expect(joined).toMatchObject({
      id: "example", name: "Example", summary: { value: "An example.", origin: "fdroid" }, license: { value: "MIT", origin: "fdroid" },
      github: { stars: 100 }, facets: SUBJECT.apps[0]?.facets,
    });
    expect(joined?.index).toEqual(SUBJECT.apps[0]?.index);
    expect(joined?.listings).toEqual(SUBJECT.apps[0]?.listings);
    expect(joined?.search).toContain("example");
  });

  test("a part whose bytes do not match the manifest is refused, whichever part it is", async () => {
    for (const path of ["atlas.json", "sources/awesome-shizuku.json", "sources/fdroid.json", "sources/github.json"]) {
      const error = await failure(loadCatalog(ROOT, "version.json", published({ served: { [path]: "{\"tampered\":true}" } }).fetcher, sha256));
      expect(error.kind, path).toBe("damaged");
      expect(error.message, path).toContain(path);
    }
  });

  test("a missing part fails the whole load: a partial catalog is never shown", async () => {
    const source = published();
    source.files.delete(`${ROOT}c/${HASH}/sources/izzy.json`);
    expect((await failure(loadCatalog(ROOT, "version.json", source.fetcher, sha256))).kind).toBe("missing");
  });

  test("without a platform digest the build loads and is recorded as unverified", async () => {
    const none: Digest = async () => null;
    const altered = JSON.stringify({ ...splitParts(SUBJECT).github, fetchedAt: "2099-01-01T00:00:00Z" });
    const loaded = await loadCatalog(ROOT, "version.json", published({ served: { "sources/github.json": altered } }).fetcher, none);
    expect(loaded.verified).toBe(false);
    expect(loaded.catalog.enrichment.githubFetchedAt).toBe("2099-01-01T00:00:00Z");
  });

  test.each([
    ["version.json of a newer schema", { versionPatch: { schema: CATALOG_SCHEMA_VERSION + 1 } }, "newer-schema"],
    ["a manifest of a newer schema", { manifestPatch: { schema: CATALOG_SCHEMA_VERSION + 1 } }, "newer-schema"],
    ["a manifest for another build", { manifestPatch: { hash: "other" } }, "damaged"],
    ["a manifest without files", { manifestPatch: { files: "none" } }, "damaged"],
    ["a manifest path that climbs out of the data directory", { versionPatch: { manifest: "../secrets/manifest.json" } }, "damaged"],
    ["an absolute manifest URL", { versionPatch: { manifest: "https://evil.example/manifest.json" } }, "damaged"],
    ["version.json without a manifest", { versionPatch: { manifest: 7 } }, "damaged"],
  ] as const)("%s is refused", async (_label, overrides, kind) => {
    const error = await failure(loadCatalog(ROOT, "version.json", published(overrides).fetcher, sha256));
    expect(error.kind).toBe(kind);
  });

  test("a part of the wrong shape or for another build is refused even when its bytes match", async () => {
    const atlas = splitParts(SUBJECT).atlas;
    const cases: [string, string, string][] = [
      ["atlas.json", JSON.stringify({ schema: CATALOG_SCHEMA_VERSION, apps: "many" }), "damaged"],
      ["atlas.json", JSON.stringify({ ...atlas, hash: "other" }), "damaged"],
      ["atlas.json", JSON.stringify({ ...atlas, schema: CATALOG_SCHEMA_VERSION + 1 }), "newer-schema"],
      ["sources/android-foss.json", JSON.stringify({ listings: {} }), "damaged"],
      ["sources/fdroid.json", JSON.stringify({ origin: "elsewhere", apps: {} }), "damaged"],
      ["sources/github.json", JSON.stringify([]), "damaged"],
    ];
    for (const [path, body, kind] of cases) {
      const error = await failure(loadCatalog(ROOT, "version.json", published({ replaced: { [path]: body } }).fetcher, sha256));
      expect(error.kind, `${path} ${body.slice(0, 30)}`).toBe(kind);
    }
  });

  test("a manifest that lists no atlas is refused", async () => {
    const error = await failure(loadCatalog(ROOT, "version.json", published({ manifestPatch: { files: [] } }).fetcher, sha256));
    expect(error.kind).toBe("damaged");
  });

  test("an unreachable site, a missing file and broken JSON are told apart", async () => {
    expect((await failure(loadCatalog(ROOT, "version.json", site({}, { offline: true }).fetcher, sha256))).kind).toBe("offline");
    expect((await failure(loadCatalog(ROOT, "version.json", site({}).fetcher, sha256))).kind).toBe("missing");
    expect((await failure(loadCatalog(ROOT, "version.json", site({ [`${ROOT}version.json`]: "<html>" }).fetcher, sha256))).kind).toBe("damaged");
  });

  test("a file listed outside the build directory is never fetched", async () => {
    const source = published();
    const build = await loadBuild(ROOT, "version.json", source.fetcher, sha256);
    const outside = { ...listed("../../other/icons.json", "icons", "droid-atlas", "{}") };
    const onDemand = createOnDemand({ ...build, manifest: { ...build.manifest, files: [outside] } }, source.fetcher, sha256);
    const before = source.requests.length;
    await expect(onDemand.iconRecord("icons/a.webp")).rejects.toMatchObject({ kind: "damaged" });
    expect(source.requests.length).toBe(before);
  });
});

describe("files loaded on demand", () => {
  async function build(source: Site): Promise<LoadedBuild> {
    return loadBuild(ROOT, "version.json", source.fetcher, sha256);
  }

  const shardRequests = (source: Site): string[] => source.requests
    .filter((request) => request.url.includes("/details/"))
    .map((request) => /details\/([a-z-]+)\//.exec(request.url)?.[1] ?? "");
  const BOTH = ["fdroid", "izzy"] as const;

  test("the description is the first index's, and the second index's shard is not fetched", async () => {
    const source = published();
    const onDemand = createOnDemand(await build(source), source.fetcher, sha256);
    expect(await onDemand.description("example", BOTH)).toEqual({ origin: "fdroid", text: "From F-Droid…" });
    expect(shardRequests(source)).toEqual(["fdroid"]);
  });

  test("the order is the pipeline's, whatever order the indexes are given in", async () => {
    const source = published();
    const onDemand = createOnDemand(await build(source), source.fetcher, sha256);
    expect((await onDemand.description("example", ["izzy", "fdroid"]))?.origin).toBe("fdroid");
    expect(shardRequests(source)).toEqual(["fdroid"]);
  });

  test("the second shard is fetched only when the first has no description for the app", async () => {
    const source = published();
    const onDemand = createOnDemand(await build(source), source.fetcher, sha256);
    const absentFromFirst = ["izzy-only", "y1", "y2", "y3", "y4", "y5", "y6", "y7"].find((id) => detailsShard(id, 4) === detailsShard("example", 4)) ?? "";
    expect(absentFromFirst).not.toBe("");
    expect(await onDemand.description(absentFromFirst, BOTH)).toBeNull();
    expect(shardRequests(source)).toEqual(["fdroid", "izzy"]);
  });

  test("no shard is fetched for an origin that does not index the app", async () => {
    const source = published();
    const onDemand = createOnDemand(await build(source), source.fetcher, sha256);
    expect(await onDemand.description("example", ["izzy"])).toEqual({ origin: "izzy", text: "From IzzyOnDroid" });
    expect(shardRequests(source)).toEqual(["izzy"]);
    expect(await onDemand.description("example", [])).toBeNull();
    expect(await onDemand.description("example", ["android-foss", "github"])).toBeNull();
    expect(shardRequests(source)).toEqual(["izzy"]);
  });

  test("an app with no description, or a blank one, yields none", async () => {
    const source = published();
    const onDemand = createOnDemand(await build(source), source.fetcher, sha256);
    const sameShard = ["other", "x1", "x2", "x3", "x4", "x5", "x6", "x7"].filter((id) => detailsShard(id, 4) === detailsShard("example", 4));
    for (const id of sameShard) expect(await onDemand.description(id, BOTH)).toBeNull();
    expect(await onDemand.description("__proto__", BOTH)).toBeNull();
  });

  test("a shard is fetched once, and a failed fetch is tried again", async () => {
    const source = published();
    const onDemand = createOnDemand(await build(source), source.fetcher, sha256);
    await onDemand.description("example", BOTH);
    await onDemand.description("example", BOTH);
    expect(shardRequests(source)).toHaveLength(1);

    const flaky = published();
    const prepared = await build(flaky);
    const url = [...flaky.files.keys()].find((key) => key.includes("/details/fdroid/")) ?? "";
    const body = flaky.files.get(url) ?? "";
    flaky.files.delete(url);
    const retried = createOnDemand(prepared, flaky.fetcher, sha256);
    await expect(retried.description("example", BOTH)).rejects.toMatchObject({ kind: "missing" });
    flaky.files.set(url, body);
    expect((await retried.description("example", BOTH))?.origin).toBe("fdroid");
  });

  test("an icon's attribution is found by the path the app carries", async () => {
    const source = published();
    const onDemand = createOnDemand(await build(source), source.fetcher, sha256);
    expect(await onDemand.iconRecord("icons/a.webp")).toEqual(ICON_RECORD);
    expect(await onDemand.iconRecord("icons/a-large.webp")).toEqual(ICON_RECORD);
    expect(await onDemand.iconRecord("icons/b.webp")).toBeNull();
    expect(await onDemand.iconRecord("icons/unknown.webp")).toBeNull();
  });
});

describe("what the loader keeps for the Sources page", () => {
  test("every loaded part comes with its header, in the order the manifest lists the parts", async () => {
    const source = published();
    const loaded = await loadCatalog(ROOT, "version.json", source.fetcher, sha256);
    expect(loaded.parts.map((part) => part.file.path)).toEqual(["atlas.json", "sources/github.json", "sources/android-foss.json", "sources/awesome-shizuku.json", "sources/fdroid.json", "sources/izzy.json"]);
    expect(loaded.parts.every((part) => part.header?.license === "CC0-1.0" && part.header.source.name === "Synthetic fixture")).toBe(true);
  });

  test("a part with a malformed header still loads; only its header is missing", async () => {
    const parts = splitParts(SUBJECT);
    const body = JSON.stringify({ ...parts.github, header: { license: 7 } });
    const source = published({ replaced: { "sources/github.json": body } });
    const loaded = await loadCatalog(ROOT, "version.json", source.fetcher, sha256);
    expect(loaded.catalog.apps).toHaveLength(1);
    expect(loaded.parts.find((part) => part.file.role === "github")?.header).toBeNull();
    expect(loaded.parts.filter((part) => part.header !== null)).toHaveLength(5);
  });

  test("the icon credits are the whole icons file: its records, minus any that are not records, and its header", async () => {
    const source = published();
    const onDemand = createOnDemand(await loadBuild(ROOT, "version.json", source.fetcher, sha256), source.fetcher, sha256);
    const credits = await onDemand.iconCredits();
    expect(credits.records).toEqual([ICON_RECORD]);
    expect(credits.header).toBeNull();
  });

  test("an icon record is one with every field of the contract, each of its type", () => {
    expect(isIconRecord(ICON_RECORD)).toBe(true);
    expect(isIconRecord({ ...ICON_RECORD, revision: null, project: null, license: "not stated" })).toBe(true);
    for (const field of ["file", "fileLarge", "app", "name", "rule", "retrieved", "author", "license", "changes", "original"] as const) {
      const { [field]: dropped, ...rest } = ICON_RECORD;
      expect(isIconRecord(rest), `without ${field}: ${String(dropped)}`).toBe(false);
    }
    expect(isIconRecord({ ...ICON_RECORD, project: 7 })).toBe(false);
    expect(isIconRecord({ ...ICON_RECORD, original: { url: "https://example.org/a.png" } })).toBe(false);
    expect(isIconRecord([ICON_RECORD])).toBe(false);
  });
});

describe("paths under the data root", () => {
  test.each(["icons/abc.webp", "c/3fa9/details/fdroid/2.json", "a_b-c.d~e/f%20g"])("%s is accepted", (path) => {
    expect(dataUrl(ROOT, path)).toBe(ROOT + path);
  });

  test.each([
    "", "/etc/passwd", "../up.json", "a/../../up.json", "./a", "a//b", "https://evil.example/x.png", "//evil.example/x.png",
    "javascript:alert(1)", "data:image/png;base64,AAAA", "a\\b", "a b", "a?b=1", "a#b", 42, null,
  ])("%j is refused", (path) => {
    expect(dataUrl(ROOT, path)).toBeNull();
  });
});
