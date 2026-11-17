import assert from "node:assert/strict";
import { test } from "node:test";
import { batchQuery, fetchGithub, repoFromNode, type Fetch } from "../enrich/github.ts";
import { SHIZUKU_PERMISSION } from "../enrich/index-v2.ts";
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
