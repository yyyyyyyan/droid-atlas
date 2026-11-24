/**
 * Writes a small synthetic build to `public/data/version.fixture.json` for
 * looking at the states real data rarely or not yet shows: an app listed by
 * two catalogs, closed-source, paid and root labels, sources that disagree, a
 * fork, a moved and a missing repository, a stale listing, a guide, text in
 * another script, a retired id. Every entry is invented and says so in its
 * name; none of it is catalog data. Open it in development with
 * `?catalog=fixture`.
 *
 *   node scripts/write-fixture-build.ts
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { splitParts } from "../src/catalog/fixture-parts.ts";
import { app, catalog, listing, sourceCategory } from "../src/catalog/fixtures.ts";
import { detailsShard, type App, type Catalog, type CatalogVersion, type IndexFacts } from "../../schema/catalog.ts";
import type { Manifest, ManifestFile } from "../../schema/parts.ts";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const SHARDS = 2;
const LICENSE = "CC0-1.0";
const ATTRIBUTION = "Synthetic fixture written by Droid Atlas; not catalog data.";

function index(origin: "fdroid" | "izzy", pkg: string, overrides: Partial<IndexFacts> = {}): IndexFacts {
  return {
    origin, pkg, version: "2.4.1", updatedAt: "2026-10-30T00:00:00Z", addedAt: "2023-02-01T00:00:00Z", minSdk: 26, targetSdk: 36,
    sizeBytes: 4_200_000, author: "Fixture Authors", antiFeatures: [], antiFeatureReasons: {}, permissionCount: 6, declaresShizuku: false, declaresInternet: true,
    ...overrides,
  };
}

const github = (overrides: Partial<NonNullable<App["github"]>> = {}): NonNullable<App["github"]> => ({
  stars: 1840, pushedAt: "2026-11-02T00:00:00Z", archived: false, movedTo: null, forkOf: null,
  release: { tag: "v2.4.1", publishedAt: "2026-10-30T00:00:00Z", hasApk: true },
  ...overrides,
});

const apps: App[] = [
  app({
    id: "fixture.two.catalogs", name: "Fixture: in two catalogs", category: "system-tools", region: "system",
    packages: ["fixture.two.catalogs"],
    repo: { host: "github", url: "https://github.com/fixture/two-catalogs", slug: "fixture/two-catalogs" },
    channels: [
      { type: "fdroid", pkg: "fixture.two.catalogs", variant: null, listed: true },
      { type: "izzy", pkg: "fixture.two.catalogs", variant: null, listed: true },
      { type: "izzy", pkg: "fixture.two.catalogs.beta", variant: "Beta", listed: true },
    ],
    summary: { value: "Freezes apps you rarely use, with Shizuku or root.", origin: "fdroid" },
    license: { value: "GPL-3.0-or-later", origin: "fdroid" },
    index: [index("fdroid", "fixture.two.catalogs", { declaresShizuku: true }), index("izzy", "fixture.two.catalogs", { declaresShizuku: true })],
    github: github(),
    facets: { shizuku: true, root: true, onFdroid: true, onIzzy: true, openness: "open-source", noInternet: false, apkOnGithub: true, noAntiFeatures: true, archived: false, recommended: true },
    evidence: { shizuku: ["fdroid", "izzy", "awesome-shizuku"], root: ["awesome-shizuku"], openness: [{ value: "open-source", origin: "android-foss" }, { value: "open-source", origin: "awesome-shizuku" }] },
    listings: [
      listing({ name: "Fixture: in two catalogs", category: "android-foss/launcher", added: "2023-03-01T00:00:00Z", order: 0, extraLinks: [{ name: "Wiki", url: "https://example.org/wiki" }] }),
      listing({
        source: "awesome-shizuku", category: "awesome-shizuku/system", name: "Fixture Two", order: 0, added: "2026-10-01T00:00:00Z",
        description: "Freeze, hide and suspend apps. Works with Shizuku, Dhizuku and root; the root mode adds unattended freezing.",
        tags: ["recommended", "root"], license: "GPL-3.0",
      }),
    ],
    search: "fixture: in two catalogs fixture two freezes apps shizuku root launcher system fixture.two.catalogs fixture/two-catalogs",
  }),
  app({
    id: "fixture.closed.paid", name: "Fixture: closed source, paid, root, with a deliberately long name that has to truncate", category: "system-tools", region: "system",
    packages: ["fixture.closed.paid"], repo: null, github: null, website: "https://example.com/closed",
    channels: [{ type: "play", pkg: "fixture.closed.paid", variant: null, listed: null }],
    summary: { value: "A closed-source tuner that needs root and is sold on Google Play.", origin: "awesome-shizuku" },
    facets: { shizuku: true, root: true, paid: true, openness: "closed-source" },
    evidence: { shizuku: ["awesome-shizuku"], root: ["awesome-shizuku"], openness: [{ value: "closed-source", origin: "awesome-shizuku" }], pricing: [{ value: "paid", origin: "awesome-shizuku" }] },
    listings: [listing({
      source: "awesome-shizuku", category: "awesome-shizuku/system", name: "Fixture Closed", order: 1, url: "https://play.google.com/store/apps/details?id=fixture.closed.paid",
      description: "A closed-source tuner that needs root and is sold on Google Play.", tags: ["closed-source", "paid", "root"],
    })],
    search: "fixture: closed source paid root tuner fixture.closed.paid system",
  }),
  app({
    id: "fixture.sources.disagree", name: "Fixture: sources disagree", category: "system-ui-gestures", region: "personal",
    packages: ["fixture.sources.disagree"],
    repo: { host: "github", url: "https://github.com/fixture/renamed", slug: "fixture/disagree" },
    channels: [{ type: "fdroid", pkg: "fixture.sources.disagree", variant: null, listed: false }],
    summary: { value: "Listed as source-available by one catalog and as open source by an index; archived upstream.", origin: "izzy" },
    license: { value: "LicenseRef-Proprietary", origin: "awesome-shizuku" },
    index: [index("izzy", "fixture.sources.disagree", { antiFeatures: ["NonFreeNet", "Tracking"], declaresInternet: true })],
    github: github({ archived: true, movedTo: "fixture/renamed", forkOf: "upstream/original", stars: 12, release: { tag: "v0.9", publishedAt: "2024-01-05T00:00:00Z", hasApk: false } }),
    facets: { paid: true, fork: true, staleLink: true, onIzzy: true, openness: "source-available", noInternet: false, apkOnGithub: false, noAntiFeatures: false, archived: true },
    evidence: {
      archived: ["github", "awesome-shizuku"],
      openness: [{ value: "source-available", origin: "awesome-shizuku" }, { value: "open-source", origin: "izzy" }],
      pricing: [{ value: "iap", origin: "awesome-shizuku" }, { value: "free", origin: "izzy" }],
    },
    listings: [listing({
      source: "awesome-shizuku", category: "awesome-shizuku/customization", name: "Fixture Disagree", order: 0,
      description: "A themer. The free build has in-app purchases; the project moved and was later archived…",
      tags: ["source-available", "iap", "archived"], license: "Custom, source-available",
    })],
    search: "fixture: sources disagree themer customization fixture.sources.disagree fixture/renamed",
  }),
  app({
    id: "fixture.no.facts", name: "Fixture: nothing but a link", region: "personal",
    repo: { host: "other", url: "https://git.example.org/someone/project", slug: null }, github: null,
    listings: [listing({ name: "Fixture: nothing but a link", category: "android-foss/launcher", order: 1, url: "https://git.example.org/someone/project" })],
    search: "fixture: nothing but a link launcher",
  }),
  app({
    id: "fixture.repo.gone", name: "Fixture: repository gone", region: "personal", repoMissing: true,
    repo: { host: "github", url: "https://github.com/fixture/gone", slug: "fixture/gone" }, github: null,
    listings: [listing({ name: "Fixture: repository gone", category: "android-foss/launcher", order: 2, parent: "fixture.two.catalogs" })],
    search: "fixture: repository gone launcher fixture/gone",
  }),
  app({
    id: "fixture.other.script", name: "فیکسچر: نام فارسی 设备 Fixture", region: "personal",
    packages: ["fixture.other.script"],
    repo: { host: "codeberg", url: "https://codeberg.org/fixture/other-script", slug: "fixture/other-script" }, github: null,
    channels: [{ type: "fdroid", pkg: "fixture.other.script", variant: null, listed: true }],
    summary: { value: "یک برنامهٔ نمونه برای آزمودن متن راست‌به‌چپ. A sample for right-to-left text.", origin: "fdroid" },
    license: { value: "MIT", origin: "fdroid" },
    index: [index("fdroid", "fixture.other.script", { declaresInternet: false, permissionCount: 0, author: "نویسنده" })],
    facets: { onFdroid: true, openness: "open-source", noInternet: true, noAntiFeatures: true },
    evidence: { noInternet: ["fdroid"], openness: [{ value: "open-source", origin: "android-foss" }] },
    listings: [listing({ name: "فیکسچر: نام فارسی 设备 Fixture", category: "android-foss/launcher", order: 3, added: "2026-11-01T00:00:00Z" })],
    search: "فیکسچر: نام فارسی 设备 fixture launcher fixture.other.script fixture/other-script",
  }),
  app({
    id: "fixture.guide", name: "Fixture: a guide, not an app", category: "system-tools", region: "system",
    repo: null, github: null, website: "https://example.org/guide",
    summary: { value: "How to set up wireless debugging for Shizuku.", origin: "awesome-shizuku" },
    listings: [listing({
      source: "awesome-shizuku", category: "awesome-shizuku/system", kind: "resource", name: "Fixture: a guide, not an app", order: 2,
      url: "https://example.org/guide", description: "How to set up wireless debugging for Shizuku.",
    })],
    search: "fixture: a guide not an app wireless debugging shizuku system",
  }),
];

const data: Catalog = catalog({
  apps,
  sourceCategories: [
    sourceCategory(),
    sourceCategory({ id: "awesome-shizuku/customization", source: "awesome-shizuku", name: "Customization", section: null, category: "system-ui-gestures", order: 0 }),
    sourceCategory({
      id: "awesome-shizuku/system", source: "awesome-shizuku", name: "System", section: "Vendor-specific", category: "system-tools", region: "system", order: 1,
      note: "Apps in this section change system settings; read each app's own instructions before granting access.",
    }),
  ],
  redirects: { "fixture.retired.id": "fixture.two.catalogs", "fixture.removed.id": null },
  generatedAt: new Date().toISOString(),
  hash: "fixture",
});

const descriptions: Record<string, Record<string, string>> = {
  fdroid: {
    "fixture.two.catalogs": "Fixture Two freezes apps you rarely use so they cannot run in the background.\n\nIt works without root through Shizuku or Dhizuku, and with root when you want unattended freezing.\n\n* Freeze, hide or suspend\n* Unfreeze from the launcher\n* Tasker and quick-settings integration\n\nThis text is synthetic and exists to show a long description…",
    "fixture.other.script": "این متن ساختگی است. It is here to show mixed-direction text in a description.",
  },
  izzy: {
    "fixture.two.catalogs": "The IzzyOnDroid build of Fixture Two.",
    "fixture.sources.disagree": "A themer for system colors. Synthetic text.",
  },
};

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function main(): Promise<void> {
  const directory = `c/${data.hash}`;
  const files: ManifestFile[] = [];
  const write = async (path: string, role: ManifestFile["role"], origin: ManifestFile["origin"], value: unknown): Promise<void> => {
    const text = JSON.stringify(value);
    await mkdir(dirname(join(outDir, directory, path)), { recursive: true });
    await writeFile(join(outDir, directory, path), text);
    files.push({ path, role, origin, sha256: digest(text), bytes: Buffer.byteLength(text), license: LICENSE, attribution: ATTRIBUTION });
  };
  const parts = splitParts(data);
  await write("atlas.json", "atlas", "droid-atlas", parts.atlas);
  for (const part of parts.sources) await write(`sources/${part.info.id}.json`, "source", part.info.id, part);
  for (const part of parts.indexes) await write(`sources/${part.origin}.json`, "index", part.origin, part);
  await write("sources/github.json", "github", "github", parts.github);
  for (const [origin, texts] of Object.entries(descriptions)) {
    for (let n = 0; n < SHARDS; n += 1) {
      const shard = Object.fromEntries(Object.entries(texts).filter(([id]) => detailsShard(id, SHARDS) === n).map(([id, description]) => [id, { description }]));
      await write(`details/${origin}/${n}.json`, "details", origin as ManifestFile["origin"], shard);
    }
  }
  const manifest: Manifest = { schema: 3, generatedAt: data.generatedAt, hash: data.hash, files, detailsShards: SHARDS };
  await writeFile(join(outDir, directory, "manifest.json"), JSON.stringify(manifest));
  const version: CatalogVersion = { schema: 3, generatedAt: data.generatedAt, hash: data.hash, manifest: `${directory}/manifest.json` };
  await writeFile(join(outDir, "version.fixture.json"), JSON.stringify(version));
  console.log(`Wrote ${apps.length} synthetic apps to ${join(outDir, "version.fixture.json")}`);
}

await main();
