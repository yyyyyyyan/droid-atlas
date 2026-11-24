import { describe, expect, test } from "vitest";
import { EXPLORE, aboutRoute, buildHash, destinationOf, destinationRoot, isDestinationRoot, licenseRoute, parentOf, parseHash, placeOf } from "../router/route.ts";
import { filterCredits, nextRows } from "../views/IconCredits.tsx";
import { iconOwner, iconSourceWords, licenseIds, licensesMentioned, licenseTextId, licenseTextPath, projectUrl, sourceCredits } from "./credits.ts";
import { buildVocabulary, parseQuery, runQuery } from "./filters.ts";
import { FIXTURE_HEADER } from "./fixture-parts.ts";
import { app, catalog } from "./fixtures.ts";
import { catalogHealth, DOWNLOADS_BEHIND_AFTER_DAYS, STALE_AFTER_DAYS } from "./health.ts";
import { manifestFileUrl, readHeader, type IconRecord, type LoadedCatalog, type LoadedPart, type ManifestFile, type PartHeader } from "./load.ts";
import { buildModel } from "./model.ts";
import type { Catalog } from "./schema.ts";

const DATA = "https://atlas.example/app/data/";
const BASE = `${DATA}c/0123456789abcdef/`;
const DAY = 86_400_000;

function header(overrides: Omit<Partial<PartHeader>, "source"> & { source?: Partial<PartHeader["source"]> } = {}): PartHeader {
  return { ...FIXTURE_HEADER, ...overrides, source: { ...FIXTURE_HEADER.source, ...overrides.source } };
}

function file(path: string, role: ManifestFile["role"], origin: ManifestFile["origin"], license = "CC0-1.0"): ManifestFile {
  return { path, role, origin, sha256: "0".repeat(64), bytes: 2048, license, attribution: `Manifest attribution for ${origin}` };
}

function built(subject: Catalog, parts: LoadedPart[], extra: ManifestFile[] = []): LoadedCatalog {
  return {
    catalog: subject,
    parts,
    version: { schema: 3, generatedAt: subject.generatedAt, hash: subject.hash, manifest: "c/0123456789abcdef/manifest.json" },
    manifest: { schema: 3, generatedAt: subject.generatedAt, hash: subject.hash, detailsShards: 4, files: [...parts.map((part) => part.file), ...extra] },
    base: BASE,
    dataRoot: DATA,
    verified: true,
  };
}

const FOSS_COMMIT = "5a425acfacf36d693c693f92cb499e405994fef9";

function realistic(): LoadedCatalog {
  const subject = catalog();
  const sources = subject.sources.map((source) => (source.id === "android-foss" ? { ...source, commit: FOSS_COMMIT, entries: 789 } : { ...source, entries: 548 }));
  return built({ ...subject, sources }, [
    { file: file("atlas.json", "atlas", "droid-atlas"), header: header({ source: { name: "Droid Atlas", url: "https://droid-atlas.invalid/" }, changes: "Compiled on 2026-11-11." }) },
    { file: file("sources/github.json", "github", "github", "NOASSERTION"), header: header({ source: { name: "GitHub", url: "https://github.com" }, license: "NOASSERTION", licenseUrl: null }) },
    { file: file("sources/izzy.json", "index", "izzy", "LicenseRef-per-record"), header: header({ source: { name: "IzzyOnDroid", url: "https://apt.izzysoft.de/fdroid/" }, license: "LicenseRef-per-record", licenseUrl: null, attribution: "Index data is from IzzyOnDroid repodata, AGPL-3.0-or-later." }) },
    { file: file("sources/fdroid.json", "index", "fdroid", "LicenseRef-per-record"), header: header({ source: { name: "F-Droid", url: "https://f-droid.org" }, license: "LicenseRef-per-record", licenseUrl: null, attribution: "Index data is from fdroiddata, AGPL-3.0-only." }) },
    { file: file("sources/awesome-shizuku.json", "source", "awesome-shizuku", "CC-BY-SA-3.0"), header: header({ source: { name: "awesome-shizuku", url: "https://github.com/timschneeb/awesome-shizuku", commit: "def" }, license: "CC-BY-SA-3.0" }) },
    {
      file: file("sources/android-foss.json", "source", "android-foss", "GPL-3.0-only"),
      header: header({
        source: { name: "Android FOSS", url: "https://github.com/offa/android-foss", commit: FOSS_COMMIT },
        license: "GPL-3.0-only",
        licenseUrl: "https://www.gnu.org/licenses/gpl-3.0.html",
        attribution: "Android FOSS by offa and contributors",
        changes: "Modified by Droid Atlas on 2026-11-11: entries extracted from the README into JSON.",
      }),
    },
  ], [
    file(`../../upstream/android-foss/${FOSS_COMMIT}.md`, "upstream", "android-foss", "GPL-3.0-only"),
    file("../../upstream/awesome-shizuku/def/pages/ARCHIVED.md", "upstream", "awesome-shizuku", "CC-BY-SA-3.0"),
    file("icons.json", "icons", "droid-atlas"),
  ]);
}

describe("part headers", () => {
  test("a well-formed header is read field by field", () => {
    expect(readHeader({ header: FIXTURE_HEADER, apps: [] })).toEqual(FIXTURE_HEADER);
  });

  test.each([
    ["no header", {}],
    ["a header that is not an object", { header: "CC0" }],
    ["a source that is missing", { header: { ...FIXTURE_HEADER, source: undefined } }],
    ["a license that is not text", { header: { ...FIXTURE_HEADER, license: 3 } }],
    ["a commit that is neither text nor null", { header: { ...FIXTURE_HEADER, source: { ...FIXTURE_HEADER.source, commit: 7 } } }],
    ["markup where a string belongs", { header: { ...FIXTURE_HEADER, changes: { html: "<b>x</b>" } } }],
  ])("%s gives no header rather than a partial one", (_label, part) => {
    expect(readHeader(part)).toBeNull();
  });
});

describe("links to the build's files", () => {
  const build = { base: BASE, dataRoot: DATA };

  test("a part, and an upstream snapshot beside the builds, resolve under the data root", () => {
    expect(manifestFileUrl(build, "sources/android-foss.json")).toBe(`${BASE}sources/android-foss.json`);
    expect(manifestFileUrl(build, "../../upstream/android-foss/abc.md")).toBe(`${DATA}upstream/android-foss/abc.md`);
  });

  test.each([
    "../../../secrets.txt",
    "../../../../etc/passwd",
    "https://evil.example/x.json",
    "//evil.example/x.json",
    "/absolute.json",
    "javascript:alert(1)",
    "a\\b.json",
    "x y.json",
    "",
  ])("%s is not linked", (path) => {
    expect(manifestFileUrl(build, path)).toBeNull();
  });

  test("something that is not a string is not linked", () => {
    expect(manifestFileUrl(build, 42)).toBeNull();
    expect(manifestFileUrl(build, null)).toBeNull();
  });
});

describe("licenses named by the build", () => {
  test("an expression gives each identifier once, and markers that are not licenses give none", () => {
    expect(licenseIds("GPL-3.0-or-later")).toEqual(["GPL-3.0-or-later"]);
    expect(licenseIds("(MIT OR Apache-2.0) AND MIT")).toEqual(["MIT", "Apache-2.0"]);
    expect(licenseIds("LicenseRef-per-record")).toEqual([]);
    expect(licenseIds("NOASSERTION")).toEqual([]);
  });

  test("identifiers are found in a sentence, and bare family names are not", () => {
    expect(licensesMentioned("Index data is from fdroiddata, AGPL-3.0-only; text may also be under AGPL-3.0-only.")).toEqual(["AGPL-3.0-only"]);
    expect(licensesMentioned("IzzyOnDroid repodata, AGPL-3.0-or-later, and CC-BY-SA-3.0 text")).toEqual(["AGPL-3.0-or-later", "CC-BY-SA-3.0"]);
    expect(licensesMentioned("Under the GPL, more or less.")).toEqual([]);
  });

  test("a license text is looked for only under a plain identifier", () => {
    expect(licenseTextPath("CC-BY-SA-3.0")).toBe("licenses/CC-BY-SA-3.0.txt");
    expect(licenseTextPath("../../etc/passwd")).toBeNull();
    expect(licenseTextPath("LicenseRef-per-record")).toBeNull();
    expect(licenseTextPath("NOASSERTION")).toBeNull();
  });
});

describe("source credits", () => {
  test("every origin gets one credit: catalogs first, then the repositories and GitHub, our own data last", () => {
    const credits = sourceCredits(realistic());
    expect(credits.map((credit) => credit.origin)).toEqual(["android-foss", "awesome-shizuku", "fdroid", "izzy", "github", "droid-atlas"]);
    expect(credits.map((credit) => credit.group)).toEqual(["catalog", "catalog", "facts", "facts", "facts", "own"]);
  });

  test("a catalog's credit carries what its license asks to be shown", () => {
    const [foss] = sourceCredits(realistic());
    expect(foss).toMatchObject({
      title: "Android FOSS",
      url: "https://github.com/offa/android-foss",
      attribution: "Android FOSS by offa and contributors",
      license: "GPL-3.0-only",
      licenseUrl: "https://www.gnu.org/licenses/gpl-3.0.html",
      commit: FOSS_COMMIT,
      commitUrl: `https://github.com/offa/android-foss/commit/${FOSS_COMMIT}`,
      asOf: "2026-11-10T00:00:00Z",
      entries: 789,
      changes: "Modified by Droid Atlas on 2026-11-11: entries extracted from the README into JSON.",
      warranty: "Provided without warranty.",
    });
    expect(foss?.files).toEqual([
      { name: "sources/android-foss.json", url: `${BASE}sources/android-foss.json`, bytes: 2048, kind: "data" },
      { name: `${FOSS_COMMIT}.md`, url: `${DATA}upstream/android-foss/${FOSS_COMMIT}.md`, bytes: 2048, kind: "upstream" },
    ]);
  });

  test("a repository index is dated by its index, has no commit, and states its licenses in its attribution", () => {
    const fdroid = sourceCredits(realistic()).find((credit) => credit.origin === "fdroid");
    expect(fdroid).toMatchObject({ commit: null, commitUrl: null, asOf: "2026-11-10T00:00:00Z", license: "LicenseRef-per-record", entries: null });
    expect(licensesMentioned(fdroid?.attribution ?? "")).toEqual(["AGPL-3.0-only"]);
  });

  test("a commit that is not a hash, or a source that is not a GitHub repository, gets no commit link", () => {
    const shizuku = sourceCredits(realistic()).find((credit) => credit.origin === "awesome-shizuku");
    expect(shizuku?.commit).toBeNull();
    expect(shizuku?.commitUrl).toBeNull();
    const elsewhere = built(catalog(), [{
      file: file("sources/android-foss.json", "source", "android-foss"),
      header: header({ source: { url: "https://codeberg.org/someone/list", commit: FOSS_COMMIT } }),
    }]);
    expect(sourceCredits(elsewhere)[0]).toMatchObject({ commit: FOSS_COMMIT, commitUrl: null });
  });

  test("hostile addresses in a header are dropped, and a hostile file path is not linked", () => {
    const hostile = built(catalog(), [{
      file: file("../../../outside.json", "source", "android-foss"),
      header: header({ source: { url: "javascript:alert(1)", commit: `${FOSS_COMMIT}/../../..` }, licenseUrl: "data:text/html,<script>1</script>" }),
    }]);
    const [credit] = sourceCredits(hostile);
    expect(credit).toMatchObject({
      url: "https://github.com/offa/android-foss",
      licenseUrl: "https://github.com/offa/android-foss/blob/master/LICENSE",
      commit: null,
      commitUrl: null,
      files: [],
    });
    const noFallback = built({ ...catalog(), sources: [] }, hostile.parts);
    expect(sourceCredits(noFallback)[0]).toMatchObject({ url: null, licenseUrl: null });
  });

  test("a part whose header is unreadable is still credited, from the manifest and the catalog", () => {
    const bare = built(catalog(), [{ file: file("sources/awesome-shizuku.json", "source", "awesome-shizuku", "CC-BY-SA-3.0"), header: null }]);
    expect(sourceCredits(bare)[0]).toMatchObject({
      title: "awesome-shizuku",
      url: "https://github.com/timschneeb/awesome-shizuku",
      attribution: "Manifest attribution for awesome-shizuku",
      license: "CC-BY-SA-3.0",
      changes: null,
    });
  });

  test("the project's own address is offered only once it is a real one", () => {
    expect(projectUrl(realistic())).toBeNull();
    const decided = realistic();
    const atlas = decided.parts.find((part) => part.file.role === "atlas");
    if (atlas?.header) atlas.header.source.url = "https://codeberg.org/example/atlas";
    expect(projectUrl(decided)).toBe("https://codeberg.org/example/atlas");
    if (atlas?.header) atlas.header.source.url = "not a url";
    expect(projectUrl(decided)).toBeNull();
  });
});

describe("catalog health", () => {
  const NOW = Date.parse("2026-11-11T12:00:00Z");
  const subject = catalog({
    generatedAt: "2026-11-11T06:00:00Z",
    apps: [
      app({ id: "fine", name: "Fine", icon: "icons/a.webp" }),
      app({ id: "stale", name: "Stale", facets: { staleLink: true } }),
      app({ id: "gone", name: "Gone", repoMissing: true }),
      app({ id: "old", name: "Old", facets: { archived: true } }),
      app({ id: "unknown", name: "Unknown", facets: { archived: null } }),
    ],
    redirects: { "old-id": "fine", "left-id": null },
  });
  subject.sources[0]?.anomalies.push({ file: "README.md", line: 412, kind: "unrecognized", text: "* [Broken](" });

  test("it reports age, integrity and the entries that point at something gone", () => {
    const health = catalogHealth(buildModel(subject, NOW), { verified: true }, NOW);
    expect(health).toMatchObject({ ageDays: 0, stale: false, verified: true, hash: "testhash", schema: 3, apps: 5, resources: 0, withIcon: 1, redirects: 2, anomalyCount: 1 });
    expect(health.staleLinks.map((entry) => entry.app.id)).toEqual(["stale"]);
    expect(health.repoGone.map((entry) => entry.app.id)).toEqual(["gone"]);
    expect(health.archived.map((entry) => entry.app.id)).toEqual(["old"]);
    expect(health.sources[0]?.anomalies).toEqual([{ file: "README.md", line: 412, kind: "unrecognized", text: "* [Broken](" }]);
  });

  test("each origin's download figures are dated by the last day they count, and a publisher that has stopped is said to be behind", () => {
    const withFigures = catalog({
      apps: [
        app({ id: "one", name: "One", downloads: [{ origin: "fdroid", count: 9, from: "2026-07-28", to: "2026-08-23" }, { origin: "github", count: 4, from: null, to: null }] }),
        app({ id: "two", name: "Two", downloads: [{ origin: "izzy", count: 3, from: "2026-10-09", to: "2026-11-07" }] }),
      ],
      enrichment: {
        fdroidIndexAt: "2026-11-10T00:00:00Z", izzyIndexAt: "2026-11-10T00:00:00Z", githubFetchedAt: "2026-11-10T00:00:00Z",
        downloads: [
          { origin: "fdroid", name: "F-Droid Metrics", url: "https://fdroid.gitlab.io/metrics/", license: null, retrieved: "2026-11-13T00:29:23Z", newest: "2026-08-23" },
          { origin: "izzy", name: "IzzyOnDroid download statistics", url: "https://dlstats.izzyondroid.org/", license: null, retrieved: "2026-11-13T00:29:23Z", newest: "2026-11-07" },
          { origin: "github", name: "GitHub release assets", url: "https://docs.github.com/", license: null, retrieved: "2026-11-13T00:31:28Z", newest: null },
        ],
      },
    });
    const at = Date.parse("2026-11-13T12:00:00Z");
    const { downloads } = catalogHealth(buildModel(withFigures, at), { verified: true }, at);
    expect(downloads.map((item) => [item.source.origin, item.apps, item.ageDays, item.behind])).toEqual([
      ["fdroid", 1, 82, true],
      ["izzy", 1, 6, false],
      ["github", 1, null, false],
    ]);
    expect(downloads[2]).toMatchObject({ newest: null, retrieved: Date.parse("2026-11-13T00:31:28Z") });
    expect(catalogHealth(buildModel(subject, NOW), { verified: true }, NOW).downloads).toEqual([]);
    const edge = Date.parse("2026-08-23T00:00:00Z") + DOWNLOADS_BEHIND_AFTER_DAYS * DAY;
    expect(catalogHealth(buildModel(withFigures, edge), { verified: true }, edge).downloads[0]?.behind).toBe(false);
    expect(catalogHealth(buildModel(withFigures, edge + DAY), { verified: true }, edge + DAY).downloads[0]?.behind).toBe(true);
  });

  test("a catalog is called stale only after the allowed days have passed", () => {
    const model = buildModel(subject, NOW);
    const built = Date.parse(subject.generatedAt);
    expect(catalogHealth(model, { verified: true }, built + STALE_AFTER_DAYS * DAY + DAY - 1).stale).toBe(false);
    expect(catalogHealth(model, { verified: true }, built + (STALE_AFTER_DAYS + 1) * DAY)).toMatchObject({ stale: true, ageDays: STALE_AFTER_DAYS + 1 });
  });

  test("an unverified build and an unreadable build time are reported as such, not guessed", () => {
    const odd = buildModel({ ...subject, generatedAt: "yesterday-ish" }, NOW);
    expect(catalogHealth(odd, { verified: false }, NOW)).toMatchObject({ verified: false, generatedAt: null, ageDays: null, stale: false });
  });

  test("a clock behind the build does not produce a negative age", () => {
    expect(catalogHealth(buildModel(subject, NOW), { verified: true }, NOW - 30 * DAY).ageDays).toBe(0);
  });

  test("entries whose repository is gone can be listed through the filter the page links to", () => {
    const model = buildModel(subject, NOW);
    const vocabulary = buildVocabulary(model);
    const found = runQuery(vocabulary, model.entries, parseQuery(vocabulary, { f: "gone" }));
    expect(found.map((entry) => entry.app.id)).toEqual(["gone"]);
    const none = buildVocabulary(buildModel(catalog({ apps: [app({ id: "fine" })] }), NOW));
    expect(none.def("gone") !== undefined).toBe(false);
  });
});

describe("icon credits", () => {
  const record = (name: string, pkg: string, author: string): IconRecord => ({
    file: `icons/${pkg}.webp`, fileLarge: `icons/${pkg}.webp`, app: pkg, name, rule: "fdroid-index", author, license: "MIT", project: null,
    original: { url: `https://f-droid.org/repo/icons/${pkg}.png`, sha256: "0".repeat(64) }, revision: null, retrieved: "2026-11-11", changes: "resized",
  });
  const records = [record("Zebra", "org.zebra", "Ana"), record("élan Player", "org.elan.player", "Björn"), record("Alpha", "org.alpha", "Chen")];

  test("with no query every record is listed by app name, diacritics folded", () => {
    expect(filterCredits(records, "  ").map((item) => item.name)).toEqual(["Alpha", "élan Player", "Zebra"]);
  });

  test("the rows made next are the ones asked for, in the list's order, and only then the rest", () => {
    const sorted = filterCredits(records, "");
    const apps = (names: string[]): string[] => names.map((name) => sorted.find((item) => item.name === name)?.app ?? "");
    const all = new Set(sorted.map((item) => item.app));
    expect(nextRows(sorted, new Set(), all, 2)).toEqual(apps(["Alpha", "élan Player"]));
    expect(nextRows(sorted, new Set(apps(["Alpha"])), all, 5)).toEqual(apps(["élan Player", "Zebra"]));
    expect(nextRows(sorted, new Set(), new Set(apps(["Zebra"])), 2), "a search is not kept waiting behind rows it hides").toEqual(apps(["Zebra", "Alpha"]));
    expect(nextRows(sorted, all, all, 5)).toEqual([]);
    const shared = [...sorted, { ...(sorted[0] as IconRecord), app: "org.alpha.fork", name: "Alpha fork" }];
    expect(nextRows(shared, all, all, 5), "a fork that shows its upstream's icon file is a row of its own").toEqual(["org.alpha.fork"]);
  });

  test("a query matches app, package or author, every word of it", () => {
    expect(filterCredits(records, "elan").map((item) => item.name)).toEqual(["élan Player"]);
    expect(filterCredits(records, "org.zebra").map((item) => item.name)).toEqual(["Zebra"]);
    expect(filterCredits(records, "bjorn player").map((item) => item.name)).toEqual(["élan Player"]);
    expect(filterCredits(records, "player chen")).toEqual([]);
    expect(["fdroid-index", "izzy-index", "repo-launcher", "repo-fastlane", "readme-logo", "site-icon", "store-listing", "a-rule-from-later"].map(iconSourceWords), "where an icon came from, in a word or two").toEqual([
      "F-Droid", "IzzyOnDroid", "repository", "repository", "repository", "website", "store listing", "project",
    ]);
    expect(["the Endda/80bee-app project", "Team Kodi", "the Eden developers", "the project"].map(iconOwner)).toEqual(["Endda/80bee-app", "Team Kodi", "Eden developers", "project"]);
    expect(["GPL-3.0", "AGPL-3.0", "LGPL-2.1", "GPL-2.0"].map(licenseTextId), "a bare GNU identifier is the “-only” one, by SPDX's own definition").toEqual(["GPL-3.0-only", "AGPL-3.0-only", "LGPL-2.1-only", "GPL-2.0-only"]);
    expect(["GPL-3.0-or-later", "GPL-3.0-only", "MIT", "BSD 3-Clause", "GPL", "GPL-3", "Propietary", "Apache-2.0"].map(licenseTextId), "anything else is left as it is spelled").toEqual(["GPL-3.0-or-later", "GPL-3.0-only", "MIT", "BSD 3-Clause", "GPL", "GPL-3", "Propietary", "Apache-2.0"]);
  });
});

describe("about routes", () => {
  test("About and the pages beneath it have addresses of their own and round-trip", () => {
    expect(placeOf(parseHash("#/about"))).toEqual({ kind: "about", page: "home" });
    expect(placeOf(parseHash("#/about/sources"))).toEqual({ kind: "about", page: "sources" });
    expect(placeOf(parseHash("#/about/icons"))).toEqual({ kind: "about", page: "icons" });
    expect(placeOf(parseHash("#/about/health"))).toEqual({ kind: "about", page: "health" });
    expect(placeOf(parseHash("#/about/notices"))).toEqual({ kind: "about", page: "notices" });
    expect(placeOf(parseHash("#/about/license/GPL-3.0-or-later"))).toEqual({ kind: "license", id: "GPL-3.0-or-later" });
    expect(buildHash(aboutRoute())).toBe("#/about");
    expect(buildHash(aboutRoute("sources"))).toBe("#/about/sources");
    expect(buildHash(aboutRoute("health"))).toBe("#/about/health");
    expect(buildHash(licenseRoute("CC-BY-SA-3.0"))).toBe("#/about/license/CC-BY-SA-3.0");
  });

  test("About is a destination of its own, and Settings and every page under About belong to it", () => {
    for (const hash of ["#/about", "#/about/sources", "#/about/icons", "#/about/health", "#/about/notices", "#/about/license/MIT", "#/settings"]) {
      expect(destinationOf(parseHash(hash))).toBe("about");
    }
    expect(isDestinationRoot(parseHash("#/about"))).toBe(true);
    expect(isDestinationRoot(parseHash("#/about/sources"))).toBe(false);
    expect(isDestinationRoot(parseHash("#/settings"))).toBe(false);
    expect(buildHash(destinationRoot("about"))).toBe("#/about");
  });

  test("Back from a page under About that was entered cold leads to About, and from About to Explore", () => {
    for (const hash of ["#/about/sources", "#/about/health", "#/about/license/MIT", "#/settings"]) {
      expect(buildHash(parentOf(parseHash(hash)) ?? EXPLORE)).toBe("#/about");
    }
    expect(buildHash(parentOf(parseHash("#/about")) ?? aboutRoute())).toBe("#/");
  });

  test("anything else under about is not a place", () => {
    expect(placeOf(parseHash("#/about/secrets")).kind).toBe("unknown");
    expect(placeOf(parseHash("#/about/health/more")).kind).toBe("unknown");
    expect(placeOf(parseHash("#/about/license")).kind).toBe("unknown");
    expect(placeOf(parseHash("#/about/license/MIT/extra")).kind).toBe("unknown");
    expect(placeOf(parseHash("#/settings/extra")).kind).toBe("unknown");
  });
});
