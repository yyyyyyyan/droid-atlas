/** Builders for schema-shaped test data. Every field has a neutral default so a test states only what it is about. */

import type { App, Catalog, Category, Facets, Listing, SourceCategory } from "./schema.ts";

type AppOverrides = Partial<Omit<App, "facets" | "evidence">> & {
  facets?: Partial<Facets>;
  evidence?: Partial<App["evidence"]>;
};

export function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    source: "android-foss",
    category: "android-foss/launcher",
    kind: "app",
    order: 0,
    name: "Example",
    url: "https://github.com/accrescent/accrescent",
    description: null,
    tags: [],
    license: null,
    added: null,
    parent: null,
    extraLinks: [],
    ...overrides,
  };
}

export function app(overrides: AppOverrides = {}): App {
  const name = overrides.name ?? "Example";
  const { facets, evidence, ...rest } = overrides;
  return {
    id: "example",
    name,
    category: "launchers",
    region: "personal",
    listings: [listing({ name })],
    packages: [],
    repo: { host: "github", url: "https://github.com/accrescent/accrescent", slug: "accrescent/accrescent" },
    website: null,
    channels: [],
    summary: null,
    icon: null,
    iconLarge: null,
    license: null,
    index: [],
    github: {
      stars: 100,
      pushedAt: "2026-10-01T00:00:00Z",
      archived: false,
      movedTo: null,
      forkOf: null,
      release: { tag: "v1", publishedAt: "2026-10-01T00:00:00Z", hasApk: true },
    },
    downloads: [],
    repoMissing: false,
    search: name.toLowerCase(),
    ...rest,
    facets: {
      shizuku: false,
      root: false,
      paid: false,
      recommended: false,
      fork: false,
      staleLink: false,
      onFdroid: false,
      onIzzy: false,
      openness: null,
      noInternet: null,
      apkOnGithub: null,
      noAntiFeatures: null,
      archived: null,
      ...facets,
    },
    evidence: { shizuku: [], root: [], archived: [], noInternet: [], openness: [], pricing: [], ...evidence },
  };
}

export function category(overrides: Partial<Category> = {}): Category {
  return { id: "launchers", name: "Launchers", region: "personal", remainder: false, ...overrides };
}

export function sourceCategory(overrides: Partial<SourceCategory> = {}): SourceCategory {
  return {
    id: "android-foss/launcher",
    source: "android-foss",
    name: "Launcher",
    section: "Apps",
    category: "launchers",
    region: "personal",
    order: 0,
    note: null,
    ...overrides,
  };
}

export function catalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    schema: 3,
    generatedAt: "2026-11-11T00:00:00Z",
    hash: "testhash",
    sources: [
      {
        id: "android-foss", name: "Android FOSS", url: "https://github.com/offa/android-foss", license: "GPL-3.0",
        licenseUrl: "https://github.com/offa/android-foss/blob/master/LICENSE", commit: "abc", committedAt: "2026-11-10T00:00:00Z",
        entries: 0, anomalies: [],
      },
      {
        id: "awesome-shizuku", name: "awesome-shizuku", url: "https://github.com/timschneeb/awesome-shizuku", license: "CC-BY-SA-3.0",
        licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/", commit: "def", committedAt: "2026-11-10T00:00:00Z",
        entries: 0, anomalies: [],
      },
    ],
    enrichment: { fdroidIndexAt: "2026-11-10T00:00:00Z", izzyIndexAt: "2026-11-10T00:00:00Z", githubFetchedAt: "2026-11-10T00:00:00Z", downloads: [] },
    antiFeatures: [],
    regions: [
      { id: "personal", name: "Personalization" },
      { id: "system", name: "System & Power Tools" },
    ],
    categories: [
      category(),
      category({ id: "system-ui-gestures", name: "System UI & Gestures" }),
      category({ id: "system-tools", name: "System Tools", region: "system" }),
      category({ id: "other-system-tools", name: "Other System Tools", region: "system", remainder: true }),
    ],
    sourceCategories: [
      sourceCategory(),
      sourceCategory({ id: "awesome-shizuku/customization", source: "awesome-shizuku", name: "Customization", section: null, category: "system-ui-gestures", order: 0 }),
      sourceCategory({ id: "awesome-shizuku/system", source: "awesome-shizuku", name: "System", section: null, category: "system-tools", region: "system", order: 1 }),
    ],
    apps: [],
    redirects: {},
    ...overrides,
  };
}
