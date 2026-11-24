#!/usr/bin/env node
/**
 * Writes a synthetic upstream cache that `pipeline/build.ts --offline` can
 * build from, so CI exercises the real pipeline, the real app build and the
 * end-to-end suite without contacting any upstream.
 *
 *   node scripts/fixture/upstream-cache.mjs --out <dir>
 *   node pipeline/build.ts --offline --bootstrap --cache <dir> \
 *     --generated-at 2026-11-11T12:00:00.000Z --out <data dir>
 *
 * Icons and download figures come from the cache too: index icons with the
 * SHA-256 the fake index states, a repository launcher icon, a site icon and
 * a store listing icon as an earlier lookup would have found them, all drawn
 * here as small PNG files; and F-Droid, IzzyOnDroid and GitHub download
 * figures in the shapes those publishers use.
 *
 * Every app, package, repository and sentence here is invented and says so;
 * nothing is copied from Android FOSS, awesome-shizuku, F-Droid, IzzyOnDroid
 * or GitHub (docs/LICENSING.md §1.2 asks for synthetic fixtures). The list
 * files only imitate the upstream Markdown grammar the parsers read. License
 * texts are placeholders: this cache is for CI and is never deployed.
 *
 * Output is deterministic: commits carry fixed dates and a fixed identity.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

export const FIXTURE_GENERATED_AT = "2026-11-11T12:00:00.000Z";
const RETRIEVED = "2026-11-11T06:00:00.000Z";
const INDEX_TIMESTAMP = Date.parse("2026-11-11T03:00:00.000Z");
const SPDX_TAG = "v3.29.0";
const HEADER_LICENSES = ["AGPL-3.0-only", "AGPL-3.0-or-later", "CC-BY-SA-3.0", "CC0-1.0", "GPL-3.0-only"];
/** Licenses the fixture apps state, whose texts the icon credits link. */
const APP_LICENSES = ["Apache-2.0", "GPL-3.0-or-later", "MIT", "MPL-2.0"];
const GIT_IDENTITY = { name: "Synthetic Fixture", email: "fixture@example.invalid" };

/** Android FOSS grammar: `## – Section –`, `### • Category`, `* [**Name**](url) [[F-Droid](…)]`. */
const ANDROID_FOSS_HISTORY = [
  {
    date: "2025-03-01T10:00:00Z",
    message: "Synthetic fixture: first entries",
    readme: [
      "# Synthetic Android FOSS fixture",
      "",
      "Invented entries in the list's Markdown grammar, for CI only.",
      "",
      "* [App Store](#app-store)",
      "* [Apps](#apps)",
      "",
      "## – App Store –",
      "",
      "* [**Fixture Store**](https://github.com/fixture-org/fixture-store) [[F-Droid](https://f-droid.org/packages/org.fixture.store/)]",
      "",
      "---",
      "",
      "## – Apps –",
      "",
      "### • Keyboard",
      "",
      "* [**Fixture Keys**](https://github.com/fixture-org/fixture-keys) [[F-Droid](https://f-droid.org/packages/org.fixture.keys/)] [[IzzyOnDroid](https://apt.izzysoft.de/fdroid/index/apk/org.fixture.keys)]",
      "",
      "### • Notes",
      "",
      "* [**Fixture Notes**](https://codeberg.org/fixture/notes) [[IzzyOnDroid](https://apt.izzysoft.de/fdroid/index/apk/org.fixture.notes)]",
      "",
    ],
  },
  {
    date: "2026-10-20T10:00:00Z",
    message: "Synthetic fixture: more entries",
    readme: [
      "# Synthetic Android FOSS fixture",
      "",
      "Invented entries in the list's Markdown grammar, for CI only.",
      "",
      "* [App Store](#app-store)",
      "* [Apps](#apps)",
      "* [Tutorials and Guides](#tutorials-and-guides)",
      "",
      "## – App Store –",
      "",
      "* [**Fixture Store**](https://github.com/fixture-org/fixture-store) [[F-Droid](https://f-droid.org/packages/org.fixture.store/)]",
      "",
      "---",
      "",
      "## – Apps –",
      "",
      "### • Browser",
      "",
      "* [**Fixture Browser**](https://github.com/fixture-org/fixture-browser) [[F-Droid](https://f-droid.org/packages/org.fixture.browser/)]",
      "",
      "### • Keyboard",
      "",
      "* [**Fixture Keys**](https://github.com/fixture-org/fixture-keys) [[F-Droid](https://f-droid.org/packages/org.fixture.keys/)] [[IzzyOnDroid](https://apt.izzysoft.de/fdroid/index/apk/org.fixture.keys)]",
      "* [**Fixture Glide Keys**](https://github.com/fixture-org/fixture-glide-keys)",
      "* [**Fixture Thumb Keys**](https://github.com/fixture-org/fixture-thumb-keys)",
      "",
      "### • Notes",
      "",
      "* [**Fixture Notes**](https://codeberg.org/fixture/notes) [[IzzyOnDroid](https://apt.izzysoft.de/fdroid/index/apk/org.fixture.notes)]",
      "* [**Fixture Archived Notes**](https://github.com/fixture-org/fixture-old-notes)",
      "",
      "### • Weather",
      "",
      "* [**Fixture Weather**](https://github.com/fixture-org/fixture-weather)",
      "",
      "---",
      "",
      "## – Tutorials and Guides –",
      "",
      "* [**Fixture Guide**](https://example.org/fixture-guide)",
      "",
    ],
  },
];

const ANNOTATIONS = [
  "## Annotations",
  "- ✨ - Fixture annotation: the maintainer's pick",
  "- `Paid` 💰 - Fixture annotation: paid",
  "- `IAP` 💰 - Fixture annotation: in-app purchases",
  "- `Ads` - Fixture annotation: ads",
  "- `Proprietary` - Fixture annotation: not under a FOSS license",
  "- `n-day trial` - Fixture annotation: trial",
  "- `Root` - Fixture annotation: needs root",
  "",
  "--------------------",
  "",
  "## License",
  "",
  "Fixture license section.",
  "",
];

/** awesome-shizuku grammar: `## Apps`, `### Category`, `* [Name](url) [tokens] - description `License``. */
const AWESOME_SHIZUKU_HISTORY = [
  {
    date: "2025-06-01T10:00:00Z",
    message: "Synthetic fixture: first entries",
    files: {
      "README.md": [
        "# Synthetic awesome-shizuku fixture",
        "",
        "## Table of contents",
        "",
        "- [Apps](#apps)",
        "",
        "## Apps",
        "",
        "### Audio",
        "",
        "* [Fixture Equalizer](https://github.com/fixture-org/fixture-eq) ✨ - Invented equalizer entry for CI. `GPL-3.0`",
        "",
        ...ANNOTATIONS,
      ],
      "pages/CLOSED_SOURCE.md": ["# Synthetic closed-source page", "", "## Closed-source apps", "", "### Automation", "", "* [Fixture Closed Tool](https://example.com/fixture-closed-tool) `IAP` 💰 - Invented closed-source entry for CI. `Proprietary`", ""],
      "pages/ARCHIVED.md": ["## Archived apps", "", "Invented archive note for CI.", "", "* [Fixture Retired](https://github.com/fixture-org/fixture-retired) - Invented archived entry for CI. `MIT`", ""],
    },
  },
  {
    date: "2026-11-01T10:00:00Z",
    message: "Synthetic fixture: more entries",
    files: {
      "README.md": [
        "# Synthetic awesome-shizuku fixture",
        "",
        "## Table of contents",
        "",
        "- [Apps](#apps)",
        "",
        "## Apps",
        "",
        "### Audio",
        "",
        "* [Fixture Equalizer](https://github.com/fixture-org/fixture-eq) ✨ - Invented equalizer entry for CI. `GPL-3.0`",
        "",
        "### Input methods",
        "",
        "* [Fixture Keys](https://github.com/fixture-org/fixture-keys) - The same invented keyboard, listed by both catalogs. `GPL-3.0`",
        "",
        "### Patching",
        "",
        "* [Fixture Patcher](https://github.com/fixture-org/fixture-patcher) - Invented patcher entry for CI. `GPL-3.0`",
        "",
        "### Software management",
        "",
        "* [Fixture Paid Freezer](https://play.google.com/store/apps/details?id=org.fixture.freezer) `Paid` 💰 `Root` - Invented paid, root-mode entry for CI. `Proprietary`",
        "",
        "### Vendor-specific",
        "",
        "#### Samsung OneUI",
        "",
        "* [Fixture Vendor Tweak](https://github.com/fixture-org/fixture-vendor) - Invented vendor entry for CI. `Apache-2.0`",
        "",
        ...ANNOTATIONS,
      ],
    },
  },
];

/**
 * A square RGBA PNG, `size` pixels a side: a disc of `color` on white, with a
 * `mark` color square in its middle, so each fixture icon is distinct and
 * none is blank.
 */
export function fixtureIcon(size, color, mark = [255, 255, 255]) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2 + 0.5;
      const dy = y - size / 2 + 0.5;
      const inMark = Math.abs(dx) < size / 8 && Math.abs(dy) < size / 8;
      const inDisc = dx * dx + dy * dy < (size * 0.4) ** 2;
      const [r, g, b] = inMark ? mark : inDisc ? color : [255, 255, 255];
      row.set([r, g, b, 255], 1 + x * 4);
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBlob = (bytes) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

/** Index icons: package → the image and its path in the repository. */
const INDEX_ICONS = {
  fdroid: {
    "org.fixture.store": { path: "/org.fixture.store/en-US/icon_fixture.png", bytes: fixtureIcon(256, [40, 90, 200]) },
    "org.fixture.browser": { path: "/org.fixture.browser/en-US/icon_fixture.png", bytes: fixtureIcon(512, [230, 120, 20]) },
  },
  izzy: {
    "org.fixture.notes": { path: "/org.fixture.notes/en-US/icon_fixture.png", bytes: fixtureIcon(192, [30, 160, 90]) },
  },
};

/** Hand-written index-v2 records in the shape `pipeline/enrich/index-v2.ts` reads. */
function indexPackage({ name, summary, description, license, sourceCode, permissions = [], antiFeatures = [], reasons = {}, icon = null }) {
  return {
    metadata: {
      name: { "en-US": name },
      summary: { "en-US": summary },
      description: { "en-US": description },
      license,
      sourceCode,
      authorName: "Fixture Authors",
      added: Date.parse("2024-01-15T00:00:00Z"),
      lastUpdated: Date.parse("2026-10-30T00:00:00Z"),
      ...(icon ? { icon: { "en-US": { name: icon.path, sha256: sha256(icon.bytes), size: icon.bytes.length } } } : {}),
    },
    versions: {
      fixture: {
        added: Date.parse("2026-10-30T00:00:00Z"),
        file: { name: `/${sourceCode.split("/").pop()}.apk`, size: 4_200_000 },
        manifest: {
          versionName: "1.0.0",
          versionCode: 1,
          usesSdk: { minSdkVersion: 26, targetSdkVersion: 36 },
          usesPermission: permissions.map((permission) => ({ name: permission })),
        },
        antiFeatures: Object.fromEntries(antiFeatures.map((feature) => [feature, reasons[feature] ?? {}])),
      },
    },
  };
}

const FDROID_PACKAGES = {
  "org.fixture.store": indexPackage({
    name: "Fixture Store",
    summary: "Invented app store used by the CI fixture",
    description: "An invented app store. It exists only in the synthetic CI fixture.",
    license: "GPL-3.0-or-later",
    sourceCode: "https://github.com/fixture-org/fixture-store",
    permissions: ["android.permission.INTERNET"],
    icon: INDEX_ICONS.fdroid["org.fixture.store"],
  }),
  "org.fixture.keys": indexPackage({
    name: "Fixture Keys",
    summary: "Invented keyboard used by the CI fixture",
    description: "An invented keyboard that asks for no network access.",
    license: "Apache-2.0",
    sourceCode: "https://github.com/fixture-org/fixture-keys",
  }),
  "org.fixture.browser": indexPackage({
    name: "Fixture Browser",
    summary: "Invented browser used by the CI fixture",
    description: "An invented browser with an invented anti-feature.",
    license: "MPL-2.0",
    sourceCode: "https://github.com/fixture-org/fixture-browser",
    permissions: ["android.permission.INTERNET"],
    antiFeatures: ["NonFreeNet"],
    reasons: { NonFreeNet: { "en-US": "Synthetic reason for CI: loads invented pages from an invented service." } },
    icon: INDEX_ICONS.fdroid["org.fixture.browser"],
  }),
};

const IZZY_PACKAGES = {
  "org.fixture.keys": indexPackage({
    name: "Fixture Keys",
    summary: "Invented keyboard used by the CI fixture",
    description: "An invented keyboard that asks for no network access.",
    license: "Apache-2.0",
    sourceCode: "https://github.com/fixture-org/fixture-keys",
  }),
  "org.fixture.notes": indexPackage({
    name: "Fixture Notes",
    summary: "Invented notes app hosted outside GitHub",
    description: "An invented notes app whose repository is not on GitHub.",
    license: "GPL-3.0-only",
    sourceCode: "https://codeberg.org/fixture/notes",
    icon: INDEX_ICONS.izzy["org.fixture.notes"],
  }),
};

function githubRepo(fullName, extra = {}) {
  return {
    fullName,
    description: `Invented repository ${fullName} for the CI fixture`,
    stars: 120,
    pushedAt: "2026-10-28T00:00:00Z",
    archived: false,
    homepage: null,
    license: null,
    forkOf: null,
    release: { tag: "v1.0.0", publishedAt: "2026-10-30T00:00:00Z", hasApk: true, apkDownloads: 0 },
    head: createHash("sha1").update(fullName).digest("hex"),
    owner: { login: fullName.split("/")[0], organization: true, avatarUrl: null },
    ...extra,
  };
}

const RELEASE_WITH_DOWNLOADS = { tag: "v1.0.0", publishedAt: "2026-10-30T00:00:00Z", hasApk: true, apkDownloads: 4321 };

const GITHUB_REPOS = {
  "fixture-org/fixture-store": githubRepo("fixture-org/fixture-store", { license: "GPL-3.0" }),
  "fixture-org/fixture-keys": githubRepo("fixture-org/fixture-keys", { stars: 2400, license: "Apache-2.0", release: RELEASE_WITH_DOWNLOADS }),
  "fixture-org/fixture-browser": githubRepo("fixture-org/fixture-browser"),
  "fixture-org/fixture-old-notes": githubRepo("fixture-org/fixture-old-notes", { archived: true, release: null }),
  "fixture-org/fixture-weather": githubRepo("fixture-org/fixture-weather", { forkOf: "fixture-upstream/weather" }),
  "fixture-org/fixture-eq": githubRepo("fixture-org/fixture-eq", { release: { ...RELEASE_WITH_DOWNLOADS, apkDownloads: 87 } }),
  "fixture-org/fixture-retired": githubRepo("fixture-org/fixture-retired", { archived: true, release: null }),
  "fixture-org/fixture-vendor": { missing: true },
  "fixture-org/fixture-glide-keys": githubRepo("fixture-org/fixture-glide-keys"),
  "fixture-org/fixture-thumb-keys": githubRepo("fixture-org/fixture-thumb-keys"),
  "fixture-org/fixture-patcher": githubRepo("fixture-org/fixture-patcher"),
};

function git(dir, args, date) {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: GIT_IDENTITY.name,
    GIT_AUTHOR_EMAIL: GIT_IDENTITY.email,
    GIT_COMMITTER_NAME: GIT_IDENTITY.name,
    GIT_COMMITTER_EMAIL: GIT_IDENTITY.email,
    GIT_AUTHOR_DATE: date ?? "2025-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: date ?? "2025-01-01T00:00:00Z",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  execFileSync("git", ["-C", dir, ...args], { env, stdio: ["ignore", "ignore", "pipe"] });
}

function writeLines(path, lines) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}`);
}

function repository(dir, history) {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "--quiet", "--initial-branch=master"]);
  for (const step of history) {
    for (const [file, lines] of Object.entries(step.files)) writeLines(join(dir, file), lines);
    git(dir, ["add", "--all"], step.date);
    git(dir, ["commit", "--quiet", "--no-gpg-sign", "-m", step.message], step.date);
  }
  writeFileSync(`${dir}.retrieved`, RETRIEVED);
}

/** Anti-feature definitions in the index's `repo` section; invented wording. */
const ANTI_FEATURES = {
  NonFreeNet: { name: { "en-US": "Fixture Non-Free Network" }, description: { "en-US": "Synthetic definition for CI: relies on a non-free network service." } },
};

function indexFile(path, packages) {
  writeFileSync(path, JSON.stringify({ repo: { timestamp: INDEX_TIMESTAMP, antiFeatures: ANTI_FEATURES }, packages }));
  writeFileSync(`${path}.meta.json`, JSON.stringify({ retrieved: RETRIEVED, etag: null, lastModified: null }));
}

/** Icons an earlier lookup found for apps no index gives one: what `pipeline/icon-discovery.ts` caches. */
const DISCOVERED = (() => {
  const eqHead = GITHUB_REPOS["fixture-org/fixture-eq"].head;
  const launcher = fixtureIcon(192, [140, 60, 200]);
  const site = fixtureIcon(180, [200, 40, 60], [20, 20, 20]);
  const store = fixtureIcon(512, [250, 200, 30], [30, 30, 30]);
  return {
    "github-fixture-org-fixture-eq": {
      basis: JSON.stringify(["fixture-org/fixture-eq", null, null, null, null]),
      candidates: [{ rule: "repo-launcher", url: `https://raw.githubusercontent.com/fixture-org/fixture-eq/${eqHead}/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`, expect: { kind: "git-blob", value: gitBlob(launcher) }, revision: eqHead, allowSvg: false, minPx: 96 }],
      bytes: launcher,
    },
    "awesome-shizuku-fixture-closed-tool": {
      basis: JSON.stringify([null, null, null, "https://example.com/fixture-closed-tool", null]),
      candidates: [{ rule: "site-icon", url: "https://example.com/fixture-apple-touch-icon.png", expect: null, revision: null, allowSvg: true, minPx: 96 }],
      bytes: site,
    },
    "org.fixture.freezer": {
      basis: JSON.stringify([null, null, null, null, "org.fixture.freezer"]),
      candidates: [{ rule: "store-listing", url: "https://play-lh.googleusercontent.com/fixtureFreezerIconForTheSyntheticCiFixture=s512", expect: null, revision: null, allowSvg: false, minPx: 96 }],
      bytes: store,
    },
  };
})();

/** The icon cache: originals keyed as `pipeline/icons.ts` keys them, and the lookups. */
function writeIcons(dir) {
  const originals = join(dir, "originals");
  mkdirSync(originals, { recursive: true });
  const original = (url, bytes) => {
    const key = sha256(Buffer.from(url)).slice(0, 32);
    writeFileSync(join(originals, key), bytes);
    writeFileSync(join(originals, `${key}.retrieved`), RETRIEVED);
  };
  for (const [origin, icons] of Object.entries(INDEX_ICONS)) {
    const base = origin === "fdroid" ? "https://f-droid.org/repo" : "https://apt.izzysoft.de/fdroid/repo";
    for (const icon of Object.values(icons)) original(`${base}${icon.path}`, icon.bytes);
  }
  const entries = {};
  for (const [app, { basis, candidates, bytes }] of Object.entries(DISCOVERED)) {
    entries[app] = { basis, checkedAt: RETRIEVED, misses: 0, candidates };
    original(candidates[0].url, bytes);
  }
  writeFileSync(join(dir, "discovery.json"), JSON.stringify({ version: 3, entries }));
}

const day = (base, offset) => new Date(Date.parse(`${base}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

/** F-Droid's weekly per-server files and IzzyOnDroid's per-day files, as `pipeline/enrich/downloads.ts` caches them. */
function writeDownloads(dir) {
  const fdroid = join(dir, "fdroid-metrics");
  const izzy = join(dir, "izzy-dlstats");
  mkdirSync(fdroid, { recursive: true });
  mkdirSync(izzy, { recursive: true });
  const stamp = (path, text) => {
    writeFileSync(path, text);
    writeFileSync(`${path}.retrieved`, RETRIEVED);
  };
  const weeks = ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"];
  for (const server of ["http02.fdroid.net", "http03.fdroid.net"]) {
    stamp(join(fdroid, `${server}.index.json`), JSON.stringify(weeks.map((w) => `${w}.json`).reverse()));
    for (const week of weeks) {
      const paths = {
        "/repo/org.fixture.store_1.apk": { hits: 350 },
        "/repo/org.fixture.browser_1.apk": { hits: 120 },
        "/repo/index-v2.json": { hits: 9000 },
      };
      stamp(join(fdroid, `${server}.${week}.json`), JSON.stringify({ weekStartDate: `${week}T00:00:00+00:00`, firstProcessedDate: `${week}T00:00:30+00:00`, lastProcessedDate: `${day(week, 6)}T23:59:59+00:00`, hits: 9470, paths, errors: {}, queries: {} }));
    }
  }
  const months = {};
  for (let i = 0; i < 60; i++) {
    const date = day("2026-09-11", i);
    const month = date.slice(0, 7);
    months[month] ??= {};
    months[month][date] = { "org.fixture.keys": 4, "org.fixture.notes": 2 };
  }
  for (const [month, days] of Object.entries(months)) stamp(join(izzy, `${month}.json`), JSON.stringify(days));
}

/** Writes the whole cache into `out`, replacing anything there. */
export function writeUpstreamCache(out) {
  const root = resolve(out);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  repository(
    join(root, "android-foss"),
    ANDROID_FOSS_HISTORY.map((step) => ({ ...step, files: { "README.md": step.readme } })),
  );
  repository(join(root, "awesome-shizuku"), AWESOME_SHIZUKU_HISTORY);
  indexFile(join(root, "fdroid-index-v2.json"), FDROID_PACKAGES);
  indexFile(join(root, "izzy-index-v2.json"), IZZY_PACKAGES);
  writeFileSync(join(root, "github-repos.json"), JSON.stringify({ version: 3, fetchedAt: RETRIEVED, repos: GITHUB_REPOS }));
  writeIcons(join(root, "icons"));
  writeDownloads(join(root, "downloads"));
  const spdx = join(root, "spdx", SPDX_TAG);
  mkdirSync(spdx, { recursive: true });
  for (const id of [...HEADER_LICENSES, ...APP_LICENSES]) {
    writeFileSync(join(spdx, `${id}.txt`), `Placeholder for the ${id} license text in the synthetic CI fixture. Not for publication.\n`);
  }
  return root;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (!values.out) {
    process.stderr.write("usage: node scripts/fixture/upstream-cache.mjs --out <dir>\n");
    process.exit(2);
  }
  process.stdout.write(`${writeUpstreamCache(values.out)}\n`);
}
