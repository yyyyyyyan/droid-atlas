import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { App, Catalog, Openness } from "../../schema/catalog.ts";
import type { PackageReading } from "../../schema/package-reading.ts";
import { chooseApk, type ReleaseAsset } from "../apk/choose.ts";
import { JOB_DEFAULTS, plan, runJob, summary, type JobOptions } from "../apk/job.ts";
import { Pacer, type Clock } from "../apk/pace.ts";
import { checkStore, emptyStore, loadStore, saveStore, type ReadingStore } from "../apk/store.ts";
import { buildZip, el, encodeAxml, rangeServer } from "./apk-fixtures.ts";

/** A virtual clock: sleeping moves time forward at once. */
function fakeClock(start = Date.parse("2026-11-23T08:00:00Z")): Clock & { slept: number[] } {
  let now = start;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  };
}

interface AppSpec {
  id: string;
  openness?: Openness | null;
  fdroid?: string;
  izzy?: string;
  github?: { slug: string; tag: string; hasApk?: boolean };
  resource?: boolean;
}

/** An invented app with only the fields the job reads filled in meaningfully. */
function app(spec: AppSpec): App {
  const index = [
    ...(spec.fdroid ? [{ origin: "fdroid" as const, pkg: spec.fdroid }] : []),
    ...(spec.izzy ? [{ origin: "izzy" as const, pkg: spec.izzy }] : []),
  ].map((i) => ({
    ...i,
    version: "1.0",
    updatedAt: null,
    addedAt: null,
    minSdk: null,
    targetSdk: null,
    sizeBytes: null,
    author: null,
    antiFeatures: [],
    permissionCount: 0,
    declaresShizuku: false,
    declaresInternet: true,
  }));
  return {
    id: spec.id,
    name: spec.id,
    category: "c",
    region: "r",
    listings: [
      {
        source: "android-foss",
        category: "android-foss/x",
        kind: spec.resource ? "resource" : "app",
        order: 0,
        name: spec.id,
        url: "https://example.org/",
        description: null,
        tags: [],
        license: null,
        added: null,
        parent: null,
        extraLinks: [],
      },
    ],
    packages: index.map((i) => i.pkg),
    repo: spec.github ? { host: "github", url: `https://github.com/${spec.github.slug}`, slug: spec.github.slug } : null,
    website: null,
    channels: [],
    summary: null,
    icon: null,
    iconLarge: null,
    license: null,
    index,
    github: spec.github
      ? {
          stars: 1,
          pushedAt: "2026-11-01T00:00:00Z",
          archived: false,
          movedTo: null,
          forkOf: null,
          release: { tag: spec.github.tag, publishedAt: "2026-11-01T00:00:00Z", hasApk: spec.github.hasApk ?? true },
        }
      : null,
    downloads: [],
    repoMissing: false,
    facets: {
      shizuku: false,
      root: false,
      paid: false,
      recommended: false,
      fork: false,
      staleLink: false,
      onFdroid: Boolean(spec.fdroid),
      onIzzy: Boolean(spec.izzy),
      openness: spec.openness === undefined ? "open-source" : spec.openness,
      noInternet: null,
      apkOnGithub: null,
      noAntiFeatures: null,
      archived: null,
    },
    evidence: { shizuku: [], root: [], archived: [], noInternet: [], openness: [], pricing: [] },
    search: spec.id,
  };
}

function catalog(apps: App[]): Catalog {
  return { apps } as unknown as Catalog;
}

const sha = (n: number): string => n.toString(16).padStart(64, "0");

/** An invented index-v2 document whose latest version of each package has a file and hash. */
function index(files: Record<string, { code: number; sha256: string }>): unknown {
  return {
    repo: { timestamp: 1 },
    packages: Object.fromEntries(
      Object.entries(files).map(([pkg, f]) => [
        pkg,
        {
          versions: {
            old: { added: 1, file: { name: `/${pkg}_1.apk`, sha256: sha(1), size: 10 }, manifest: { versionCode: 1 } },
            new: { added: 2, file: { name: `/${pkg}_${f.code}.apk`, sha256: f.sha256, size: 100 }, manifest: { versionCode: f.code } },
          },
        },
      ]),
    ),
  };
}

function packageZip(pkg: string): Uint8Array {
  const manifest = el("manifest", { "@package": pkg, versionCode: 2, versionName: "1.0" }, [
    el("application", {}, [
      el("service", { name: ".Tile", exported: true }, [el("intent-filter", {}, [el("action", { name: "android.service.quicksettings.action.QS_TILE" })])]),
    ]),
  ]);
  return buildZip([{ name: "AndroidManifest.xml", data: encodeAxml(manifest) }]);
}

/** A fake web: F-Droid and GitHub file hosts by range, and GitHub's release API. */
function web(
  packages: Record<string, Uint8Array>,
  releases: Record<string, unknown> = {},
  clock?: Clock,
): { fetch: typeof fetch; starts: { host: string; at: number }[] } {
  const server = rangeServer(packages);
  const starts: { host: string; at: number }[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    starts.push({ host: url.hostname, at: clock?.now() ?? 0 });
    const api = /^\/repos\/([^/]+\/[^/]+)\/releases\/latest$/.exec(url.pathname);
    if (url.hostname === "api.github.com" && api) {
      const release = releases[api[1] as string];
      return release === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(release), { status: 200 });
    }
    return server.fetch(input, init);
  }) as typeof fetch;
  return { fetch: fake, starts };
}

function options(overrides: Partial<JobOptions> & Pick<JobOptions, "fetch" | "clock">): JobOptions {
  return { ...JOB_DEFAULTS, githubToken: null, ...overrides };
}

const WG_TUNNEL: ReleaseAsset[] = [
  ["wgtunnel-fdroid-v5.9.1-arm64.apk", 18893713],
  ["wgtunnel-fdroid-v5.9.1-armv7.apk", 18433541],
  ["wgtunnel-fdroid-v5.9.1.apk", 56300286],
  ["wgtunnel-standalone-v5.9.1-arm64.apk", 18916313],
  ["wgtunnel-standalone-v5.9.1-armv7.apk", 18456141],
  ["wgtunnel-standalone-v5.9.1.apk", 56322886],
].map(([name, size]) => ({
  name: name as string,
  size: size as number,
  url: `https://github.com/wgtunnel/android/releases/download/5.9.1/${name as string}`,
  sha256: null,
  updatedAt: "2026-11-01T00:00:00Z",
}));

function assets(...names: [string, number][]): ReleaseAsset[] {
  return names.map(([name, size]) => ({ name, size, url: `https://github.com/o/r/releases/download/v1/${name}`, sha256: null, updatedAt: "2026-11-01T00:00:00Z" }));
}

test("the APK rule picks the largest universal build, else arm64, never a debug build", () => {
  assert.equal(chooseApk(WG_TUNNEL)?.name, "wgtunnel-standalone-v5.9.1.apk");
  const perAbi = assets(
    ["app-armeabi-v7a-release.apk", 9_000_000],
    ["app-arm64-v8a-release.apk", 10_000_000],
    ["app-x86_64-release.apk", 11_000_000],
    ["app-x86-release.apk", 10_500_000],
  );
  assert.equal(chooseApk(perAbi)?.name, "app-arm64-v8a-release.apk");
  assert.equal(chooseApk([...perAbi, ...assets(["app-universal-release.apk", 30_000_000])])?.name, "app-universal-release.apk");
  assert.equal(chooseApk(assets(["App-debug.apk", 50], ["App-release.apk", 40]))?.name, "App-release.apk");
  assert.equal(chooseApk(assets(["Alarmio-2.1.apk", 5], ["Alarmio-2.1.apk.sig", 1]))?.name, "Alarmio-2.1.apk");
  assert.equal(chooseApk(assets(["b.apk", 7], ["a.apk", 7]))?.name, "a.apk", "ties go by name");
  assert.equal(chooseApk(assets(["app-x86.apk", 7], ["app-armeabi-v7a.apk", 7])), null, "neither universal nor arm64");
  assert.equal(chooseApk(assets(["app-debug.apk", 7], ["source.tar.gz", 9], ["app.aab", 9])), null);
});

test("the pacer spaces requests to one host and leaves other hosts alone", async () => {
  const clock = fakeClock(0);
  const pacer = new Pacer(1000, clock);
  const starts: [string, number][] = [];
  for (const host of ["a", "a", "b", "a"]) {
    await pacer.turn(host);
    starts.push([host, clock.now()]);
  }
  assert.deepEqual(starts, [
    ["a", 0],
    ["a", 1000],
    ["b", 1000],
    ["a", 2000],
  ]);
});

test("both switches are off by default, and unknown or closed openness is skipped", () => {
  assert.equal(JOB_DEFAULTS.izzy, false);
  assert.equal(JOB_DEFAULTS.closed, false);
  const apps = [
    app({ id: "a-closed", openness: "closed-source", fdroid: "org.example.closed" }),
    app({ id: "b-unknown", openness: null, github: { slug: "o/unknown", tag: "v1" } }),
    app({ id: "c-available", openness: "source-available", fdroid: "org.example.avail" }),
    app({ id: "d-izzy", izzy: "org.example.izzy" }),
    app({ id: "e-guide", resource: true }),
    app({ id: "f-nothing" }),
  ];
  const result = plan({ catalog: catalog(apps), fdroidIndex: index({}), izzyIndex: index({ "org.example.izzy": { code: 2, sha256: sha(9) } }) }, emptyStore(), JOB_DEFAULTS, 0);
  assert.deepEqual(result.work, []);
  assert.equal(result.skipped["not-open-source"], 3);
  assert.equal(result.skipped["izzy-off"], 1);
  assert.equal(result.skipped["not-an-app"], 1);
  assert.equal(result.skipped["no-package"], 1);
  const switched = plan(
    { catalog: catalog(apps), fdroidIndex: index({}), izzyIndex: index({ "org.example.izzy": { code: 2, sha256: sha(9) } }) },
    emptyStore(),
    { ...JOB_DEFAULTS, izzy: true, closed: true },
    0,
  );
  assert.deepEqual(
    switched.work.map((w) => [w.app, w.lane]),
    [
      ["b-unknown", "github"],
      ["d-izzy", "izzy"],
    ],
  );
});

test("a run reads up to the cap, paced per host, and records every reading by its file's hash", async () => {
  const clock = fakeClock();
  const pkgs = ["org.example.a", "org.example.b", "org.example.c", "org.example.d", "org.example.e"];
  const files = Object.fromEntries(pkgs.map((pkg, i) => [pkg, { code: 2, sha256: sha(100 + i) }]));
  const net = web(Object.fromEntries(pkgs.map((pkg) => [`https://f-droid.org/repo/${pkg}_2.apk`, packageZip(pkg)])), {}, clock);
  const store = emptyStore();
  let saves = 0;
  const counts = await runJob(
    { catalog: catalog(pkgs.map((pkg, i) => app({ id: `app-${i}`, fdroid: pkg }))), fdroidIndex: index(files), izzyIndex: null },
    store,
    options({ cap: 2, fetch: net.fetch, clock, onProgress: () => saves++ }),
  );
  assert.equal(counts.read, 2);
  assert.equal(counts.skipped["over-cap"], 3);
  assert.equal(saves, 2);
  assert.deepEqual(Object.keys(store.readings).sort(), [`sha256:${sha(100)}`, `sha256:${sha(101)}`]);
  assert.equal(store.readings[`sha256:${sha(100)}`]?.file.sha256, sha(100));
  const fdroid = net.starts.filter((s) => s.host === "f-droid.org").map((s) => s.at);
  assert.ok(fdroid.length >= 6);
  for (let i = 1; i < fdroid.length; i++) assert.ok((fdroid[i] as number) - (fdroid[i - 1] as number) >= 1000, "one request a second to F-Droid");
  assert.deepEqual(checkStore(store), []);

  const again = await runJob(
    { catalog: catalog(pkgs.map((pkg, i) => app({ id: `app-${i}`, fdroid: pkg }))), fdroidIndex: index(files), izzyIndex: null },
    store,
    options({ cap: 2, fetch: net.fetch, clock }),
  );
  assert.equal(again.skipped["already-read"], 2, "files read before are not read again");
  assert.equal(again.read, 2);
  assert.equal(again.carriedOver, 2);
});

test("GitHub releases are looked up, the rule picks the file, and a release read before is not looked up again", async () => {
  const clock = fakeClock();
  const chosen = "https://github.com/wgtunnel/android/releases/download/5.9.1/wgtunnel-standalone-v5.9.1.apk";
  const asset = "https://release-assets.githubusercontent.com/x/wgtunnel-standalone-v5.9.1.apk";
  const server = rangeServer({ [asset]: packageZip("org.example.tunnel") }, { redirects: { [chosen]: asset } });
  const release = {
    tag_name: "5.9.1",
    assets: WG_TUNNEL.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.url, updated_at: a.updatedAt, digest: a.name.endsWith("standalone-v5.9.1.apk") ? `sha256:${sha(7)}` : null })),
  };
  let lookups = 0;
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith("https://api.github.com/")) {
      lookups++;
      return new Response(JSON.stringify(release), { status: 200 });
    }
    return server.fetch(input, init);
  }) as typeof fetch;
  const apps = [app({ id: "wg", github: { slug: "wgtunnel/android", tag: "5.9.1" } })];
  const store = emptyStore();
  const first = await runJob({ catalog: catalog(apps), fdroidIndex: null, izzyIndex: null }, store, options({ fetch: fake, clock }));
  assert.equal(first.read, 1);
  const reading = store.readings[`sha256:${sha(7)}`];
  assert.equal(reading?.source.url, chosen);
  assert.equal(reading?.file.name, "wgtunnel-standalone-v5.9.1.apk");
  const second = await runJob({ catalog: catalog(apps), fdroidIndex: null, izzyIndex: null }, store, options({ fetch: fake, clock }));
  assert.equal(second.skipped["already-read"], 1);
  assert.equal(lookups, 1);
});

test("a failed package is counted by kind and not tried again for a week", async () => {
  const clock = fakeClock();
  const net = web({ "https://f-droid.org/repo/org.example.bad_2.apk": new Uint8Array(100) }, {}, clock);
  const apps = [app({ id: "bad", fdroid: "org.example.bad" }), app({ id: "gone", github: { slug: "o/gone", tag: "v1" } })];
  const input = { catalog: catalog(apps), fdroidIndex: index({ "org.example.bad": { code: 2, sha256: sha(5) } }), izzyIndex: null };
  const store = emptyStore();
  const first = await runJob(input, store, options({ fetch: net.fetch, clock }));
  assert.equal(first.failed.http, 1);
  assert.equal(first.failed["release-lookup"], 1);
  const second = await runJob(input, store, options({ fetch: net.fetch, clock }));
  assert.equal(second.skipped["failed-recently"], 2);
  await clock.sleep(JOB_DEFAULTS.retryAfterMs);
  const third = await runJob(input, store, options({ fetch: net.fetch, clock }));
  assert.equal(third.failed.http, 1, "tried again after a week");
});

test("an app keeps its last reading until a newer file is read; readings of apps no longer read are dropped", async () => {
  const clock = fakeClock();
  const pkg = "org.example.kept";
  const net = web(
    { [`https://f-droid.org/repo/${pkg}_2.apk`]: packageZip(pkg), [`https://f-droid.org/repo/${pkg}_3.apk`]: packageZip(pkg) },
    {},
    clock,
  );
  const store = emptyStore();
  const apps = [app({ id: "kept", fdroid: pkg })];
  await runJob({ catalog: catalog(apps), fdroidIndex: index({ [pkg]: { code: 2, sha256: sha(20) } }), izzyIndex: null }, store, options({ fetch: net.fetch, clock }));
  const over = await runJob(
    { catalog: catalog(apps), fdroidIndex: index({ [pkg]: { code: 3, sha256: sha(21) } }), izzyIndex: null },
    store,
    options({ cap: 0, fetch: net.fetch, clock }),
  );
  assert.equal(over.skipped["over-cap"], 1);
  assert.deepEqual(Object.keys(store.readings), [`sha256:${sha(20)}`], "kept while the new version waits");
  const noIndex = await runJob({ catalog: catalog(apps), fdroidIndex: null, izzyIndex: null }, store, options({ fetch: net.fetch, clock }));
  assert.equal(noIndex.skipped["no-index"], 1);
  assert.deepEqual(Object.keys(store.readings), [`sha256:${sha(20)}`], "kept when the index is missing");
  const newer = await runJob({ catalog: catalog(apps), fdroidIndex: index({ [pkg]: { code: 3, sha256: sha(21) } }), izzyIndex: null }, store, options({ fetch: net.fetch, clock }));
  assert.equal(newer.read, 1);
  assert.equal(newer.dropped, 1);
  assert.deepEqual(Object.keys(store.readings), [`sha256:${sha(21)}`]);
  const closed = await runJob(
    { catalog: catalog([app({ id: "kept", fdroid: pkg, openness: "closed-source" })]), fdroidIndex: index({ [pkg]: { code: 3, sha256: sha(21) } }), izzyIndex: null },
    store,
    options({ fetch: net.fetch, clock }),
  );
  assert.equal(closed.dropped, 1);
  assert.deepEqual(store.readings, {});
});

test("time runs out: no package starts after the limit", async () => {
  const clock = fakeClock();
  const pkgs = ["org.example.a", "org.example.b", "org.example.c"];
  const net = web(Object.fromEntries(pkgs.map((pkg) => [`https://f-droid.org/repo/${pkg}_2.apk`, packageZip(pkg)])), {}, clock);
  const counts = await runJob(
    {
      catalog: catalog(pkgs.map((pkg, i) => app({ id: `app-${i}`, fdroid: pkg }))),
      fdroidIndex: index(Object.fromEntries(pkgs.map((pkg, i) => [pkg, { code: 2, sha256: sha(40 + i) }]))),
      izzyIndex: null,
    },
    emptyStore(),
    options({ fetch: net.fetch, clock, stopAfterMs: 4000 }),
  );
  assert.equal(counts.read + counts.skipped["time-limit"], 3);
  assert.ok(counts.skipped["time-limit"] >= 1);
});

function goodReading(key: number): PackageReading {
  return {
    format: 1,
    evidence: "statically-discovered",
    source: { host: "fdroid", url: `https://f-droid.org/repo/org.example.s_${key}.apk` },
    file: { name: `org.example.s_${key}.apk`, sizeBytes: 100, sha256: sha(key) },
    readAt: "2026-11-23T08:00:00.000Z",
    package: "org.example.s",
    version: { name: "1.0", code: key },
    manifest: { sha256: sha(1), sizeBytes: 10 },
    transfer: { requests: 3, bytes: 900 },
    interfaces: { tiles: [], taskerPlugin: [], shareTargets: [], links: [], actions: [], shizuku: { permission: false, provider: false } },
  };
}

test("the store keeps good entries, drops bad ones, and is never saved broken", () => {
  const dir = mkdtempSync(join(tmpdir(), "readings-"));
  const path = join(dir, "readings.json");
  assert.equal(loadStore(path).status, "missing");
  assert.deepEqual(loadStore(path).store, emptyStore());
  writeFileSync(path, "{ not json");
  assert.equal(loadStore(path).status, "unreadable");
  writeFileSync(path, JSON.stringify({ format: 99, readings: {} }));
  assert.equal(loadStore(path).status, "unreadable");

  const bad = { ...goodReading(3), evidence: "documented" };
  const html = goodReading(4);
  html.interfaces.actions.push({ action: "<script>", component: { type: "receiver", name: "a b", exported: null, enabled: null, permission: null } });
  const text = `{"format":1,"readings":{"sha256:${sha(2)}":${JSON.stringify(goodReading(2))},"sha256:${sha(3)}":${JSON.stringify(bad)},"sha256:${sha(4)}":${JSON.stringify(html)},"sha256:${sha(9)}":${JSON.stringify(goodReading(5))},"__proto__":${JSON.stringify(goodReading(6))}},"failures":{"github:o/r@v1":{"at":"2026-11-20T00:00:00Z","kind":"http"},"x":{"at":"nope","kind":"http"}}}`;
  writeFileSync(path, text);
  const loaded = loadStore(path);
  const spaced = goodReading(8);
  spaced.version = { name: "1.2 beta", code: { unread: "resource-reference", ref: "0x7f0a0001" } };
  assert.deepEqual(checkStore({ format: 1, readings: { [`sha256:${sha(8)}`]: spaced }, failures: {} }), []);
  assert.equal(loaded.status, "read");
  assert.deepEqual(Object.keys(loaded.store.readings), [`sha256:${sha(2)}`]);
  assert.deepEqual(Object.keys(loaded.store.failures), ["github:o/r@v1"]);
  assert.equal(loaded.dropped, 5);
  assert.equal(Object.getPrototypeOf(loaded.store.readings), Object.prototype);

  saveStore(path, loaded.store);
  const saved = readFileSync(path, "utf8");
  const broken: ReadingStore = { ...loaded.store, readings: { ...loaded.store.readings, [`sha256:${sha(3)}`]: bad as unknown as PackageReading } };
  assert.notDeepEqual(checkStore(broken), []);
  assert.throws(() => saveStore(path, broken), /not saved/);
  assert.equal(readFileSync(path, "utf8"), saved, "the last good file stays");
});

test("the summary states counts only", () => {
  const text = summary(
    {
      read: 3,
      skipped: { "not-an-app": 1, "not-open-source": 2, "izzy-off": 0, "no-index": 0, "no-package": 4, "already-read": 5, "failed-recently": 0, "no-apk-by-rule": 1, "over-cap": 6, "time-limit": 0 },
      failed: { address: 0, http: 1, zip: 0, manifest: 0, unexpected: 0, "release-lookup": 2 },
      carriedOver: 7,
      dropped: 1,
    },
    "read",
  );
  assert.match(text, /\| Read \| 3 \|/);
  assert.match(text, /\| Skipped: over-cap \| 6 \|/);
  assert.match(text, /\| Failed: release-lookup \| 2 \|/);
  assert.match(text, /\| Carried over \| 7 \|/);
  assert.match(text, /\| Dropped \| 1 \|/);
  assert.doesNotMatch(text, /org\.|https?:/);
});
