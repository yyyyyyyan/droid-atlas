import { describe, expect, test } from "vitest";
import { deriveLicense, deriveLicenses, type AppStatements } from "../../../schema/join.ts";
import { factsFor } from "./facts.ts";
import { licenseKey, licenseKeysOf, licenseParts, linksRepository, ownerLabel, repositoryOwner } from "./fact-tokens.ts";
import { buildVocabulary, countOptions, describeQuery, EMPTY_QUERY, parseQuery, queryParams, runQuery, storedQueryName, toggleFilter } from "./filters.ts";
import { app, catalog, listing } from "./fixtures.ts";
import { buildModel } from "./model.ts";
import type { App } from "./schema.ts";

const NOW = Date.parse("2026-11-20T00:00:00Z");

function repo(host: NonNullable<App["repo"]>["host"], slug: string | null): App["repo"] {
  return { host, url: `https://example.org/${slug ?? "x"}`, slug };
}

describe("the licenses an app carries", () => {
  const statements = (overrides: Partial<AppStatements>): AppStatements => ({
    listings: [], fdroid: null, izzy: null, github: null, packages: [], repoSlug: null, categoryName: () => undefined, ...overrides,
  });
  const index = (license: string | null) => ({
    facts: { origin: "fdroid" as const, pkg: "a.b", version: null, updatedAt: null, addedAt: null, minSdk: null, targetSdk: null, sizeBytes: null, author: null, antiFeatures: [], antiFeatureReasons: {}, permissionCount: 0, declaresShizuku: false, declaresInternet: false },
    summary: null, license, downloads: null,
  });

  test("are every source's statement, F-Droid's, IzzyOnDroid's, each listing's, GitHub's; the license shown first is the first of them", () => {
    const given = statements({
      fdroid: index("GPL-3.0-or-later"),
      izzy: index(null),
      listings: [listing({ license: "MIT" }), listing({ source: "awesome-shizuku", license: "Proprietary" }), listing({ license: "" })],
      github: { facts: { stars: 1, pushedAt: "", archived: false, movedTo: null, forkOf: null, release: null }, description: null, license: "MPL-2.0", downloads: null },
    });
    expect(deriveLicenses(given)).toEqual([
      { value: "GPL-3.0-or-later", origin: "fdroid" },
      { value: "MIT", origin: "android-foss" },
      { value: "Proprietary", origin: "awesome-shizuku" },
      { value: "MPL-2.0", origin: "github" },
    ]);
    expect(deriveLicense(given)).toEqual({ value: "GPL-3.0-or-later", origin: "fdroid" });
    expect(deriveLicenses(statements({}))).toEqual([]);
    expect(deriveLicense(statements({}))).toBeNull();
  });
});

describe("a repository owner", () => {
  test("is the slug's first segment on a named forge, compared without case, and one owner per forge", () => {
    expect(repositoryOwner({ repo: repo("github", "FossifyOrg/Gallery") })).toEqual({ key: "owner:github/fossifyorg", host: "github", name: "FossifyOrg" });
    expect(repositoryOwner({ repo: repo("gitlab", "fossifyorg/gallery") })?.key).toBe("owner:gitlab/fossifyorg");
    expect(repositoryOwner({ repo: repo("sourcehut", "~someone/app") })?.key).toBe("owner:sourcehut/~someone");
    expect(ownerLabel({ host: "codeberg", name: "Someone" })).toBe("Someone on Codeberg");
  });

  test("is not known for a repository elsewhere, for none, or for a slug that is not one", () => {
    expect(repositoryOwner({ repo: repo("other", null) })).toBeNull();
    expect(repositoryOwner({ repo: null })).toBeNull();
    expect(repositoryOwner({ repo: repo("github", null) })).toBeNull();
    expect(repositoryOwner({ repo: repo("github", "a,b/c") })).toBeNull();
    expect(repositoryOwner({ repo: repo("github", "<b>x</b>/c") })).toBeNull();
  });
});

describe("a license token", () => {
  test("joins one license's spellings: -only, -or-later, + and the bare form, in any case and with spaces", () => {
    for (const spelling of ["GPL-3.0-only", "GPL-3.0-or-later", "GPL-3.0", "GPL-3.0+", "gpl-3.0", " GPL-3.0 "]) expect(licenseKey(spelling)).toBe("license:gpl-3.0");
    expect(licenseKey("Apache 2.0")).toBe("license:apache-2.0");
    expect(licenseKey("BSD 3-Clause")).toBe("license:bsd-3-clause");
  });

  test("keeps different versions and different licenses apart", () => {
    expect(licenseKey("GPL-2.0-or-later")).toBe("license:gpl-2.0");
    expect(licenseKey("AGPL-3.0-only")).toBe("license:agpl-3.0");
    expect(licenseKey("LGPL-3.0")).toBe("license:lgpl-3.0");
    expect(licenseKey("Modified MPL-2.0")).toBe("license:modified-mpl-2.0");
  });

  test("does not exist for a statement that there is no license, nor for text no license name has", () => {
    for (const none of ["Proprietary", "Propietary", "No license", "NOASSERTION", "", "   ", "GPL, MIT", "<script>", "x".repeat(80)]) expect(licenseKey(none)).toBeNull();
  });

  test("is one per license a statement offers a choice of; the words between lead nowhere", () => {
    expect(licenseParts("Apache-2.0 OR GPL-3.0-or-later")).toEqual([
      { text: "Apache-2.0", key: "license:apache-2.0" },
      { text: " OR ", key: null },
      { text: "GPL-3.0-or-later", key: "license:gpl-3.0" },
    ]);
    expect(licenseParts("(MIT OR Apache-2.0)").map((part) => part.key)).toEqual(["license:mit", null, "license:apache-2.0"]);
    expect(licenseParts("/MIT").map((part) => part.key)).toEqual([null, "license:mit"]);
    expect(licenseParts("Proprietary")).toEqual([{ text: "Proprietary", key: null }]);
  });

  test("an app is under every license any source states for it", () => {
    const subject = app({ licenses: [{ value: "GPL-3.0-only", origin: "fdroid" }, { value: "GPL-3.0", origin: "github" }, { value: "MPL-2.0", origin: "github" }, { value: "Proprietary", origin: "awesome-shizuku" }] });
    expect(licenseKeysOf(subject)).toEqual(["license:gpl-3.0", "license:mpl-2.0"]);
  });
});

const CATALOG = catalog({
  apps: [
    app({ id: "gallery", name: "Gallery", repo: repo("github", "FossifyOrg/Gallery"), licenses: [{ value: "GPL-3.0-only", origin: "fdroid" }, { value: "GPL-3.0", origin: "github" }] }),
    app({ id: "notes", name: "Notes", repo: repo("github", "fossifyorg/Notes"), licenses: [{ value: "GPL-3.0-or-later", origin: "fdroid" }], facets: { onFdroid: true } }),
    app({ id: "clock", name: "Clock", repo: repo("github", "FossifyOrg/Clock"), licenses: [{ value: "GPL-3.0", origin: "github" }], facets: { onFdroid: true } }),
    app({ id: "mirror", name: "Mirror", repo: repo("gitlab", "FossifyOrg/Mirror"), licenses: [{ value: "MIT", origin: "github" }] }),
    app({ id: "lone", name: "Lone", repo: repo("codeberg", "solo/lone"), licenses: [{ value: "Apache-2.0", origin: "fdroid" }, { value: "MIT", origin: "github" }] }),
    app({ id: "closed", name: "Closed", repo: null, licenses: [{ value: "Proprietary", origin: "awesome-shizuku" }] }),
  ],
});

describe("the catalog by owner and by license", () => {
  const model = buildModel(CATALOG, NOW);
  const facts = model.facts();

  test("groups entries by owner, named as most of their slugs spell it, and keeps forges apart", () => {
    const fossify = facts.owners.get("owner:github/fossifyorg");
    expect(fossify?.label).toBe("FossifyOrg on GitHub");
    expect(fossify?.entries.map((entry) => entry.app.id)).toEqual(["clock", "gallery", "notes"]);
    expect(facts.owners.get("owner:gitlab/fossifyorg")?.entries.map((entry) => entry.app.id)).toEqual(["mirror"]);
    const lone = model.byId.get("lone");
    expect(lone && facts.ownerOf(lone)?.key).toBe("owner:codeberg/solo");
    const closed = model.byId.get("closed");
    expect(closed && facts.ownerOf(closed)).toBeNull();
  });

  test("groups entries by license, named as most sources write it without its version qualifier, each app once", () => {
    expect(facts.licenses.get("license:gpl-3.0")).toMatchObject({ label: "GPL-3.0" });
    expect(facts.licenses.get("license:gpl-3.0")?.entries.map((entry) => entry.app.id)).toEqual(["clock", "gallery", "notes"]);
    expect(facts.licenses.get("license:mit")?.entries.map((entry) => entry.app.id)).toEqual(["lone", "mirror"]);
    expect([...facts.licenses.keys()].sort()).toEqual(["license:apache-2.0", "license:gpl-3.0", "license:mit"]);
  });

  test("is indexed once, when first asked for", () => {
    expect(model.facts()).toBe(facts);
  });
});

describe("owner and license tokens in queries", () => {
  const model = buildModel(CATALOG, NOW);
  const vocabulary = buildVocabulary(model);

  test("exist for what the catalog holds, and are never in the filter panel or a lens", () => {
    expect(vocabulary.def("owner:github/fossifyorg")).toMatchObject({ short: "FossifyOrg on GitHub", group: "owner", lens: false });
    expect(vocabulary.def("license:gpl-3.0")).toMatchObject({ short: "GPL-3.0", group: "license", lens: false });
    expect(vocabulary.def("owner:github/nobody")).toBeUndefined();
    expect(vocabulary.def("license:proprietary")).toBeUndefined();
    expect(vocabulary.defs.some((def) => def.group === "owner" || def.group === "license")).toBe(false);
    expect(vocabulary.lenses.some((def) => def.group === "owner" || def.group === "license")).toBe(false);
  });

  test("are not indexed while no query names one", () => {
    const counting = buildModel(CATALOG, NOW);
    let asked = 0;
    const facts = counting.facts;
    counting.facts = () => {
      asked += 1;
      return facts();
    };
    const plain = buildVocabulary(counting);
    parseQuery(plain, { q: "notes", f: "fdroid,c:launchers,af:Ads" });
    expect(asked).toBe(0);
    parseQuery(plain, { f: "license:mit" });
    expect(asked).toBe(1);
  });

  test("read from a link, come first, survive the round trip, and drop what the catalog no longer holds", () => {
    const query = parseQuery(vocabulary, { f: "fdroid,license:gpl-3.0,owner:github/fossifyorg,owner:github/gone,license:wtfpl" });
    expect(query.filters).toEqual(["owner:github/fossifyorg", "license:gpl-3.0", "fdroid"]);
    expect(parseQuery(vocabulary, { f: queryParams(query).f ?? "" })).toEqual(query);
    expect(describeQuery(vocabulary, query)).toBe("FossifyOrg on GitHub · GPL-3.0 · F-Droid");
  });

  test("an owner written in other letters is the same owner", () => {
    expect(parseQuery(vocabulary, { f: "owner:github/fossifyorg" }).filters).toEqual(["owner:github/fossifyorg"]);
    expect(parseQuery(vocabulary, { f: "owner:GitHub/FossifyOrg,License:MIT" }).filters).toEqual(["owner:github/fossifyorg", "license:mit"]);
  });

  test("narrow like any other filter, with text and with other filters", () => {
    const ids = (f: string, q = ""): string[] => runQuery(vocabulary, model.entries, parseQuery(vocabulary, { f, q })).map((entry) => entry.app.id);
    expect(ids("owner:github/fossifyorg")).toEqual(["clock", "gallery", "notes"]);
    expect(ids("owner:github/fossifyorg,fdroid")).toEqual(["clock", "notes"]);
    expect(ids("owner:github/fossifyorg", "note")).toEqual(["notes"]);
    expect(ids("license:mit")).toEqual(["lone", "mirror"]);
    expect(ids("license:mit,license:apache-2.0")).toEqual(["lone"]);
    expect(ids("owner:github/fossifyorg,license:mit")).toEqual([]);
  });

  test("are switched off by their chip and counted like any other filter", () => {
    const query = parseQuery(vocabulary, { f: "owner:github/fossifyorg,fdroid" });
    expect(toggleFilter(vocabulary, query, "owner:github/fossifyorg").filters).toEqual(["fdroid"]);
    expect(toggleFilter(vocabulary, EMPTY_QUERY, "license:mit").filters).toEqual(["license:mit"]);
    expect(countOptions(vocabulary, model.entries, query, ["fdroid", "license:gpl-3.0"])).toEqual(new Map([["fdroid", 2], ["license:gpl-3.0", 2]]));
  });

  test("a pin keeps its name while its tokens exist, and says what is left once one has gone", () => {
    expect(storedQueryName(vocabulary, { f: "owner:github/fossifyorg" }, "Fossify")).toBe("Fossify");
    expect(storedQueryName(vocabulary, { f: "owner:github/gone,fdroid" }, "Gone")).toBe("F-Droid");
    expect(storedQueryName(vocabulary, { f: "license:gone" }, "Gone")).toBeNull();
  });
});

describe("the sheet's license and owner rows", () => {
  const model = buildModel(catalog({
    apps: [
      ...CATALOG.apps,
      app({ id: "agreed", name: "Agreed", repo: null, licenses: [{ value: "MIT", origin: "fdroid" }, { value: "MIT", origin: "github" }] }),
    ],
  }), NOW);
  const row = (id: string, key: string) => {
    const entry = model.byId.get(id);
    return entry ? factsFor(model, entry).find((fact) => fact.key === key) ?? null : null;
  };

  test("a license spelled differently by a second source shows once, as the first source writes it, leading to its list", () => {
    expect(row("gallery", "license")?.lines).toEqual([
      { value: "GPL-3.0-only", tone: "neutral", detail: null, quote: null, sources: ["F-Droid"], parts: [{ text: "GPL-3.0-only", key: "license:gpl-3.0" }] },
    ]);
  });

  test("the same license in the same words names both sources", () => {
    expect(row("agreed", "license")?.lines.map((line) => line.sources)).toEqual([["F-Droid", "GitHub"]]);
  });

  test("two sources stating two licenses give two lines, each leading to its own list", () => {
    expect(row("lone", "license")?.lines.map((line) => [line.value, line.sources, line.parts?.[0]?.key])).toEqual([
      ["Apache-2.0", ["F-Droid"], "license:apache-2.0"],
      ["MIT", ["GitHub"], "license:mit"],
    ]);
  });

  test("a statement that there is no license is shown as stated, leading nowhere", () => {
    expect(row("closed", "license")?.lines).toEqual([{ value: "Proprietary", tone: "neutral", detail: null, quote: null, sources: ["awesome-shizuku"] }]);
  });

  test("the owner row appears when another entry has the same owner on the same forge, worded as the app's own slug spells it", () => {
    expect(row("notes", "owner")?.lines).toEqual([
      { value: "fossifyorg on GitHub", tone: "neutral", detail: null, quote: null, sources: ["GitHub"], parts: [{ text: "fossifyorg on GitHub", key: "owner:github/fossifyorg" }] },
    ]);
    expect(row("mirror", "owner")).toBeNull();
    expect(row("lone", "owner")).toBeNull();
    expect(row("closed", "owner")).toBeNull();
  });
});

describe("who states a repository's owner", () => {
  const index = { origin: "fdroid" as const, pkg: "a.b", version: null, updatedAt: null, addedAt: null, minSdk: null, targetSdk: null, sizeBytes: null, author: null, antiFeatures: [], antiFeatureReasons: {}, permissionCount: 0, declaresShizuku: false, declaresInternet: false };
  const model = buildModel(catalog({
    apps: [
      app({ id: "confirmed", name: "Confirmed", repo: repo("github", "Team/One") }),
      app({ id: "listed", name: "Listed", repo: repo("github", "team/two"), github: null, listings: [listing({ name: "Listed", url: "https://www.github.com/Team/Two/releases" })] }),
      app({ id: "indexed", name: "Indexed", repo: repo("github", "team/three"), github: null, listings: [listing({ name: "Indexed", url: "https://example.org/three" })], index: [index] }),
    ],
  }), NOW);
  const credit = (id: string): string[] | undefined => {
    const entry = model.byId.get(id);
    return entry ? factsFor(model, entry).find((fact) => fact.key === "owner")?.lines[0]?.sources : undefined;
  };

  test("is GitHub when it answered for the repository, else the catalogs that link it, else the index the address came from", () => {
    expect(credit("confirmed")).toEqual(["GitHub"]);
    expect(credit("listed")).toEqual(["Android FOSS"]);
    expect(credit("indexed")).toEqual(["F-Droid"]);
  });

  test("a link leads into a repository on its forge, at its slug or below, in any letters", () => {
    const at = { host: "codeberg" as const, slug: "Owner/Name" };
    expect(linksRepository("https://codeberg.org/owner/name", at)).toBe(true);
    expect(linksRepository("https://codeberg.org/Owner/Name/releases", at)).toBe(true);
    expect(linksRepository("https://codeberg.org/owner/other", at)).toBe(false);
    expect(linksRepository("https://github.com/owner/name", at)).toBe(false);
    expect(linksRepository("not a url", at)).toBe(false);
    expect(linksRepository("https://example.org/owner/name", { host: "other", slug: null })).toBe(false);
  });
});
