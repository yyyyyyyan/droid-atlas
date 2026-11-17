/** Every identity rule in docs/ARCHITECTURE.md § Identity, each with its counter-example. */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { App } from "../../schema/catalog.ts";
import type { GithubResult } from "../enrich/github.ts";
import { identify, NO_OVERRIDES, type IdentityOverrides, type IdentityResult } from "../identity.ts";
import type { SourceEntry } from "../sources/types.ts";
import { SOURCE_CATEGORIES, entry, fakeGithub, fakeIndex, fakeRepo, type FakePackage } from "./fixtures.ts";

interface World {
  entries: SourceEntry[];
  fdroid?: Record<string, FakePackage>;
  izzy?: Record<string, FakePackage>;
  github?: Record<string, GithubResult>;
  overrides?: IdentityOverrides;
}

function run(world: World): IdentityResult {
  return identify({
    entries: world.entries,
    categories: SOURCE_CATEGORIES,
    fdroid: fakeIndex("fdroid", world.fdroid ?? {}),
    izzy: fakeIndex("izzy", world.izzy ?? {}),
    github: fakeGithub(world.github ?? {}),
    previous: null,
    overrides: world.overrides ?? NO_OVERRIDES,
  });
}

function appOf(result: IdentityResult, name: string): App {
  const app = result.apps.find((a) => a.listings.some((l) => l.name === name));
  assert.ok(app, `no app with a listing named ${name}`);
  return app;
}

const fdroidLink = (pkg: string) => ({ type: "fdroid" as const, pkg, variant: null });
const playLink = (pkg: string) => ({ type: "play" as const, pkg, variant: null });

test("rule 1: the same package id in two sources is one app with two listings", () => {
  const result = run({
    entries: [
      entry({ name: "Alpha", url: "https://github.com/ex/alpha", channels: [fdroidLink("org.ex.alpha")] }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "alpha", url: "https://play.google.com/store/apps/details?id=org.ex.alpha", channels: [playLink("org.ex.alpha")] }),
    ],
    fdroid: { "org.ex.alpha": {} },
  });
  assert.equal(result.apps.length, 1);
  assert.equal(result.apps[0]?.id, "org.ex.alpha");
  assert.deepEqual(result.apps[0]?.listings.map((l) => l.source), ["android-foss", "awesome-shizuku"]);
  assert.ok(result.merges.some((m) => m.identifier === "package:org.ex.alpha" && m.crossSource));
});

test("names never merge: equal names with no shared identifier stay apart and are reported", () => {
  const result = run({
    entries: [
      entry({ name: "Notes", url: "https://github.com/one/notes" }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Notes", url: "https://github.com/two/notes" }),
    ],
  });
  assert.equal(result.apps.length, 2);
  assert.equal(result.nonMerges[0]?.similarity, "equal");
});

test("rule 1: a package is verified by the index when exactly one index entry declares the repository", () => {
  const result = run({
    entries: [entry({ name: "Beta", url: "https://github.com/ex/beta" })],
    izzy: { "org.ex.beta": { sourceCode: "https://github.com/ex/beta" } },
  });
  assert.deepEqual(result.apps[0]?.packages, ["org.ex.beta"]);
  assert.equal(result.verifications[0]?.via, "index-source-code");
});

test("rule 1 counter-example: two index entries declaring the repository verify nothing", () => {
  const result = run({
    entries: [entry({ name: "Mono", url: "https://github.com/ex/mono" })],
    fdroid: { "org.ex.photos": { sourceCode: "https://github.com/ex/mono" }, "org.ex.auth": { sourceCode: "https://github.com/ex/mono" } },
  });
  assert.deepEqual(result.apps[0]?.packages, []);
});

test("rule 1 and GitHub renames: a renamed repository is matched by its current name", () => {
  const result = run({
    entries: [
      entry({ name: "Old", url: "https://github.com/ex/old-name" }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "New", url: "https://github.com/ex/new-name" }),
    ],
    github: { "ex/old-name": fakeRepo("ex/new-name"), "ex/new-name": fakeRepo("ex/new-name") },
  });
  assert.equal(result.apps.length, 1);
  assert.equal(result.apps[0]?.github?.movedTo, "ex/new-name");
  assert.equal(result.apps[0]?.repo?.url, "https://github.com/ex/new-name");
});

test("rule 2: a single-app repository merges an entry without a package into the app with one", () => {
  const result = run({
    entries: [
      entry({ name: "Gamma", url: "https://github.com/ex/gamma", channels: [fdroidLink("org.ex.gamma")] }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Gamma", url: "https://github.com/ex/gamma/blob/main/README.md" }),
    ],
    fdroid: { "org.ex.gamma": { sourceCode: "https://github.com/ex/gamma" } },
  });
  assert.equal(result.apps.length, 1);
});

test("rule 2 counter-example: a repository that ships two apps is never merged on", () => {
  const result = run({
    entries: [
      entry({ name: "Photos", url: "https://github.com/ex/mono", channels: [fdroidLink("org.ex.photos")] }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Auth", url: "https://github.com/ex/mono", channels: [playLink("org.ex.auth")] }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Ente?", url: "https://github.com/ex/mono" }),
    ],
    fdroid: { "org.ex.photos": { sourceCode: "https://github.com/ex/mono" } },
  });
  assert.equal(result.apps.length, 3);
  assert.equal(result.multiPackageRepos[0]?.repo, "github:ex/mono");
});

test("rule 3: a suffix variant merges with the bare id through the same single-app repository and becomes a channel", () => {
  const result = run({
    entries: [
      entry({ name: "Delta", url: "https://github.com/ex/delta", channels: [playLink("org.ex.delta")] }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Delta", url: "https://github.com/ex/delta", channels: [fdroidLink("org.ex.delta.fdroid")] }),
    ],
    fdroid: { "org.ex.delta.fdroid": { sourceCode: "https://github.com/ex/delta" } },
  });
  assert.equal(result.apps.length, 1);
  const app = result.apps[0];
  assert.deepEqual(app?.packages, ["org.ex.delta", "org.ex.delta.fdroid"]);
  assert.deepEqual(app?.channels.find((c) => c.pkg === "org.ex.delta.fdroid"), { type: "fdroid", pkg: "org.ex.delta.fdroid", variant: "F-Droid build", listed: true });
});

test("rule 3 counter-example: a suffix alone proves nothing", () => {
  const result = run({
    entries: [
      entry({ name: "Machi", url: "https://github.com/ex/machi", channels: [fdroidLink("com.ex.machi")] }),
      entry({ name: "Neo Store", url: "https://github.com/other/neo", channels: [fdroidLink("com.ex.machi.fdroid")] }),
    ],
  });
  assert.equal(result.apps.length, 2);
});

test("rule 4: a fork relation alone never merges; the fork is labeled", () => {
  const result = run({
    entries: [
      entry({ name: "Upstream", url: "https://github.com/up/app", channels: [fdroidLink("org.up.app")] }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Fork", url: "https://github.com/fork/app" }),
    ],
    fdroid: { "org.up.app": { sourceCode: "https://github.com/up/app" } },
    github: { "up/app": fakeRepo("up/app"), "fork/app": fakeRepo("fork/app", { forkOf: "up/app" }) },
  });
  assert.equal(result.apps.length, 2);
  const fork = appOf(result, "Fork");
  assert.equal(fork.facets.fork, true);
  assert.equal(fork.github?.forkOf, "up/app");
  assert.equal(fork.id, "github-fork-app");
  assert.equal(appOf(result, "Upstream").id, "org.up.app");
  assert.equal(result.forks[0]?.forkOf, "up/app");
});

test("rule 5: a store link is trusted from a fork of the index's repository (LibChecker)", () => {
  const result = run({
    entries: [
      entry({ name: "LibChecker", url: "https://github.com/person/libchecker", channels: [fdroidLink("com.ex.libchecker")] }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "LibChecker", url: "https://github.com/org/libchecker", channels: [playLink("com.ex.libchecker")] }),
    ],
    fdroid: { "com.ex.libchecker": { sourceCode: "https://github.com/org/libchecker" } },
    github: { "person/libchecker": fakeRepo("person/libchecker", { forkOf: "org/libchecker" }), "org/libchecker": fakeRepo("org/libchecker") },
  });
  assert.equal(result.apps.length, 1);
  assert.deepEqual(result.rejectedLinks, []);
  assert.equal(result.apps[0]?.repo?.slug, "org/libchecker");
  assert.equal(result.apps[0]?.facets.fork, false);
});

test("rule 5: a store link is trusted from the index's repository under an old name, and from its parent", () => {
  const result = run({
    entries: [
      entry({ name: "Renamed", url: "https://github.com/ex/old", channels: [fdroidLink("org.ex.renamed")] }),
      entry({ name: "Old", url: "https://github.com/ex/new" }),
      entry({ name: "Parent", url: "https://github.com/up/tool", channels: [fdroidLink("org.ex.forked")] }),
      entry({ name: "Child", url: "https://github.com/child/tool" }),
    ],
    fdroid: { "org.ex.renamed": { sourceCode: "https://github.com/ex/new" }, "org.ex.forked": { sourceCode: "https://github.com/child/tool" } },
    github: {
      "ex/old": fakeRepo("ex/new"),
      "ex/new": fakeRepo("ex/new"),
      "up/tool": fakeRepo("up/tool"),
      "child/tool": fakeRepo("child/tool", { forkOf: "up/tool" }),
    },
  });
  assert.deepEqual(result.rejectedLinks, []);
  assert.deepEqual(appOf(result, "Renamed").packages, ["org.ex.renamed"]);
  assert.deepEqual(appOf(result, "Parent").packages, ["org.ex.forked"]);
});

test("rule 6: a package no index carries is a stale channel, not an identifier (Canta)", () => {
  const result = run({
    entries: [
      entry({ name: "Canta", url: "https://github.com/sam/canta", channels: [fdroidLink("org.sam_old.canta")] }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Canta", url: "https://github.com/sam/canta", channels: [{ type: "izzy", pkg: "io.github.sam.canta", variant: null }] }),
    ],
    izzy: { "io.github.sam.canta": { sourceCode: "https://github.com/sam/canta" } },
  });
  assert.equal(result.apps.length, 1);
  const app = result.apps[0];
  assert.deepEqual(app?.packages, ["io.github.sam.canta"]);
  assert.deepEqual(app?.channels.find((c) => c.pkg === "org.sam_old.canta"), { type: "fdroid", pkg: "org.sam_old.canta", variant: null, listed: false });
  assert.equal(app?.facets.staleLink, true);
  assert.deepEqual(result.multiPackageRepos, []);
  assert.equal(result.stalePackages[0]?.pkg, "org.sam_old.canta");
});

test("rule 6 counter-example: two live packages from one repository stay apart (Ente, Tutanota)", () => {
  const result = run({
    entries: [
      entry({ name: "Tuta Mail", url: "https://github.com/tuta/tuta", channels: [fdroidLink("de.tuta.mail")] }),
      entry({ name: "Tuta Calendar", url: "https://github.com/tuta/tuta", channels: [fdroidLink("de.tuta.calendar")] }),
      entry({ name: "Ente Photos", url: "https://github.com/ente/ente", channels: [fdroidLink("io.ente.photos.fdroid")] }),
      entry({ name: "Ente Auth", url: "https://github.com/ente/ente", channels: [fdroidLink("io.ente.auth")] }),
    ],
    fdroid: {
      "de.tuta.mail": { sourceCode: "https://github.com/tuta/tuta" },
      "de.tuta.calendar": { sourceCode: "https://github.com/tuta/tuta" },
      "io.ente.photos.fdroid": { sourceCode: "https://github.com/ente/ente" },
      "io.ente.auth": { sourceCode: "https://github.com/ente/ente" },
    },
  });
  assert.equal(result.apps.length, 4);
  assert.deepEqual(result.multiPackageRepos.map((m) => m.repo), ["github:ente/ente", "github:tuta/tuta"]);
});

test("rule 8: overrides declare entries the same or different, over every rule, and are reported", () => {
  const entries = [
    entry({ name: "One", url: "https://one.example" }),
    entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Uno", url: "https://uno.example" }),
    entry({ name: "Twin A", url: "https://github.com/ex/a", channels: [fdroidLink("org.ex.twin")] }),
    entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Twin B", url: "https://github.com/ex/b", channels: [fdroidLink("org.ex.twin")] }),
  ];
  const overrides = {
    same: [{ a: { source: "android-foss" as const, url: "https://one.example/" }, b: { source: "awesome-shizuku" as const, url: "https://uno.example" }, reason: "same project, two sites", date: "2026-11-11" }],
    different: [
      { a: { source: "android-foss" as const, url: "https://github.com/ex/a" }, b: { source: "awesome-shizuku" as const, url: "https://github.com/ex/b" }, reason: "different apps, reused id", date: "2026-11-11" },
      { a: { source: "android-foss" as const, url: "https://nothing.example" }, b: { source: "android-foss" as const, url: "https://none.example" }, reason: "stale", date: "2026-11-11" },
    ],
    packages: [],
  };
  const result = run({ entries, fdroid: { "org.ex.twin": {} }, overrides });
  assert.equal(result.apps.length, 3);
  assert.equal(appOf(result, "One").id, appOf(result, "Uno").id);
  assert.notEqual(appOf(result, "Twin A").id, appOf(result, "Twin B").id);
  assert.deepEqual(result.overrides.map((o) => [o.kind, o.matched]), [["different", true], ["different", false], ["same", true]]);
  assert.ok(result.merges.some((m) => m.identifier.startsWith("override:same")));
});

test("rule 5: resources never merge, even on a shared link", () => {
  const result = run({
    entries: [
      entry({ name: "F-Droid", url: "https://f-droid.org" }),
      entry({ name: "F-Droid", url: "https://f-droid.org", kind: "resource", category: "android-foss/getting-more" }),
      entry({ name: "Awesome list", url: "https://github.com/ex/list", kind: "resource", category: "android-foss/getting-more" }),
      entry({ name: "List app", url: "https://github.com/ex/list" }),
    ],
  });
  assert.equal(result.apps.length, 4);
});

test("a store link contradicted by the index and by another listed entry does not identify the entry", () => {
  const result = run({
    entries: [
      entry({ name: "Flowish", url: "https://github.com/flow/flowish", channels: [fdroidLink("org.ex.tube")] }),
      entry({ name: "Tube", url: "https://github.com/tube/tube", channels: [fdroidLink("org.ex.tube")] }),
    ],
    fdroid: { "org.ex.tube": { sourceCode: "https://github.com/tube/tube" } },
  });
  assert.equal(result.apps.length, 2);
  assert.deepEqual(appOf(result, "Flowish").channels, []);
  assert.equal(result.rejectedLinks[0]?.pkg, "org.ex.tube");
});

test("a store link whose index repository is not listed elsewhere is kept (moved repositories, mirrors)", () => {
  const result = run({
    entries: [entry({ name: "Moved", url: "https://codeberg.org/old/moved", channels: [fdroidLink("org.ex.moved")] })],
    fdroid: { "org.ex.moved": { sourceCode: "https://codeberg.org/new/moved" } },
  });
  assert.deepEqual(result.apps[0]?.packages, ["org.ex.moved"]);
  assert.deepEqual(result.rejectedLinks, []);
});

test("nested entries point at their parent's app id; an entry nested under itself loses the link", () => {
  const entries = [
    entry({ name: "Store", url: "https://store.example" }),
    entry({ name: "Client", url: "https://github.com/ex/client", parent: 0 }),
  ];
  const result = run({ entries });
  assert.equal(appOf(result, "Client").listings[0]?.parent, appOf(result, "Store").id);
});

test("derived fields: summary prefers the index, then awesome-shizuku's description, then GitHub", () => {
  const result = run({
    entries: [
      entry({ name: "One", url: "https://github.com/ex/one" }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "One", url: "https://github.com/ex/one", description: "Listed text" }),
      entry({ name: "Two", url: "https://github.com/ex/two", channels: [fdroidLink("org.ex.two")] }),
      entry({ name: "Three", url: "https://github.com/ex/three" }),
    ],
    fdroid: { "org.ex.two": { summary: "Index text", license: "MIT" } },
    github: { "ex/one": fakeRepo("ex/one", { description: "Repo text" }), "ex/three": fakeRepo("ex/three", { description: "Repo text 3" }) },
  });
  assert.deepEqual(appOf(result, "One").summary, { value: "Listed text", origin: "awesome-shizuku" });
  assert.deepEqual(appOf(result, "Two").summary, { value: "Index text", origin: "fdroid" });
  assert.deepEqual(appOf(result, "Three").summary, { value: "Repo text 3", origin: "github" });
  assert.deepEqual(appOf(result, "Two").license, { value: "MIT", origin: "fdroid" });
});

test("facets and evidence: Shizuku declared vs listed, openness by its most restrictive statement", () => {
  const result = run({
    entries: [
      entry({ name: "Declares", url: "https://github.com/ex/declares", channels: [fdroidLink("org.ex.declares")] }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "Listed", url: "https://github.com/ex/listed", tags: ["source-available", "iap"], license: "Proprietary" }),
      entry({ source: "awesome-shizuku", category: "awesome-shizuku/closed-audio", name: "Closed", url: "https://closed.example", tags: ["closed-source", "paid"] }),
    ],
    fdroid: { "org.ex.declares": { permissions: ["moe.shizuku.manager.permission.API_V23"], license: "GPL-3.0-or-later" } },
  });
  const declares = appOf(result, "Declares");
  assert.equal(declares.facets.shizuku, true);
  assert.deepEqual(declares.evidence.shizuku, ["fdroid"]);
  assert.equal(declares.facets.noInternet, true);
  assert.equal(declares.facets.openness, "open-source");
  assert.deepEqual(declares.evidence.pricing, [{ value: "free", origin: "fdroid" }]);
  const listed = appOf(result, "Listed");
  assert.deepEqual(listed.evidence.shizuku, ["awesome-shizuku"]);
  assert.equal(listed.facets.openness, "source-available");
  assert.equal(listed.facets.paid, false);
  assert.equal(listed.facets.noInternet, null);
  const closed = appOf(result, "Closed");
  assert.equal(closed.facets.openness, "closed-source");
  assert.equal(closed.facets.paid, true);
});

test("the result does not depend on the order of the entries", () => {
  const entries = [
    entry({ name: "A", url: "https://github.com/ex/a", channels: [fdroidLink("org.ex.a")] }),
    entry({ source: "awesome-shizuku", category: "awesome-shizuku/audio", name: "A", url: "https://github.com/ex/a" }),
    entry({ name: "Same", url: "https://same.example/one" }),
    entry({ name: "Same", url: "https://same.example/two" }),
  ];
  const forward = run({ entries, fdroid: { "org.ex.a": {} } });
  const backward = run({ entries: [...entries].reverse(), fdroid: { "org.ex.a": {} } });
  assert.deepEqual(forward.apps.map((a) => a.id).sort(), backward.apps.map((a) => a.id).sort());
});

const matched = (result: IdentityResult) => result.indexMatches.map((m) => [m.entry.name, m.pkg, m.rule, m.applied, m.note]);

test("rule 9, website: one app states the entry's home page and the names agree", () => {
  const result = run({ entries: [entry({ name: "Tool", url: "https://tool.example.org/" })], fdroid: { "org.ex.tool": { name: "Tool", webSite: "https://tool.example.org" } } });
  assert.deepEqual(appOf(result, "Tool").packages, ["org.ex.tool"]);
  assert.deepEqual(matched(result), [["Tool", "org.ex.tool", "website", true, null]]);
  assert.deepEqual(result.verifications.map((v) => v.via), ["index-website"]);
});

test("rule 9, website: never when several apps state the site, the site hosts many projects, or the names differ", () => {
  const suite = run({
    entries: [entry({ name: "Suite", url: "https://suite.example.org/" })],
    fdroid: { "org.ex.mail": { name: "Suite Mail", webSite: "https://suite.example.org/" }, "org.ex.notes": { name: "Suite", webSite: "https://suite.example.org" } },
    izzy: { "org.ex.calendar": { name: "Suite Calendar", webSite: "https://suite.example.org/" } },
  });
  assert.deepEqual(appOf(suite, "Suite").packages, []);
  assert.deepEqual(matched(suite), [
    ["Suite", "org.ex.calendar", "website", false, "3 apps state this website"],
    ["Suite", "org.ex.mail", "website", false, "3 apps state this website"],
    ["Suite", "org.ex.notes", "website", false, "3 apps state this website"],
  ]);
  const store = run({ entries: [entry({ name: "F-Droid", url: "https://f-droid.org/" })], fdroid: { "org.fdroid.fdroid": { name: "F-Droid", webSite: "https://f-droid.org/" } } });
  assert.deepEqual(appOf(store, "F-Droid").packages, []);
  assert.deepEqual(matched(store), [["F-Droid", "org.fdroid.fdroid", "website", false, "a site that hosts many projects"]]);
  const other = run({ entries: [entry({ name: "Tool", url: "https://tool.example.org/" })], fdroid: { "org.ex.toolpro": { name: "Tool Pro", webSite: "https://tool.example.org/" } } });
  assert.deepEqual(appOf(other, "Tool").packages, []);
  assert.deepEqual(matched(other), [["Tool", "org.ex.toolpro", "website", false, "the names differ"]]);
  const variants = run({ entries: [entry({ name: "Tool", url: "https://tool.example.org/" })], fdroid: { "org.ex.tool": { name: "Tool", webSite: "https://tool.example.org/" }, "org.ex.tool.fdroid": { name: "Tool", webSite: "https://tool.example.org/" } } });
  assert.deepEqual(appOf(variants, "Tool").packages.sort(), ["org.ex.tool"], "a suffix variant is one app, matched by its base");
});

test("rule 9, source code: a package whose source is the entry's link on a forge the parser does not know; never two apps", () => {
  const one = run({ entries: [entry({ name: "Tunnel", url: "https://git.example.net/tunnel-android" })], fdroid: { "org.ex.tunnel": { name: "Tunnel", sourceCode: "https://git.example.net/tunnel-android/" } } });
  assert.deepEqual(appOf(one, "Tunnel").packages, ["org.ex.tunnel"]);
  assert.deepEqual(matched(one), [["Tunnel", "org.ex.tunnel", "source-code", true, null]]);
  const two = run({ entries: [entry({ name: "Pair", url: "https://git.example.net/pair" })], fdroid: { "org.ex.pair.a": { sourceCode: "https://git.example.net/pair" }, "org.ex.pair.b": { sourceCode: "https://git.example.net/pair" } } });
  assert.deepEqual(appOf(two, "Pair").packages, []);
  assert.equal(two.indexMatches.every((m) => !m.applied && m.note === "2 apps state this source"), true);
  const guide = run({ entries: [entry({ name: "Guide", url: "https://git.example.net/guide", kind: "resource", category: "android-foss/getting-more" })], fdroid: { "org.ex.guide": { sourceCode: "https://git.example.net/guide" } } });
  assert.deepEqual(guide.indexMatches, [], "guides and links are never matched");
});

test("package overrides: the entry named by source, link and category gains the package and keeps its id", () => {
  const entries = () => [
    entry({ name: "F-Droid", url: "https://f-droid.org/" }),
    entry({ name: "F-Droid", url: "https://f-droid.org/", kind: "resource", category: "android-foss/getting-more" }),
  ];
  const before = run({ entries: entries(), fdroid: { "org.fdroid.fdroid": { name: "F-Droid", webSite: "https://f-droid.org/" } } });
  const overrides: IdentityOverrides = {
    same: [],
    different: [],
    packages: [
      { entry: { source: "android-foss", url: "https://f-droid.org", category: "android-foss/apps-tools" }, pkg: "org.fdroid.fdroid", reason: "F-Droid's own client", date: "2026-11-12" },
      { entry: { source: "android-foss", url: "https://f-droid.org" }, pkg: "org.fdroid.basic", reason: "names two entries, so applies to none", date: "2026-11-12" },
      { entry: { source: "android-foss", url: "https://nowhere.example" }, pkg: "org.ex.none", reason: "matches nothing", date: "2026-11-12" },
    ],
  };
  const after = identify({
    entries: entries(),
    categories: SOURCE_CATEGORIES,
    fdroid: fakeIndex("fdroid", { "org.fdroid.fdroid": { name: "F-Droid", webSite: "https://f-droid.org/" }, "org.fdroid.basic": { name: "F-Droid Basic" } }),
    izzy: fakeIndex("izzy", {}),
    github: fakeGithub(),
    previous: { apps: before.apps, redirects: before.redirects },
    overrides,
  });
  const client = after.apps.find((a) => a.listings[0]?.kind === "app");
  assert.ok(client);
  assert.deepEqual(client.packages, ["org.fdroid.fdroid"]);
  assert.equal(client.index[0]?.pkg, "org.fdroid.fdroid");
  assert.deepEqual(after.apps.map((a) => a.id).sort(), before.apps.map((a) => a.id).sort(), "no id changes");
  assert.deepEqual(after.ids.created, []);
  assert.deepEqual(after.indexMatches.filter((m) => m.rule === "override").map((m) => [m.pkg, m.applied]), [["org.fdroid.fdroid", true]]);
});

test("rule 7 counts only trusted store links: a rejected link to another app's listing does not block the entry's own index match", () => {
  const result = run({
    entries: [
      entry({ name: "Flow", url: "https://github.com/ex/flow", channels: [{ type: "izzy", pkg: "org.ex.tube", variant: null }] }),
      entry({ name: "Tube", url: "https://github.com/ex/tube", channels: [{ type: "izzy", pkg: "org.ex.tube", variant: null }] }),
    ],
    izzy: { "org.ex.tube": { sourceCode: "https://github.com/ex/tube" }, "org.ex.flow": { sourceCode: "https://github.com/ex/flow" } },
  });
  assert.deepEqual(appOf(result, "Flow").packages, ["org.ex.flow"]);
  assert.deepEqual(appOf(result, "Tube").packages, ["org.ex.tube"]);
});
