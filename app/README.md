# Droid Atlas — the app

A mobile-first, installable web app for finding Android apps in the catalogs
Droid Atlas gathers. It is a static site: one HTML file, one JavaScript bundle,
one stylesheet, self-hosted fonts, a service worker, and a `data/` directory of
JSON the pipeline writes. There is no server, no account, and no third-party
request unless the reader taps a link.

Stack: Preact 11 with `@preact/signals`, Vite 8, strict TypeScript 7, Vitest 5,
a hand-written hash router and a hand-written service worker. No UI library, no
CSS framework, no state or router library. The one other runtime package is
lean-qr's smallest encoder, for the QR code a computer shows a phone.

The design target is a phone browser tab of 384×688 CSS px, then 412 px wide,
then 1024 px and wider. Dark (true black) is the default theme; light follows
the system unless the reader chooses.

## Run it

All commands are run from the repository root with pnpm (Node 24 or 26).

```bash
pnpm install

# 1. Data. The app shows nothing without it; the directory is not in git.
node pipeline/build.ts --offline --bootstrap                 # first time
node pipeline/build.ts --offline --previous app/public/data  # afterwards

# 2. Development server (no service worker, no CSP)
pnpm --filter @droid-atlas/app dev        # http://127.0.0.1:4320/

# 3. Checks
pnpm --filter @droid-atlas/app test       # vitest: every *.test.ts under app/
pnpm --filter @droid-atlas/app typecheck  # the app, then the service worker
pnpm --filter @droid-atlas/app build      # both type-checks, then dist/
pnpm --filter @droid-atlas/app preview    # serve dist/ (CSP and service worker active)
pnpm run site                             # third-party notice + completeness check of app/dist
pnpm run test:e2e                         # the independent journeys in tests/e2e, against app/dist

# 4. A build meant for publication: fails while PRODUCT_REPOSITORY in src/product.ts is missing or a placeholder
DROID_ATLAS_RELEASE=1 pnpm --filter @droid-atlas/app build
```

`--offline` needs the upstream cache in `.cache/` at the repository root; see
the pipeline's own documentation for a build that fetches.

Vite does not notice files added to `public/` while it runs. Restart the dev
server after rebuilding the data, or icons and parts will 404.

**A preview leaves a service worker behind.** `preview` and `dev` share an
origin when they use the same port, and the worker a preview registered keeps
answering page loads with the *built* shell afterwards, so the dev server
appears to ignore your edits. Use different ports, a private window, or
unregister it (DevTools → Application → Service workers → Unregister, and
clear site data).

More scripts, all in `app/`:

| Command | What it does |
|---|---|
| `pnpm --filter @droid-atlas/app data:fixture` | Writes a seven-app synthetic build beside the real one. In a dev server only, `/?catalog=fixture#/` loads it. It holds states real data rarely shows together |
| `pnpm --filter @droid-atlas/app measure` | Times parse, join, model build and queries on the real parts in Node |
| `pnpm --filter @droid-atlas/app icons` | Regenerates `public/icons/*.png` and `public/favicon.svg` from the drawings in `icons/` (needs `sharp`, a devDependency used by nothing else) |
| `node scripts/e2e-offline.ts <cdp-url> [--only <n>]` | The offline and update rules, end to end, in Chromium against `dist/` (below) |
| `node scripts/measure-browser.ts <cdp-url> <app-url>` | Boot, typing, filter and scroll timings in Chromium |

The two browser scripts drive a Chromium over the DevTools protocol. Any
Chromium started with `--remote-debugging-port` works; its browser-level
WebSocket URL is the first argument (`agent-browser get cdp-url` prints one).
`scripts/browser/*.js` are snippets evaluated in a page: `audit.js` (contrast
of every rendered text and icon, and every tap target under 44 px),
`rows-visible.js`, `motion.js`, `restore.js`, `perf.js`.

## The icon

The mark is D1, a D-shaped half globe in four pieces. Its drawings in `icons/`
are finished work: the icons script places them, it never scales or redraws
them.

| File | What it is the source of |
|---|---|
| `d1-icon.svg` | The mark on a rounded black plate, 512 units: `icon-192.png`, `icon-512.png` ("any") and `apple-touch-icon.png` |
| `d1-maskable.svg` | The same drawing on a full-bleed plate, already inside the maskable safe circle: `maskable-192.png`, `maskable-512.png` |
| `d1-monochrome.svg` | The four pieces in white on transparency, with real gaps: `monochrome-192.png`, `monochrome-512.png` |
| `d1-favicon-16.svg`, `d1-favicon-24.svg` | Drawings fitted to the pixel grid for an icon drawn at 16 to 23 and at 24 to 31 px |
| `d1-favicon-16-bare-dark.svg`, `d1-favicon-24-bare-dark.svg` | The same without the plate; the mark of the 24 px one is the header's mark on a screen of one device pixel per CSS pixel |
| `d1-mark-dark.svg`, `d1-mark-light.svg` | The mark alone, with each theme's fills: the header's mark |

`public/favicon.svg` is one file holding the 16 px, 24 px and full drawings; media
queries on its own width show the 16 px drawing below 24 px, the 24 px one below
32 px and the full one from there up, which Chromium and Firefox both honor for
an SVG drawn as an image. The header's mark (`Mark` in `ui/Icon.tsx`) carries
the paths of `d1-mark-*.svg` and of the 24 px fitting inline, with the fills in
CSS; on a screen of one device pixel per CSS pixel its 18 px form is the fitted
drawing, whose gaps stay whole pixels, and everywhere else the full one. The
rail's 24 px mark is the full drawing.

## Structure

```
index.html            the page template; %PRODUCT_NAME% and colors are filled from src/product.ts
manifest, sw.js, _headers   are generated into dist/ (build/)
public/theme.js       applies stored theme and density before first paint (the CSP allows no inline script)
public/icons/         generated PNG icons (committed);  icons/  the drawings they come from (below)
public/data/          written by the pipeline; gitignored
build/
  site-files.ts       pure: the web app manifest, the _headers file, the CSP, the shell file list
  shell.ts            the Vite plugins that write them and bundle the service worker in a second pass
  site-version.ts     the site's own version at build time: the commit, from GITHUB_SHA or the checkout, and its date
scripts/              fixture build, timing scripts, icon generation, the offline end-to-end check
src/
  product.ts          the product's name, description, app id, colors, repository, contact: the only place the name is spelled
  version.ts          the site's own version as the build fixed it (About's last line, "This site" on Data health)
  main.tsx            boot: worker takeover, stored build or network, model, mount; loading and failure screens
  app.tsx             chrome (bottom bar / rail), route → view, scroll restoration, focus, "/" shortcut, title
  services.ts         the one context every view reads
  links.ts            every outbound URL the app can produce, in one table (`LINK_FORMS`), and how each is opened (tested);
                      `platformOf`, the one place the platform (Android, iOS, a computer) is decided
  catalog/
    load.ts           version.json → manifest → parts, sha256 check, part headers, on-demand files
    source.ts         loadCatalog: fetch the parts, joinCatalog (schema/join.ts)
    model.ts          Catalog → Model
    facts.ts          what a row, the sheet's facts and its statistics say about an entry; the measure a sorted row shows
    filters.ts        filter vocabulary (each anti-feature its own pair of filters), URL ⇄ query, running a query,
                      ranking, counts, sorts, where a search matched, and the line above a list an anti-feature
                      filter narrows: whose statement it is and how many apps no index lists
    statements.ts     the little that is said where something is missing: no working link, and a row's address in place of a summary
    description.ts    a long description as paragraphs and lists; a paragraph wrapped by hand at a column is set as one
    credits.ts        the Sources page's blocks, from part headers and the manifest; an icon's owner and the kind of place it came from
    health.ts         the Data health page's figures, the age of each origin's download figures included
  offline/
    decide.ts         pure decisions: which build a launch renders, update, takeover, request kinds, stale caches
    store.ts          the stored catalog: download into memory, verify, store, make current (shared by page and worker)
    client.ts         the page's side: takeover as the page loads, stored build, check after launch, status
  sw/sw.ts            the service worker (own tsconfig: tsconfig.sw.json)
  router/             route.ts (pure), router.ts (history rules), browser.ts, fake-browser.ts
  state/
    storage.ts        createStore: versioned localStorage, cross-tab refresh, corrupt and newer-version data
    saved.ts          saved apps, notes, merge
    visit.ts          the date Saved was last opened, which its release marks are measured from
    pins.ts  settings.ts
    transfer.ts       export and import: file format, reading, merging, summary
    persistence.ts    navigator.storage status;   install.ts  beforeinstallprompt
  lib/                format.ts, treemap.ts (the region map's rows: cut one at a time on a phone, all at once on the wide map,
                      where a tile also lists categories and so must not be a sliver)
  ui/                 components and their pure helpers
  views/              Explore, Levels (region / category / lens), Search, Saved, Settings,
                      AboutHome (what it is, how to use it), About (sources and licenses), IconCredits,
                      Health, TextPage (a license or the third-party notices, read inside the app), NotFound
  styles/             base.css (tokens, shared parts, pages), explore.css, list.css, sheet.css
```

UI helpers worth knowing before changing a screen:

- `ui/place.ts` — color-as-place. A region id maps to a tone `{ h, cs }`; the
  `.place` block in `base.css` derives every surface and text color from those
  two numbers with OKLCH, once per theme.
- `ui/AppList.tsx` — the list every list screen is. Its sticky bar is one row
  of tools (Filters, Sort) running on into quick-filter chips, and, only
  while something narrows the list, a second 36 px row with the result count
  and the active filters. Filters and "Sort and view" (the sort, and the row
  density) are bottom sheets, not history entries. `quiet` (set by Search
  while the on-screen keyboard is up) puts the tools row away; the search
  field then carries its own Filters button, which opens the same sheet
  through `openFilters()`.
- `ui/ResourceList.tsx` — a region or category that holds only guides and
  sites: headed groups of links, with none of an app list's tools.
- `ui/VirtualList.tsx`, `ui/window.ts`, `ui/scroll.ts` — window-scrolled
  virtual list with fixed row heights (88 px comfortable, 52 px compact) and
  anchor-based scroll restoration. The icon credits are not windowed: a
  credit wraps to as many lines as it needs, so every row is in the document
  at its own height, laid out and painted, so a fling never uncovers a row
  that is not drawn; each row is `contain: layout style paint`. Their rows
  are made once, a screenful with the page and the rest in slices of idle
  time, and a search or a chip then only hides and shows them, the rows
  down to the first screenful of matches at once and the rest in idle
  slices (`views/IconCredits.tsx`); the list is its own anchor
  source, so Back returns to the credit that was in view. A fling scrolls on
  the compositor, ahead of the page's code, so rows are kept ready well
  beyond the screen: three screens each way at rest, and as far as the scroll
  will travel in 700 ms at its present speed in the direction it is going (up
  to sixteen screens). A fling thrown on another goes faster than the list
  plans for; it still counts, at the top speed, in its direction, and only a
  step no finger could make is taken for a jump. The window is placed inside
  the scroll event and left alone while it still has half that room. After a
  query change the list renders little more than the visible rows first and
  the rest a moment later.
- `ui/Row.tsx`, `catalog/facts.ts` — a row. Every row is as tall as every
  other, so what fits is decided before layout, from the list's own width
  (`listWidth`, measured by `AppList`; `rowLine`). A comfortable row is
  always name, summary, last line. A name too long for one line takes a
  second and the summary gives the line up (`nameWidth`, an estimate that
  errs wide; `tests/e2e/tools/name-widths.ts` compares it with the browser's
  measure for every name in the catalog). The last line holds the category's
  whole name and the badges that fit beside it (`rowChips`): a plain fact
  that does not fit is left out; a caution never is, and takes room from the
  category's name down to `META_FLOOR`, is said shorter ("Anti-features 2"),
  or is counted ("+1", "2 cautions"). Nothing is cut at a row's edge from
  320 px up. Saved pins its marks (`savedMarks`) at the front of the badges,
  on comfortable and compact rows alike: "Archived", and "Released Nov 18"
  for a release later than both the last visit and the save. A pinned mark
  is never left out or counted, and the other badges share the room left. A list sorted by one source's downloads says above its rows
  what period the figures cover, and nothing else (`sortNote`); a running
  total shows the day it is counted from beside the figure. Where a search
  matched is said on a row only when the row does not show the words: the
  summary's cut is estimated from the row's width (`summaryShown`).
- `ui/AppIcon.tsx`, `ui/plate.ts` — an icon stands on a quiet plate with a
  hairline, so a dark or partly transparent one keeps its shape on a black
  page. An icon drawn in white or black on transparency, which the theme's
  plate would lose, stands on the other plate; that is decided from a 16 px
  sample of the image when it loads, before it is shown, within a budget of
  2 ms a frame, and never changes while the icon is on screen. Row icons are
  decoded with the frame that shows them and do not fade in. Every icon is
  the list-size file first, a plain `img` with no `srcset`, so a row never
  asks for the large file; the sheet loads the large one beside it and
  swaps it in only once it has loaded, and a large file that fails changes
  nothing. The plate is decided on the list file.
- `ui/BottomSheet.tsx`, `ui/sheet-drag.ts` — every sheet on a phone: a modal
  `<dialog>` that follows the finger. A drag from the handle or the header
  (the app sheet's header scrolls with its content and is marked
  `data-sheet-grip`), or from the content while it is scrolled to its top,
  moves the sheet; a short or slow one springs back, a long or fast one
  closes it, and closing by drag is the same call as the close control. A
  drag follows its own finger by identifier and is dropped when the page is
  hidden or the pointer is taken away (`ui/gesture-lost.ts`).
- `ui/Whole.tsx` — a name or a figure with its unit that a line may break
  around but never inside (`.whole`).
- `ui/LevelHead.tsx` — the three-line colored header of a level, kept short
  because everything above the first row costs rows.
- `ui/Sheet.tsx`, `ui/SheetContent.tsx`, `ui/NoteEditor.tsx` — the app sheet: a
  bottom sheet with half and full heights on a phone, a side panel at
  1024 px and wider. Its order is what the entry is (summary, description),
  how to get it (store listings with Obtainium last, source code, links),
  then the evidence (statistics, details, sources and credits).
- Wording follows `docs/COPY.md`: a fact is a label and a value, provenance
  is a name and a date, and method is written once. In the sheet that means
  a download figure is source, figure and period, with one link, "How these
  are counted", to the place that says what each source counts (Sources and
  licenses, under that source; `HOW_COUNTED`); the Details heading names the
  source most of its rows share and a row names its own only when it differs
  (`detailsSource`); and what no index states about an app is two rows that
  read "Unknown", never "none". How old each source's figures are is on Data
  health. A filter, a sort and a lens carry no sentence or tooltip; the
  tooltips kept define a term ("Source-available", "Stale link").
- `ui/keyboard.ts` — whether the on-screen keyboard is up (a text field has
  focus and the viewport is clearly shorter than it has been). The bottom bar
  steps aside, Search shows its compact bar, and the app sheet gives its note
  field the whole screen, only while that holds; `ui/typing.ts` says when the
  search form has focus without the layout shifting under a tap.
- `ui/UndoBar.tsx` — the bar that offers to put back what was just removed
  from Saved.

## Routes

| Route | View |
|---|---|
| `#/` | Explore |
| `#/region/<id>`, `#/cat/<source>/<slug>`, `#/lens/<id>` | The levels |
| `#/search?q=&f=&sort=` | Search |
| `#/saved` | Saved |
| `#/about` | About: what the app is, where its data comes from, how to use it, the project |
| `#/settings` | Settings (reached from About) |
| `#/about/sources` | Sources and licenses |
| `#/about/icons` | Icon credits |
| `#/about/health` | Data health |
| `#/about/notices`, `#/about/license/<SPDX id>` | The third-party notices and the text of one license, as pages of the app |
| `…?app=<id>` on any list route | That list with the app sheet open |
| `#/app/<id>` | Share form, normalized on arrival |

## Data flow

1. A launch first looks in Cache Storage for the build stored on the device
   (`offline/client.ts`). With one, `version.json` is not fetched: the stored
   build is rendered. Without one (first visit, no service worker), `load.ts`
   fetches `data/version.json` past the HTTP cache.
2. `load.ts` fetches the manifest and `source.ts` the atlas, source, index and
   GitHub parts. Each is checked against the manifest's sha256 and its header
   is kept (`LoadedCatalog.parts`) for the Sources page. `crypto.subtle`
   exists only on secure origins; elsewhere the build is loaded and recorded
   as `verified: false`, which Data health states.
3. `joinCatalog` (shared with the pipeline) builds the `Catalog`; `model.ts`
   builds the `Model` once. Parsing, joining and model building each run in a
   task of their own.
4. Long descriptions and `icons.json` are fetched when first needed. A sheet
   fetches one description shard: the build holds at most one description per
   app, from its first repository index, so the origins in `App.index` are
   tried in the pipeline's order (F-Droid, then IzzyOnDroid) and the second
   shard is requested only when the first has no description for that app.
   An app no repository indexes fetches none.

Failures are one of four `CatalogError` kinds (`offline`, `missing`,
`newer-schema`, `damaged`), each with its own screen in `main.tsx`.

Catalog strings are untrusted. They are rendered as text nodes only. A URL
from the data reaches an `href` only through `links.ts` (`safeWebUrl`, or a
hand-off built from a validated package id or slug) or `manifestFileUrl`,
which keeps a manifest path inside the data root.

## State model

| State | Lives in | Notes |
|---|---|---|
| Where you are, the query, filters, sort, the open app | the URL hash | |
| History position | `history.state` `{ id, idx, under, scroll }` | |
| Scroll anchors, stack mirror | `sessionStorage` `droid-atlas:v1:scroll`, `:stack` | per tab |
| Last place per display mode | `localStorage` `droid-atlas:v1:lastPlace:<mode>` | resumed on a launch with no hash, when Settings allows |
| Saved apps (with notes), pins, settings | `localStorage` `droid-atlas:v1:saved`, `:pins`, `:settings` | through `createStore` |
| When Saved was last opened | `localStorage` `droid-atlas:v1:lastVisit` | the build time of the catalog on screen, read and written once a session; not exported |
| The stored catalog and shell | Cache Storage, names starting `droid-atlas:` | below |
| Everything else | signals local to a component | |

`createStore` re-reads before every write and refreshes on the `storage`
event, so a tab and the installed app do not overwrite each other. Stored JSON
that does not parse is moved to `<key>.corrupt` (status `recovered`). Data
whose `v` is higher than this build reads is left exactly as it is (status
`newer`): an old tab beside an updated installed app must not overwrite what
the newer one saved. A change that returns the stored value writes nothing.

Settings: `theme`, `density`, `resume` (reopen the last place) and
`introSeen` (the introduction on Explore was dismissed). There is no setting
for which app opens a link: Android decides, from the apps the person has.
Only Android gets an `intent:` link; elsewhere the Obtainium row is the
GitHub releases page, or nothing when its source is a store listing. Install
is offered where the browser offers it, explained on Android, and left out
elsewhere.

### Export and import

Settings → Your data. One JSON file (`format: "droid-atlas-export"`,
`version: 1`) holds the saved list including removals and notes, the pins and
the three portable settings. Import **merges** (`state/transfer.ts`):

- saved apps: for each app (same id, or a package id in common) the most
  recent save or removal wins, and so does the most recently edited note;
- pins: added when the device has neither that id nor that question;
- settings: taken from the file only where the device still has the default.

A file that is not JSON, not an export, from a newer version, or over 4 MB is
refused and nothing changes; a section in a shape this version does not read
is skipped and named. `MIGRATIONS` is where an upgrade from an older file
version goes; it is empty because version 1 is the first.

The storage prefix, the export format name, the manifest `id` and the cache
names are identifiers on users' devices. They deliberately do not follow
`PRODUCT_NAME` and must not change after launch.

## Offline and updates

`docs/ARCHITECTURE.md` § Offline and updates has eight rules. Where each lives:

| Rule | Implementation |
|---|---|
| 1. `version.json` is fetched past the HTTP cache on every launch | `store.ts` `checkForUpdate` (`cache: "no-cache"`), run by the page after each launch; the worker never answers `version.json` from a cache (`classifyRequest` → `pass`) |
| 2. A new build is downloaded into memory, verified, then stored and made current | `store.ts` `downloadBuild` → `storeBuild`. The pointer moves last, after the stored files are confirmed. Nothing is deleted when a build arrives: the one that was current stays stored as the previous one, for a window that may be showing it, until the purge (below) |
| 3. Applied at the next launch, silently | The page renders `launchChoice()` (the stored pointer at boot) and never re-reads it, and reads that build straight from Cache Storage (`storedBuildFetch`), not through the worker. Data health says when a newer catalog is waiting |
| 4. Install stores the shell, `version.json` and the catalog, or fails | `sw.ts` install: `storeShell()`, which checks afterwards that every file is there, and `ensureCatalog()`. A worker that later finds its shell incomplete stores it again when it takes control and at each launch (`restoreShell`) |
| 5. Details shards and icons are cached as viewed | `sw.ts` `buildFile`, `iconFile`: cache-first, and a fetched file is kept only if its bytes match the stored manifest's sha256 (or, for an icon, its own name). Nothing of a build that is not stored is kept |
| 6. A waiting worker takes over at the next load of the page, never under an open one | `client.ts` `takeOverIfWaiting` asks before the first render and tells the worker to take over; `sw.ts` calls `skipWaiting`; the page reloads once on `controllerchange`, and only then (below). A window open on an older shell keeps its files: `mayPurge`, `tidy()` and the `other-shell` request kind |
| 7. A newer schema keeps the stored catalog and asks for a reload | `decideUpdate` → `newer-schema`; `chooseLaunchBuild` falls back to the previous build when a newer shell stored a format this one cannot read; `ReloadPrompt` |
| 8. Navigations resolve to `index.html` ignoring the query | `classifyRequest` → `navigate`; the document is stored without the `redirected` flag some hosts' `/index.html → /` leaves |

**What is stored, and how each cache is bounded.**

| Cache | Holds | Bound |
|---|---|---|
| `droid-atlas:shell:<version>` | One version of the app's own files | One after a purge. A newer worker adds its own while it installs and waits |
| `droid-atlas:build:<dir>` | One catalog build: its parts, and the description shards and icon credits viewed from it | One after a purge. Each update adds one |
| `droid-atlas:pointer` | Which build is current, which was before it, which build the icon cache was last cleared for, and what the worker knows of each open window of the app (`pointer/window/<id>.json`) | Three small entries, and one per open window: entries of windows that are gone are deleted at each launch |
| `droid-atlas:icons` | Icons as they are viewed, shared by all builds | After a purge, only icons the current build's entries use: two files per entry at most (list size and large size) |
| `droid-atlas:viewed` | License texts and the third-party notice, as opened; network-first | One entry per file the app links to, a fixed set of a few dozen; a text that changes replaces its entry |

**The purge.** Nothing is deleted when a build or a shell arrives, because a
window that is open may be in the middle of a session with the older one.
Leftovers are deleted when a page launches and can prove nothing else needs
them. Once it has rendered, the page tells its worker which script it runs
and which build it shows (`reportLaunch`, `LAUNCHED_MESSAGE`); the worker
purges only when (`mayPurge`):

- no other window still needs the files (below),
- no newer worker is installing or waiting (the files such a worker has just
  stored are not the active worker's to judge),
- the window that launched runs this worker's shell, and
- it shows the current build.

**Which windows hold files** (`holdsFiles`). The worker keeps a small entry
per open window: the shell version its document was answered with, written
when the worker answers the page load (`resultingClientId`), and the build
the page says it shows, written when the page reports its launch.

- A window known to be on another shell or another build holds its files for
  as long as it is open.
- A window on this shell and the current build holds nothing: a purge takes
  nothing it uses, so any number of up-to-date windows may be open.
- A window the worker cannot place (answered by the worker of an earlier
  version, or by the network; not rendered yet, or never going to) is given
  the benefit of the doubt for a day from when the worker first saw it
  (`SILENT_WINDOW_MS`), then stops counting.
- A window that shows a file of the site and not the app (a license text
  opened in a tab) is not a window of the app (`isAppAddress`) and never
  counts. On the phone such a tab blocked every purge under the first form of
  this rule, which counted every window in scope.

`purge` then deletes every shell cache but the worker's own and every build
cache but the current one, forgets the previous build, and removes from the
icon cache every icon the current build's entries do not use (`pruneIcons`;
icons are named by their content, so a changed icon leaves its old file
behind, and this is what collects those). The icon pass reads the atlas, so
it runs once per build. The page's own look for a newer build waits for the
purge to finish, so a build that look stores is never taken for a leftover.
With one window, the day's update therefore costs one extra build for one
session: it is stored during a session, shown at the next launch, and the
build before it is deleted by that launch.

A worker's install also checks, after storing its shell, that every file is
there, and fails if not; a failed install is tried again at the next load.
What install stored can still be gone by the time the worker is in control:
the worker of an earlier build deleted the shell of a waiting one, and a
browser short of space evicts caches. So a worker checks its shell when it
activates and whenever a page reports a launch, and stores it again if any
file is missing (`restoreShell`).

**A window left behind.** A window that stays open is not told about newer
catalogs, and the site keeps the files of older builds only for a while (the
published data holds the current build and the one before). What such a
window has stored it keeps reading, with or without a connection. A
description it never viewed has to come from the site, and when that fails
`leftBehind` looks for a newer build, unless one is already known. If the
device then holds a build other than the one on screen, the sheet says that
the description belongs to the catalog the window was opened with and a
newer one has taken its place, and every view shows "A newer catalog is
ready, and parts of the one on screen can no longer be loaded", each with a
reload. Without a newer build the failure reads as before: "could not be
loaded just now", with "Try again".

**The handover, and when it does not come.** `skipWaiting` is a request, not
a switch. Chromium lets the new worker take control only once the old one has
no request in hand, gives the old one up to five minutes, and does not
answer a request that reaches the old worker while the handover is pending
until the handover has happened. A launch that asked for the takeover while
its own loading screen was fetching fonts through the old worker therefore
sometimes waited minutes. Three things keep a launch out of that:

- **The page asks while it is silent.** `takeOverIfWaiting` runs before
  anything is rendered (`main.tsx`), and, once the waiting worker has
  answered, waits for the page's `load` event and 800 ms more
  (`TAKEOVER_QUIET_MS`, for the icon and the manifest a browser fetches by
  itself after a load) before it tells the worker to. A launch with no
  waiting worker renders at once.
- **The page reloads only on `controllerchange`.** It waits four seconds for
  it (`TAKEOVER_SWITCH_MS`). If it does not come, because the old worker is
  still answering something for another reason, the launch goes on with the
  shell it has.
- **A launch reads its stored catalog from Cache Storage itself**
  (`storedBuildFetch`), so it renders whether or not a worker answers.

**Every load of the page is a launch**: the icon, a link, the reload button,
the same address opened again. A load that finds a worker waiting always
ends on the new version, with one reload at most; the reloaded page finds
nothing waiting, so it cannot loop. The worker does not count windows before
it agrees. An earlier version refused while any other window of the site was
open, and a tab that was never closed could then stay on the old version
through any number of reloads.

**A window that is open on the older shell is left as it was.** Its document
is not reloaded when the worker changes under it. While any other window is
open nothing is purged, and the new worker answers a request for a built
asset it does not have from wherever that asset is stored (`other-shell`), so
a part of the old shell that had not been fetched yet (a font subset for a
script not shown so far) still arrives. The older shell and the older build
are deleted by the first launch that finds no other window (the purge,
above), and that window itself runs the new version the next time it is
loaded.

The request cannot be withdrawn. In the case where the launch went on
without the handover, the new worker takes control later, under the open
page, which is treated like any other window on the older shell; until the
handover has happened, requests through the old worker, a reload among them,
wait for it.

The worker is not registered in development. In a build, `build/shell.ts`
compiles `src/sw/sw.ts` to `dist/sw.js` after the main bundle is written, with
the list of shell files and a version hashed from their content, so any change
to the shell changes the worker's bytes.

`node scripts/e2e-offline.ts <cdp-url>` checks all of this in Chromium against
`dist/`, from a static server of its own that it can take offline: an offline
launch after one online load (including a query string, `/index.html`, a
viewed description and icon); a second catalog stored during a session and
shown only at the next launch; a damaged part and a foreign manifest changing
nothing; a newer schema refused with the reload prompt; a newer worker waiting
through the session and taking over at the next launch, with one reload, or
none when the handover came after the launch had stopped waiting; a launch
with a second window open, which gets the new shell while the other window
keeps its document, its shell and its files; a launch that asks for the
takeover while the old worker is answering a slow request; and a deploy under
a single window that is never closed, reached once by the reload button and
once by opening the same address again, where the session is untouched while
it runs, the second load after the deploy runs the new shell, and that shell
then opens with the site unreachable; a waiting worker whose stored shell is
deleted before it takes over, which stores it again and opens offline; a
text file of the site open in a second window, which does not hold a purge,
and a scriptless document of the app, which holds one until its entry is a
day old; and two deploys of both the app and the
catalog with a window left open on the first version, where nothing is
deleted while that window is open, the window reads what it has stored after
the site has dropped its build, says that a newer catalog is ready when a
description it never stored cannot be fetched, and reaches the newest
version with one reload, at which point, both windows being current,
exactly one build and one shell stay stored, with no icon the current build
does not use, and the device opens without a connection. Every launch in
the takeover scenarios has to render within nine seconds. `--only 7` runs
the scenarios whose number starts with what is given; `--shots <directory>`
saves pictures of the left-behind notice in both themes.

## Installable

`dist/manifest.webmanifest` is generated from `build/site-files.ts`: fixed
`id` (`droid-atlas`), `start_url` and `scope` of `./` so it installs from any
path, standalone display, shortcuts to Search and Saved, and six PNG icons
(192 and 512 px as `any`, `maskable` and `monochrome`). A manifest has one
theme color and one background color; they are the dark theme's. The page's
own `theme-color` and `color-scheme` follow the theme in use.

`dist/_headers` (for hosts that read one: Cloudflare Workers, Netlify) caches
`/assets/*`, `/data/c/*`, `/data/icons/*` and `/data/upstream/*` for good,
revalidates `/`, `/index.html`, `/data/version.json`, `/sw.js` and the
manifest, and sends the Content-Security-Policy as a real header with
`frame-ancestors 'none'`, which a `<meta>` tag cannot carry.

Settings → Install offers a button when the browser fires
`beforeinstallprompt`, and otherwise says where the browser's own menu has it.

## Router rules, as implemented

`router/router.ts` is the only code that touches `history`. It is written
against `RouterEnv`, so `router.test.ts` drives it with a fake that records
every push and replace. The numbered rules are those of
`docs/ARCHITECTURE.md`.

1. **Push** when going one level deeper or opening the sheet.
2. **Replace, same entry id** for anything that refines the level you are on:
   typing, filters, sort, stepping the sheet. Typing reaches the URL after a
   250 ms settle; a pending edit is flushed before any push, on Back and when
   the page is hidden.
3. **Replace, new id** when the path changes without going deeper.
4. Sibling category chips replace.
5. Bottom bar: Search and Saved **push** from anywhere, except from each
   other's root, where they replace. Explore is reached by `history.go(-n)`
   to the root entry when the stack mirror knows where it is, otherwise by
   replace; it is never pushed.
6. The sheet's close control is `history.back()` only when `idx > 0` and the
   entry's `under` equals the list URL; otherwise it replaces.
7. A navigation the router did not make is adopted at `idx + 1`. `#/app/<id>`
   is normalized by replace; a retired id follows `Catalog.redirects` first.
8. Nothing else writes history.

Cold start: nothing is pushed before the first gesture; the first
`pointerdown` or `keydown` puts every level above a deep entry beneath it, the
map first: under a sheet its list, under a category's list its region, under
that the map. Back then climbs level by level, as if the person had
navigated there, which is what a resumed session needs.

A sheet that is open at a cold start (`?app=<id>` in the launch URL) has no
entry beneath it until that gesture, so Back could only leave the app. The
architecture's answer is a close watcher, and this is how the code provides
one:

- **Below 1024 px** the sheet is a `<dialog>` opened with `showModal()`. The
  code creates no `CloseWatcher` of its own, because a modal dialog already
  has the platform's: Android Back and Escape arrive as the dialog's close
  request, the dialog closes, its `close` event reaches `PhoneSheet`, and
  `router.closeSheet()` puts the list in the sheet entry's place with
  `replaceState`. One Back closes the sheet and nothing is pushed. This
  relies on the browser letting a dialog shown without a user gesture answer
  a close request, which the HTML specification grants to the first such
  watcher of a page, and a cold start has only that one.
- **From 1024 px** the sheet is a side panel, not a dialog, so `PanelSheet`
  creates a `CloseWatcher` while the panel is on screen and closes the sheet
  the same way when it fires.
- **Where there is no `CloseWatcher`** (and the dialog does not get one), that
  one Back leaves the app, as the architecture accepts. Escape is handled as
  a key as well, so it closes the panel in any browser.

So the Cold start rule is met wherever the browser has close watchers, which
is Chrome and the other Chromium browsers on Android: by the dialog's own
below 1024 px, and by an explicit one above.

In desktop Chromium the dialog path is exercised by the journey "a cold sheet
is a modal dialog the platform's close request can close before any
gesture". The Back button itself, on both paths, can only be checked on a
device.

Resume: a launch with an empty hash reopens the last place for that display
mode if Settings allows it and the place still exists. An explicit `#/` opens
Explore.

Scroll restoration: the position is kept in `history.state` and mirrored in
`sessionStorage` under the entry id, both written on every route change, when
the page is hidden, and at most once a second while scrolling. A load that
arrives with `history.state` restores from it. A load that arrives without
it has no entry id, and restores only when it is a return and not a visit: a
reload, a back/forward load (`PerformanceNavigationTiming.type`), or the
reload of a discarded tab (`document.wasDiscarded`). It then takes the most
recently stored position among the session's entries that showed the same
URL (`recoveredScroll`, a pure function with its own tests). An ordinary
navigation to that URL starts at the top. A restored position is checked
again over the next four frames, with or without an anchor row, because
parts of a view that settle a moment later (Explore's caption waits for the
map's layout) would otherwise leave the page a line off.

Anything without a URL is a modal `<dialog>` closed by the platform's close
request (Escape, Android Back) or by dragging it down: the filters and the
"Sort and view" sheet. Where Back does not always reach an open dialog
first (Firefox for Android, on what it counts as a tab's first page; any
browser without `CloseWatcher`), such a sheet also holds a history entry
while it is open (`Router.holdBack`, the one exception to rule 8, made by
the router itself): a copy of the entry beneath, pushed on the tap that
opens the sheet. Back lands on the entry beneath and closes the sheet
without a navigation; closed any other way, the sheet takes its entry back
with `history.go(-1)`, and the pop that answers is not a navigation either.
A change made while the sheet is open (a sort) is written to the entry
beneath when the sheet's entry comes off. In Chromium nothing changes.

Closing the app sheet by dragging it down calls `router.closeSheet()`, the
call the close control and Back end in: one history entry is removed and the
list beneath is where it was.

## Keyboard and focus

`/` goes to the search field from anywhere. In a list, ↑ ↓ Home End move
between rows and Enter opens the entry; from the search field ↓ enters the
results. With details open, ← → step to the previous and next result and
Escape closes. On the wide layout these are listed in the idle panel.

Focus: a launch moves focus nowhere, so the first Tab reaches the skip link.
A level change moves focus to the page and names the new place in the live
region. Opening details, by Enter on a row or by a click, moves focus into
them, so ← → step from there at once. In the phone dialog focus goes to the
app's name and Tab cycles inside the dialog. In the wide panel, which is not
modal, focus goes to the panel itself (a landmark named after the app), so
the first Tab reaches its first control and the order is stepper, close,
content, foot; Shift+Tab or Escape leaves it. Stepping leaves focus where it
is and scrolls the list to the row shown. While focus is in the list, ← → do
nothing and ↑ ↓ move between rows; choosing another row with the panel open
moves focus into the panel again. Closing details returns focus to the row
of the entry last shown, or
to the page when that row is no longer rendered. Dialogs return focus to the
control that opened them; the filter panel opened from the search field's
button returns it to the Filters button in the bar, since the field's own
button is gone once the field is left.

Targets: every control is at least 44×44 CSS px in its own box, links inside
running text excepted. Pills that are drawn shorter (chips 34 px, the tools
row's pills 34 px, active-filter chips 28 px, pins 36 px) are 44 px boxes with
transparent top and bottom borders and a negative margin, so the layout and
the persistent chrome are as tall as the pills look (`base.css`, "Pills
drawn shorter"). Rows that wrap have a row gap of 44 px minus the drawn
height, so boxes do not overlap. One place cannot have that: with a filter
active the bar is a 44 px tools row over a 36 px strip, which is all the
persistent chrome budget allows, so the strip's chips grow downwards (4 px
above the chip, 12 px below) and their boxes reach 8 px over the first list
row instead of into the tools row; between chips those 8 px still belong to
the row.

Accessible names contain the words on screen (WCAG 2.5.3): a map tile reads
"Media: 148 entries in 17 categories" and shows "Media 148", a mini-map tile
reads "Media: 148", an active filter chip reads its visible short label
followed by ", remove filter" with the long description as its title.

## Tests

`pnpm --filter @droid-atlas/app test` runs sixteen files:

| File | Covers |
|---|---|
| `router/router.test.ts` | history rules 1–8, cold start, resume and its setting, restoration incl. loads without `history.state`, header back, a sheet that holds Back with an entry of its own |
| `catalog/catalog.test.ts` | model, redirects, filters, sorts, counts, each anti-feature as its own filter, whose statement an anti-feature filter rests on and how many apps it leaves out, row chips fitted beside the category name at each width, cautions said shorter or counted, the width of a name, how much of a summary a row shows, the note above a download sort, the measure a sorted row shows, statistics, sheet facts, search ranking, marked matches and where a search matched, descriptions as paragraphs and lists, marks for same-named categories, Saved's archived and release marks pinned first on comfortable and compact rows |
| `catalog/statements.test.ts` | what the sheet says where something is missing, over the shapes of entry the catalog holds: "Unknown" rows exactly for an app no index carries, nothing called "none", every stated line naming who states it, the source the Details heading names |
| `catalog/load.test.ts` | loading from parts, tampered and missing files, wrong shapes, newer schema, on-demand files, part headers, icon credits |
| `catalog/about.test.ts` | part headers, links to build files, license ids, source credits incl. hostile input, catalog health, icon credit search, About routes |
| `links.test.ts` | every link form as it was tapped on the device, on Android and elsewhere; that only the Obtainium link navigates the window; no package name or fork in any link; hostile package ids and slugs; guides and sites; framed pages |
| `state/state.test.ts` | stores, corrupt and newer-version storage, saved-app resolution across id changes, when each entry was saved |
| `state/visit.test.ts` | the date Saved was last opened: the first visit, the same session, the next session, another window, a date that never moves back, blocked and damaged storage; which releases are marked: after a save, on the day of the visit, an index that states only the day |
| `state/transfer.test.ts` | notes, merging saved apps, pins and settings, the export file, reading damaged and foreign files, a migration chain, importing, two windows |
| `offline/offline.test.ts` | every decision function; download, verify, store, make current; each way a download can be wrong; newer schema; the install requirement; pointers; a launch reading its stored build without the worker |
| `ui/layout.test.ts` | the list window at rest and in motion, the room it keeps ahead of a scroll, scroll speed, the quick window, region map layout, the wide map's rows (this catalog's counts, the one before, one region far smaller, two equal small ones, thirteen equal: no sliver, names on whole words, categories listed, areas at their share), result stepping, row memo |
| `ui/sheet-drag.test.ts` | where a dragged sheet comes to rest (spring back, next height, close), release speed, the keyboard test, map tile labels, names and labels |
| `ui/typing.test.ts` | when Search stops counting as typed in |
| `lib/quiet.test.ts` | a request given up on when nothing arrives for a while, a body that stops, and a slow one that keeps delivering and is never cut |
| `ui/fit.test.ts` | how many chips of a row fit on one line, with room kept for the chip that shows the rest |
| `ui/count.test.ts` | the count line of a list: apps, links, filtered and whole |
| `ui/icon-size.test.ts` | where the sheet's large icon is worth fetching |
| `ui/qr.test.ts` | the QR drawing paints exactly the encoder's dark modules inside a margin of four |
| `ui/plate.test.ts` | which icons stand on the other plate: a white or black glyph on transparency, and every icon that covers its plate or keeps its shape on both |
| `styles/contrast.test.ts` | WCAG contrast of every text/surface token pair, per region tone and theme; hue spacing |
| `build/site-files.test.ts` | the manifest (fixed id, relative URLs, icons exist at their stated sizes), the icon source, the page template, `_headers`, the shell file list and version, what blocks a release build |
| `build/site-version.test.ts` | the site's version: nothing stated without git and `GITHUB_SHA`, a local HEAD with its date and a modified tree, `GITHUB_SHA` in Actions, and a link to the commit only when `PROJECT_URL` names the repository the workflow ran in |

The app's own browser checks are scripts rather than a test runner:
`scripts/e2e-offline.ts` and the snippets in `scripts/browser/`. The
journeys, the accessibility scan, the layout measures and the data audit are
the suite in `tests/e2e` (Playwright), which reads the catalog with code of
its own and blocks service workers, so the offline rules are covered only by
`e2e-offline.ts`. NOTES says what each showed.
