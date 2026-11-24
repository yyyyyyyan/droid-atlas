# Architecture

How Droid Atlas is built and the rules its parts follow. Reasons are given
where a rule is not obvious.

## Shape

A static site. A build-time pipeline turns upstream catalogs into JSON and
icons; a client-side app reads them. There is no server, and the app makes no
request to any third party unless the user taps a link.

```
schema/      the catalog contract (TypeScript), imported by both sides
pipeline/    sources → enrichment → identity → validate → emit    (Node, TypeScript)
app/         the PWA                                              (Preact, TypeScript, Vite)
tests/e2e/   user-journey tests against the built app             (Playwright)
scripts/     release tooling: site assembly, the daily refresh's helpers, the public export
docs/        this document, licensing, release, the copy standard, the taxonomy
```

## Tooling

| Choice | Why |
|---|---|
| TypeScript everywhere, strict | One catalog contract checked on both sides |
| Pipeline runs as `.ts` under Node's built-in type stripping | No build step for the pipeline; erasable syntax only |
| Preact + `@preact/signals` | A component model for a dozen views at ~5 kB; signals keep list filtering off the render path |
| Vite, one JavaScript bundle, no code splitting | A daily deploy replaces hashed files; a client holding yesterday's shell must never need a chunk that no longer exists |
| Hand-written router on the History API | Navigation rules are the product's hardest requirement and must be explicit and testable, not a library's defaults |
| Hand-written service worker | Few rules, and they must be exactly right |
| Vitest, Playwright, axe-core | Units; navigation journeys at 384×688; accessibility checks inside the journeys |
| `sharp` (pipeline only) | Icon thumbnails |
| pnpm | Strict, fast, single lockfile |

No CSS framework, no component library, no state library, no router library.
Fonts are self-hosted. Add a dependency only with a stated reason in the commit
that adds it.

## Pipeline

```
sources/android-foss.ts      clone, parse README, first-seen dates from git history
sources/awesome-shizuku.ts   clone, parse README + closed-source + archived pages
enrich/fdroid.ts, izzy.ts    index-v2 lookups by package id and by source-code URL
enrich/github.ts             GraphQL: stars, activity, archived, moved, fork parent, release assets
identity.ts                  one App per real app, many Listings; permanent ids
taxonomy.ts                  regions, categories, upstream category → category, filing each app
placements.json              apps placed by hand, each with a reason
icons.ts                     find, fetch and credit icons; 192 and 384 px WebP (LICENSING.md §1.3)
validate.ts                  schema, invariants, comparison with the previous good catalog
emit.ts                      content-addressed data directory and version.json
apk/                         package readings by byte range, and their job, outside the build (§ Package readings)
```

### Identity

Two listings are the same app only on a verified identifier. Names never merge
entries.

1. **The package id is the primary key.** A package id is verified when a
   source links a store listing containing it (F-Droid, IzzyOnDroid, Play
   `details?id=`), or when exactly one index entry's `sourceCode` equals the
   app's canonical repository.
2. **A repository identifies an app only when it ships one app.** Any
   repository that carries two or more distinct packages in any index, or is
   linked by entries with different verified packages, is multi-package and is
   never merged on (Ente Photos and Ente Auth share `ente-io/ente`; Tutanota
   and its Calendar share `tutao/tutanota`).
3. **Suffix variants** (`.fdroid`, `.foss`, `.libre`, `.beta`…) merge with the
   bare id only when the canonical repository is also the same and single-app.
   The variant becomes a `Channel` with `variant` set. A suffix alone proves
   nothing (`com.machiav3lli.fdroid` is Neo Store).
4. **Forks are separate apps**, even when they keep the upstream package id.
   GitHub's fork parent labels them; a fork relation alone never merges them.
5. **A store link is the source's own statement of identity**, and is trusted
   when the entry's repository is the repository the index names, a rename of
   it, or a fork of it in either direction. When the index names an unrelated
   repository that another entry lists, the link is treated as an upstream
   mistake: it identifies nothing and its channel is not offered (Android
   FOSS's "Flow" links LibreTube's page).
6. **A package id no index carries any more is not an identifier.** It stays on
   the app as a stale channel, but it neither makes a repository multi-package
   nor keeps two entries apart (Canta changed its package id; one catalog still
   links the old one).
7. Index `sourceCode` matching is not used to assign a package to an entry of
   a multi-package repository.
8. `pipeline/identity-overrides.json` holds the few cases no rule can decide:
   pairs declared the same app or different apps, each with a reason. It
   overrides every rule and is listed in the build report.
9. Entries that are not installable apps (guides, sites, further reading, the
   list's own repository) are listings of `kind: "resource"`.

The build report lists every merge with the identifier that justified it and
every pair of like-named entries that was not merged, so both can be reviewed.

### Taxonomy

Droid Atlas owns its whole taxonomy, regions and categories both. The
sources' categories are input to it and stay with each listing as facts.
`docs/TAXONOMY.md` is the review page, generated from a build.

- **Categories.** `pipeline/taxonomy.ts` defines every category the app
  shows: a slug id that changes only with its name, a US English name by the
  rule in `COPY.md`, and its region. A region a catch-all or a fallback leads to has one **remainder**
  ("Other …"), which holds what nobody has placed yet. A category that holds
  no app in a build appears nowhere in the app.
- **Mapping.** Every upstream category maps to exactly one category, or is a
  **catch-all** ("Utilities", "Miscellaneous", "Productivity", "Archived
  apps"…) whose apps are placed one by one. The mapping is keyed by the
  sources' category ids.
- **Placements.** `pipeline/placements.json` places single apps by id, each
  with a one-line reason that follows plainly from what the sources say about
  the app: every app listed only in catch-alls, and an app that the mapping
  plainly puts where nobody would look for it. A placement never changes a
  fact.
- **One category per app.** A placement wins; otherwise the first listing, by
  source priority then position, whose upstream category is not a catch-all
  decides. An app's region is its category's, so counts add up.
- **The daily build never fails on the taxonomy.** An unmapped upstream
  category falls back to its source's fallback region's remainder; an app
  arriving in a catch-all with no placement waits in its region's remainder;
  a placement whose app is gone is stale. The build report lists each, with
  the whole table, mapping and placements and their counts.

Regions are sized to be browsable: no region should hold more than about a
sixth of the catalog.

| Id | Name | Holds |
|---|---|---|
| `system` | System & Tweaks | battery and power, display, quick settings, monitors and task managers, Shizuku and its alternatives, rooting |
| `apps` | Apps & Installers | app stores and updaters, installers, app managers, patching, backup |
| `files` | Files & Sync | file managers, file tools, sharing and PC links, cloud and sync, downloaders |
| `automation` | Automation & Dev Tools | automation, AI agents, developer and APK tools, terminals and Linux, remote access, smart home and wearables |
| `device` | Device-specific | apps for one maker's devices (Samsung, Pixel, Xiaomi, Nothing) or one kind (gaming handhelds, e-ink tablets) |
| `privacy` | Privacy, Security & Network | privacy tools, passwords, VPNs, firewalls, ad blocking, link tools, network tools, profiles and device owner, safety |
| `personal` | Personalization | interface tweaks, launchers, keyboards, buttons and controllers, wallpapers, icon packs |
| `comms` | Communication | messaging, mail, social clients, phone and contacts |
| `media` | Media | music, audio, video, images, cameras, front-ends, recorders, Android TV |
| `work` | Productivity | notes, readers, documents, planners, habits, calendars, finance, focus, clipboard, bookmarks, study |
| `world` | Web & World | browsers, maps, weather, transport, science, health, Android Auto |
| `games` | Games | games by genre, emulators, game tools |
| `guides` | Guides & Further Reading | resources that are not apps |

Each listing keeps its source's own name, description, tags and category. The
app shows the source's category only where it shows the source, in the app
sheet's sources block, quoted in the source's own spelling.

### Permanent ids

An app's id is assigned once. The pipeline reads the previous good catalog,
matches each new app to a previous one by any of its keys (package ids,
canonical repository, source + listing URL), and reuses that id. A new app gets
an id from its package id, else its repository, else a slug of its first
listing, made unique by a short hash of its key rather than by list position.
When an id must be retired (a merge, a split, a removal) the old id is written
to `Catalog.redirects`, pointing at its successor or at null. The app resolves
saved apps, deep links and its last place through `redirects`. The share of ids
that are new or retired in one build is a validation gate.

### Completeness and untrusted input

Every upstream line is an entry, a heading, a separator, a note, a section the
parser deliberately skips (recorded in the report), or a recorded anomaly.
Anomalies are carried into the catalog and shown in the app's data-health view.

Upstream text is data. URLs are kept only when they parse as `http:` or
`https:`. Package ids and repository slugs are validated against the strict
patterns in the schema before anything is built from them, because they are
later embedded in `intent:` URLs where `#`, `;` and `end` are syntax. Nothing
upstream is executed or interpolated into markup, a shell command or a path.

### Evidence levels

Every fact has two marks: who says so (`Origin` in `schema/catalog.ts`) and
how it is known (`EvidenceLevel`). The four levels stay apart everywhere:

- **Documented**: the app's own project says so.
- **Statically discovered**: a tool read it from the app's package or source,
  without running the app.
- **Reported**: someone other than the project says so.
- **Experimentally verified**: the app was run and the result observed.

The facts the catalog carries today map to them as follows. Their data does
not yet carry the level; the mapping is by kind of fact.

| Fact | Who says so | Level |
|---|---|---|
| An entry's name, link, description and tags (paid, root, closed source, archived), and the list's category | Android FOSS, awesome-shizuku | Reported |
| Listed as a Shizuku app | awesome-shizuku | Reported |
| Summary and description | F-Droid, IzzyOnDroid (the app's own text) | Documented |
| Repository description | GitHub (the project's own text) | Documented |
| License stated by an index or a list | F-Droid, IzzyOnDroid, a list | Reported |
| License detected in the repository | GitHub | Statically discovered |
| Anti-features | F-Droid, IzzyOnDroid | Reported |
| Version, SDK levels, file size, permissions, requests Shizuku's permission, requests internet access | F-Droid, IzzyOnDroid (their tools read the package) | Statically discovered |
| Author, and the dates the index added and updated the app | F-Droid, IzzyOnDroid | Reported |
| Repository archived, latest release and whether it carries an APK | GitHub (the project's own act) | Documented |
| Stars, last push, fork parent, new address | GitHub | Reported |
| Download figures | F-Droid, IzzyOnDroid, GitHub | Reported |
| A package reading's interfaces (§ Package readings) | The package | Statically discovered |

No fact in the catalog is experimentally verified. A facet that combines
statements keeps the level of each: the Shizuku evidence of one app can hold
a reported statement (a list names it) and a statically discovered one (an
index read the permission from its package).

### Package readings

`pipeline/apk/` reads what one version of a package declares in its manifest,
without downloading the whole file and without running anything. The result
is a `PackageReading` (`schema/package-reading.ts`), whose evidence level is
always statically discovered. It names the package's address, file name,
size and the hash its index or release states, the version, the date, and the
hash of the manifest bytes that were read.

- **What it reads.** Quick Settings tiles, Tasker (Locale) plug-in
  components, share targets and the content types they name, link schemes and
  hosts, the app's own actions other apps may call, and Shizuku's permission
  and provider (every provider name and permission element the Shizuku API
  has used). Each comes with its component's `exported`, `enabled` and
  guarding permission exactly as written. Nothing is inferred from defaults,
  and nothing counts or lists components by whether a permission guards them.
- **As Android reads it.** Elements count only where Android looks for them,
  and framework attributes are found by resource id alone: an attribute the
  file's resource map does not cover is invisible to Android and is not read.
- **What it does not read.** The resource table, so no labels. A value that
  is a resource reference is recorded as not read, with the reference.
  Receivers registered at run time, dynamic shortcuts and the extras an
  action needs are not in a manifest at all. A declaration says an interface
  exists in that version; it says nothing about whether it works.
- **By byte range.** The first request asks for four bytes, which gives the
  file's size and shows it starts like a zip. Then the last 4 KiB, which hold
  the zip's end record unless the file carries a long comment (then up to the
  last 64 KiB). Then the central directory, which must end where the end
  record starts and is read at its stated size, and last the manifest entry,
  found by the bytes of its name. Every range is explicit, since GitHub's
  file host refuses a request for "the last N bytes". Measured on six
  packages: three to five requests and 65 to 101 kB a reading, most of it the
  central directory.
- **Hosts.** Only F-Droid's repository and archive addresses
  (`https://f-droid.org/repo/…`, `…/archive/…`) and GitHub release download
  addresses are accepted, in the exact form the URL parser gives them.
  Redirects are followed by hand: an F-Droid address may lead only to
  `f-droid.org`, a GitHub address only to GitHub's release file hosts. Requests carry the pipeline's user agent,
  `droid-atlas-pipeline`.
- **Untrusted bytes.** Every size, count and offset is bounded and checked:
  requests, bytes received and file size per reading (a range longer than
  what is left of the byte budget is not requested), per-request and
  whole-reading time limits, central directory size and entry count,
  compressed and inflated manifest size, string count and length, characters
  decoded over the whole manifest, element count, attributes per element and
  nesting depth. Zip64, split archives, encryption, compression other than
  deflate, a duplicated manifest entry, a local header naming another entry
  and a manifest failing its CRC-32 are refused. Kept values must match the
  pattern of their kind (package id, class name, scheme, host, content type,
  version name, or printable ASCII for actions and permissions); anything else
  is recorded as not read. Every failure is a `PackageReadError` naming its
  stage, and messages carry no raw server text.
- **By hand.** `node pipeline/scripts/read-package.ts <address> [--sha256
  <hex>]` prints one reading.

#### The package readings job

`.github/workflows/package-readings.yml` runs `pipeline/scripts/package-readings.ts`
(`pipeline/apk/cli.ts`, `pipeline/apk/job.ts`). It is not part of the daily
refresh and the catalog build reads nothing it writes, so it can neither fail
nor delay a catalog.

- **What it reads.** For each app of the live catalog: the latest version the
  F-Droid index lists, from the upstream cache the refresh keeps; else the APK
  of the latest GitHub release (as GitHub's REST API names it) that this rule
  picks: of the `.apk` assets, leave out any whose name contains "debug",
  take those whose name names no processor architecture and of them the
  largest, ties broken by name; when every APK names one, the arm64 ones the
  same way. A release tag may contain "/", which GitHub writes into the
  download address as it is. A file read before, by its SHA-256 or, when
  GitHub states none, its address, size and change time, is not read again.
  An asset whose size as served differs from the size GitHub states is not
  read.
- **What it skips.** Guides and other entries that are not apps; apps whose
  openness facet is not "open-source" (closed source, source available, or
  stated by no source); apps whose only package is on IzzyOnDroid; apps with
  no package file to read; a release with no APK the rule accepts, for 7 days
  after it was looked up; packages that failed in the last 7 days. The
  openness rule has a switch, `PACKAGE_READINGS_CLOSED`, off unless set
  (`RELEASE.md` §3). `PACKAGE_READINGS_IZZY` alone reads nothing: the reader
  has no host rule for IzzyOnDroid, so with it on an IzzyOnDroid package is
  still skipped, under its own rule name.
- **Pace.** At most 200 packages a scheduled run (20 by default when run by
  hand), one request at a time to each host and one second at least between
  the starts of two requests to the same host. No package is started after 40
  minutes; the job stops at 60. When GitHub's API answers two lookups in a row
  with a rate limit, a server error or no answer, no more GitHub releases are
  looked up in that run and nothing is recorded for them.
- **Size.** A manifest with more than 256 entries in one interface list, or
  more than 256 content types, schemes or hosts in one entry, is refused, and
  so is a reading over 256 KB as JSON.
- **Where results are kept.** One file, `readings.json`, in the Actions cache
  (key `package-readings-<run>-<attempt>`), restored at the start of a run
  and saved at its end only when the whole file passes its check. It is
  written through a temporary file outside the cached directory. A missing or
  unreadable file starts the store empty; an entry that fails the check, or a
  failure record dated in the future, is dropped and the rest are kept. A
  reading that would fail the check is not kept and is counted as
  "not-stored". An app keeps its last reading until a newer file of it is
  read, and loses it when it is no longer an app the job reads.
- **What it reports.** The run's summary states counts only: read, skipped
  (one count per rule), failed (one count per kind), carried over and
  dropped. A run that stops prints the stage it stopped at and the class of
  the error, nothing taken from its input. It opens no issue.
- **What it publishes.** Nothing. The readings are not on the site, in an
  artifact or in a log, and nothing in the app shows them.

### Validation gates

`validate.ts` fails the build, and therefore the deploy, when:

- the output does not match the schema, or an invariant breaks (duplicate ids,
  dangling category, parent or redirect references, an app with no listing);
- a source's entry count, or any category that had ten or more entries, falls
  by more than 5% against the previous good catalog;
- a coverage ratio (with summary, with index facts, with GitHub facts, with
  icon) falls by more than five points, which is how an upstream format change
  that silently empties a field is caught;
- anomalies exceed 1% of a source's lines;
- more than 3% of ids are new or retired in one build;
- an upstream fetch still fails after retries with backoff.

A legitimate upstream change that trips a gate is accepted by committing an
entry to `pipeline/accepted-baseline.json` (the gate, the new value, the date
and the reason); the build records that it was used. The previous good catalog
is the one the live site serves; the first build is bootstrapped with
`--bootstrap`. A failed build publishes nothing, so the last good catalog
stays live. Every source succeeds or the build fails: a partial refresh is not
a refresh.

### Output

The sources are published under licenses that do not combine into one file
(GPL-3.0, CC-BY-SA-3.0, AGPL-3.0, each app's own). So a build is published as
one file per origin, each opening with its own license header, and the app
joins them in memory. `LICENSING.md` gives the reasoning and the obligations;
`schema/parts.ts` defines the files.

```
data/version.json                               the only mutable file
data/c/<hash>/manifest.json                     every file of the build: path, sha256, license, attribution
data/c/<hash>/atlas.json                        ours (CC0-1.0): identity, regions and categories, facets
data/c/<hash>/sources/android-foss.json         GPL-3.0-only
data/c/<hash>/sources/awesome-shizuku.json      CC-BY-SA-3.0
data/c/<hash>/sources/fdroid.json, izzy.json    facts and summaries; license per record
data/c/<hash>/sources/github.json               facts
data/c/<hash>/details/<origin>/<n>.json         shards of long text, one origin per shard
data/c/<hash>/icons.json                        an attribution record per self-hosted icon
data/icons/<content-hash>.webp                  icons that pass the policy in LICENSING.md §1.3
data/upstream/<source>/<commit>…                snapshot of the upstream files a build was made from
data/report.json, data/report.md                build report
data/licenses/<SPDX-id>.txt                     text of every license the manifest or icons.json names
```

Each index's reason for an anti-feature is short and is part of its index
facts in `sources/<index>.json`.

`<hash>` in a directory name is a digest of the bytes of every file in that
build, so nothing under `data/c/` is ever rewritten in place. It is not the
catalog hash in `version.json`: that one identifies the catalog's content and
leaves out the part headers, whose dates change with every build, so that the
app can tell "same catalog, rebuilt" from "new catalog" and skip the download.

Neither hash names the code. The site's own version is the commit the app
was built from, shortened, and that commit's date. There is no version
number: a number implies a release cycle the project does not have. Both are
fixed into the bundle at build time (`app/build/site-version.ts`) and never
read at run time: `GITHUB_SHA` in GitHub Actions; in a local build the
checkout's HEAD, marked "with local changes" when the tree holds changes in
no commit; nothing where there is neither git nor `GITHUB_SHA`. The date is
the committer date git gives for that commit. The daily refresh rebuilds the
same commit with new data, so the commit changes when the code does and the
catalog hash every day. About ends with it in one line ("Site build a1b2c3d ·
Nov 17, 2026"), and Data health gives it a section of its own, "This site",
apart from "This catalog" with its "Catalog build" and "Data format" (the
schema number of `version.json`). A build that knows no commit shows no line
on About, and "Not stated by this build" on Data health.

The commit is a link to its page only when the build ran in Actions and
`PROJECT_URL` names the very repository the workflow ran in. Any other build
shows it as text: a local checkout, or a workflow in another repository,
builds commits the public repository may never hold.

The version plays no part in updates, which the service worker detects by a
hash of the shell's files (`__SHELL_VERSION__`). The commit is in the bundle,
so a deploy from a new commit is a new shell to an installed copy even when
the commit changed no code.

`schema/join.ts` holds `joinCatalog`, a pure function with no Node or browser
dependency, used by the app at start and by the pipeline's validation; the
pipeline's `splitCatalog` is its inverse, and a test holds the two to a round
trip. Source text never enters the JavaScript bundle or another source's file.
Test fixtures for the repository indexes are synthetic.

Output is deterministic: the same inputs give byte-identical files apart from
`generatedAt`.

## App

### Routes

Hash routes, so the app runs from any static host and any sub-path.

| Route | View |
|---|---|
| `#/` | Explore: region map, lenses, what is new |
| `#/region/<id>` | A region: its categories and apps |
| `#/cat/<id>` | One category |
| `#/lens/<id>` | Apps sharing one verified fact |
| `#/search?q=&f=&sort=` | Combinable filters, pins |
| `#/saved` | Saved apps |
| `#/about`, `#/about/<page>` | About; sources and licenses, icon credits, data health, third-party notices |
| `#/settings` | Preferences, export and import, install |
| `…?app=<id>` on any list route | That list with the app sheet open |
| `#/app/<id>` | Share form: replaced on arrival by the app's primary category with the sheet open |

Explore, Search, Saved and About are the bottom-bar destinations. Settings is
reached from About and belongs to it.

A category address of a build before this taxonomy (a source's category id,
or the `<region>/<slug>` of source categories once merged by name) is not
"Not found": it is replaced on arrival by the category that took it in, or by
its region when no single category did (a catch-all, a merged name whose
parts went different ways). With `?app=` it leads to that app's own category
with the sheet open. A stored pin is read the same way: a part that names an
old category filters by its successor under the successor's name, and a part
with no successor is dropped from the pin (`catalog/former.ts`). The id of a
category of Droid Atlas's own that was renamed is read the same way, as the id
that replaced it (`RENAMED_CATEGORIES`).

A search whose every word begins a word of a category's name (its own, or a
source's name it takes in, in the source's spelling or the US one) opens with
a row for the category itself above the apps: its name, its region and how
many entries it holds, a link to `#/cat/<id>`. At most three, the one named
in full first, then the larger; none for fewer than three letters, for a
category that holds nothing, or for a word that only occurs in apps' names
and summaries (`categoriesNamed` in `catalog/filters.ts`). The rows are a
`nav` of their own, not part of the list, and are not counted with the apps.

#### Facts that lead to lists

The filter panel holds the questions a person brings before they know any
app. A fact with many values is reached from an app instead: in its details,
the value links to `#/search?f=<token>`, an ordinary list where the token is
a removable chip that combines with every other filter, text and sort, and
can be pinned and shared. Two families of tokens work this way
(`catalog/fact-tokens.ts`); neither is offered in the panel or as a lens.

| Token | Holds | Chip |
|---|---|---|
| `owner:<host>/<owner>` | Entries whose repository (`App.repo.slug`) is on that forge, one of the four named ones, under that owner, compared without regard to case. The same name on two forges is two owners; nothing groups owners into one developer | "fossifyorg on GitHub", spelled as most of the owner's slugs spell it |
| `license:<license>` | Entries for which at least one source (F-Droid, IzzyOnDroid, a list, GitHub: `App.licenses`) states that license | "GPL-3.0", spelled as most sources write it |

A license token is a license as stated, lower-cased, with spaces as hyphens
and without `-only`, `-or-later` or `+`. So "GPL-3.0-only", "GPL-3.0-or-later"
and GitHub's "GPL-3.0" are one token: each of those apps may be used under
version 3 of the GPL, which is all the chip says, whereas a token per spelling
would split one license by how a source happens to write it. A statement of
several licenses is read term by term, without parentheses, each term folded
on its own: "A OR B" and "A / B" offer a choice and "A AND B" applies both, so
each names A and B; "A WITH E" names A, since an exception only adds
permissions and is not a license. A statement that there is no license
("Proprietary", "No license") has no token: it is a list's wording for a
closed app, and "Closed source" in the panel already asks that question, from
every source that states it.

In an app's details, the License row has a line for each statement, in the
source's own words and credited to it; sources that use the same words share
a line. A statement without a version qualifier adds no line beside another
that states the same licenses with one: GitHub's "GPL-3.0" says nothing next
to an index's "GPL-3.0-only". "GPL-3.0-only" and "GPL-3.0-or-later" are two
statements and two lines. Each license's list is linked once, from the first
line that names it, by the list's own name and the number of entries in it
("GPL-3.0 642"); where the source's words are that name ("MIT"), they are the
link. The license in a list's own entry, under Sources and credits, is shown
the same way.

When at least one other entry has the same repository owner, a Repository
owner row links to the owner's list, names up to three of the other entries
and says how many more there are. Its source is GitHub when GitHub answered
for the repository; otherwise whoever the build recorded as giving it
(`Evidence.repository`): the lists whose entry links it, by its source-code
link or its main link, else the index whose source-code field it was read
from. A catalog built before that was recorded names no source for it. An app
without a repository on a named forge, or whose owner has no other entry, has
no such row.

Tokens are read in any letters and kept in lower case; an owner or license
token comes first in a query, before the panel's tokens. Both families are
built from an index of the catalog made in its own task once the page is first
idle after its first view (within three seconds), or sooner by a query or an
app's details that need it, so the start of the app does not pay for about a
thousand owners. A token whose owner or license the catalog no longer holds is dropped
like any unknown token, and a pin that stored one is named by what it still
filters (`storedQueryName`).

### What is a history entry

**Anything with its own URL is a history entry. Anything without one is a
dialog.** Levels and the app sheet have URLs. The filter panel, the sort menu,
the mark legend and the sheet's half/full height do not: they are modal
`<dialog>` elements or popovers, closed by the platform's close request (the
Android Back gesture, Escape) and by a visible control. They never touch
`history`.

Every entry this app creates carries `{ id, idx, under }` in `history.state`:
a random id (`crypto.randomUUID()`), its position in the app's own stack, and,
for a sheet entry, the canonical URL of the list beneath it.

### History rules

1. **Push**: moving to a deeper level; opening the app sheet from a list.
2. **Replace, same entry id**: changing a query, filter or sort; stepping to
   the previous or next result inside the sheet.
3. **Replace, new entry id**: any replace that changes the view (the path).
   Scroll is stored per entry id, so a different view must not inherit it.
4. **Sibling category chips** inside a region replace (new entry id).
5. **Bottom bar.** Explore is the start destination. Selecting Search, Saved
   or About replaces (new id) when the current entry is the root of another of
   the three, and pushes from anywhere else, including the Explore root, so
   Back from any of them returns to where the user was. Selecting Explore
   goes back to the app's root Explore entry when the stack has one
   (`history.go(-n)`), and otherwise replaces. It never pushes. Selecting the
   current destination from deeper inside it returns to that destination's
   root the same way.
6. **Closing the sheet with its close control** calls `history.back()` when
   `idx > 0` and `under` is the entry beneath; otherwise it replaces with the
   list URL. Forward after that reopens the sheet, exactly as after Back.
7. **A navigation the router did not make** (a typed hash, a second deep link
   delivered to the running app) arrives with no state. It is adopted as a new
   entry at `idx + 1`, and a `#/app/<id>` is normalized by replace.
8. Nothing else touches `history`. No entry per keystroke, scroll or toggle.
   Pending debounced query edits are flushed before any push, on Back, and on
   `visibilitychange`.

### Cold start

Chrome marks a history entry as skippable when the page creates it without a
user gesture, and the browser's Back skips it; with nothing else in the stack,
Back closes the tab or the installed app. So **nothing is pushed before the
first user gesture.**

- A cold start renders its target as the single existing entry, replacing the
  URL where needed (a resumed place, a normalized `#/app/<id>`).
- If the target includes an open sheet, a `CloseWatcher` is created for it, so
  the first Back closes the sheet even before any gesture. Where
  `CloseWatcher` is unavailable, that one Back leaves the app.
- On the first `pointerdown` or `keydown` (capture phase), if the current entry
  is at depth with nothing of ours beneath it, the router seeds the stack:
  replace the current entry with its parent (the list for a sheet, Explore for
  a list) and push the target again. From then on Back behaves as if the user
  had navigated there.

Desktop automation does not reproduce the skippable-entry behavior
(`history.back()` and CDP navigation are not the browser's Back). These rules
are checked by hand on a phone: no automated test can prove them.

### State and restoration

- `history.scrollRestoration = "manual"`. The scroll anchor (row id and offset)
  is kept in `history.state` through a throttled `replaceState` (at most once a
  second) and mirrored in `sessionStorage` under the entry id.
- State is written on every route change and on `visibilitychange → hidden`.
  `pagehide` alone is too late on Android. No `unload` or `beforeunload`
  handlers: they disqualify the page from the back/forward cache.
- A list is restored by rendering the window around the saved anchor first and
  then scrolling, never the other way round.
- A **launch** is a fresh document that is not a reload of a discarded page
  (`document.wasDiscarded` is false and there is no entry state). On a launch
  with no route, the app resumes the last place when it is under seven days
  old. The last place is stored per display mode, so a browser tab never
  becomes the installed app's resume point, and a last place whose app or
  category no longer exists falls back to its region, then to Explore.
- Persistent data lives in `localStorage` under `droid-atlas:v1:`: `saved`,
  `pins`, `settings`, `lastPlace:<mode>`, `lastVisit`. A browser tab and the
  installed app share it, so every change is a read-modify-write of the stored
  value, and the app re-reads on the `storage` event. Saved apps are stored as
  `{ id, packages, repo, savedAt, removedAt? }`, which lets a save survive an
  id change and lets an import merge rather than overwrite.
- `lastVisit` is the one date Saved keeps: the build time of the catalog on
  screen when Saved was last opened. It is read once, at the first visit to
  Saved in a session, and kept for the rest of it, so a mark does not vanish
  the moment it is seen; the new date is stored at that visit and never moves
  back. The catalog's time, not the clock's, because a release reaches the app
  only with the next catalog, however late the visit. A saved app is marked
  "Released <day>" when its latest release is later than both that date and
  its own `savedAt`; with no date (the first visit, storage refused) nothing
  is. One gap is accepted: an app saved after its catalog was built is not
  marked for a release made between that build and the save, because which
  catalog was on screen at the save is not kept. The date is not part of
  export and import.
- Every read tolerates missing, corrupt or older-version data.
- `navigator.storage.persist()` is requested after the first save; Settings
  shows whether storage is persistent and offers export. Export and import use
  one versioned JSON file; import merges.

### External links

Built only by `app/src/links.ts`, with tests that pin the strings verified on
the device and tests with hostile inputs. Hand-off URLs are assembled from
validated parts (package id, forge host, owner, name), never from a raw
upstream URL. Hand-offs navigate the current window; ordinary web pages open
with `target="_blank" rel="noopener"`. Always real `<a href>` elements followed
by a direct tap. Actions are not rendered when the app is framed
(`top !== self`).

### Offline and updates

1. `version.json` is fetched with `cache: "no-cache"` on every launch. It
   names the current build's manifest by hash.
2. A new build is downloaded into memory: the manifest, then the atlas, source,
   index and GitHub parts it lists. Each is checked against the manifest's
   sha256, the schema is checked for support, and only when every part is
   present and correct are they written to Cache Storage and made current.
   Nothing is deleted when a build arrives (rule 6 says when leftovers go). A
   partial or mismatched download changes nothing.
3. A newer catalog is applied at the next launch, silently. Stars change
   daily, so every day has a new hash; the app shows "catalog as of <date>"
   and never interrupts a session to announce a refresh. The one exception
   is asked for: on a touch screen, a pull down at the top of a page makes
   the check of rule 1 now, as the button on Data health does, and when the
   device then holds a catalog other than the one on screen the page loads
   again on it, at the same place ("New catalog · <date>"). Nothing newer
   ("Up to date · catalog of <date>") or the site out of reach ("Offline ·
   catalog of <date>") is one line of text and changes nothing. The
   browser's own pull to reload stays off: it would show the stored catalog
   again.
4. The service worker's install step precaches the shell, `version.json` and
   the catalog it names, and fails if any of them is missing, so the first
   offline launch has data.
5. Details shards and icons are cached as they are viewed. Their URLs are
   content-addressed, so cache-first is always correct.
6. A waiting service worker takes over at the next load of the page, before
   the first render: the page asks, the worker skips waiting, and the page
   reloads once on `controllerchange`. It never changes what an open window
   shows. The worker keeps one small entry per open window of the app (the
   shell its load was answered with, the catalog it reports once rendered)
   and judges windows one by one: a window on another shell or catalog holds
   that shell's and catalog's files while it is open; windows on the current
   ones hold nothing; a window showing a plain file of the site never counts;
   an app window that never reports holds files for 24 hours at most. Older
   shells and builds that no window holds, and icons the current catalog no
   longer uses, are removed when a launched page on the current shell and
   catalog reports in and no worker is installing or waiting. A window whose
   catalog can no longer be loaded says so and offers a reload.
7. A shell that meets a catalog with a newer schema than it supports keeps its
   cached catalog and asks to be reloaded.
8. Navigations inside the scope resolve to `index.html` ignoring the query.

### Origin

Storage, the installed app and the service worker are bound to the origin, and
moving origin later strands every user's saved apps. The site is therefore
published on an origin dedicated to it (a custom domain, or a GitHub
organization whose only site this is), never on a shared
`<user>.github.io/<project>` path. The manifest declares a fixed `id`. The
host is chosen before the first public install (`RELEASE.md` §2); the app
itself assumes nothing about the host beyond static files, and ships a
`_headers` file for hosts that honor one.

### Security and privacy

- A `<meta>` Content-Security-Policy: `default-src 'self'; img-src 'self'
  data:; connect-src 'self'; base-uri 'none'; form-action 'none'`.
- No third-party request without a tap: fonts and icons are self-hosted, and an
  app whose icon may not be redistributed shows a monogram, never a hot-link.
- No analytics, no cookies, nothing leaves the device.

### Budgets

Measured against gzip, the encoding static hosts reliably serve. The App
JavaScript budget is enforced: `pnpm site` (`scripts/assemble-site.mjs`)
prints the size and fails over the limit, which is kept in that script
(`APP_JAVASCRIPT_BUDGET_KB`) and nowhere else in code. Its measure is zlib
at the default level over every script in `assets/`; the figure `pnpm build`
prints comes from the bundler's own compressor and runs about one percent
higher for the same file (79.46 against 78.67 kB on 2026-11-17).

| | Budget |
|---|---|
| App JavaScript | 85 kB |
| `catalog.json` | 450 kB |
| One details shard | 40 kB |
| One icon | list size (192 px) 13 kB at most, 2.5 kB median; large size (384 px) 37 kB at most, 4.3 kB median; fetched as viewed, never prefetched |
| Catalog parse and index build on the phone | one task under 50 ms, measured |
| First list paint on the phone, warm cache | 500 ms |
| Filter or search update | one frame for 1,500 apps |
| Persistent chrome at 384×688 | under a fifth of the height |

### Accessibility and language

Semantic controls, visible focus, full keyboard operation, 44 px targets,
contrast of at least 4.5:1 in both themes, `prefers-reduced-motion` honored,
no gesture without a visible control that does the same thing. The region map
is a list of links in reading order, each with a full accessible name, and
color is never the only cue. The sheet is a modal dialog: background inert,
focus returned on close, its height control a button with `aria-expanded`.
The interface is English only; upstream text is rendered with `dir="auto"`,
and sorting and search use `Intl.Collator` with diacritics folded.

## Testing

| Layer | What it proves |
|---|---|
| Pipeline unit tests | Each parser on its awkward lines; every identity rule with its counter-example; every validation gate failing when it should |
| App unit tests | Router transitions against a recording history fake: each rule above, the cold-start seeding, restoration, query parsing, link strings including hostile input |
| End-to-end journeys | The journeys in `tests/e2e/journeys/`, including reload with the same `sessionStorage` and cold deep links |
| Device checklist | What automation cannot reproduce: the browser's own Back before and after a gesture, tab discard, process kill, the installed app, update while open |
