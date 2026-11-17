import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { CatalogVersion } from "../catalog/schema.ts";
import {
  buildCacheName,
  buildDirectory,
  chooseLaunchBuild,
  classifyRequest,
  CURRENT_KEY,
  decideUpdate,
  ICON_CACHE,
  iconDigestPrefix,
  isVersion,
  listedDigest,
  POINTER_CACHE,
  holdsFiles,
  isAppAddress,
  mayPurge,
  shellCacheName,
  SILENT_WINDOW_MS,
  staleCaches,
  VIEWED_CACHE,
} from "./decide.ts";
import {
  checkForUpdate,
  downloadBuild,
  DownloadError,
  ensureCatalog,
  hasCompleteBuild,
  launchChoice,
  leftoverCaches,
  noteWindow,
  openWindows,
  pruneIcons,
  purge,
  readPointers,
  storeBuild,
  storedBuildFetch,
  type CacheLike,
  type CacheStorageLike,
  type OfflineEnv,
} from "./store.ts";

const ROOT = "https://atlas.example/app/data/";
const SCOPE = "https://atlas.example/app/";

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function hashOf(seed: string): string {
  return sha(`build ${seed}`);
}

function version(seed: string, schema = 1): CatalogVersion {
  const hash = hashOf(seed);
  return { schema: schema as CatalogVersion["schema"], generatedAt: `2026-11-${seed.length + 10}T00:00:00Z`, hash, manifest: `c/${hash.slice(0, 16)}/manifest.json` };
}

/** Cache Storage as a map of maps. Bodies are kept as text so a test can read what was stored. */
class FakeCaches implements CacheStorageLike {
  readonly stores = new Map<string, Map<string, string>>();
  failPutsMatching: RegExp | null = null;

  async open(name: string): Promise<CacheLike> {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map();
      this.stores.set(name, store);
    }
    const entries = store;
    return {
      match: async (url) => (entries.has(url) ? new Response(entries.get(url)) : undefined),
      put: async (url, response) => {
        if (this.failPutsMatching?.test(url)) return;
        entries.set(url, await response.text());
      },
      keys: async () => [...entries.keys()].map((url) => ({ url })),
      delete: async (url) => entries.delete(url),
    };
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.stores.delete(name);
  }

  snapshot(): string {
    return JSON.stringify([...this.stores].map(([name, entries]) => [name, [...entries]]));
  }
}

interface Site {
  files: Map<string, string>;
  requests: { url: string; cache: string | undefined }[];
  offline: boolean;
}

/** Publishes a build on a fake site and returns its version. `tamper` alters what is served after the manifest was written. */
function publish(site: Site, seed: string, options: { schema?: number; makeLive?: boolean } = {}): CatalogVersion {
  const built = version(seed, options.schema ?? 1);
  const dir = `${ROOT}c/${built.hash.slice(0, 16)}/`;
  const parts: Record<string, [string, string]> = {
    "atlas.json": ["atlas", JSON.stringify({ schema: built.schema, hash: built.hash, apps: [], regions: [], redirects: {}, generatedAt: built.generatedAt, seed })],
    "sources/android-foss.json": ["source", JSON.stringify({ info: {}, categories: [], listings: [], seed })],
    "sources/fdroid.json": ["index", JSON.stringify({ origin: "fdroid", apps: {}, seed })],
    "sources/github.json": ["github", JSON.stringify({ apps: {}, fetchedAt: "x", seed })],
    "details/fdroid/0.json": ["details", JSON.stringify({ seed })],
    "icons.json": ["icons", JSON.stringify({ icons: [], seed })],
  };
  const manifest = {
    schema: built.schema,
    generatedAt: built.generatedAt,
    hash: built.hash,
    detailsShards: 1,
    files: Object.entries(parts).map(([path, [role, body]]) => ({ path, role, origin: "droid-atlas", sha256: sha(body), bytes: body.length, license: "CC0-1.0", attribution: "Test" })),
  };
  for (const [path, [, body]] of Object.entries(parts)) site.files.set(dir + path, body);
  site.files.set(ROOT + built.manifest, JSON.stringify(manifest));
  if (options.makeLive !== false) site.files.set(`${ROOT}version.json`, JSON.stringify(built));
  return built;
}

function world(): { site: Site; caches: FakeCaches; env: OfflineEnv } {
  const site: Site = { files: new Map(), requests: [], offline: false };
  const caches = new FakeCaches();
  const env: OfflineEnv = {
    caches,
    dataRoot: ROOT,
    supportedSchema: 1,
    digest: async (bytes) => createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    fetch: async (url, init) => {
      site.requests.push({ url, cache: init?.cache });
      if (site.offline) throw new TypeError("Failed to fetch");
      const body = site.files.get(url);
      return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
    },
  };
  return { site, caches, env };
}

const startFiles = (built: CatalogVersion): string[] => {
  const dir = `${ROOT}c/${built.hash.slice(0, 16)}/`;
  return [ROOT + built.manifest, `${dir}atlas.json`, `${dir}sources/android-foss.json`, `${dir}sources/fdroid.json`, `${dir}sources/github.json`].sort();
};

describe("which build a launch renders", () => {
  const a = version("a");
  const b = version("bb");

  test("the current build, when this shell reads its format", () => {
    expect(chooseLaunchBuild(b, a, 1)).toEqual({ use: b, needsReload: false });
  });

  test("nothing stored means the network, with no reload asked for", () => {
    expect(chooseLaunchBuild(null, null, 1)).toEqual({ use: null, needsReload: false });
  });

  test("a current build in a newer format is left alone: the previous one is rendered and a reload is asked for", () => {
    const newer = version("ccc", 2);
    expect(chooseLaunchBuild(newer, a, 1)).toEqual({ use: a, needsReload: true });
    expect(chooseLaunchBuild(newer, null, 1)).toEqual({ use: null, needsReload: true });
    expect(chooseLaunchBuild(newer, version("dddd", 3), 1)).toEqual({ use: null, needsReload: true });
  });

  test("a newer shell reads an older format", () => {
    expect(chooseLaunchBuild(a, null, 2)).toEqual({ use: a, needsReload: false });
  });
});

describe("what to do with the version the site serves", () => {
  const a = version("a");
  const b = version("bb");

  test("the same build: nothing", () => {
    expect(decideUpdate(a, { ...a }, 1)).toEqual({ action: "none" });
  });

  test("another build in a readable format: download it", () => {
    expect(decideUpdate(a, b, 1)).toEqual({ action: "download", version: b });
    expect(decideUpdate(null, a, 1)).toEqual({ action: "download", version: a });
  });

  test("a newer format is refused before anything else about the file is looked at", () => {
    expect(decideUpdate(a, version("ccc", 2), 1)).toEqual({ action: "newer-schema" });
    expect(decideUpdate(a, { schema: 9, anything: "else" }, 1)).toEqual({ action: "newer-schema" });
  });

  test.each([
    ["not an object", "c/abc/manifest.json"],
    ["null", null],
    ["a hash that is not hex", { ...a, hash: "../../x" }],
    ["a manifest path that climbs out", { ...a, manifest: "c/../../evil/manifest.json" }],
    ["a manifest elsewhere", { ...a, manifest: "https://evil.example/c/abcdef0123456789/manifest.json" }],
    ["no schema", { hash: a.hash, manifest: a.manifest, generatedAt: a.generatedAt }],
    ["a schema of zero", { ...a, schema: 0 }],
  ])("%s is not a version, and changes nothing", (_label, fetched) => {
    expect(decideUpdate(a, fetched, 1)).toEqual({ action: "invalid" });
    expect(isVersion(fetched)).toBe(false);
  });
});

describe("when stored files may be purged", () => {
  const alone = { windowsHoldingFiles: 0, newerWorkerPending: false, runsThisShell: true, showsCurrentBuild: true };

  test("when no other window holds them, and the window that launched is itself on this shell and the current build", () => {
    expect(mayPurge(alone)).toBe(true);
  });

  test("not while another window holds them", () => {
    expect(mayPurge({ ...alone, windowsHoldingFiles: 1 })).toBe(false);
    expect(mayPurge({ ...alone, windowsHoldingFiles: 4 })).toBe(false);
  });

  test("a window on another shell or another build holds its files for as long as it is open", () => {
    const longAgo = 0;
    const now = 400 * SILENT_WINDOW_MS;
    expect(holdsFiles({ shell: "old", build: "b", seen: longAgo }, "new", "b", now)).toBe(true);
    expect(holdsFiles({ shell: "new", build: "a", seen: longAgo }, "new", "b", now)).toBe(true);
    expect(holdsFiles({ shell: "old", build: null, seen: longAgo }, "new", "b", now)).toBe(true);
    expect(holdsFiles({ shell: null, build: "a", seen: longAgo }, "new", "b", now)).toBe(true);
  });

  test("a window on this shell and the current build holds nothing, however many are open", () => {
    expect(holdsFiles({ shell: "new", build: "b", seen: 5 }, "new", "b", 6)).toBe(false);
  });

  test("a window that has not said what it runs or shows holds them for a day, and no longer", () => {
    const silent = { shell: null, build: null, seen: 1000 };
    expect(holdsFiles(silent, "new", "b", 1000)).toBe(true);
    expect(holdsFiles(silent, "new", "b", 1000 + SILENT_WINDOW_MS - 1)).toBe(true);
    expect(holdsFiles(silent, "new", "b", 1000 + SILENT_WINDOW_MS)).toBe(false);
    expect(holdsFiles({ shell: "new", build: null, seen: 1000 }, "new", "b", 2000)).toBe(true);
    expect(holdsFiles({ shell: "new", build: null, seen: 1000 }, "new", "b", 1000 + SILENT_WINDOW_MS)).toBe(false);
    expect(holdsFiles({ shell: null, build: "b", seen: 1000 }, "new", "b", 1000 + SILENT_WINDOW_MS)).toBe(false);
  });

  test("only the app's own address is a window of the app; a file of the site shown in a window is not", () => {
    const scope = "https://atlas.example/app/";
    expect(isAppAddress("https://atlas.example/app/", scope)).toBe(true);
    expect(isAppAddress("https://atlas.example/app/?launch=1#/region/media", scope)).toBe(true);
    expect(isAppAddress("https://atlas.example/app/index.html#/saved", scope)).toBe(true);
    expect(isAppAddress("https://atlas.example/app/third-party-licenses.txt", scope)).toBe(false);
    expect(isAppAddress("https://atlas.example/app/data/licenses/GPL-3.0-or-later.txt", scope)).toBe(false);
    expect(isAppAddress("https://atlas.example/", scope)).toBe(false);
    expect(isAppAddress("https://elsewhere.example/app/", scope)).toBe(false);
    expect(isAppAddress("not an address", scope)).toBe(false);
  });

  test("not while a newer worker is installing or waiting, whose files they may be", () => {
    expect(mayPurge({ ...alone, newerWorkerPending: true })).toBe(false);
  });

  test("not when the window that launched is itself on another shell or another build", () => {
    expect(mayPurge({ ...alone, runsThisShell: false })).toBe(false);
    expect(mayPurge({ ...alone, showsCurrentBuild: false })).toBe(false);
  });
});

describe("how a request is answered", () => {
  const SHELL = ["index.html", "assets/index-abc.js", "theme.js", "manifest.webmanifest"];
  const kind = (url: string, mode = "cors", method = "GET") => classifyRequest({ url, mode, method }, SCOPE, SHELL);

  test("a page load of the app's own address is the shell, whatever the query or fragment", () => {
    expect(kind(SCOPE, "navigate")).toEqual({ kind: "navigate" });
    expect(kind(`${SCOPE}?source=pwa&utm=x`, "navigate")).toEqual({ kind: "navigate" });
    expect(kind(`${SCOPE}index.html?catalog=fixture#/region/media`, "navigate")).toEqual({ kind: "navigate" });
  });

  test("a page load of any other path in scope is never answered with the shell", () => {
    expect(kind(`${SCOPE}some/old/path`, "navigate")).toEqual({ kind: "pass" });
    expect(kind(`${SCOPE}third-party-licenses.txt`, "navigate")).toEqual({ kind: "viewed" });
    expect(kind(`${SCOPE}data/licenses/MIT.txt`, "navigate")).toEqual({ kind: "viewed" });
    expect(kind(`${SCOPE}data/c/0123456789abcdef/sources/fdroid.json`, "navigate")).toEqual({ kind: "build-file", hash: "0123456789abcdef" });
    expect(kind(`${SCOPE}data/report.md`, "navigate")).toEqual({ kind: "pass" });
    for (const path of ["third-party-licenses.txt", "data/licenses/MIT.txt", "data/upstream/android-foss/abc.md", "anything.txt", "index.htm"]) {
      expect(kind(SCOPE + path, "navigate").kind).not.toBe("navigate");
    }
  });

  test("the shell's own files are recognized by path, ignoring the query", () => {
    expect(kind(`${SCOPE}assets/index-abc.js`)).toEqual({ kind: "shell", file: "assets/index-abc.js" });
    expect(kind(`${SCOPE}theme.js?v=2`)).toEqual({ kind: "shell", file: "theme.js" });
    expect(kind(`${SCOPE}assets/index-other.js`)).toEqual({ kind: "other-shell" });
    expect(kind(`${SCOPE}assets/font-abc.woff2?v=1`)).toEqual({ kind: "other-shell" });
    expect(kind(`${SCOPE}assets/nested/file.js`)).toEqual({ kind: "pass" });
    expect(kind(`${SCOPE}assets/index-other.js`, "cors", "POST")).toEqual({ kind: "pass" });
  });

  test("files of a build, icons, and license texts each have their own treatment", () => {
    expect(kind(`${SCOPE}data/c/0123456789abcdef/details/fdroid/3.json`)).toEqual({ kind: "build-file", hash: "0123456789abcdef" });
    expect(kind(`${SCOPE}data/c/0123456789abcdef/manifest.json`)).toEqual({ kind: "build-file", hash: "0123456789abcdef" });
    expect(kind(`${SCOPE}data/icons/005088aaab448a31.webp`)).toEqual({ kind: "icon" });
    expect(kind(`${SCOPE}data/licenses/GPL-3.0-or-later.txt`)).toEqual({ kind: "viewed" });
    expect(kind(`${SCOPE}third-party-licenses.txt`)).toEqual({ kind: "viewed" });
  });

  test("version.json is never answered from a cache", () => {
    expect(kind(`${SCOPE}data/version.json`)).toEqual({ kind: "pass" });
    expect(kind(`${SCOPE}data/version.json`, "cors")).toEqual({ kind: "pass" });
  });

  test("other origins, other paths on this origin, and anything but GET go straight through", () => {
    expect(kind("https://f-droid.org/packages/org.example/", "navigate")).toEqual({ kind: "pass" });
    expect(kind("https://atlas.example/other-app/", "navigate")).toEqual({ kind: "pass" });
    expect(kind("https://atlas.example/apparently/", "navigate")).toEqual({ kind: "pass" });
    expect(kind(`${SCOPE}data/licenses/MIT.txt`, "cors", "HEAD")).toEqual({ kind: "pass" });
    expect(kind(`${SCOPE}`, "navigate", "POST")).toEqual({ kind: "pass" });
    expect(kind("not a url")).toEqual({ kind: "pass" });
    expect(kind(`${SCOPE}data/upstream/android-foss/abc.md`)).toEqual({ kind: "pass" });
    expect(kind(`${SCOPE}data/report.json`)).toEqual({ kind: "pass" });
  });

  test("a build directory that is not a hash is not treated as one", () => {
    expect(kind(`${SCOPE}data/c/..%2f..%2fsecret/x.json`)).toEqual({ kind: "pass" });
    expect(kind(`${SCOPE}data/c/latest/atlas.json`)).toEqual({ kind: "pass" });
  });
});

describe("what a viewed file must hash to before it is kept", () => {
  const digest = "a".repeat(64);
  const manifest = { files: [{ path: "details/fdroid/3.json", sha256: digest.toUpperCase() }, { path: "icons.json", sha256: "short" }, "junk", null] };

  test("a file the stored manifest lists: the SHA-256 listed for it", () => {
    expect(listedDigest(manifest, "details/fdroid/3.json")).toBe(digest);
  });

  test("a file it does not list, or lists without a usable digest, is never kept", () => {
    expect(listedDigest(manifest, "details/fdroid/4.json")).toBeNull();
    expect(listedDigest(manifest, "icons.json")).toBeNull();
    expect(listedDigest(manifest, "../../version.json")).toBeNull();
    expect(listedDigest(null, "details/fdroid/3.json")).toBeNull();
    expect(listedDigest({ files: "all of them" }, "details/fdroid/3.json")).toBeNull();
  });

  test("an icon: the hash its own name starts with", () => {
    expect(iconDigestPrefix(`${ROOT}icons/005088aaab448a31.webp`)).toBe("005088aaab448a31");
    expect(iconDigestPrefix(`${ROOT}icons/005088aaab448a31.webp?v=1`)).toBe("005088aaab448a31");
    expect(iconDigestPrefix(`${ROOT}icons/launcher.webp`)).toBeNull();
    expect(iconDigestPrefix(`${ROOT}c/005088aaab448a31/icons.json`)).toBeNull();
  });
});

describe("which caches are left over", () => {
  const names = [
    shellCacheName("s1"), shellCacheName("s2"), buildCacheName("aaaaaaaaaaaaaaaa"), buildCacheName("bbbbbbbbbbbbbbbb"), buildCacheName("cccccccccccccccc"),
    POINTER_CACHE, ICON_CACHE, VIEWED_CACHE, "someone-elses-cache", "workbox-precache-v2",
  ];

  test("shells of other versions and builds that are not kept; nothing else", () => {
    expect(staleCaches(names, "s2", ["bbbbbbbbbbbbbbbb", "cccccccccccccccc"])).toEqual([shellCacheName("s1"), buildCacheName("aaaaaaaaaaaaaaaa")]);
  });

  test("without a shell version no shell is named", () => {
    expect(staleCaches(names, null, ["cccccccccccccccc"])).toEqual([buildCacheName("aaaaaaaaaaaaaaaa"), buildCacheName("bbbbbbbbbbbbbbbb")]);
  });

  test("the build directory comes from the manifest path", () => {
    expect(buildDirectory(version("a"))).toBe(hashOf("a").slice(0, 16));
    expect(buildDirectory({ manifest: "c/../x/manifest.json" })).toBeNull();
  });
});

describe("fetching and storing a build", () => {
  test("a complete, correct build is stored and becomes current", async () => {
    const { site, caches, env } = world();
    const a = publish(site, "a");
    expect(await checkForUpdate(env)).toEqual({ result: "updated", version: a });
    expect(await readPointers(env)).toEqual({ current: a, previous: null });
    expect(await hasCompleteBuild(env, a)).toBe(true);
    expect([...(caches.stores.get(buildCacheName(a.hash.slice(0, 16)))?.keys() ?? [])].sort()).toEqual(startFiles(a));
    expect(await launchChoice(env)).toEqual({ use: a, needsReload: false });
  });

  test("version.json is always asked for past the HTTP cache", async () => {
    const { site, env } = world();
    publish(site, "a");
    await checkForUpdate(env);
    expect(site.requests[0]).toEqual({ url: `${ROOT}version.json`, cache: "no-cache" });
  });

  test("details shards and icon credits are not fetched with the build", async () => {
    const { site, env } = world();
    publish(site, "a");
    await checkForUpdate(env);
    expect(site.requests.some((request) => /details|icons\.json/.test(request.url))).toBe(false);
  });

  test("a second build replaces the first as current and keeps it as previous; a third arriving deletes nothing, because a window may still show the first", async () => {
    const { site, caches, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    const b = publish(site, "bb");
    expect(await checkForUpdate(env)).toEqual({ result: "updated", version: b });
    expect(await readPointers(env)).toEqual({ current: b, previous: a });
    expect(await hasCompleteBuild(env, a)).toBe(true);
    const c = publish(site, "ccc");
    await checkForUpdate(env);
    expect(await readPointers(env)).toEqual({ current: c, previous: b });
    expect(caches.stores.has(buildCacheName(a.hash.slice(0, 16)))).toBe(true);
    expect(caches.stores.has(buildCacheName(b.hash.slice(0, 16)))).toBe(true);
    expect(await hasCompleteBuild(env, a)).toBe(true);
  });

  test("the same build served again is reported as current and nothing is fetched but the version", async () => {
    const { site, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    site.requests.length = 0;
    expect(await checkForUpdate(env)).toEqual({ result: "current", version: a });
    expect(site.requests.map((request) => request.url)).toEqual([`${ROOT}version.json`]);
  });

  test("a current build that lost a file is fetched again", async () => {
    const { site, caches, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    caches.stores.get(buildCacheName(a.hash.slice(0, 16)))?.delete(`${ROOT}c/${a.hash.slice(0, 16)}/sources/fdroid.json`);
    expect(await hasCompleteBuild(env, a)).toBe(false);
    expect(await checkForUpdate(env)).toEqual({ result: "current", version: a });
    expect(await hasCompleteBuild(env, a)).toBe(true);
  });
});

describe("a download that is not right changes nothing", () => {
  async function withBuildA() {
    const made = world();
    const a = publish(made.site, "a");
    await checkForUpdate(made.env);
    return { ...made, a, before: made.caches.snapshot() };
  }

  test("a part whose bytes do not match the manifest", async () => {
    const { site, caches, env, a, before } = await withBuildA();
    const b = publish(site, "bb");
    const url = `${ROOT}c/${b.hash.slice(0, 16)}/sources/android-foss.json`;
    site.files.set(url, `${site.files.get(url)} `);
    expect(await checkForUpdate(env)).toEqual({ result: "rejected", reason: "mismatch" });
    expect(caches.snapshot()).toBe(before);
    expect((await readPointers(env)).current).toEqual(a);
  });

  test("a part that is missing", async () => {
    const { site, caches, env, before } = await withBuildA();
    const b = publish(site, "bb");
    site.files.delete(`${ROOT}c/${b.hash.slice(0, 16)}/sources/github.json`);
    expect(await checkForUpdate(env)).toEqual({ result: "rejected", reason: "missing" });
    expect(caches.snapshot()).toBe(before);
  });

  test("a manifest that belongs to another build", async () => {
    const { site, caches, env, a, before } = await withBuildA();
    const b = publish(site, "bb");
    site.files.set(ROOT + b.manifest, site.files.get(ROOT + a.manifest) ?? "");
    expect(await checkForUpdate(env)).toEqual({ result: "rejected", reason: "mismatch" });
    expect(caches.snapshot()).toBe(before);
  });

  test("an atlas that belongs to another build, even with a matching hash in the manifest", async () => {
    const { site, caches, env, before } = await withBuildA();
    const b = publish(site, "bb");
    const dir = `${ROOT}c/${b.hash.slice(0, 16)}/`;
    const foreign = JSON.stringify({ schema: 1, hash: hashOf("zzzz"), apps: [] });
    const manifest = JSON.parse(site.files.get(ROOT + b.manifest) ?? "{}") as { files: { path: string; sha256: string }[] };
    for (const file of manifest.files) if (file.path === "atlas.json") file.sha256 = sha(foreign);
    site.files.set(`${dir}atlas.json`, foreign);
    site.files.set(ROOT + b.manifest, JSON.stringify(manifest));
    expect(await checkForUpdate(env)).toEqual({ result: "rejected", reason: "mismatch" });
    expect(caches.snapshot()).toBe(before);
  });

  test("a part that is not JSON, and a version file that is not one", async () => {
    const { site, caches, env, before } = await withBuildA();
    site.files.set(`${ROOT}version.json`, "<!doctype html><title>Not found</title>");
    expect(await checkForUpdate(env)).toEqual({ result: "rejected", reason: "malformed" });
    site.files.set(`${ROOT}version.json`, JSON.stringify({ schema: 1, hash: "nope" }));
    expect(await checkForUpdate(env)).toEqual({ result: "rejected", reason: "malformed" });
    expect(caches.snapshot()).toBe(before);
  });

  test("a manifest that lists a file outside its directory", async () => {
    const { site, caches, env, before } = await withBuildA();
    const b = publish(site, "bb");
    const manifest = JSON.parse(site.files.get(ROOT + b.manifest) ?? "{}") as { files: { path: string; role: string }[] };
    manifest.files.push({ path: "../../../outside.json", role: "source" });
    site.files.set(ROOT + b.manifest, JSON.stringify(manifest));
    expect(await checkForUpdate(env)).toEqual({ result: "rejected", reason: "malformed" });
    expect(caches.snapshot()).toBe(before);
    expect(site.requests.some((request) => request.url.includes("outside"))).toBe(false);
  });

  test("a site that cannot be reached", async () => {
    const { site, caches, env, before } = await withBuildA();
    site.offline = true;
    expect(await checkForUpdate(env)).toEqual({ result: "offline" });
    expect(caches.snapshot()).toBe(before);
  });

  test("a connection that drops after the version file", async () => {
    const { site, caches, env, before } = await withBuildA();
    publish(site, "bb");
    const online = env.fetch;
    env.fetch = async (url, init) => {
      if (!url.endsWith("version.json")) throw new TypeError("Failed to fetch");
      return online(url, init);
    };
    expect(await checkForUpdate(env)).toEqual({ result: "offline" });
    expect(caches.snapshot()).toBe(before);
  });

  test("a platform that cannot compute SHA-256 stores nothing unverified", async () => {
    const { site, caches, env } = world();
    publish(site, "a");
    env.digest = async () => null;
    expect(await checkForUpdate(env)).toEqual({ result: "rejected", reason: "unverifiable" });
    expect([...caches.stores.values()].every((entries) => entries.size === 0)).toBe(true);
  });

  test("storage that silently drops a file: the pointer does not move", async () => {
    const { site, caches, env, a } = await withBuildA();
    publish(site, "bb");
    caches.failPutsMatching = /sources\/fdroid\.json$/;
    expect(await checkForUpdate(env)).toEqual({ result: "rejected", reason: "missing" });
    expect((await readPointers(env)).current).toEqual(a);
  });
});

describe("a catalog in a newer format than the shell reads", () => {
  test("is refused at the version file: nothing is fetched, the stored catalog stays current", async () => {
    const { site, caches, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    const before = caches.snapshot();
    publish(site, "bb", { schema: 2 });
    site.requests.length = 0;
    expect(await checkForUpdate(env)).toEqual({ result: "newer-schema" });
    expect(site.requests.map((request) => request.url)).toEqual([`${ROOT}version.json`]);
    expect(caches.snapshot()).toBe(before);
    expect(await launchChoice(env)).toEqual({ use: a, needsReload: false });
  });

  test("is refused at the manifest and at the atlas when the version file understates it", async () => {
    const { site, env } = world();
    const a = publish(site, "a", { makeLive: false });
    const manifest = JSON.parse(site.files.get(ROOT + a.manifest) ?? "{}") as Record<string, unknown>;
    site.files.set(ROOT + a.manifest, JSON.stringify({ ...manifest, schema: 2 }));
    await expect(downloadBuild(env, a)).rejects.toMatchObject({ reason: "newer-schema" });

    const b = publish(site, "bb", { makeLive: false });
    const dir = `${ROOT}c/${b.hash.slice(0, 16)}/`;
    const atlas = JSON.stringify({ schema: 2, hash: b.hash });
    const listed = JSON.parse(site.files.get(ROOT + b.manifest) ?? "{}") as { files: { path: string; sha256: string }[] };
    for (const file of listed.files) if (file.path === "atlas.json") file.sha256 = sha(atlas);
    site.files.set(`${dir}atlas.json`, atlas);
    site.files.set(ROOT + b.manifest, JSON.stringify(listed));
    await expect(downloadBuild(env, b)).rejects.toMatchObject({ reason: "newer-schema" });
  });

  test("stored by a newer shell in another window: this shell renders the previous build and asks for a reload", async () => {
    const { site, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    const newer = publish(site, "bb", { schema: 2 });
    await checkForUpdate({ ...env, supportedSchema: 2 });
    expect((await readPointers(env)).current).toEqual(newer);
    expect(await launchChoice(env)).toEqual({ use: a, needsReload: true });
    expect(await hasCompleteBuild(env, a)).toBe(true);
  });
});

describe("the install step's requirement", () => {
  test("online, it stores the catalog the site serves", async () => {
    const { site, env } = world();
    const a = publish(site, "a");
    expect(await ensureCatalog(env)).toEqual(a);
    expect(await hasCompleteBuild(env, a)).toBe(true);
  });

  test("with nothing stored it fails when the catalog is missing, altered, unreachable or too new", async () => {
    const missing = world();
    await expect(ensureCatalog(missing.env)).rejects.toBeInstanceOf(DownloadError);

    const altered = world();
    const a = publish(altered.site, "a");
    altered.site.files.set(`${ROOT}c/${a.hash.slice(0, 16)}/atlas.json`, "{}");
    await expect(ensureCatalog(altered.env)).rejects.toMatchObject({ reason: "mismatch" });

    const unreachable = world();
    publish(unreachable.site, "a");
    unreachable.site.offline = true;
    await expect(ensureCatalog(unreachable.env)).rejects.toMatchObject({ reason: "unreachable" });

    const tooNew = world();
    publish(tooNew.site, "a", { schema: 2 });
    await expect(ensureCatalog(tooNew.env)).rejects.toMatchObject({ reason: "newer-schema" });
    expect(tooNew.caches.stores.has(POINTER_CACHE) ? tooNew.caches.stores.get(POINTER_CACHE)?.size : 0).toBe(0);
  });

  test("with a complete catalog already stored it is satisfied even when the site is unreachable or serves something unusable", async () => {
    const { site, env } = world();
    const a = publish(site, "a");
    await ensureCatalog(env);
    site.offline = true;
    expect(await ensureCatalog(env)).toEqual(a);
    site.offline = false;
    const b = publish(site, "bb");
    site.files.delete(`${ROOT}c/${b.hash.slice(0, 16)}/atlas.json`);
    expect(await ensureCatalog(env)).toEqual(a);
    expect((await readPointers(env)).current).toEqual(a);
  });

  test("a stored pointer whose build is incomplete does not satisfy it", async () => {
    const { site, caches, env } = world();
    const a = publish(site, "a");
    await ensureCatalog(env);
    caches.stores.get(buildCacheName(a.hash.slice(0, 16)))?.clear();
    site.offline = true;
    await expect(ensureCatalog(env)).rejects.toBeInstanceOf(DownloadError);
  });
});

describe("pointers", () => {
  test("an unreadable pointer is no pointer, and no build is deleted on its account", async () => {
    const { site, caches, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    caches.stores.get(POINTER_CACHE)?.set(ROOT + CURRENT_KEY, "{{{");
    expect(await readPointers(env)).toEqual({ current: null, previous: null });
    await purge(env, "shell");
    expect(caches.stores.has(buildCacheName(a.hash.slice(0, 16)))).toBe(true);
    expect(await launchChoice(env)).toEqual({ use: null, needsReload: false });
  });

  test("what is left over is every shell but the worker's own and every build but the current one, and nothing else", async () => {
    const { site, caches, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    const b = publish(site, "bb");
    await checkForUpdate(env);
    await caches.open(shellCacheName("old"));
    await caches.open(shellCacheName("new"));
    await caches.open(buildCacheName("feedfeedfeedfeed"));
    await caches.open(ICON_CACHE);
    await caches.open("another-apps-cache");
    expect((await leftoverCaches(env, "new")).sort()).toEqual([buildCacheName("feedfeedfeedfeed"), buildCacheName(a.hash.slice(0, 16)), shellCacheName("old")].sort());
    expect(await hasCompleteBuild(env, a)).toBe(true);
    expect(await hasCompleteBuild(env, b)).toBe(true);
  });

  test("after two deploys a purge leaves the current build and the worker's shell, forgets the previous build, and touches no other cache", async () => {
    const { site, caches, env } = world();
    publish(site, "a");
    await checkForUpdate(env);
    publish(site, "bb");
    await checkForUpdate(env);
    const c = publish(site, "ccc");
    await checkForUpdate(env);
    for (const name of [shellCacheName("first"), shellCacheName("second"), shellCacheName("third"), VIEWED_CACHE, "another-apps-cache"]) await caches.open(name);
    expect([...caches.stores.keys()].filter((name) => name.startsWith("droid-atlas:build:"))).toHaveLength(3);

    const deleted = await purge(env, "third");
    expect(deleted).toHaveLength(4);
    expect([...caches.stores.keys()].sort(), "and no cache is created by tidying").toEqual([
      "another-apps-cache", buildCacheName(c.hash.slice(0, 16)), POINTER_CACHE, shellCacheName("third"), VIEWED_CACHE,
    ].sort());
    expect(await readPointers(env)).toEqual({ current: c, previous: null });
    expect(await launchChoice(env)).toEqual({ use: c, needsReload: false });
    expect(await hasCompleteBuild(env, c)).toBe(true);
    expect(await purge(env, "third")).toEqual([]);
  });

  test("what is known of a window is added to, never taken back, and dated from when it was first seen", async () => {
    const { env } = world();
    expect(await noteWindow(env, "w1", { shell: "s1" }, 100)).toEqual({ shell: "s1", build: null, seen: 100 });
    expect(await noteWindow(env, "w1", { build: "b1" }, 200)).toEqual({ shell: "s1", build: "b1", seen: 100 });
    expect(await noteWindow(env, "w1", {}, 300)).toEqual({ shell: "s1", build: "b1", seen: 100 });
  });

  test("of the windows open now, one nothing is known of is noted as first seen, and windows that are gone are forgotten", async () => {
    const { env, caches } = world();
    await noteWindow(env, "here", { shell: "s1", build: "b1" }, 100);
    await noteWindow(env, "gone", { shell: "s0", build: "b0" }, 50);
    const first = await openWindows(env, ["here", "silent"], 1000);
    expect(first.get("here")).toEqual({ shell: "s1", build: "b1", seen: 100 });
    expect(first.get("silent")).toEqual({ shell: null, build: null, seen: 1000 });
    expect((await openWindows(env, ["here", "silent"], 9000)).get("silent")?.seen).toBe(1000);
    const kept = [...(caches.stores.get(POINTER_CACHE)?.keys() ?? [])].filter((key) => key.includes("pointer/window/"));
    expect(kept).toHaveLength(2);
    expect(kept.some((key) => key.includes("gone"))).toBe(false);
    expect(await readPointers(env)).toEqual({ current: null, previous: null });
  });

  test("the icon cache is cleared of icons the current build's entries do not use, once per build, and of nothing when the build cannot be read", async () => {
    const { site, caches, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    const directory = a.hash.slice(0, 16);
    const atlasUrl = `${ROOT}c/${directory}/atlas.json`;
    const atlas = JSON.parse(caches.stores.get(buildCacheName(directory))?.get(atlasUrl) ?? "{}") as Record<string, unknown>;
    const withIcons = { ...atlas, apps: [{ id: "one", icon: "icons/1111111111111111.webp", iconLarge: "icons/2222222222222222.webp" }, { id: "two", icon: "icons/3333333333333333.webp", iconLarge: "icons/3333333333333333.webp" }, { id: "three", icon: null, iconLarge: null }] };
    const icons = await caches.open(ICON_CACHE);
    const stored = ["1111111111111111", "2222222222222222", "3333333333333333", "aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"].map((name) => `${ROOT}icons/${name}.webp`);
    for (const url of stored) await icons.put(url, new Response("x"));

    caches.stores.get(buildCacheName(directory))?.set(atlasUrl, "{not json");
    expect(await pruneIcons(env)).toBe(0);
    expect(caches.stores.get(ICON_CACHE)?.size).toBe(5);

    caches.stores.get(buildCacheName(directory))?.set(atlasUrl, JSON.stringify(withIcons));
    expect(await pruneIcons(env)).toBe(2);
    expect([...(caches.stores.get(ICON_CACHE)?.keys() ?? [])].sort()).toEqual(stored.slice(0, 3));

    await icons.put(`${ROOT}icons/cccccccccccccccc.webp`, new Response("x"));
    expect(await pruneIcons(env), "the same build is not read twice").toBe(0);
    expect(caches.stores.get(ICON_CACHE)?.size).toBe(4);
  });

  test("storing the build that is already current does not make it its own predecessor", async () => {
    const { site, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    await storeBuild(env, await downloadBuild(env, a));
    expect(await readPointers(env)).toEqual({ current: a, previous: null });
  });
});

describe("a launch reads its stored build without the worker", () => {
  test("every stored file comes from Cache Storage and the network is not asked", async () => {
    const { site, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    site.requests.length = 0;
    const read = storedBuildFetch(env, a);
    for (const url of startFiles(a)) expect(await (await read(url)).text()).toBe(site.files.get(url));
    expect(site.requests).toEqual([]);
  });

  test("a file the build's cache does not hold goes to the network", async () => {
    const { site, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    site.requests.length = 0;
    const shard = `${ROOT}c/${a.hash.slice(0, 16)}/details/fdroid/0.json`;
    expect(await (await storedBuildFetch(env, a)(shard)).text()).toBe(site.files.get(shard));
    expect(site.requests.map((request) => request.url)).toEqual([shard]);
  });

  test("a build that is not stored is read from the network and leaves no cache behind", async () => {
    const { site, caches, env } = world();
    const a = publish(site, "a");
    const before = caches.snapshot();
    const url = ROOT + a.manifest;
    expect(await (await storedBuildFetch(env, a)(url)).text()).toBe(site.files.get(url));
    expect(caches.snapshot()).toBe(before);
  });

  test("storage that fails is the same as storage that is empty", async () => {
    const { site, caches, env } = world();
    const a = publish(site, "a");
    await checkForUpdate(env);
    const failing: OfflineEnv = {
      ...env,
      caches: {
        open: (name) => caches.open(name),
        delete: (name) => caches.delete(name),
        keys: async () => {
          throw new Error("storage is unavailable");
        },
      },
    };
    const url = ROOT + a.manifest;
    expect(await (await storedBuildFetch(failing, a)(url)).text()).toBe(site.files.get(url));
  });
});
