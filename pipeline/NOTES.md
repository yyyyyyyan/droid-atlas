# Pipeline notes

`@droid-atlas/pipeline` turns Android FOSS and awesome-shizuku, enriched with
the F-Droid and IzzyOnDroid indexes and GitHub, into the per-origin data files
the app reads. It follows `docs/ARCHITECTURE.md` (§ Pipeline) and
`docs/LICENSING.md` (§1); this file records how to run it, what each stage
does, every judgment call that the documents leave open, and the known gaps.

## Running it

From the repository root, after `pnpm install`:

| Command | What it does |
|---|---|
| `node pipeline/build.ts --bootstrap` | First build: no previous build to compare with |
| `pnpm --filter @droid-atlas/pipeline run build` | Later builds; the previous build is `app/public/data/version.json` |
| `node pipeline/build.ts --offline` | Build from `.cache/` alone; no network |
| `node pipeline/build.ts --previous https://<site>/data/` | Compare with the live site's build (what CI should do) |
| `pnpm --filter @droid-atlas/pipeline test` | Unit tests, and a real offline build when `.cache/` is filled |
| `pnpm --filter @droid-atlas/pipeline typecheck` | `tsc --noEmit`, strict |
| `node pipeline/scripts/read-package.ts <address> [--sha256 <hex>]` | Read one package's manifest by byte range and print the reading; not part of the build |
| `node pipeline/scripts/package-readings.ts --catalog <dir, version.json or URL> --store <file> [--cap <n>]` | The package readings job (ARCHITECTURE § Package readings); `--check <file>` checks a store |

Other options: `--out <dir>` (default `app/public/data`), `--cache <dir>`
(default `.cache`), `--generated-at <iso>` (fixes the only clock-dependent
field, for reproducible output), `--sources android-foss,awesome-shizuku`,
`--no-icons`, `--project-url <url>`, `--project-contact <address>` (named in
`icons.json`'s header as where removal requests go; without it the header names
the issue tracker), `--baseline <file>`, `--icon-policy <file>`,
`--icon-api-budget <n>` and `--icon-web-budget <n>` (icon lookup budgets of the
run; § Icons).

`--previous` reads a build in the current catalog format or in format 1:
`upgradeParts` brings a format-1 build's parts to format 2 before the join, for
what a previous build is read for (ids, redirects, the comparison gates); its
icon records are not carried. Any other format fails with one message naming
it and asking for `--bootstrap`. A bootstrap assigns ids afresh, so it is for a
first build only: measured on 2026-11-12, a bootstrap lineage changed 20 of
1,294 ids that `--previous` with the format-1 build keeps.

Without `--previous` or `--bootstrap` the build uses the output directory's own
`version.json` if there is one, and otherwise refuses rather than guess. Exit
status is 0 only when every gate passed and the files were written.

The GitHub token comes from `GITHUB_TOKEN`, falling back to `gh auth token`.

### Timings (2026-11-12, this workstation, under other load)

| Build | Wall time |
|---|---|
| Offline, from a filled cache | **about 20–30 s**: icons 8–15 s (reading cached originals, encoded files, gate results and fingerprints, and the all-pairs template comparison), index JSON parse 1.5–2.5 s, download figures 1.5 s, emit 1 s |
| Online, cache already filled | about 3–3.5 min: the GitHub GraphQL pass over ~1,170 repositories (about 2 min), icons with a few dozen lookups (about 50 s), download publications (about 7 s) |
| Online, empty icon cache | about 5 min more: the first lookup of the ~500 apps no index gives an icon, and the download of every original |

The real-build test (two offline builds and a rebuild) takes about 1–2 minutes.

## Stages

```
sources/android-foss.ts       README → categories + entries; anomalies; first-seen dates
sources/awesome-shizuku.ts    README + pages/CLOSED_SOURCE.md + pages/ARCHIVED.md, same
enrich/index-v2.ts            F-Droid / IzzyOnDroid index-v2 → per-package records, source-code lookup
enrich/github.ts              GraphQL: stars, push, archived, current name, fork parent, release APK
identity.ts                   entries → apps (identity rules), listings, statements per origin
ids.ts                        permanent ids, redirects, churn
facets.ts                     facets and evidence
taxonomy.ts                   regions, categories, upstream category → category, filing each app (with placements.json)
scripts/taxonomy-doc.ts       docs/TAXONOMY.md from a build
enrich/downloads.ts           F-Droid, IzzyOnDroid and GitHub download figures (§ Download statistics)
icons.ts                      LICENSING §1.3 icon policy: candidates, deny list, gates, templates, files, IconRecords
icon-discovery.ts             icon lookups in repositories, sites and store listings; their cache; Net
icon-sources.ts               pure readers of trees, manifests, READMEs, pages, web manifests, Play listings
android-icon.ts               adaptive launcher icons composed from XML resources
icon-image.ts                 icon gates and the two WebP files
scripts/contact-sheets.ts     labeled grids of a build's icons by rule, for review by eye
lib/spdx.ts                   SPDX expression parser, license gate, license texts
split.ts                      catalog → per-origin parts with license headers
../schema/join.ts             parts → catalog (also used by the app)
validate.ts, schema-check.ts  release gates
emit.ts                       data directory: manifest, parts, shards, snapshots, licenses, version.json
report.ts                     report.json, report.md
build.ts                      orchestration and CLI
apk/http.ts                   byte ranges over HTTPS: allowed hosts, redirects by hand, request, byte and time limits
apk/zip.ts                    zip end record, central directory and one entry, by range
apk/axml.ts                   Android binary XML → element tree, bounded
apk/manifest.ts               element tree → declared interfaces (tiles, Tasker, share, links, actions, Shizuku)
apk/read.ts                   one package address → PackageReading (schema/package-reading.ts)
apk/choose.ts                 which APK of a GitHub release is read
apk/pace.ts                   one second between the starts of two requests to a host
apk/store.ts                  readings kept between runs: load, check entry by entry, save only when whole
apk/job.ts                    the package readings job: plan by rule, cap, lanes per host, prune, counts
apk/cli.ts                    the job as a command: arguments, stages, fixed messages on failure
scripts/read-package.ts       one reading printed, for checking by hand
scripts/package-readings.ts   the job as the package-readings workflow runs it
```

Data flow: each parser produces `SourceEntry` records; `identity.ts` groups
them into `App`s using the indexes and GitHub; icons are decided and license
texts gathered; the in-memory `Catalog` is assembled and hashed; `split.ts`
cuts it into parts; `validate.ts` runs every gate, including
`joinCatalog(parts)` deep-equal to the catalog; only then does `emit.ts` write
anything, `version.json` last.

### Output (`app/public/data/`, git-ignored)

```
version.json                                 the only mutable file, written last
c/<16 hex of hash>/manifest.json             every file: path, role, origin, sha256, bytes, license, attribution
c/<…>/atlas.json                             CC0-1.0: ids, regions, packages, repo, channels, icon, facets, evidence
c/<…>/sources/android-foss.json              GPL-3.0-only: info, categories, listings
c/<…>/sources/awesome-shizuku.json           CC-BY-SA-3.0: same
c/<…>/sources/fdroid.json, izzy.json         LicenseRef-per-record: facts, summary, license per app
c/<…>/sources/github.json                    NOASSERTION: facts; description only where it is the summary
c/<…>/icons.json                             CC0-1.0: one IconRecord per app with an icon (both files, rule, original URL and hash, revision, date, author, license)
c/<…>/details/<fdroid|izzy>/<n>.json         long descriptions, one origin per shard
icons/<16 hex of content sha256>.webp        192 px (App.icon) and 384 px (App.iconLarge) files
upstream/android-foss/<commit>.md            the README the build used
upstream/awesome-shizuku/<commit>/…          README.md and the two pages used
licenses/<SPDX-id>.txt                       every license the manifest or icons.json names
report.json, report.md
```

On each build the previous build's directory and the snapshots it names are
kept (an open client may still be reading them); older ones are removed.
Icons referenced by the previous build are kept too. License texts are never
removed.

## Judgment calls

### Parsing

- **Category ids.** Android FOSS: `<section>-<category>` for categories inside
  a section (`android-foss/apps-keyboard`, `android-foss/games-music`), the
  section alone otherwise (`android-foss/app-store`). awesome-shizuku: the
  category name (`awesome-shizuku/audio`), `vendor-<name>` for `####` vendor
  sub-categories, `closed-` for the closed-source page, `awesome-shizuku/archived`
  for the archive. Built from the heading structure, never from position or
  collisions, so a new upstream category cannot rename an existing one.
- **Closed-source and archived entries are their own categories**, as the list
  keeps them on separate pages, with sections "Closed-source apps" and
  "Closed-source apps › Vendor-specific". Every closed-page entry is tagged
  `closed-source`; every archive entry `archived`.
- **`Proprietary` in the main list means source-available.** The list's own
  rule (CONTRIBUTING.md, Annotations) is that closed-source apps live on the
  separate page, so a `Proprietary` license (or the misspelling `Propietary`,
  `No license`, or a non-free license such as PolyForm-Noncommercial) in the
  main list is tagged `source-available`. On the archive page the list states
  nothing either way, so no openness tag is added there.
- **Tags.** ✨ → recommended; Paid, IAP, Ads, Root as named; any
  `<n>-<unit> trial` → trial. `No Ads` and the 💰 marker are known and carry no
  tag. Any other token is an anomaly (the entry is kept) and is listed in the
  report. The list's own Annotations section is parsed on every build: an
  annotation the parser does not know is an anomaly, and so is one of ours that
  the list stops defining.
- **License strings** are kept verbatim on the listing. A string the classifier
  does not recognize (`Modified MPL-2.0` today) is listed in the report under
  "Unrecognized tokens"; it does not make the app open-source.
- **Descriptions** are reduced from Markdown to plain text (links keep their
  text, emphasis and code markers dropped); links inside a description are kept
  as the listing's `extraLinks`. The license header's statement of changes says
  so.
- **Notes.** `> [!NOTE]` blocks inside a category, and prose directly under a
  category heading before its first entry (the archive page's "All projects in
  this section have been deprecated…"), become `Category.note`. Notes outside
  any category (the page introductions, the "Closed-source apps" and "Unlisted
  apps" pointer sections of the README) are not category notes; they are listed
  in the report as loose notes with their placement.
- **Prose sub-bullets** such as "Mihon/Tachiyomi has several other active
  forks, including [TachiyomiSY](…) and [TachiyomiAZ](…)" are not entries; their
  links become `extraLinks` on the parent listing and the text is a loose note
  in the report.
- **Skipped sections** (recorded with their item counts): the introductions and
  tables of contents, Development libraries, Miscellaneous content (command-line
  utilities, Automate flows), Annotations, License. An unknown `##` section is
  skipped *and* recorded as an anomaly, so new upstream content cannot vanish
  quietly.
- **Resources.** Android FOSS's "Tutorials and Guides" and "Getting more …"
  sections, and any entry linking into a list's own repository, are
  `kind: "resource"`. Android FOSS's "Tools" (desktop APK tools) and "Rooting
  and Recovery" stay apps: they are software, though not all install on a phone.
- **Anomaly file.** Every anomaly carries the upstream file it is on
  (`README.md`, `pages/CLOSED_SOURCE.md`, `pages/ARCHIVED.md`); `text` is the
  line itself. The check that the list still defines our annotations reports
  a missing one as line 0 of `README.md`.
- **Line denominator** for the 1% anomaly gate is every line of every parsed
  file, including skipped sections.
- **First-seen dates** are keyed by the normalized entry URL across the files a
  source uses, so moving an entry between sections or to the archive keeps its
  date. Dates are UTC days.

### Identity

ARCHITECTURE.md § Identity rules 1–9 are implemented as written (rules 5 and
7 started here and were adopted). How each one is applied:

- **Rule 5, store links.** A store link verifies its package unless the index
  names, for that package, a repository on the *same forge* that is unrelated
  to the entry's (not equal after GitHub renames, not a fork of it in either
  direction) *and* that another entry lists. The link's channel is then not
  offered either. Only Android FOSS's "Flow" (LibreTube's IzzyOnDroid page)
  trips it today; it is listed under "Store links not trusted". Cross-forge
  differences are not treated as contradictions, because mirrors (a Codeberg
  project with a GitHub mirror the index names) would otherwise split apps.
- **Rule 6, stale package ids.** A package from an F-Droid or IzzyOnDroid link
  that neither index carries is a stale channel (`listed: false`), not an
  identifier: it is left out of `packages`, of unions, and of the multi-package
  count. Play links cannot be checked against an index and stay identifiers.
  The report lists every stale id ("Package ids no index carries").
- **Rule 7.** Index source-code matching never assigns a package to an entry
  of a multi-package repository; the repository's app count includes the live
  packages other entries link (otherwise Ente Photos' package would attach to
  an entry linking `ente-io/ente` without a package). Only trusted links count:
  a store link rule 5 sets aside does not make the repository multi-package
  (Flow links LibreTube's IzzyOnDroid page and still gets its own
  `io.github.aedev.flow` from its repository).
- **Rule 8, overrides.** `pipeline/identity-overrides.json`:
  `{"same": [pair…], "different": [pair…]}`, a pair being
  `{"a": {"source", "url"}, "b": {"source", "url"}, "reason", "date"}`; entries
  are matched by source and normalized main link. `same` pairs are joined
  first; `different` pairs veto any later join that would put them in one app.
  Every override is listed in the report with the entries it matched; one that
  matches nothing is shown as stale. `packages` entries,
  `{"entry": {"source", "url", "category"?}, "pkg", "reason", "date"}`, declare
  an entry that links no listing to be an index's package; one applies only
  when it names exactly one entry (the category tells apart one link a source
  lists twice) and the package is in an index, and the report lists each with
  the entries it named. Shipped: F-Droid's own client
  (`https://f-droid.org/` under App Store → `org.fdroid.fdroid`), which no
  automatic rule can decide because four F-Droid packages state that site.
- **Rule 9, index matches for entries without a store link** (added
  2026-11-12). An app entry with no store link and no repository the parser
  knows is matched only on what an index itself states, and only when that
  names one app (suffix variants counted with their base):
  - *source code*: a package whose `sourceCode` is the entry's main or source
    link, normalized (a repository on a forge `parseRepo` does not know);
  - *website*: a package whose `webSite` is the entry's main link, when no other
    app states that site, the site is not one that hosts many projects
    (`sharedSite` in `forge.ts`: forges, stores, f-droid.org, document hosts…),
    and the names agree (equal letters and digits, or one is the other plus a
    word such as "app" or "for Android").
  Every candidate, applied or set aside with the reason, is listed in the report
  under "Index matches for entries without a store link". On 2026-11-12 the
  automatic rules found no candidate in the real catalog: entries that link a
  home page link sites no index package states, and BlissLauncher, Collabora
  Office and WireGuard are in neither index. An entry that gains a package keeps
  its id: ids are matched by listing link as well as by package.
- **Rule 3, suffix vocabulary.** `.fdroid .foss .floss .libre .oss .free .play
  .playstore .gplay .reproducible .stable .beta .alpha .nightly .preview .canary
  .edge`. `.lite`, `.plus` and `.dev` are not variants (reduced or paid
  editions, or a legitimate segment). A variant still merges only through the
  same single-app repository; it becomes a channel labeled "F-Droid build",
  "Play Store build", "Beta"…
- **Rule 4, forks.** GitHub's fork parent labels an entry; a fork relation
  never joins two entries by itself (fork and parent are different repository
  keys). A trusted store link does join them (LibChecker: Android FOSS links the
  original author's repository, now a fork of the organization's, together with
  the app's F-Droid page). When an app's entries link several repositories, the
  app's repository is the one the index names, else a non-fork, else the first.
  A fork app with no package of its own gets its id from its repository.
- **Resources never merge**, not even with each other.
- **Order.** Listings within an app: source priority, then `order`, then
  category order, then file and line; this is a refinement of `sortListings` in
  `join.ts` and survives its stable sort.
- **Website**: the index's `webSite`, else a listing link that is neither a
  repository nor a store page, else GitHub's homepage, never equal to the
  repository.
- Equal and near-equal names (lower-cased, punctuation and suffixes like "app",
  "client", "android" removed) that stayed apart are all reported.

### Permanent ids

- Base: the main package id; else `<host>-<slug of owner/name>` from the
  canonical repository; else `<source>-<slug of name>`.
- Matching against the previous build scores package (4), canonical
  repository (3), source + category + URL (2), source + URL (1); pairs are
  assigned greedily by score, then previous id, then the candidate's own key, so
  the result does not depend on input order (tested by reversing the input).
- A new id whose base is taken (by a current id, a previous id or a redirect
  key) or shared by two new apps gets `-<6 hex of sha256(key)>`, the key being
  "source category URL name" of its primary listing. Two new apps with the same
  base both get suffixes; neither wins by position.
- A previous id with no successor redirects to `null`; one whose app merged
  into another redirects to the survivor; older redirects are followed so every
  redirect points at a live id or `null`.
- Churn = (new + retired) / previous apps. With nothing published yet, every
  local build so far is `--bootstrap`.

### Taxonomy

ARCHITECTURE § Taxonomy gives the rules; `taxonomy.ts` holds the table and
the mapping, `placements.json` the apps placed by hand, and
`docs/TAXONOMY.md` (regenerate with `node pipeline/scripts/taxonomy-doc.ts`
after a build) the review page. Identity files each app once its id is known
(`fileApps` in `identity.ts`), so a placement is keyed by the permanent id.

- Adding an upstream category: give it a `MAPPING` entry, or a `catchAll`
  with its home region; until then it lands in its fallback region's
  remainder and the report lists it under "Unmapped upstream categories".
- Placing an app: add `"<app id>": { "category", "reason" }`. The reason
  restates what a source says; a placement whose app is gone shows under
  "Stale placements". The report's "Awaiting placement" is the to-do list.
- `test/taxonomy.test.ts` holds the table's rules and, when
  `app/public/data` has a build, checks it: every upstream category mapped or
  a catch-all, nothing stale, no empty category but a remainder. An app may
  await placement, since upstream adds apps between reviews: it has to be in
  its region's remainder, and `docs/TAXONOMY.md` has to name it and no other.
- A format-2 previous build is upgraded by today's table without placements
  (`upgradeParts`); it is read only for ids, redirects and the gates.

Counts on 2026-11-16 (1,294 entries; a sixth is 216): media 151, work 151,
personal 139, privacy 138, system 108, automation 108, games 101, world 88,
files 87, apps 78, comms 76, device 56, guides 13.

### Facets and evidence

- `paid` is true when any source states `paid` or `trial`. `iap` alone is not
  paid; all statements are in `evidence.pricing`.
- `pricing` evidence: awesome-shizuku's Paid/IAP/trial tags; an untagged
  awesome-shizuku app listing is that list's statement of "free" (its
  contribution rules require the tags); a listed F-Droid or IzzyOnDroid channel
  is that repository's statement of "free".
- `openness` evidence: a closed-source or source-available tag; a free license
  (OSI/FSF list in `lib/licenses.ts`) stated by a listing, an index or GitHub;
  an Android FOSS app listing (the list's scope is FOSS; resources excluded).
  The facet is the most restrictive statement.
- `noInternet` and `noAntiFeatures` are true only when every index carrying the
  app agrees; null without an index.
- `archived` is true when GitHub says archived or the awesome-shizuku archive
  lists the app; false when GitHub says not archived; null otherwise.

### Text and details

- Summary per the rule in `parts.ts`. A GitHub description is written to
  `github.json` only for apps whose summary it is (LICENSING §2.F).
- Long descriptions come from the app's first index only (F-Droid, else
  IzzyOnDroid), so each app has at most one details entry; descriptions over
  4,000 characters are cut at a word and end in "…", which the F-Droid and
  IzzyOnDroid headers' statements of changes describe as an excerpt.
- Details shards: one count shared by both origins, the smallest whose largest
  shard is under 32 kB gzip (budget 40 kB). 16 today.

### Hash, headers, determinism

- The catalog hash covers the catalog without `generatedAt`, the details text
  and the icon records. Part headers are excluded: their `changes` dates follow
  `generatedAt`. A rebuild on a later day from the same inputs therefore has
  the same hash (tested).
- `retrieved` in headers is the time the upstream copy was last confirmed
  current: recorded next to each clone (`.cache/<source>.retrieved`) and each
  index (`*.meta.json`), and the GitHub cache's fetch time. A cache filled
  before these records existed falls back to the file's modification time or
  the HEAD commit time.
- The atlas header's project URL is a placeholder, `https://droid-atlas.invalid/`,
  unless the build is given the project's address with `--project-url`. The
  report flags the placeholder, the app links to its own repository address
  instead of it, and the daily refresh refuses to run a deploy without a
  real `PROJECT_URL` (`scripts/refresh-config.mjs`).
- Header licenses: GPL-3.0-only (Android FOSS), CC-BY-SA-3.0 (awesome-shizuku),
  CC0-1.0 (atlas, icons.json), `LicenseRef-per-record` with an AGPL-3.0-only /
  AGPL-3.0-or-later notice (F-Droid / IzzyOnDroid), `NOASSERTION` (GitHub). The
  attribution and changes wording is in `split.ts`.

### Icons (LICENSING §1.3)

The policy of 2026-11-12: an icon from any reasonable source, self-hosted,
credited exactly, removed on request.

- **Order.** F-Droid's index icon, IzzyOnDroid's; then, for apps with neither,
  the cached lookup's candidates in the order discovery found them: fastlane,
  F-Droid metadata, launcher (the `*-playstore.png` / `ic_launcher-web.png`
  beside the sources, then bitmaps of the manifest's icon resource, then a
  composed adaptive icon), README logo, then — only when the repository gave no
  file — the website's icons and the Play listing's, and last a forge avatar
  that is the project's own. The first candidate that passes every check wins.
- **Repository.** The repository discovery reads is the one the app's GitHub
  facts come from, under its current name (`IdentityResult.githubRepos`), so a
  renamed repository is found; GitLab.com and Codeberg by their slug. One
  recursive tree listing per repository at the default branch's head.
- **Launcher module.** Every `src/<set>/AndroidManifest.xml` outside test,
  debug and sample code (eight at most, `main` first) is read; the module whose
  manifest declares the LAUNCHER category is used, with the
  `<application android:icon>` of its first manifest that names one, else
  `ic_launcher`. Bitmaps rank by density (`nodpi` with the densest; a directory
  without a density qualifier below every density), `main` before flavors,
  round variants last.
- **Composed adaptive icons.** When the module has the icon only as XML, the
  `<adaptive-icon>`'s background and foreground (a color, a VectorDrawable, a
  bitmap, an `<inset>` or `<bitmap>` of those, or a rectangle `<shape>` filled
  with a `<solid>` color or a linear `<gradient>` at a multiple of 45°) are
  drawn on the 108 dp canvas at 4 px/dp and the visible 72 dp are cut out
  (288 px). Colors resolve through `@color/…` in the module's
  `res/values/*.xml` (six files at most) and three `@android:color/` values;
  anything else (theme attributes, color state lists, tints other than a literal color in `src_in` mode, trimmed paths,
  sweep or radial shape gradients, rounded or stroked shapes, other drawable
  types) makes the icon unavailable rather than drawn wrong. Discovery composes
  once to know it can; the image stage composes again from the listed files,
  each checked against its blob id.
- **Websites.** The page's web manifest icons (96 px or more, `any` before
  `maskable`), `apple-touch-icon`, a `rel=icon` declared at 96 px or more or
  SVG, and last a PNG, WebP or JPEG `rel=icon` that declares no size (the gate
  measures it); never `.ico`. A website given as `http://` is read over
  `https://`. Sites that host many projects give nothing (`sharedSite` in
  `forge.ts`), nor does a page that names forge software in `og:site_name`,
  `application-name` or `generator`.
- **Templates.** After choosing, every chosen image is reduced to a 16 × 16
  color thumbnail on white; images within a mean difference of 3 (out of 255)
  are the same image. One shared by apps of three or more projects (forks
  counted with the repository they were forked from, `projectOf`) is a
  template — Android Studio's or Flutter's default launcher icon — and is
  refused for all of them; each then tries its next candidate (three rounds).
  A launcher candidate refused as a template takes the app's other launcher
  candidates with it: they are the same resource at another density or its
  round variant. On 2026-11-12 this refused the launcher icons of 21 apps
  (Android Studio's default, and Flutter's in three Flutter projects) and one
  index icon (Captive Portal Controller's, Android Studio's default).
- **Gates.** `icon-image.ts`: PNG, WebP, JPEG or GIF by their magic bytes, or
  SVG from READMEs and websites only, refused if it has an entity, an internal
  DTD subset, a script or event handler, a foreign object, an embedded image or
  any reference outside the file. Decoding capped at 4096² pixels, originals at
  8 MB. Short side at least 96 px except index icons; square within 5 %
  (index icons 35 %: the index chose them) and then padded; not blank, where a
  single color with a transparency shape (a glyph) is not blank.
- **Files.** 192 px always; 384 px when the original's short side is at least
  288 px (or it is SVG), else the 192 px file serves both. WebP effort 6,
  quality 82 (alpha 90), stepping down 72, 62, 52, 42 until the file fits 16 kB
  (list) or 48 kB (large). Measured on the 2026-11-12 build (1,199 icons, 892
  with a separate large file): list files p50 2.5 kB, p90 6.3 kB, largest
  13.1 kB, 3.8 MB in all; large files p50 4.3 kB, p90 11.0 kB, largest 36.6 kB,
  6.5 MB in all. No file needed a lower quality step.
- **Integrity.** Index icons against the index's SHA-256; repository files
  (and every part of a composed icon) against the blob id the forge's tree
  lists at the commit; websites, store listings and avatars state no hash.
- **Records.** `IconRecord` in `schema/parts.ts`. `author`: the index's
  `authorName`, else "the <owner/name> project", else "the <app> developers".
  `license`: the app's license as the catalog states it (`App.license`), else
  "not stated". `project`: the repository, else the website. `revision`: the
  index timestamp or the commit. The texts of the SPDX licenses records name
  are shipped where the SPDX list has them (`listedLicenseIds`); a record's
  license needs no text.
- **Deny list.** `pipeline/icon-policy.json`: `deny` (`app` or `package`,
  `reason`, `date`) and `denySources` (`rule` or `host`, `reason`, `date`).
  Shipped with two entries from the contact-sheet review: the Shizuku forks
  `github-thedjchi-shizuku` and `github-thejaustin-shizukuplus`, whose
  repositories' launcher icon is Shizuku's own, which Shizuku's README reserves
  for Shizuku itself; and CallVault, a fork of ShizuCallRecorder whose launcher
  icon is ShizuCallRecorder's logo, which that project's GPLv3 section 7
  additional terms forbid using without its author's written permission. The
  standard: a fork's icon is withheld only when the upstream explicitly
  reserves its art; otherwise a fork that kept its parent's icon shows it, as
  its own source does.
- **Shared images.** After the template pass, an image that apps of two or more
  projects show is set aside for any app that has it from a rule other than an
  index, when that app has another candidate no other project shows (a copied
  metadata directory, as HyperOSUnfcker's holds Canta's icon). Store metadata
  (`fastlane/`, `metadata/`) counts only at the repository root or at an
  ancestor of the launchable module, so another project kept in the
  repository (OmniBot's vendored ReTerminal) gives nothing.
- **Reviewed sources.** `sources` in the same file (`ReviewedSource`): for an
  app, a rule, the exact URL, the SHA-256 of the file as reviewed, the commit for
  a repository file, a reason and a date. Tried after the index icons and before
  discovery's candidates, through every gate; bytes that differ from the
  reviewed hash are refused, so a changed upstream file needs a new review. The
  icon audit accepts a credit whose original is a reviewed source with the same
  rule and hash. On 2026-11-13 twelve were added for prominent apps no rule could
  reach: WireGuard, Krita, Eden and DroidFish from their repositories or official
  mirrors, GSplit and Rayshift Translate from repository paths discovery does not
  read, Tor Browser, Collabora Office, aard2, ObscuraCam and TWRP from their
  publishers' own Play listings, and BlissLauncher's project avatar. Ghost
  Commander (SourceForge, no store listing, no icon in F-Droid's index), MiXplorer,
  MT Manager and Universal Android Debloater were looked for and have no source
  that could be verified.
- **Previous build.** `loadPrevious` also returns the previous `icons.json`
  and, for a local build in the current format, its data directory. An app that
  gets no icon in this run keeps the previous one — files copied from the
  previous build, record kept — unless it is denied now, its rule or host is
  vetoed, or its original was refused by a check in this run. In CI the mirror
  step provides the previous build's files, so it must keep both sizes.
- **Review by eye.** `node pipeline/scripts/contact-sheets.ts --data <dir>
  --out <dir outside the repository> [--rules …] [--apps <file of ids>]`. On
  2026-11-12 every icon from a rule other than the indexes, every index icon
  the old license gates had withheld, and every icon new in the release build
  (465 in all) was inspected on 19 sheets;
  three were removed (the two Shizuku forks above, and Android Studio's default
  round icon, which led to the template rule for other densities).

- **Coverage** on the build of 2026-11-13: 1,215 of 1,281 apps (94.8 %) and 3
  of 13 guides and links. By rule: F-Droid index 694, IzzyOnDroid index 84,
  fastlane 61, metadata 7, launcher 303, README logo 4, site 12, store listing
  49, forge avatar 4 (twelve of these from reviewed sources). The 66 apps
  without one, each with its reason, are in the report; most link a repository
  with no usable icon (26), use a default template icon (22), or link only a
  website or a forge the lookup cannot read.

#### Lookups, caching and the request budget

- **Cache.** `.cache/icons/discovery.json` (version 3): per app id, the basis
  (repository, website, Play package), when it was looked up, consecutive
  misses, the version of the discovery rules (`DISCOVERY_RULES`) and the
  candidates. Originals are cached by URL in `.cache/icons/originals/` (with a
  `.retrieved` date); in `.cache/icons/encoded/`, the encoded files by the
  original's SHA-256, the gate result by original and gate options, and the
  template fingerprint by file. On 2026-11-12: originals 65 MB, encoded 19 MB.
- **Who is looked up.** Apps with no index icon, when: new; their basis
  changed; they had no candidate and the back-off passed (7, 14, 28, then 56
  days) or their last lookup ran under older discovery rules; or they have
  candidates and today is their slot in a 28-day rotation (FNV-1a of the id).
  New apps first, then changed, misses, rotation. Raising `DISCOVERY_RULES`
  when a rule starts finding icons it missed re-tries the misses on the next
  run without re-reading the hits.
- **Budget.** Per run, 400 GitHub REST requests (one recursive tree listing per
  GitHub repository; the GraphQL pass already returns each repository's head
  commit and owner at no extra cost) and 2,500 other requests (raw files,
  GitLab and Codeberg APIs, web pages, Play listings, originals).
  `--icon-api-budget` and `--icon-web-budget` change them. When a budget is
  spent or a host answers 429 (or GitHub 403 with no requests left), the
  remaining lookups are left for a later run and the cached entries stand.
  Measured: the first lookup of 517 apps used the whole 400-request API budget
  and 1,927 other requests, leaving 35 for the next run. A normal daily run
  looks up the new apps, the misses whose back-off ended, and about one in 28 of
  the ~520 apps with candidates (about 19): roughly 20–40 lookups, 20–40 GitHub
  API requests and 100–250 others.
- **Never fails the build.** Lookup and download errors are reported (“Lookup
  error”, “Downloads that failed”) and leave the old entry and the previous
  build's icon in place.
- **Safety.** Only `https` URLs with a DNS name, the default port and no
  credentials are fetched, on every redirect hop (`fetchableUrl`, a trailing
  dot ignored), and only when every address the name resolves to is public
  (`privateAddress`: loopback, RFC 1918, unique-local, link-local, CGNAT and
  IPv4-mapped forms are refused). The connection resolves the name again, so a
  name that answers differently between the two lookups is not caught; pinning
  the connection would need `undici` as a dependency; repository
  paths with `..`, empty segments or control characters are ignored
  (`safeRepoPath`); responses are read to a byte limit (1 MB for text, 8 MB for
  images).
- **GitLab** files are read through its API (`/repository/files/…/raw`): the
  `/-/raw/` paths answer automated requests with 403. gitlab.com rate-limits
  bursts and answers an occasional 429 even to a first request; its requests
  are spaced 400 ms apart. Any host's first 429 in a run is waited out once
  (`Retry-After` up to 30 s, else 5 s); a second defers the rest of that host's
  lookups to the next run.

### Download statistics

`enrich/downloads.ts`. What each figure counts is `DOWNLOAD_MEANING` in
`schema/catalog.ts`; sources and terms are in LICENSING §2.J.

- **F-Droid**: `https://fdroid.gitlab.io/metrics/<server>/index.json` and the
  weekly files it lists, for `http01`–`http04.fdroid.net` (F-Droid's front-end
  download servers; `originserver` and `fdroid.link` are mirror
  synchronization and redirects, not downloads). A week counts when its
  processed logs span at least 5.5 days; the figure is the sum, over the latest
  four weeks every server active in the last year covers completely, of the
  hits on `/repo/<pkg>_<code>.apk` and `/archive/<pkg>_<code>.apk`. The period
  is the first to the last processed day. Each index and the newest week are
  fetched on every online build, and a cached week is fetched again until it is
  complete, so a week cached while partial is filled in once newer weeks
  appear. Files of weeks no longer read are deleted.
- **F-Droid's publication has stalled.** Its weekly scheduled job
  (`fdroid/metrics` on GitLab) has failed every week since 2026-09-07; on
  2026-11-12 the newest complete week is 17–23 August 2026 and the figure covers
  28 July to 23 August, 82 days before the build of 2026-11-13. `DownloadSource.newest` carries
  the last day counted; the report shows each origin's age and adds a "Stale"
  note past 120 days (`STALE_FIGURES_DAYS`). Newer weeks are used as soon as
  they are published.
- **IzzyOnDroid**: `…/stats/basic/monthly-in-days/<YYYY-MM>.json` for the
  build's month and the two before; the figure is the sum over the 30 days
  ending on the last day published (refused when more than two of them are
  missing). The month two back is cached for good; the two newer ones are
  fetched on every online build.
- **GitHub**: the `downloadCount` of the latest release's `.apk` assets, from
  the same GraphQL query as the other facts (no extra request); the period is
  the release's publication day to the fetch day.
- A figure is attached to the app's package in the index (`IndexFacts.pkg`),
  and only when it is at least 1. A source that cannot be reached leaves its
  cached files in use, or no figures; it never fails the build.
- Coverage on the build of 2026-11-13: F-Droid 539 of 728 apps it lists (74 %;
  F-Droid omits files under 100 hits a week on a server), IzzyOnDroid 277 of
  277, GitHub 959 of 960 apps whose latest release has an APK.

### SPDX license list

`pipeline/spdx/licenses.json` holds the ids and the OSI, FSF-libre and
deprecated flags of SPDX License List **3.29.0** (2026-09-16) and its exception
ids, read from `spdx/license-list-data` at tag `v3.29.0` through the GitHub
GraphQL API by `scripts/vendor-spdx.ts`. The SPDX License List data is
published under **CC0-1.0** (https://github.com/spdx/license-list-data). The npm
package `spdx-license-list` was not used: it carries list 3.28.0 and no
FSF-libre flag. License *texts* are fetched the same way (`text/<id>.txt` at the
same tag) when first needed and cached in `.cache/spdx/v3.29.0/`; an offline
build uses the cache. Deprecated ids map to `-only`, or `-or-later` with `+`.

### Validation

Hard gates (cannot be accepted): schema shape including the strict package and
slug patterns, invariants, enrichment failures, the round trip, icon records,
header license texts. Comparison gates (acceptable for one exact value in
`accepted-baseline.json`): anomalies per source, entries per source, listings
per category of ten or more (a fall past 5 % and past three listings), coverage of summary / index / GitHub / icon among
installable apps, id churn. Measurements are rounded (counts exact, coverage to
0.1 point, churn to 0.01 %) so a baseline entry can name them exactly; a
further drop needs a new entry. Format:
`{"accepted": [{"gate": "entries:android-foss", "value": 760, "date": "…", "reason": "…"}]}`.

### Network

The two list repositories (git), the two `index-v2.json` URLs (conditional
requests), the GitHub GraphQL API (repository facts, release asset download
counts, head commits and owners, and `spdx/license-list-data` for license
metadata and texts), F-Droid's metrics pages on `fdroid.gitlab.io` and
IzzyOnDroid's `dlstats.izzyondroid.org`, and for icons: the index icon paths
inside `https://f-droid.org/repo/` and `https://apt.izzysoft.de/fdroid/repo/`,
the GitHub REST API (tree listings), `raw.githubusercontent.com`, the GitLab.com
and Codeberg APIs, and the websites and Play listings entries link, under the
icon budgets and URL rules of § Icons. Requests carry a generic user agent and
nothing about the machine or user. Index, list and GitHub fetches retry with
backoff (4 tries, 2 s doubling) before failing the build; icon lookups and
download publications never fail it. Online builds re-query GitHub for every
repository so stars, activity and release downloads stay current.

Package readings (`apk/`) are not part of the build. A reading requests
`f-droid.org/repo/` (or `/archive/`) and GitHub release download addresses,
and follows redirects to `objects.githubusercontent.com` and
`release-assets.githubusercontent.com` only: one request at a time, at most
10 a reading, every one a ranged `GET` with an explicit range. The job adds
the live site's catalog, read as `--previous` reads it, and the GitHub REST
API's latest release of a repository (`/repos/<owner>/<name>/releases/latest`)
for apps read from a GitHub release, paced like the rest.

### Repository hygiene

- Tests use synthetic index fixtures (`test/fixtures.ts`, invented packages).
  Parser fixtures are short invented lines in the lists' formats.
- The root `pnpm-lock.yaml` is the coordinator's (committed on next); versions
  are also pinned exactly in `package.json`.

## Known gaps

- **IzzyOnDroid mirrors** are not used for the 14 MB index (LICENSING §2.D
  suggests it); mirrors are other hosts, outside the brief's network list.
- **Renames on GitLab, Codeberg and sourcehut are not followed**; only GitHub
  reports them. Two entries linking old and new names there stay apart.
- **Same app under two live package ids in one repository** (neither a suffix
  variant nor stale) stays two apps by rule 2; such pairs appear under
  non-merges and multi-package repositories, and an override can join them.
- **Sub-directory links** (`/tree/main/app`) and document links are not treated
  as repositories, so such entries get no repository identity.
- **Icon license** is the app's project license as a source states it, not
  necessarily the icon's own; the residual risk is in LICENSING §1.3.
- **Apps without an icon** are listed with the reason in the report ("Without an
  icon"). The main groups: repositories that ship only an adaptive icon the
  composer refuses (theme attributes, theme-colored tints, round shapes) or no Android code at
  all (desktop tools, Magisk modules, documentation repositories); entries whose
  only link is a forge the discovery does not read (self-hosted GitLab, cgit,
  SourceForge) or a forum or store page; Android Studio's and Flutter's default
  icons, refused as templates; and 375 F-Droid packages that list no icon in
  `index-v2` (Krita and Ghost Commander among ours): the index states no icon
  file and no hash for them.
- **Site icons and store listings are not re-checked for changes** once their
  original is cached: they state no hash, and the cache is keyed by URL. The
  rotation re-reads the page, so a changed icon URL is picked up; a changed
  image at the same URL is not.
- **F-Droid figures are as old as F-Droid's last published week** (see
  § Download statistics); IzzyOnDroid's run about five days behind.
- **Upstream errors** found while building: Android FOSS's Flow entry links
  LibreTube's IzzyOnDroid page. Worth reporting upstream.
- The conditional-download and git-sync paths have no automated test (they
  need the network); both ran on real builds.
