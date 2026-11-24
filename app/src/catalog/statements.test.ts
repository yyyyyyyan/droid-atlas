import { describe, expect, test } from "vitest";
import { app, catalog, listing } from "./fixtures.ts";
import { buildModel, type Entry } from "./model.ts";
import type { App, Channel, IndexFacts, SourceId } from "./schema.ts";
import { detailsSource, factsFor } from "./facts.ts";
import { framedNote, NO_LINK, rowFallback } from "./statements.ts";

const NOW = Date.parse("2026-11-11T00:00:00Z");

function index(origin: "fdroid" | "izzy"): IndexFacts {
  return {
    origin, pkg: "org.example.app", version: "1", updatedAt: null, addedAt: null, minSdk: null, targetSdk: null,
    sizeBytes: null, author: null, antiFeatures: [], antiFeatureReasons: {}, permissionCount: 0, declaresShizuku: false, declaresInternet: true,
  };
}

interface Shape {
  catalogs: SourceId[];
  indexes: ("fdroid" | "izzy")[];
  github: boolean;
  repo: "github" | "gitlab" | "none";
  channels: Channel[];
  resource?: boolean;
}

function entryOf(shape: Shape): { model: ReturnType<typeof buildModel>; entry: Entry } {
  const repo: App["repo"] = shape.repo === "github"
    ? { host: "github", url: "https://github.com/owner/project", slug: "owner/project" }
    : shape.repo === "gitlab" ? { host: "gitlab", url: "https://gitlab.com/owner/project", slug: "owner/project" } : null;
  const subject = app({
    id: "subject",
    name: "Subject",
    listings: shape.catalogs.map((source, order) => listing({
      source, order, name: "Subject", kind: shape.resource ? "resource" : "app",
      category: source === "android-foss" ? "android-foss/launcher" : "awesome-shizuku/system",
      url: repo?.url ?? "https://subject.example/about",
    })),
    index: shape.indexes.map(index),
    github: shape.github
      ? { stars: 1, pushedAt: "2026-10-01T00:00:00Z", archived: false, movedTo: null, forkOf: null, release: null }
      : null,
    repo,
    website: repo ? null : "https://subject.example/",
    channels: shape.channels,
  });
  const model = buildModel(catalog({ apps: [subject] }), NOW);
  return { model, entry: model.byId.get("subject") as Entry };
}

const live = (type: "fdroid" | "izzy" | "play"): Channel => ({ type, pkg: "org.example.app", variant: null, listed: type === "play" ? null : true });
const stale = (type: "fdroid" | "izzy"): Channel => ({ type, pkg: "org.example.app", variant: null, listed: false });

/** The shapes the real catalog holds, from its most common to its rarest, and a few it does not hold yet. */
const SHAPES: { name: string; shape: Shape; inIt: string[] }[] = [
  { name: "Android FOSS, on F-Droid, on GitHub", shape: { catalogs: ["android-foss"], indexes: ["fdroid"], github: true, repo: "github", channels: [live("fdroid")] }, inIt: ["Android FOSS", "F-Droid", "GitHub"] },
  { name: "awesome-shizuku, on GitHub only", shape: { catalogs: ["awesome-shizuku"], indexes: [], github: true, repo: "github", channels: [] }, inIt: ["awesome-shizuku", "GitHub"] },
  { name: "Android FOSS, in both indexes", shape: { catalogs: ["android-foss"], indexes: ["fdroid", "izzy"], github: true, repo: "github", channels: [live("fdroid"), live("izzy")] }, inIt: ["Android FOSS", "F-Droid", "IzzyOnDroid", "GitHub"] },
  { name: "awesome-shizuku, on Google Play only", shape: { catalogs: ["awesome-shizuku"], indexes: [], github: false, repo: "none", channels: [live("play")] }, inIt: ["awesome-shizuku"] },
  { name: "Android FOSS, on IzzyOnDroid", shape: { catalogs: ["android-foss"], indexes: ["izzy"], github: true, repo: "github", channels: [live("izzy")] }, inIt: ["Android FOSS", "IzzyOnDroid", "GitHub"] },
  { name: "Android FOSS, on F-Droid, code on GitLab", shape: { catalogs: ["android-foss"], indexes: ["fdroid"], github: false, repo: "gitlab", channels: [live("fdroid")] }, inIt: ["Android FOSS", "F-Droid"] },
  { name: "Android FOSS, nothing else", shape: { catalogs: ["android-foss"], indexes: [], github: false, repo: "none", channels: [] }, inIt: ["Android FOSS"] },
  { name: "both catalogs, on F-Droid", shape: { catalogs: ["android-foss", "awesome-shizuku"], indexes: ["fdroid"], github: true, repo: "github", channels: [live("fdroid")] }, inIt: ["Android FOSS", "awesome-shizuku", "F-Droid", "GitHub"] },
  { name: "Android FOSS, a listing F-Droid no longer has", shape: { catalogs: ["android-foss"], indexes: [], github: true, repo: "github", channels: [stale("fdroid")] }, inIt: ["Android FOSS", "GitHub"] },
  { name: "Android FOSS, gone from F-Droid, still on IzzyOnDroid", shape: { catalogs: ["android-foss"], indexes: ["izzy"], github: true, repo: "github", channels: [stale("fdroid"), live("izzy")] }, inIt: ["Android FOSS", "IzzyOnDroid", "GitHub"] },
  { name: "a resource Android FOSS lists", shape: { catalogs: ["android-foss"], indexes: [], github: false, repo: "none", channels: [], resource: true }, inIt: ["Android FOSS"] },
  { name: "a resource that is a GitHub repository", shape: { catalogs: ["android-foss"], indexes: [], github: true, repo: "github", channels: [], resource: true }, inIt: ["Android FOSS", "GitHub"] },
];

const UNKNOWN = [
  { key: "permissions", label: "Permissions", lines: [{ value: "Unknown", tone: "neutral", detail: null, sources: [] }] },
  { key: "anti-unknown", label: "Anti-features", lines: [{ value: "Unknown", tone: "neutral", detail: null, sources: [] }] },
];

describe("what the sheet says of an entry is true of that entry, and is said in rows, not sentences", () => {
  test.each(SHAPES)("$name: permissions and anti-features read “Unknown” exactly when the entry is an app no index carries", ({ shape }) => {
    const { model, entry } = entryOf(shape);
    const facts = factsFor(model, entry);
    const unknown = facts.filter((fact) => fact.lines.some((line) => line.value === "Unknown"));
    if (shape.indexes.length > 0 || shape.resource) {
      expect(unknown).toEqual([]);
    } else {
      expect(unknown).toEqual(UNKNOWN);
    }
    const permissions = facts.filter((fact) => fact.key === "permissions");
    expect(permissions).toHaveLength(shape.resource ? 0 : 1);
    if (shape.indexes.length > 0) expect(permissions[0]?.lines.every((line) => /^\d+$/.test(line.value) && line.sources.length > 0)).toBe(true);
  });

  test.each(SHAPES)("$name: nothing is called “none” or “no”, and every line that states something names who states it", ({ shape, inIt }) => {
    const { model, entry } = entryOf(shape);
    for (const fact of factsFor(model, entry)) {
      for (const line of fact.lines) {
        expect(line.value).not.toMatch(/^(none|no)$/i);
        if (line.value === "Unknown") expect(line.sources).toEqual([]);
        else {
          /* That a listing is gone is the index's own statement, though the entry is no longer in it. */
          const gone: string[] = shape.channels.filter((channel) => channel.listed === false).map((channel) => (channel.type === "fdroid" ? "F-Droid" : "IzzyOnDroid"));
          expect(line.sources.length).toBeGreaterThan(0);
          expect(line.sources.every((name) => inIt.includes(name) || gone.includes(name))).toBe(true);
        }
      }
    }
  });

  test.each(SHAPES)("$name: the source the details' heading names is one the entry is in, and is the one most lines share", ({ shape, inIt }) => {
    const { model, entry } = entryOf(shape);
    const facts = factsFor(model, entry);
    const shared = detailsSource(facts);
    const stated = facts.flatMap((fact) => fact.lines).filter((line) => line.sources.length > 0).map((line) => line.sources.join(", "));
    if (stated.length === 0) {
      expect(shared).toBeNull();
      return;
    }
    const gone: string[] = shape.channels.filter((channel) => channel.listed === false).map((channel) => (channel.type === "fdroid" ? "F-Droid" : "IzzyOnDroid"));
    expect(shared?.split(", ").every((name) => inIt.includes(name) || gone.includes(name))).toBe(true);
    const count = (value: string): number => stated.filter((other) => other === value).length;
    expect(Math.max(...stated.map(count))).toBe(count(shared ?? ""));
  });

  test("an entry with no usable link says so in three words, and a framed page says what to do", () => {
    expect(NO_LINK).toBe("No working link");
    expect(framedNote("Droid Atlas")).toBe("Open Droid Atlas in its own tab to use links.");
  });

  test("a row with no summary shows the entry's own address, or nothing; never a sentence about what is missing", () => {
    const github = entryOf({ catalogs: ["android-foss"], indexes: [], github: true, repo: "github", channels: [] });
    expect(rowFallback(github.entry)).toBe("owner/project");
    const site = entryOf({ catalogs: ["android-foss"], indexes: [], github: false, repo: "none", channels: [] });
    expect(rowFallback(site.entry)).toBe("subject.example");
    const nothing = buildModel(catalog({ apps: [app({ id: "x", repo: null, github: null, listings: [listing({ url: "not a url" })] })] }), NOW);
    expect(rowFallback(nothing.byId.get("x") as Entry)).toBeNull();
  });
});
