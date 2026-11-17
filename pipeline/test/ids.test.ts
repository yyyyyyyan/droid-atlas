/** Permanent ids: carried forward by any key, new ids made unique by hash, redirects for retired ids. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { App, Listing } from "../../schema/catalog.ts";
import { assignIds, baseId, keysOf, type IdCandidate } from "../ids.ts";

function listing(url: string, category = "android-foss/apps-tools"): Listing {
  return { source: "android-foss", category, kind: "app", order: 0, name: "x", url, description: null, tags: [], license: null, added: null, parent: null, extraLinks: [] };
}

function previousApp(id: string, packages: string[], repoUrl: string | null, urls: string[]): Pick<App, "id" | "packages" | "repo" | "listings" | "github"> {
  return {
    id,
    packages,
    repo: repoUrl ? { host: "github", url: repoUrl, slug: repoUrl.split("/").slice(-2).join("/") } : null,
    listings: urls.map((u) => listing(u)),
    github: null,
  };
}

function candidate(packages: string[], repoUrl: string | null, url: string, name = "x"): IdCandidate {
  const app = previousApp("", packages, repoUrl, [url]);
  const keys = keysOf(app);
  return { keys, base: baseId(packages, keys.repo, { source: "android-foss", name }), uniqueKey: `android-foss ${url} ${name}` };
}

test("an app keeps its previous id when it gains a package id", () => {
  const previous = { apps: [previousApp("github-ex-a", [], "https://github.com/ex/a", ["https://github.com/ex/a"])] as App[], redirects: {} };
  const result = assignIds([candidate(["org.ex.a"], "https://github.com/ex/a", "https://github.com/ex/a")], previous);
  assert.deepEqual(result.ids, ["github-ex-a"]);
  assert.deepEqual(result.created, []);
});

test("an app keeps its id across a repository rename when a listing URL still matches", () => {
  const previous = { apps: [previousApp("android-foss-a", [], null, ["https://a.example"])] as App[], redirects: {} };
  const result = assignIds([candidate([], "https://github.com/ex/renamed", "https://a.example")], previous);
  assert.deepEqual(result.ids, ["android-foss-a"]);
});

test("two new apps with the same base get suffixes from their own keys, independent of order", () => {
  const a = candidate([], null, "https://one.example", "Same");
  const b = candidate([], null, "https://two.example", "Same");
  const forward = assignIds([a, b], null);
  const backward = assignIds([b, a], null);
  assert.equal(forward.ids[0], backward.ids[1]);
  assert.equal(forward.ids[1], backward.ids[0]);
  assert.match(forward.ids[0] ?? "", /^android-foss-same-[0-9a-f]{6}$/);
  assert.notEqual(forward.ids[0], forward.ids[1]);
});

test("a new app whose base is a retired id gets a suffix instead of reviving it", () => {
  const previous = { apps: [] as App[], redirects: { "org.ex.a": null } };
  const result = assignIds([candidate(["org.ex.a"], null, "https://x.example")], previous);
  assert.match(result.ids[0] ?? "", /^org\.ex\.a-[0-9a-f]{6}$/);
});

test("a merge retires one id and redirects it to the survivor", () => {
  const previous = {
    apps: [previousApp("org.ex.a", ["org.ex.a"], null, ["https://a.example"]), previousApp("github-ex-a", [], "https://github.com/ex/a", ["https://github.com/ex/a"])] as App[],
    redirects: {},
  };
  const merged = candidate(["org.ex.a"], "https://github.com/ex/a", "https://a.example");
  const result = assignIds([merged], previous);
  assert.deepEqual(result.ids, ["org.ex.a"]);
  assert.deepEqual(result.redirects, { "github-ex-a": "org.ex.a" });
  assert.deepEqual(result.retired, ["github-ex-a"]);
});

test("a removed app redirects to null, and older redirects are followed to a live id or null", () => {
  const previous = {
    apps: [previousApp("org.ex.gone", ["org.ex.gone"], null, ["https://gone.example"]), previousApp("org.ex.b", ["org.ex.b"], null, ["https://b.example"])] as App[],
    redirects: { "very-old": "org.ex.gone", "old-b": "org.ex.b" },
  };
  const result = assignIds([candidate(["org.ex.b"], null, "https://b.example")], previous);
  assert.deepEqual(result.redirects, { "old-b": "org.ex.b", "org.ex.gone": null, "very-old": null });
});

test("a split keeps the id for the app matching the strongest key", () => {
  const previous = { apps: [previousApp("org.ex.a", ["org.ex.a"], "https://github.com/ex/a", ["https://a.example"])] as App[], redirects: {} };
  const byPackage = candidate(["org.ex.a"], null, "https://elsewhere.example");
  const byRepo = candidate(["org.ex.other"], "https://github.com/ex/a", "https://a2.example");
  const result = assignIds([byRepo, byPackage], previous);
  assert.equal(result.ids[1], "org.ex.a");
  assert.equal(result.ids[0], "org.ex.other");
});

test("a fork's package ids are not its keys", () => {
  const fork = { ...previousApp("github-fork-a", ["org.up.a"], "https://github.com/fork/a", []), github: { stars: 0, pushedAt: "", archived: false, movedTo: null, forkOf: "up/a", release: null } };
  assert.deepEqual(keysOf(fork).packages, []);
});
