import assert from "node:assert/strict";
import { test } from "node:test";
import { batchQuery, fetchGithub, repoFromNode, type Fetch } from "../enrich/github.ts";
import { ANTI_FEATURE_REASON_LIMIT, PERMISSION_NAMES_LIMIT, SHIZUKU_PERMISSION, SUMMARY_LIMIT } from "../enrich/index-v2.ts";
import { fakeIndex } from "./fixtures.ts";

test("an index record takes facts from the latest version and anti-features from all of them", () => {
  const index = fakeIndex("fdroid", {
    "org.example.one": {
      summary: "Does **one** thing",
      description: "<p>Long &amp; detailed</p>",
      permissions: [SHIZUKU_PERMISSION, "android.permission.INTERNET", "android.permission.INTERNET"],
      antiFeatures: ["Tracking"],
      oldAntiFeatures: ["NonFreeAssets"],
      sourceCode: "https://github.com/example/one",
      versionName: "2.0",
    },
  });
  const record = index.packages.get("org.example.one");
  assert.equal(record?.facts.version, "2.0");
  assert.equal(record?.facts.minSdk, 24);
  assert.equal(record?.facts.permissionCount, 2);
  assert.equal(record?.facts.declaresShizuku, true);
  assert.equal(record?.facts.declaresInternet, true);
  assert.deepEqual(record?.facts.antiFeatures, ["Tracking"]);
  assert.deepEqual(record?.allAntiFeatures, ["NonFreeAssets", "Tracking"]);
  assert.equal(record?.summary, "Does one thing");
  assert.equal(record?.description, "Long & detailed");
  assert.equal(record?.facts.pkg, "org.example.one");
  assert.equal(index.timestamp, "2023-11-14T22:13:20.000Z");
});

test("an index record keeps the permission names it counts, sorted and without repeats", () => {
  const index = fakeIndex("fdroid", {
    "org.example.perm": {
      permissions: ["org.example.perm.permission.C2D", "android.permission.INTERNET", "android.permission.CAMERA ", "android.permission.CAMERA"],
      permissionsSdk23: ["android.permission.READ_CONTACTS"],
    },
    "org.example.none": {},
  });
  const record = index.packages.get("org.example.perm");
  assert.deepEqual(record?.permissions, ["android.permission.CAMERA", "android.permission.INTERNET", "org.example.perm.permission.C2D"]);
  assert.equal(record?.facts.permissionCount, 3);
  assert.deepEqual(index.packages.get("org.example.none")?.permissions, []);
});

test("a permission name too long or with spaces or control characters is not shown, and the count is unchanged", () => {
  const index = fakeIndex("izzy", {
    "org.example.odd": { permissions: ["android.permission.INTERNET", "two words", "x".repeat(300), "ok.name\u0000"] },
  });
  const record = index.packages.get("org.example.odd");
  assert.deepEqual(record?.permissions, ["android.permission.INTERNET"]);
  assert.equal(record?.facts.permissionCount, 4);
});

test("an anti-feature keeps the index's English reason as plain text, bounded, and nothing when there is none", () => {
  const index = fakeIndex("izzy", {
    "org.example.flags": {
      antiFeatures: ["Ads", "NonFreeNet", "Tracking", "NonFreeDep", "TetheredNet"],
      reasons: {
        Ads: { de: "Werbung.", "en-US": "Shows **banner** ads from <i>an example network</i>." },
        NonFreeNet: { de: "Nur deutsch." },
        Tracking: {},
        NonFreeDep: { "en-US": `Uses ${"many ".repeat(200)}libraries.` },
        TetheredNet: { "en-US": "   " },
      },
    },
  });
  const reasons = index.packages.get("org.example.flags")?.facts.antiFeatureReasons ?? {};
  assert.deepEqual(Object.keys(reasons).sort(), ["Ads", "NonFreeDep"]);
  assert.equal(reasons["Ads"], "Shows banner ads from an example network.");
  assert.ok((reasons["NonFreeDep"] ?? "").length <= ANTI_FEATURE_REASON_LIMIT + 1);
  assert.match(reasons["NonFreeDep"] ?? "", /…$/);
});

test("a reason is kept only for an anti-feature the latest version flags", () => {
  const index = fakeIndex("fdroid", {
    "org.example.old": {
      antiFeatures: ["Ads"],
      reasons: { Ads: { "en-US": "Has ads." } },
      oldAntiFeatures: ["Ads", "Tracking"],
      oldReasons: { Ads: { "en-US": "Had other ads." }, Tracking: { "en-US": "Used to track." } },
    },
    "org.example.bad": { antiFeatures: ["Ads"], reasons: { Ads: "not a map" } },
  });
  assert.deepEqual(index.packages.get("org.example.old")?.facts.antiFeatureReasons, { Ads: "Has ads." });
  assert.deepEqual(index.packages.get("org.example.bad")?.facts.antiFeatureReasons, {});
});

test("English text falls back from en-US to en when en-US is not a string", () => {
  const index = fakeIndex("izzy", {
    "org.example.en": { antiFeatures: ["Ads"], reasons: { Ads: { "en-US": { text: "odd" }, en: "Shows ads." } } },
  });
  assert.deepEqual(index.packages.get("org.example.en")?.facts.antiFeatureReasons, { Ads: "Shows ads." });
});

test("a reason of invisible characters only is no reason", () => {
  const index = fakeIndex("izzy", {
    "org.example.blank": { antiFeatures: ["Ads", "Tracking"], reasons: { Ads: { "en-US": "⁠؜" }, Tracking: { "en-US": "​ ﻿" } } },
  });
  assert.deepEqual(index.packages.get("org.example.blank")?.facts.antiFeatureReasons, {});
});

test("a huge reason or summary is cut before it is read, and ends as a marked excerpt", () => {
  const huge = `**Note** ${"word ".repeat(200_000)}`;
  const started = performance.now();
  const index = fakeIndex("fdroid", { "org.example.huge": { summary: huge, antiFeatures: ["Ads"], reasons: { Ads: { "en-US": huge } } } });
  assert.ok(performance.now() - started < 2000, "a megabyte of text is read in well under two seconds");
  const record = index.packages.get("org.example.huge");
  for (const [text, limit] of [[record?.facts.antiFeatureReasons["Ads"] ?? "", ANTI_FEATURE_REASON_LIMIT], [record?.summary ?? "", SUMMARY_LIMIT]] as const) {
    assert.ok(text.length <= limit + 1, `${text.length} characters`);
    assert.match(text, /^Note word word .*…$/);
  }
});

test("an index entry keeps at most the name limit, the first names in alphabetical order, and the count stays the index's", () => {
  const names = Array.from({ length: PERMISSION_NAMES_LIMIT + 100 }, (_, i) => `org.example.permission.P${String(i).padStart(4, "0")}`);
  const index = fakeIndex("fdroid", { "org.example.many": { permissions: [...names].reverse() } });
  const record = index.packages.get("org.example.many");
  assert.equal(record?.permissions.length, PERMISSION_NAMES_LIMIT);
  assert.deepEqual(record?.permissions, names.slice(0, PERMISSION_NAMES_LIMIT));
  assert.equal(record?.facts.permissionCount, PERMISSION_NAMES_LIMIT + 100);
});

test("an index maps source-code URLs and repository keys to packages", () => {
  const index = fakeIndex("izzy", {
    "org.example.a": { sourceCode: "https://github.com/Example/Mono/" },
    "org.example.b": { sourceCode: "https://github.com/example/mono" },
  });
  assert.deepEqual([...(index.bySourceCode.get("github:example/mono") ?? [])].sort(), ["org.example.a", "org.example.b"]);
});

test("the icon follows rule 1: en-US, else the first locale, and only paths inside the repository", () => {
  const index = fakeIndex("fdroid", {
    "org.example.de": { icon: { locale: "de-DE", name: "/org.example.de/de-DE/icon.png", sha256: "b".repeat(64) } },
    "org.example.none": { icon: null },
    "org.example.bad": { icon: { name: "https://evil.example/icon.png", sha256: "c".repeat(64) } },
  });
  assert.equal(index.packages.get("org.example.de")?.iconUrl, "https://f-droid.org/repo/org.example.de/de-DE/icon.png");
  assert.equal(index.packages.get("org.example.none")?.iconUrl, null);
  assert.equal(index.packages.get("org.example.bad")?.iconUrl, null);
});

test("a malformed index is refused", async () => {
  const { parseIndex } = await import("../enrich/index-v2.ts");
  assert.throws(() => parseIndex("fdroid", "https://f-droid.org/repo", { packages: {} }));
});

test("GitHub query names are JSON-escaped and nodes are validated", () => {
  assert.match(batchQuery(["o/n"]), /r0: repository\(owner: "o", name: "n"\)/);
  assert.equal(repoFromNode({ nameWithOwner: 5 }), null);
  const repo = repoFromNode({
    nameWithOwner: "New/Name",
    stargazerCount: 3,
    pushedAt: "2026-01-01T00:00:00Z",
    isArchived: true,
    isFork: true,
    parent: { nameWithOwner: "Up/Stream" },
    latestRelease: { tagName: "v1", publishedAt: "2026-01-01T00:00:00Z", releaseAssets: { nodes: [{ name: "app-release.APK" }] } },
  });
  assert.equal(repo?.forkOf, "Up/Stream");
  assert.equal(repo?.release?.hasApk, true);
  assert.equal(repo?.archived, true);
});

function fakeFetch(responses: { status: number; body: unknown }[]): { fetch: Fetch; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (_url, init) => {
      calls.push(init.body);
      const next = responses.shift() ?? { status: 500, body: {} };
      return { ok: next.status < 300, status: next.status, json: async () => next.body };
    },
  };
}

test("fetchGithub records not-found repositories as missing and skips invalid names without asking", async () => {
  const { fetch, calls } = fakeFetch([
    {
      status: 200,
      body: {
        data: { r0: { nameWithOwner: "a/b", stargazerCount: 1 }, r1: null },
        errors: [{ type: "NOT_FOUND", path: ["r1"], message: "nope" }],
      },
    },
  ]);
  const result = await fetchGithub(["a/b", "c/d", "bad name/x"], "t", fetch, () => {});
  assert.equal(calls.length, 1);
  assert.ok(!calls[0]?.includes("bad name"));
  assert.equal((result["a/b"] as { fullName: string }).fullName, "a/b");
  assert.deepEqual(result["c/d"], { missing: true });
  assert.deepEqual(result["bad name/x"], { missing: true });
});

test("fetchGithub fails on any error other than not-found", async () => {
  const { fetch } = fakeFetch([{ status: 200, body: { data: {}, errors: [{ type: "RATE_LIMITED", message: "slow down" }] } }]);
  await assert.rejects(fetchGithub(["a/b"], "t", fetch, () => {}), /slow down/);
});
