/** Download figures: what each source publishes, read and summed as the schema states. */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { combineFdroidWeeks, fdroidApkPackage, fdroidDownloads, figuresAgeDays, githubFigure, izzyDownloads, izzyWindow, readFdroidWeek, readIzzyMonth, STALE_FIGURES_DAYS } from "../enrich/downloads.ts";

test("F-Droid paths: APKs in the repository and its archive only", () => {
  assert.equal(fdroidApkPackage("/repo/org.ex.app_1024.apk"), "org.ex.app");
  assert.equal(fdroidApkPackage("/archive/org.ex.app_7.apk"), "org.ex.app");
  for (const path of ["/repo/org.ex.app_1024.apk.asc", "/repo/org.ex.app_1024_src.tar.gz", "/F-Droid.apk", "/repo/index-v2.json", "/repo/../org.ex.app_1.apk", "/repo/1bad.pkg_3.apk"]) {
    assert.equal(fdroidApkPackage(path), null, path);
  }
});

const week = (start: string, first: string, last: string, paths: Record<string, number>) =>
  readFdroidWeek(start, { weekStartDate: `${start}T00:00:00+00:00`, firstProcessedDate: first, lastProcessedDate: last, hits: 1, paths: Object.fromEntries(Object.entries(paths).map(([p, hits]) => [p, { hits }])) });

test("F-Droid weeks: hits per package, partial weeks left out, only weeks every server covers", () => {
  const full = week("2026-08-10", "2026-08-10T00:00:40+00:00", "2026-08-16T23:59:59+00:00", { "/repo/org.ex.a_1.apk": 300, "/repo/org.ex.a_2.apk": 150, "/repo/org.ex.b_9.apk": 120, "/F-Droid.apk": 9000 });
  assert.ok(full);
  assert.equal(full.complete, true);
  assert.deepEqual([...full.hits], [["org.ex.a", 450], ["org.ex.b", 120]]);
  const partial = week("2026-08-24", "2026-08-24T00:00:00+00:00", "2026-08-24T00:00:37+00:00", { "/repo/org.ex.a_2.apk": 100 });
  assert.equal(partial?.complete, false);
  assert.equal(readFdroidWeek("x", { paths: {} }), null);
  const other = week("2026-08-10", "2026-08-10T00:00:00+00:00", "2026-08-16T23:00:00+00:00", { "/repo/org.ex.a_2.apk": 50 });
  const earlier = week("2026-08-03", "2026-08-03T00:00:00+00:00", "2026-08-09T23:00:00+00:00", { "/repo/org.ex.a_2.apk": 1000 });
  const combined = combineFdroidWeeks(new Map([["s1", [earlier!, full, partial!]], ["s2", [other!]]]));
  assert.deepEqual(combined?.weeks, ["2026-08-10"], "the week only s1 covers is left out");
  assert.deepEqual(combined?.period, { from: "2026-08-10", to: "2026-08-16" });
  assert.equal(combined?.hits.get("org.ex.a"), 500);
});

test("IzzyOnDroid: the last 30 days published, summed; too few days give nothing; hostile package keys dropped", () => {
  const byDay = new Map<string, Map<string, number>>();
  const days: Record<string, Record<string, number>> = {};
  for (let d = 0; d < 40; d++) {
    const date = new Date(Date.UTC(2026, 9, 1) + d * 86_400_000).toISOString().slice(0, 10);
    days[date] = { "org.ex.a": 2, "evil\"key": 5, "org.ex.b": d === 39 ? 7 : 0 };
  }
  readIzzyMonth(days, byDay);
  const window = izzyWindow(byDay);
  assert.deepEqual(window?.period, { from: "2026-10-11", to: "2026-11-09" });
  assert.equal(window?.counts.get("org.ex.a"), 60);
  assert.equal(window?.counts.get("org.ex.b"), 7);
  assert.equal(window?.counts.has("evil\"key"), false);
  const sparse = new Map([...byDay].filter(([date]) => date.endsWith("1")));
  assert.equal(izzyWindow(sparse), null);
});

test("GitHub: the latest release's APK downloads from its publication to the fetch; none without downloads", () => {
  assert.deepEqual(githubFigure({ publishedAt: "2026-10-03T10:00:00Z", apkDownloads: 1234 }, "2026-11-12T05:00:00Z"), { origin: "github", count: 1234, from: "2026-10-03", to: "2026-11-12" });
  assert.equal(githubFigure({ publishedAt: "2026-10-03T10:00:00Z", apkDownloads: 0 }, "2026-11-12T05:00:00Z"), null);
  assert.equal(githubFigure(null, "2026-11-12T05:00:00Z"), null);
  assert.equal(githubFigure({ publishedAt: "", apkDownloads: 5 }, "2026-11-12T05:00:00Z"), null);
});

test("an unreachable source gives no figures and does not throw; offline reads only the cache", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "downloads-"));
  const failing = (async () => new Response("down", { status: 503 })) as typeof fetch;
  const options = { cacheDir, offline: false, now: () => new Date("2026-11-12T05:00:00Z"), fetchImpl: failing, log: () => {} };
  assert.equal(await fdroidDownloads(options), null);
  assert.equal(await izzyDownloads(options), null);
  assert.equal(await izzyDownloads({ ...options, offline: true }), null);
  rmSync(cacheDir, { recursive: true });
});

test("F-Droid: a week cached while partial is fetched again once a newer week is published, and the newest day is the source's", async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "fdroid-metrics-"));
  const weekFile = (start: string, days: number, hits: number): string =>
    JSON.stringify({ firstProcessedDate: `${start}T00:00:00+00:00`, lastProcessedDate: new Date(Date.parse(`${start}T00:00:00Z`) + days * 86_400_000 - 1000).toISOString(), paths: { "/repo/org.ex.a_1.apk": { hits } } });
  const published: Record<string, string> = { "2026-08-03.json": weekFile("2026-08-03", 7, 10), "2026-08-10.json": weekFile("2026-08-10", 7, 10), "2026-08-17.json": weekFile("2026-08-17", 7, 10), "2026-08-24.json": weekFile("2026-08-24", 0.0005, 1) };
  const requested: string[] = [];
  const fetchImpl = (async (url: string) => {
    const name = String(url).split("/").pop() ?? "";
    requested.push(name);
    const body = name === "index.json" ? JSON.stringify(Object.keys(published)) : published[name];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200 });
  }) as typeof fetch;
  const run = (day: string) => fdroidDownloads({ cacheDir, offline: false, now: () => new Date(`${day}T12:00:00Z`), fetchImpl, log: () => {} });
  try {
    const first = await run("2026-08-25");
    assert.equal(first?.source.newest, "2026-08-23");
    published["2026-08-24.json"] = weekFile("2026-08-24", 7, 20);
    published["2026-08-31.json"] = weekFile("2026-08-31", 0.0005, 1);
    requested.length = 0;
    const second = await run("2026-09-01");
    assert.ok(requested.includes("2026-08-24.json"), "the formerly partial week is fetched again");
    assert.ok(!requested.includes("2026-08-10.json"), "a complete older week is read from the cache");
    assert.equal(second?.source.newest, "2026-08-30");
    assert.equal(second?.byPackage.get("org.ex.a")?.count, 4 * (10 + 10 + 10 + 20), "four weeks on each of the four servers");
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("figure age: days from the newest day counted to the build's date; none for running totals", () => {
  assert.equal(figuresAgeDays({ newest: "2026-08-23" }, "2026-11-12T03:00:00.000Z"), 81);
  assert.equal(figuresAgeDays({ newest: null }, "2026-11-12T03:00:00.000Z"), null);
  assert.ok(STALE_FIGURES_DAYS === 120);
});
