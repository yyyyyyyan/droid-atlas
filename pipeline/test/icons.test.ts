/** docs/LICENSING.md §1.3: sources in order, integrity, quality gates, deny list, caching, and keeping the previous build's icons. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import type { App } from "../../schema/catalog.ts";
import type { IconRecord } from "../../schema/parts.ts";
import { basisOf, discover, DISCOVERY_RULES, dueReason, forgePage, missBackoffDays, Net, ownsModule, RateLimited, retryAfterMs, type DiscoveryEntry, type DiscoveryTarget } from "../icon-discovery.ts";
import { checkImage, encodeIcon } from "../icon-image.ts";
import { buildIcons, deniedApp, deniedSource, discoveryTarget, gitBlobId, readIconPolicy, templateApps, type IconPolicyFile } from "../icons.ts";
import { fetchableUrl, launcherIcons, pageIcons, playIcon, privateAddress, readmeLogo, safeRepoPath } from "../icon-sources.ts";
import { sharedSite } from "../forge.ts";
import { identify, NO_OVERRIDES } from "../identity.ts";
import { SOURCE_CATEGORIES, entry, fakeGithub, fakeIndex, fakeRepo, type FakePackage } from "./fixtures.ts";

test("hostile URLs from repository or web content are never fetched", () => {
  for (const url of [
    "http://example.org/logo.png",
    "https://127.0.0.1/logo.png",
    "https://[::1]/logo.png",
    "https://localhost/logo.png",
    "https://intranet/logo.png",
    "https://printer.local/logo.png",
    "https://user:pass@example.org/logo.png",
    "https://example.org:8443/logo.png",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "//example.org/logo.png",
  ]) {
    assert.equal(fetchableUrl(url), null, url);
  }
  assert.equal(fetchableUrl("https://example.org/a/logo.png#x")?.href, "https://example.org/a/logo.png");
  assert.equal(fetchableUrl("../img/logo.png", "https://example.org/a/b/")?.href, "https://example.org/a/img/logo.png");
  for (const path of ["../etc/passwd", "a/../../b", "/abs/path.png", "a//b.png", "a/./b.png", "a\\b.png", "a/b\u0000.png", ""]) assert.equal(safeRepoPath(path), false, path);
  assert.equal(safeRepoPath("app/src/main/res/mipmap-xxxhdpi/ic_launcher.png"), true);
});

test("README logos: relative paths resolve only inside the repository; store pages name only Play's image host", () => {
  const resolve = (src: string): URL | null => (src.startsWith("https:") ? fetchableUrl(src) : src === "docs/logo.png" ? new URL("https://raw.githubusercontent.com/o/r/c/docs/logo.png") : null);
  assert.equal(readmeLogo([{ src: "../../../outside/logo.png", alt: "logo" }, { src: "docs/logo.png", alt: "" }], resolve)?.href, "https://raw.githubusercontent.com/o/r/c/docs/logo.png");
  assert.equal(readmeLogo([{ src: "https://img.shields.io/badge/logo-x.svg", alt: "logo" }, { src: "https://example.org/ci/badge.svg", alt: "icon" }], resolve), null);
  assert.equal(playIcon(`<img src="https://evil.example.org/AAAAAAAAAAAAAAAAAAAAAAAAAA=w240" alt="Icon image">`), null);
  assert.equal(playIcon(`<meta property="og:image" content="https://play-lh.googleusercontent.com/AbCdEfGhIjKlMnOpQrStUvWx=s0-br30">`)?.href, "https://play-lh.googleusercontent.com/AbCdEfGhIjKlMnOpQrStUvWx=s512");
});

const NO_POLICY: IconPolicyFile = { deny: [], denySources: [], sources: [] };
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** A square test icon: a colored disc on transparency, so it is neither blank nor a single color. */
async function icon(size: number, color = "#2a6", height = size): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${height}"><rect width="${size}" height="${height}" fill="#fff"/><circle cx="${size / 2}" cy="${height / 2}" r="${Math.min(size, height) / 3}" fill="${color}"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

test("gates: a non-image, a small, an oblong or a blank image is refused", async () => {
  const html = new TextEncoder().encode("<!doctype html><html><body>Not found</body></html>");
  assert.match((await checkImage(html, { minPx: 96, allowSvg: true }) as { reason: string }).reason, /not a PNG/);
  assert.match((await checkImage(await icon(64), { minPx: 96, allowSvg: false }) as { reason: string }).reason, /below 96 px/);
  assert.equal((await checkImage(await icon(64), { minPx: 0, allowSvg: false })).ok, true, "index icons skip the size gate");
  assert.match((await checkImage(await icon(300, "#2a6", 200), { minPx: 96, allowSvg: false }) as { reason: string }).reason, /not square/);
  assert.equal((await checkImage(await icon(200, "#2a6", 196), { minPx: 96, allowSvg: false })).ok, true, "within the tolerance");
  const blank = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
  assert.match((await checkImage(blank, { minPx: 96, allowSvg: false }) as { reason: string }).reason, /blank/);
  const clear = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  assert.match((await checkImage(clear, { minPx: 96, allowSvg: false }) as { reason: string }).reason, /blank/);
});

test("gates: SVG only where allowed, and never with scripts, entities or outside references", async () => {
  const svg = (body: string): Uint8Array => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">${body}</svg>`);
  const safe = svg(`<rect width="100" height="100" fill="#fff"/><circle cx="50" cy="50" r="30" fill="#36c"/>`);
  assert.equal((await checkImage(safe, { minPx: 96, allowSvg: true })).ok, true);
  assert.match((await checkImage(safe, { minPx: 96, allowSvg: false }) as { reason: string }).reason, /not accepted/);
  for (const body of [
    `<script>alert(1)</script><circle r="9"/>`,
    `<circle r="9" onload="x()"/>`,
    `<image href="file:///etc/passwd" width="100" height="100"/>`,
    `<use href="https://example.org/x.svg#a"/>`,
    `<rect style="fill:url(https://example.org/p)"/>`,
    `<foreignObject><div/></foreignObject>`,
  ]) {
    assert.equal((await checkImage(svg(body), { minPx: 96, allowSvg: true })).ok, false, body);
  }
  const entity = new TextEncoder().encode(`<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>`);
  assert.equal((await checkImage(entity, { minPx: 96, allowSvg: true })).ok, false);
});

test("files: 192 px always, 384 px only from originals big enough, square, transparent padding, no metadata, deterministic", async () => {
  const big = await sharp(await icon(512)).withMetadata({ exif: { IFD0: { Copyright: "x" } } }).png().toBuffer();
  const check = await checkImage(big, { minPx: 96, allowSvg: false });
  assert.ok(check.ok);
  const encoded = await encodeIcon(big, check);
  const list = await sharp(encoded.list).metadata();
  assert.deepEqual([list.format, list.width, list.height, list.exif], ["webp", 192, 192, undefined]);
  assert.ok(encoded.large);
  assert.equal((await sharp(encoded.large).metadata()).width, 384);
  assert.deepEqual(await encodeIcon(big, check), encoded);

  const small = await icon(192);
  const smallCheck = await checkImage(small, { minPx: 96, allowSvg: false });
  assert.ok(smallCheck.ok);
  assert.equal((await encodeIcon(small, smallCheck)).large, null);

  const oblong = await icon(200, "#2a6", 192);
  const oblongCheck = await checkImage(oblong, { minPx: 96, allowSvg: false });
  assert.ok(oblongCheck.ok);
  const { data, info } = await sharp((await encodeIcon(oblong, oblongCheck)).list).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(data[3], 0, "the padding is transparent");
});

test("deny list: an app or any of its packages, a source rule or a host", () => {
  const policy: IconPolicyFile = {
    deny: [{ package: "org.ex.gone", reason: "removal request", date: "2026-11-12" }, { app: "ex-site", reason: "wrong image", date: "2026-11-12" }],
    denySources: [{ rule: "store-listing", reason: "vetoed class", date: "2026-11-12" }, { host: "cdn.example.org", reason: "hot-link host", date: "2026-11-12" }],
    sources: [],
  };
  const app = (id: string, packages: string[], channel?: string) => ({ id, packages, channels: channel ? [{ type: "fdroid" as const, pkg: channel, variant: null, listed: true }] : [] });
  assert.equal(deniedApp(app("org.ex.gone", ["org.ex.gone"]), policy), "removal request");
  assert.equal(deniedApp(app("other", [], "org.ex.gone"), policy), "removal request");
  assert.equal(deniedApp(app("ex-site", []), policy), "wrong image");
  assert.equal(deniedApp(app("org.ex.fine", ["org.ex.fine"]), policy), null);
  assert.equal(deniedSource({ rule: "store-listing", url: "https://play-lh.googleusercontent.com/a=s512" }, policy), "vetoed class");
  assert.equal(deniedSource({ rule: "site-icon", url: "https://img.cdn.example.org/i.png" }, policy), "hot-link host");
  assert.equal(deniedSource({ rule: "site-icon", url: "https://example.org/i.png" }, policy), null);
  const dir = mkdtempSync(join(tmpdir(), "policy-"));
  writeFileSync(join(dir, "p.json"), JSON.stringify({ deny: [{ reason: "no target" }], denySources: [] }));
  assert.throws(() => readIconPolicy(join(dir, "p.json")), /app or a package/);
  writeFileSync(join(dir, "p.json"), JSON.stringify({ deny: [], denySources: [{ rule: "invented", reason: "x" }] }));
  assert.throws(() => readIconPolicy(join(dir, "p.json")), /known rule or a host/);
  rmSync(dir, { recursive: true });
});

test("caching: new and changed apps are due, misses back off, apps with candidates rotate", () => {
  const target: DiscoveryTarget = { app: "ex", name: "Ex", github: null, gitlab: null, codeberg: null, website: "https://ex.example.org/", play: null };
  const now = new Date("2026-11-12T05:00:00Z");
  assert.equal(dueReason(target, undefined, now), "new");
  const miss: DiscoveryEntry = { basis: basisOf(target), checkedAt: "2026-11-10T05:00:00Z", misses: 1, rules: DISCOVERY_RULES, candidates: [] };
  assert.equal(dueReason(target, miss, now), null);
  assert.equal(dueReason(target, { ...miss, checkedAt: "2026-11-05T05:00:00Z" }, now), "miss");
  assert.equal(dueReason(target, { ...miss, misses: 3, checkedAt: "2026-10-20T05:00:00Z" }, now), null, "a third miss waits 28 days");
  assert.deepEqual([1, 2, 3, 4, 9].map(missBackoffDays), [7, 14, 28, 56, 56]);
  assert.equal(dueReason({ ...target, website: "https://new.example.org/" }, miss, now), "changed");
  const hit: DiscoveryEntry = { ...miss, misses: 0, checkedAt: "2026-11-01T05:00:00Z", candidates: [{ rule: "site-icon", url: "https://ex.example.org/i.png", expect: null, revision: null, allowSvg: true, minPx: 96 }] };
  const days = Array.from({ length: 28 }, (_, i) => dueReason(target, hit, new Date(now.getTime() + i * 86_400_000)));
  assert.equal(days.filter((d) => d === "rotation").length, 1, "once in 28 days");
});

/** A fake web: URL → response. */
function fakeWeb(routes: Record<string, { status?: number; body?: Uint8Array | string; headers?: Record<string, string> }>, seen: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    const body = typeof route.body === "string" ? new TextEncoder().encode(route.body) : route.body;
    return new Response(body ? new Uint8Array(body) : null, { status: route.status ?? 200, headers: route.headers ?? {} });
  }) as typeof fetch;
}

const HEAD = "c".repeat(40);
const RAW = `https://raw.githubusercontent.com/ex/tool/${HEAD}`;

async function githubWorld(files: Record<string, Uint8Array | string>, readme?: string): Promise<{ routes: Parameters<typeof fakeWeb>[0]; target: DiscoveryTarget }> {
  const all = { ...files, ...(readme === undefined ? {} : { "README.md": readme }) };
  const tree = Object.entries(all).map(([path, body]) => ({ path, type: "blob", sha: gitBlobId(typeof body === "string" ? new TextEncoder().encode(body) : body) }));
  const routes: Parameters<typeof fakeWeb>[0] = { [`https://api.github.com/repos/ex/tool/git/trees/${HEAD}?recursive=1`]: { body: JSON.stringify({ tree, truncated: false }) } };
  for (const [path, body] of Object.entries(all)) routes[`${RAW}/${path}`] = { body };
  return { routes, target: { app: "ex-tool", name: "Tool", github: { slug: "ex/tool", head: HEAD, owner: { login: "ex", organization: false, avatarUrl: null } }, gitlab: null, codeberg: null, website: null, play: null } };
}

/** Every test host resolves to one public address, so no test reaches the real DNS. */
const publicDns = async (): Promise<string[]> => ["93.184.215.14"];
const net = (fetchImpl: typeof fetch, budgets = { githubApi: 10, web: 50 }, resolveHost: (host: string) => Promise<string[]> = publicDns): Net => new Net({ fetchImpl, githubToken: () => null, budgets, log: () => {}, resolveHost, retryDelayMs: 0 });

test("repository: fastlane first, then the launcher icon of the module whose manifest launches, highest density, round last", async () => {
  const png = await icon(192);
  const manifest = `<manifest><application android:icon="@mipmap/ic_app"><activity><intent-filter><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`;
  const { routes, target } = await githubWorld({
    "fastlane/metadata/android/de-DE/images/icon.png": png,
    "fastlane/metadata/android/en-US/images/icon.png": png,
    "lib/src/main/AndroidManifest.xml": `<manifest><application android:icon="@mipmap/ic_launcher"/></manifest>`,
    "lib/src/main/res/mipmap-xxxhdpi/ic_launcher.png": png,
    "manager/src/main/AndroidManifest.xml": manifest,
    "manager/src/main/res/mipmap-hdpi/ic_app.png": png,
    "manager/src/main/res/mipmap-xxxhdpi/ic_app_round.png": png,
    "manager/src/main/res/mipmap-xxhdpi/ic_app.webp": png,
    "manager/src/main/res/mipmap-anydpi-v26/ic_app.xml": "<adaptive-icon/>",
    "manager/src/foss/res/mipmap-xxxhdpi/ic_app.png": png,
    "../escape/src/main/res/mipmap-xxxhdpi/ic_app.png": png,
  });
  const candidates = await discover(target, net(fakeWeb(routes)));
  assert.deepEqual(
    candidates.map((c) => [c.rule, c.url.replace(`${RAW}/`, "")]),
    [
      ["repo-fastlane", "fastlane/metadata/android/en-US/images/icon.png"],
      ["repo-fastlane", "fastlane/metadata/android/de-DE/images/icon.png"],
      ["repo-launcher", "manager/src/main/res/mipmap-xxhdpi/ic_app.webp"],
      ["repo-launcher", "manager/src/main/res/mipmap-hdpi/ic_app.png"],
    ],
  );
  assert.ok(candidates.every((c) => c.expect?.kind === "git-blob" && c.revision === HEAD));
});

test("README: the image marked as the logo, never a badge, a store button, a screenshot or a file outside the repository", async () => {
  const png = await icon(256);
  const readme = [
    `[![Build](https://img.shields.io/badge/logo-icon-green)](x)`,
    `<a href="https://f-droid.org/packages/org.ex"><img src="https://fdroid.gitlab.io/artwork/badge/get-it-on.png" alt="Get it on F-Droid"></a>`,
    `![Screenshot logo](docs/screenshot.png)`,
    `![](../../outside/logo.png)`,
    `<img src="assets/logo.png" alt="Tool" width="128">`,
  ].join("\n");
  const { routes, target } = await githubWorld({ "assets/logo.png": png, "docs/screenshot.png": png }, readme);
  const candidates = await discover(target, net(fakeWeb(routes)));
  assert.deepEqual(candidates.map((c) => [c.rule, c.url]), [["readme-logo", `${RAW}/assets/logo.png`]]);
});

test("website and store: the manifest's and touch icons; shared hosts give nothing; refused URLs are never requested", async () => {
  const page = `<html><head><link rel="manifest" href="/site.webmanifest"><link rel="apple-touch-icon" href="/apple.png"><link rel="icon" sizes="16x16" href="/tiny.png"><link rel="icon" href="http://10.0.0.1/evil.png" sizes="512x512"></head></html>`;
  const manifest = JSON.stringify({ icons: [{ src: "/m-192.png", sizes: "192x192" }, { src: "/m-512.png", sizes: "512x512", purpose: "maskable" }, { src: "https://169.254.169.254/x.png", sizes: "512x512" }] });
  const seen: string[] = [];
  const web = fakeWeb(
    {
      "https://tool.example.org/": { body: page, headers: { "content-type": "text/html" } },
      "https://tool.example.org/site.webmanifest": { body: manifest },
      "https://play.google.com/store/apps/details?id=org.ex.tool&hl=en&gl=US": { body: `<img src="https://play-lh.googleusercontent.com/AbCdEfGhIjKlMnOpQrStUvWxYz0123=w240-h480-rw" alt="Icon image">` },
    },
    seen,
  );
  const candidates = await discover({ app: "x", name: "Tool", github: null, gitlab: null, codeberg: null, website: "https://tool.example.org/", play: "org.ex.tool" }, net(web));
  assert.deepEqual(candidates.map((c) => [c.rule, c.url]), [
    ["site-icon", "https://tool.example.org/m-192.png"],
    ["site-icon", "https://tool.example.org/m-512.png"],
    ["site-icon", "https://tool.example.org/apple.png"],
    ["store-listing", "https://play-lh.googleusercontent.com/AbCdEfGhIjKlMnOpQrStUvWxYz0123=s512"],
  ]);
  assert.ok(!seen.some((url) => /10\.0\.0\.1|169\.254/.test(url)));
  const forum = await discover({ app: "x", name: "Tool", github: null, gitlab: null, codeberg: null, website: "https://xdaforums.com/t/tool.123/", play: null }, net(fakeWeb({})));
  assert.deepEqual(forum, []);
});

test("an organization avatar only when the organization is named after the app; never a person's", async () => {
  const { routes, target } = await githubWorld({ "src/main.c": "int main;" });
  const org = { ...target, github: { ...target.github!, owner: { login: "TOOL", organization: true, avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" } } };
  assert.deepEqual((await discover(org, net(fakeWeb(routes)))).map((c) => c.rule), ["forge-avatar"]);
  const person = { ...target, github: { ...target.github!, owner: { login: "tool", organization: false, avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4" } } };
  assert.deepEqual(await discover(person, net(fakeWeb(routes))), []);
  const otherOrg = { ...target, github: { ...target.github!, owner: { login: "acme", organization: true, avatarUrl: "https://avatars.githubusercontent.com/u/3?v=4" } } };
  assert.deepEqual(await discover(otherOrg, net(fakeWeb(routes))), []);
});

test("redirects are followed only to URLs that may be fetched", async () => {
  const web = fakeWeb({ "https://tool.example.org/": { status: 302, headers: { location: "http://127.0.0.1/admin" } } });
  await assert.rejects(net(web).get("https://tool.example.org/", 1000), /refused URL/);
});

async function iconWorld(options: { packages?: Record<string, FakePackage>; routes?: Parameters<typeof fakeWeb>[0]; policy?: IconPolicyFile; offline?: boolean; previous?: { records: IconRecord[]; dataDir: string | null }; cacheDir?: string; website?: string }) {
  const packages = options.packages ?? {};
  const names = Object.keys(packages).length ? Object.keys(packages) : ["org.ex.site"];
  const entries = names.map((pkg) => entry({ name: pkg, url: options.website ?? `https://github.com/ex/${pkg}`, channels: packages[pkg] ? [{ type: "fdroid", pkg, variant: null }] : [] }));
  const index = fakeIndex("fdroid", packages);
  const identity = identify({ entries, categories: SOURCE_CATEGORIES, fdroid: index, izzy: fakeIndex("izzy", {}), github: fakeGithub(), previous: null, overrides: NO_OVERRIDES });
  const cacheDir = options.cacheDir ?? mkdtempSync(join(tmpdir(), "icons-"));
  const seen: string[] = [];
  const inputs = identity.apps.map((app) => ({
    app,
    index: identity.iconSources.get(app.id) ?? [],
    target: { app: app.id, name: app.name, github: null, gitlab: null, codeberg: null, website: options.website ?? null, play: null },
    project: app.id,
  }));
  const result = await buildIcons(inputs, {
    cacheDir,
    offline: options.offline ?? false,
    enabled: true,
    policy: options.policy ?? NO_POLICY,
    log: () => {},
    fetchImpl: fakeWeb(options.routes ?? {}, seen),
    resolveHost: publicDns,
    now: () => new Date("2026-11-12T05:00:00Z"),
    previous: options.previous ?? null,
  });
  return { result, cacheDir, seen, apps: identity.apps as App[] };
}

test("index icons: the bytes must match the index's SHA-256; F-Droid's record names the rule, revision and project license", async () => {
  const png = await icon(512);
  const good = { icon: { name: "/org.ex.good/en-US/icon.png", sha256: sha256(png) }, license: "Apache-2.0", author: "Ex Dev", sourceCode: "https://github.com/ex/good" };
  const bad = { icon: { name: "/org.ex.bad/en-US/icon.png", sha256: "f".repeat(64) } };
  const { result, cacheDir } = await iconWorld({
    packages: { "org.ex.good": good, "org.ex.bad": bad },
    routes: { "https://f-droid.org/repo/org.ex.good/en-US/icon.png": { body: png }, "https://f-droid.org/repo/org.ex.bad/en-US/icon.png": { body: png } },
  });
  assert.deepEqual([...result.paths.keys()], ["org.ex.good"]);
  const record = result.records[0];
  assert.ok(record);
  assert.notEqual(record.file, record.fileLarge);
  assert.match(record.file, /^icons\/[0-9a-f]{16}\.webp$/);
  assert.deepEqual({ ...record, file: "", fileLarge: "" }, {
    file: "",
    fileLarge: "",
    app: "org.ex.good",
    name: "org.ex.good",
    rule: "fdroid-index",
    original: { url: "https://f-droid.org/repo/org.ex.good/en-US/icon.png", sha256: sha256(png) },
    revision: "2023-11-14T22:13:20.000Z",
    retrieved: "2026-11-12",
    author: "Ex Dev",
    license: "Apache-2.0",
    project: "https://github.com/ex/org.ex.good",
    changes: "resized to 192 and 384 px WebP; metadata removed",
  });
  assert.match(result.report.rejected[0]?.reason ?? "", /SHA-256/);
  assert.match(result.report.missing.find((m) => m.app === "org.ex.bad")?.reason ?? "", /SHA-256/);
  rmSync(cacheDir, { recursive: true });
});

test("a denied app gets no icon and nothing is downloaded for it", async () => {
  const png = await icon(256);
  const { result, seen, cacheDir } = await iconWorld({
    packages: { "org.ex.gone": { icon: { name: "/org.ex.gone/icon.png", sha256: sha256(png) } } },
    routes: { "https://f-droid.org/repo/org.ex.gone/icon.png": { body: png } },
    policy: { deny: [{ package: "org.ex.gone", reason: "removal request", date: "2026-11-12" }], denySources: [], sources: [] },
  });
  assert.equal(result.paths.size, 0);
  assert.deepEqual(seen, []);
  assert.equal(result.report.missing[0]?.reason, "denied: removal request");
  rmSync(cacheDir, { recursive: true });
});

test("a discovered site icon is used when no index has one, and the lookup is cached", async () => {
  const png = await icon(180);
  const routes = {
    "https://tool.example.org/": { body: `<link rel="apple-touch-icon" href="/apple.png">`, headers: { "content-type": "text/html" } },
    "https://tool.example.org/apple.png": { body: png },
  };
  const first = await iconWorld({ routes, website: "https://tool.example.org/" });
  assert.equal(first.result.records[0]?.rule, "site-icon");
  assert.equal(first.result.records[0]?.license, "not stated");
  assert.equal(first.result.report.discovery.looked, 1);
  const again = await iconWorld({ routes: {}, website: "https://tool.example.org/", cacheDir: first.cacheDir, offline: true });
  assert.equal(again.result.records[0]?.file, first.result.records[0]?.file, "offline, from the cached lookup and original");
  assert.equal(again.result.report.discovery.due, 0);
  rmSync(first.cacheDir, { recursive: true });
});

test("the previous build's icon is kept when this run cannot download, and dropped when a gate refuses its original", async () => {
  const png = await icon(256);
  const dataDir = mkdtempSync(join(tmpdir(), "prev-"));
  mkdirSync(join(dataDir, "icons"));
  const pkg = "org.ex.kept";
  const url = `https://f-droid.org/repo/${pkg}/icon.png`;
  const webp = await sharp(png).resize(192, 192).webp().toBuffer();
  const file = `icons/${sha256(webp).slice(0, 16)}.webp`;
  writeFileSync(join(dataDir, file), webp);
  const record: IconRecord = { file, fileLarge: file, app: pkg, name: pkg, rule: "fdroid-index", original: { url, sha256: sha256(png) }, revision: null, retrieved: "2026-11-01", author: "x", license: "MIT", project: null, changes: "resized" };
  const packages = { [pkg]: { icon: { name: `/${pkg}/icon.png`, sha256: sha256(png) } } };
  const down = await iconWorld({ packages, routes: { [url]: { status: 503 } }, previous: { records: [record], dataDir } });
  assert.equal(down.result.paths.get(pkg), file);
  assert.deepEqual(down.result.report.kept, [{ app: pkg, rule: "fdroid-index" }]);
  const tiny = await icon(8);
  const refused = await iconWorld({ packages: { [pkg]: { icon: { name: `/${pkg}/icon.png`, sha256: "e".repeat(64) } } }, routes: { [url]: { body: tiny } }, previous: { records: [record], dataDir } });
  assert.equal(refused.result.paths.size, 0, "the original failed its integrity check in this run");
  const denied = await iconWorld({ packages, routes: { [url]: { status: 503 } }, previous: { records: [record], dataDir }, policy: { deny: [{ app: pkg, reason: "removal request", date: "2026-11-12" }], denySources: [], sources: [] } });
  assert.equal(denied.result.paths.size, 0, "a deny entry removes it");
  for (const dir of [dataDir, down.cacheDir, refused.cacheDir, denied.cacheDir]) rmSync(dir, { recursive: true });
});

test("a spent budget leaves lookups for a later run without failing the build", async () => {
  const entries = ["a", "b", "c"].map((name) => entry({ name, url: `https://${name}.example.org/` }));
  const identity = identify({ entries, categories: SOURCE_CATEGORIES, fdroid: fakeIndex("fdroid", {}), izzy: fakeIndex("izzy", {}), github: fakeGithub(), previous: null, overrides: NO_OVERRIDES });
  const cacheDir = mkdtempSync(join(tmpdir(), "icons-"));
  const inputs = identity.apps.map((app) => ({ app, index: [], target: { app: app.id, name: app.name, github: null, gitlab: null, codeberg: null, website: app.listings[0]?.url ?? null, play: null }, project: app.id }));
  const result = await buildIcons(inputs, { cacheDir, offline: false, enabled: true, policy: NO_POLICY, log: () => {}, fetchImpl: fakeWeb({}), resolveHost: publicDns, budgets: { githubApi: 0, web: 1 }, now: () => new Date("2026-11-12T05:00:00Z") });
  assert.equal(result.report.discovery.looked + result.report.discovery.deferred, 3);
  assert.ok(result.report.discovery.deferred >= 2);
  assert.equal(result.report.missing.length, 3);
  rmSync(cacheDir, { recursive: true });
});

test("templates: one image shared by three projects is refused for all; forks and two projects keep theirs; similar is not the same", async () => {
  const webp = async (color: string, glyph = "#fff"): Promise<Buffer> => sharp(await icon(192, color)).composite([{ input: await sharp({ create: { width: 40, height: 40, channels: 4, background: glyph } }).png().toBuffer(), left: 76, top: 76 }]).webp().toBuffer();
  const template = await webp("#3ddc84");
  const chosen = new Map([
    ["a", { list: template }],
    ["b", { list: template }],
    ["c", { list: await sharp(template).webp({ quality: 60 }).toBuffer() }],
    ["fork-1", { list: await webp("#123456") }],
    ["fork-2", { list: await webp("#123456") }],
    ["fork-3", { list: await webp("#123456") }],
    ["pair-1", { list: await webp("#aa0000") }],
    ["pair-2", { list: await webp("#aa0000") }],
    ["near-1", { list: await webp("#0a7d3e", "#fff") }],
    ["near-2", { list: await webp("#0a7d3e", "#000") }],
    ["near-3", { list: await webp("#0a7d3e", "#f00") }],
  ]);
  const project = (id: string): string => (id.startsWith("fork-") ? "upstream/app" : id);
  const found = await templateApps(chosen, project);
  assert.deepEqual([...found].sort(), [["a", 3], ["b", 3], ["c", 3]]);
});

test("forge instances are shared sites, by host name or by what the page says it is", () => {
  for (const url of ["https://gitlab.e.foundation/e/os/blisslauncher", "https://git.eden-emu.dev/eden", "https://codeberg.org/x/y", "https://www.reddit.com/r/x"]) assert.equal(sharedSite(new URL(url)), true, url);
  for (const url of ["https://tool.example.org/", "https://someone.github.io/tool/", "https://kodi.tv/"]) assert.equal(sharedSite(new URL(url)), false, url);
  assert.equal(forgePage(`<head><meta property="og:site_name" content="GitLab"></head>`), true);
  assert.equal(forgePage(`<head><meta content="Forgejo: Beyond coding. We forge." name="application-name"></head>`), true);
  assert.equal(forgePage(`<head><meta property="og:site_name" content="Tool, a gitlab-free app"></head>`), true);
  assert.equal(forgePage(`<head><meta property="og:site_name" content="Tool"><meta name="description" content="Mirror on GitHub"></head>`), false);
});

test("launcher bitmaps: nodpi ranks with the densest, a directory without a density qualifier below every density", () => {
  const tree = (paths: string[]) => paths.map((path) => ({ path, sha: "0".repeat(40) }));
  assert.deepEqual(
    launcherIcons(tree(["app/src/main/res/mipmap/ic_launcher.png", "app/src/main/res/mipmap-mdpi/ic_launcher.png", "app/src/main/res/drawable-nodpi/ic_launcher.png"]), "app", null).map((e) => e.path),
    ["app/src/main/res/drawable-nodpi/ic_launcher.png", "app/src/main/res/mipmap-mdpi/ic_launcher.png", "app/src/main/res/mipmap/ic_launcher.png"],
  );
  assert.deepEqual(launcherIcons(tree(["app/src/main/res/drawable/logo.png"]), "app", { name: "logo" }).map((e) => e.path), ["app/src/main/res/drawable/logo.png"]);
  assert.deepEqual(launcherIcons(tree(["app/src/main/res/drawable-night/ic_launcher.png", "app/src/main/res/mipmapx/ic_launcher.png"]), "app", null), []);
});

test("a repository GitHub knows under a new name is looked up under that name", () => {
  const moved = fakeRepo("New/app", { head: "a".repeat(40), owner: { login: "New", organization: false, avatarUrl: null } });
  const identity = identify({
    entries: [entry({ name: "App", url: "https://github.com/old/app" })],
    categories: SOURCE_CATEGORIES,
    fdroid: fakeIndex("fdroid", {}),
    izzy: fakeIndex("izzy", {}),
    github: fakeGithub({ "old/app": moved }),
    previous: null,
    overrides: NO_OVERRIDES,
  });
  const [app] = identity.apps;
  assert.ok(app);
  assert.equal(app.repo?.slug, "New/app");
  const target = discoveryTarget(app, identity.githubRepos.get(app.id) ?? null);
  assert.deepEqual(target.github, { slug: "New/app", head: "a".repeat(40), owner: { login: "New", organization: false, avatarUrl: null } });
});

test("website: a raster rel=icon with no declared size is tried last, an .ico never; an http website is read over https", async () => {
  assert.deepEqual(
    pageIcons(`<head><link rel="icon" href="/logo.png"><link rel="icon" href="/favicon.ico"><link rel="icon" sizes="16x16" href="/tiny.png"><link rel="apple-touch-icon" href="/apple.png"></head>`, "https://ex.example.org/", 96).icons.map((u) => u.pathname),
    ["/apple.png", "/logo.png"],
  );
  const seen: string[] = [];
  const web = fakeWeb({ "https://old.example.org/": { body: `<head><link rel="icon" href="logo.png"></head>`, headers: { "content-type": "text/html" } } }, seen);
  const candidates = await discover({ app: "x", name: "Old", github: null, gitlab: null, codeberg: null, website: "http://old.example.org/", play: null }, net(web));
  assert.deepEqual(candidates.map((c) => c.url), ["https://old.example.org/logo.png"]);
  assert.ok(seen.every((url) => url.startsWith("https://")));
});

test("caching: any lookup made under older rules is due again at once, a miss or a hit", () => {
  const target: DiscoveryTarget = { app: "ex", name: "Ex", github: null, gitlab: null, codeberg: null, website: "https://ex.example.org/", play: null };
  const now = new Date("2026-11-12T05:00:00Z");
  const miss: DiscoveryEntry = { basis: basisOf(target), checkedAt: "2026-11-11T05:00:00Z", misses: 1, candidates: [] };
  assert.equal(dueReason(target, miss, now), "rules", "written before rules were versioned");
  assert.equal(dueReason(target, { ...miss, rules: DISCOVERY_RULES - 1 }, now), "rules");
  assert.equal(dueReason(target, { ...miss, rules: DISCOVERY_RULES }, now), null);
  const hit: DiscoveryEntry = { ...miss, misses: 0, candidates: [{ rule: "site-icon", url: "https://ex.example.org/i.png", expect: null, revision: null, allowSvg: true, minPx: 96 }] };
  assert.equal(dueReason(target, { ...hit, rules: DISCOVERY_RULES - 1 }, now), "rules");
  assert.equal(dueReason(target, { ...hit, rules: DISCOVERY_RULES }, now), null);
});

test("templates: a launcher icon refused as a template takes the same resource's other densities and round variant with it", async () => {
  const square = await icon(256, "#2a6");
  const round = await icon(256, "#a26");
  const logo = await icon(256, "#26a");
  const entries = ["a", "b", "c"].map((name) => entry({ name: `Tool ${name}`, url: `https://github.com/ex${name}/tool` }));
  const identity = identify({ entries, categories: SOURCE_CATEGORIES, fdroid: fakeIndex("fdroid", {}), izzy: fakeIndex("izzy", {}), github: fakeGithub(), previous: null, overrides: NO_OVERRIDES });
  const cacheDir = mkdtempSync(join(tmpdir(), "icons-"));
  const routes: Parameters<typeof fakeWeb>[0] = {};
  const launcher = (url: string): DiscoveryEntry["candidates"][number] => ({ rule: "repo-launcher", url, expect: null, revision: HEAD, allowSvg: false, minPx: 96 });
  const inputs = identity.apps.map((app) => ({ app, index: [], target: { app: app.id, name: app.name, github: null, gitlab: null, codeberg: null, website: `https://${app.id}.example.org/`, play: null }, project: app.id }));
  const entriesById: Record<string, DiscoveryEntry> = {};
  for (const [i, input] of inputs.entries()) {
    const base = `https://raw.example.org/${input.app.id}`;
    routes[`${base}/square.png`] = { body: square };
    const candidates = [launcher(`${base}/square.png`)];
    if (i === 0) {
      routes[`${base}/round.png`] = { body: round };
      routes[`${base}/logo.png`] = { body: logo };
      candidates.push(launcher(`${base}/round.png`), { rule: "readme-logo", url: `${base}/logo.png`, expect: null, revision: HEAD, allowSvg: true, minPx: 96 });
    }
    entriesById[input.app.id] = { basis: basisOf(input.target), checkedAt: "2026-11-12T00:00:00Z", misses: 0, rules: DISCOVERY_RULES, candidates };
  }
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, "discovery.json"), JSON.stringify({ version: 3, entries: entriesById }));
  const result = await buildIcons(inputs, { cacheDir, offline: false, enabled: true, policy: NO_POLICY, log: () => {}, fetchImpl: fakeWeb(routes), resolveHost: publicDns, now: () => new Date("2026-11-12T05:00:00Z") });
  const first = inputs[0]?.app.id ?? "";
  assert.deepEqual(result.records.map((r) => [r.app, r.rule]), [[first, "readme-logo"]], "the round variant is never tried; the README logo is next");
  assert.equal(result.report.rejected.filter((r) => r.url.endsWith("round.png")).length, 0);
  rmSync(cacheDir, { recursive: true });
});

test("internal addresses: a public name that resolves to one is refused, on the first request and on every redirect hop", async () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "not an address"]) {
    assert.equal(privateAddress(address), true, address);
  }
  for (const address of ["93.184.215.14", "140.82.112.3", "2606:4700::6810:84e5", "172.32.0.1", "100.128.0.1"]) assert.equal(privateAddress(address), false, address);
  assert.equal(fetchableUrl("https://localhost./x.png"), null, "a trailing dot does not hide a local name");

  const resolver = async (host: string): Promise<string[]> => (host === "inside.example.org" ? ["93.184.215.14", "10.0.0.7"] : ["93.184.215.14"]);
  const seen: string[] = [];
  const web = fakeWeb({ "https://out.example.org/a.png": { status: 302, headers: { location: "https://inside.example.org/b.png" } }, "https://inside.example.org/b.png": { body: "x" } }, seen);
  await assert.rejects(net(web, undefined, resolver).get("https://inside.example.org/b.png", 1000), /internal address \(10\.0\.0\.7\)/);
  await assert.rejects(net(web, undefined, resolver).get("https://out.example.org/a.png", 1000), /internal address/);
  assert.deepEqual(seen, ["https://out.example.org/a.png"], "the internal host is never requested");
});

test("a 429 is waited out once; a second one stops asking that host for the rest of the run", async () => {
  let calls = 0;
  const flaky = (async () => (++calls === 1 ? new Response("", { status: 429, headers: { "retry-after": "0" } }) : new Response("ok", { status: 200 }))) as typeof fetch;
  const once = net(flaky);
  assert.equal(new TextDecoder().decode((await once.get("https://forge.example.org/a", 100))?.bytes), "ok");
  assert.equal(calls, 2);
  const always = (async () => new Response("", { status: 429 })) as typeof fetch;
  const limited = net(always);
  await assert.rejects(limited.get("https://forge.example.org/a", 100), RateLimited);
  assert.deepEqual([...limited.limited], ["forge.example.org"]);
  await assert.rejects(limited.get("https://forge.example.org/b", 100), /rate-limited earlier/);
  assert.equal(retryAfterMs("12", 5000), 12_000);
  assert.equal(retryAfterMs("3600", 5000), 5000, "a long wait is not taken; the lookup is left for a later run");
  assert.equal(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT", 5000), 5000);
});

test("reviewed sources: used with the reviewed bytes, refused once the file changes, and malformed entries rejected", async () => {
  const png = await icon(256);
  const url = "https://git.example.net/tool/plain/res/icon.png";
  const reviewed = (sha: string): IconPolicyFile => ({ deny: [], denySources: [], sources: [{ app: "github-ex-org-ex-site", rule: "repo-launcher", url, sha256: sha, revision: "b".repeat(40), reason: "launcher icon in the project's cgit repository", date: "2026-11-13" }] });
  const good = await iconWorld({ routes: { [url]: { body: png } }, policy: reviewed(sha256(png)) });
  assert.deepEqual(good.result.records.map((r) => [r.rule, r.original.url, r.revision]), [["repo-launcher", url, "b".repeat(40)]]);
  const changed = await iconWorld({ routes: { [url]: { body: await icon(256, "#a26") } }, policy: reviewed(sha256(png)) });
  assert.deepEqual(changed.result.records, []);
  assert.match(changed.result.report.rejected[0]?.reason ?? "", /do not match/);
  const dir = mkdtempSync(join(tmpdir(), "policy-"));
  const path = join(dir, "icon-policy.json");
  const base = { app: "x", rule: "site-icon", url: "https://ex.example.org/i.png", sha256: "a".repeat(64), reason: "site icon", date: "2026-11-13" };
  for (const bad of [{ ...base, rule: "fdroid-index" }, { ...base, url: "http://ex.example.org/i.png" }, { ...base, sha256: "nope" }, { ...base, rule: "repo-launcher" }, { ...base, reason: " " }]) {
    writeFileSync(path, JSON.stringify({ deny: [], denySources: [], sources: [bad] }));
    assert.throws(() => readIconPolicy(path), /sources\[0\]/, JSON.stringify(bad));
  }
  writeFileSync(path, JSON.stringify({ deny: [], denySources: [], sources: [base] }));
  assert.equal(readIconPolicy(path).sources.length, 1);
  rmSync(dir, { recursive: true });
  for (const world of [good, changed]) rmSync(world.cacheDir, { recursive: true });
});

test("store metadata belongs to the app only at the root or above its launchable module, never in another project kept in the repository", async () => {
  assert.equal(ownsModule("fastlane/metadata/android/en-US/images/icon.png", /fastlane\/metadata\//i, "app"), true);
  assert.equal(ownsModule("android/fastlane/metadata/android/en-US/images/icon.png", /fastlane\/metadata\//i, "android/app"), true);
  assert.equal(ownsModule("Vendored/fastlane/metadata/android/en-US/images/icon.png", /fastlane\/metadata\//i, "app"), false);
  assert.equal(ownsModule("Vendored/metadata/en-US/images/icon.png", /metadata\//i, "Vendored2/app"), false);
  const png = await icon(192);
  const manifest = `<manifest><application android:icon="@mipmap/ic_launcher"><activity><intent-filter><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>`;
  const { routes, target } = await githubWorld({
    "Vendored/fastlane/metadata/android/en-US/images/icon.png": png,
    "Vendored/app/src/main/AndroidManifest.xml": "<manifest><application/></manifest>",
    "app/src/main/AndroidManifest.xml": manifest,
    "app/src/main/res/mipmap-xxxhdpi/ic_launcher.png": png,
  });
  const candidates = await discover(target, net(fakeWeb(routes)));
  assert.deepEqual(candidates.map((c) => [c.rule, c.url.replace(`${RAW}/`, "")]), [["repo-launcher", "app/src/main/res/mipmap-xxxhdpi/ic_launcher.png"]]);
});

test("an image another project shows is set aside when the app has its own among its candidates, and kept when it has nothing else", async () => {
  const shared = await icon(256, "#c22");
  const own = await icon(256, "#2c2");
  const entries = ["a", "b"].map((name) => entry({ name: `Tool ${name}`, url: `https://github.com/ex${name}/tool` }));
  const identity = identify({ entries, categories: SOURCE_CATEGORIES, fdroid: fakeIndex("fdroid", {}), izzy: fakeIndex("izzy", {}), github: fakeGithub(), previous: null, overrides: NO_OVERRIDES });
  const cacheDir = mkdtempSync(join(tmpdir(), "icons-"));
  const routes: Parameters<typeof fakeWeb>[0] = {};
  const candidate = (rule: "repo-metadata" | "repo-launcher", url: string): DiscoveryEntry["candidates"][number] => ({ rule, url, expect: null, revision: HEAD, allowSvg: false, minPx: 96 });
  const inputs = identity.apps.map((app) => ({ app, index: [], target: { app: app.id, name: app.name, github: null, gitlab: null, codeberg: null, website: `https://${app.id}.example.org/`, play: null }, project: app.id }));
  const entriesById: Record<string, DiscoveryEntry> = {};
  for (const [i, input] of inputs.entries()) {
    const base = `https://raw.example.org/${input.app.id}`;
    routes[`${base}/metadata.png`] = { body: shared };
    const candidates = [candidate("repo-metadata", `${base}/metadata.png`)];
    if (i === 0) {
      routes[`${base}/launcher.png`] = { body: own };
      candidates.push(candidate("repo-launcher", `${base}/launcher.png`));
    }
    entriesById[input.app.id] = { basis: basisOf(input.target), checkedAt: "2026-11-12T00:00:00Z", misses: 0, rules: DISCOVERY_RULES, candidates };
  }
  writeFileSync(join(cacheDir, "discovery.json"), JSON.stringify({ version: 3, entries: entriesById }));
  const result = await buildIcons(inputs, { cacheDir, offline: false, enabled: true, policy: NO_POLICY, log: () => {}, fetchImpl: fakeWeb(routes), resolveHost: publicDns, now: () => new Date("2026-11-12T05:00:00Z") });
  const [first, second] = inputs.map((input) => input.app.id);
  assert.deepEqual(result.records.map((r) => [r.app, r.rule]).sort(), [[first, "repo-launcher"], [second, "repo-metadata"]].sort());
  assert.ok(result.report.rejected.some((r) => r.app === first && /another project/.test(r.reason)));
  rmSync(cacheDir, { recursive: true });
});
