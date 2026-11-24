# Notices

Droid Atlas is an independent project. It is not affiliated with or endorsed
by Google, GitHub, F-Droid, IzzyOnDroid, the maintainers of the lists it reads,
or the developers of the apps it lists.

This file sets out where the material in this repository and on the published
site comes from, under which licenses, and what we do to comply with them. The
reasoning, with the license texts and policies quoted, is in
[`docs/LICENSING.md`](docs/LICENSING.md). Machine-readable licensing for every
file in the repository is in [`REUSE.toml`](REUSE.toml), and the full license
texts are in [`LICENSES/`](LICENSES/).

## This repository

| Material | License |
|---|---|
| Our code: the pipeline, the app, the schema, scripts, tests, documentation | GPL-3.0-or-later |
| Our own data and configuration: region and category definitions, the placements of single apps, identity decisions, the accepted baseline, the icon policy file, package manifests, workflow files | CC0-1.0 |
| Android's statements about its permissions in `pipeline/android/permissions.json` (names, protection levels and English labels), extracted from `core/res/AndroidManifest.xml` and `core/res/res/values/strings.xml` of [platform/frameworks/base](https://android.googlesource.com/platform/frameworks/base) at `android-17.0.0_r1` | Apache-2.0, Copyright 2006 The Android Open Source Project. Changed by Droid Atlas on 2026-11-24: extracted into a table, string escapes resolved, declarations behind a build flag resolved by the release configuration `cp2a`. NOTICE: "Android Code. Copyright 2005-2008 The Android Open Source Project. This product includes software developed as part of The Android Open Source Project (http://source.android.com)." |
| SPDX License List metadata in `pipeline/spdx/licenses.json`, from [spdx/license-list-data](https://github.com/spdx/license-list-data) v3.29.0 | CC0-1.0, © The Linux Foundation and its contributors |
| The F-Droid mark among the app's icons (`app/src/ui/Icon.tsx`, `fdroid`), redrawn from `fdroid-logo-2015/fdroid-logo.svg` in [fdroid/artwork](https://gitlab.com/fdroid/artwork) | GPL-3.0-or-later (offered as CC-BY-SA-3.0 or GPL-3.0-or-later; we take the GPL), © 2012 William Theaker, 2013 Robert Martinez, 2015 Andrew Nayenko. Changed by Droid Atlas on 2026-11-16: redrawn by hand in one color as a stroke icon |
| Screenshots in `docs/images/` of a category and an app's details, showing six Android FOSS entries (Auxio, Booming Music, CuteMusic, Dialog Music Player, Fossify Music Player, Gramophone) with their summaries, icons and one description from the F-Droid index, captured by Droid Atlas on 2026-11-17 | Android FOSS: GPL-3.0-only. Each app's text and icon: that app's license, GPL-3.0-only (GPL-3.0-or-later for Gramophone), © its authors as named in `REUSE.toml`. F-Droid index text may also be AGPL-3.0-only. Our interface around them: GPL-3.0-or-later |
| Test lines quoted from the Android FOSS README in `pipeline/test/android-foss.test.ts` | GPL-3.0-only, © Android FOSS contributors (alongside our GPL-3.0-or-later test code) |
| Headings quoted from awesome-shizuku in `pipeline/test/awesome-shizuku.test.ts` | CC-BY-SA-3.0, © awesome-shizuku contributors (alongside our GPL-3.0-or-later test code) |

Test fixtures for the F-Droid and IzzyOnDroid indexes, and the synthetic
upstream used in CI (`scripts/fixture/`), are invented: no record in them is
copied from a real index or list.

Generated catalog data is not kept in this repository. It is built by the
pipeline and published with the site.

## Catalog data on the site

The site publishes each source's data in its own file, each opening with a
header that names its source, upstream commit or index time, license,
attribution and the changes we made, with the date. The app joins them in the
browser; no file mixes text from two sources. The full text of every license a
data file or icon names is published under `data/licenses/`, and the upstream
files a build was made from under `data/upstream/`.

| Source | License | Credit |
|---|---|---|
| [Android FOSS](https://github.com/offa/android-foss): names, links, categories and their order | GPL-3.0-only | Android FOSS by offa and contributors |
| [awesome-shizuku](https://github.com/timschneeb/awesome-shizuku): names, links, descriptions, tags, license tags, the closed-source and archived pages | CC-BY-SA-3.0 (an adaptation: entries extracted from Markdown into JSON, tags normalized, Markdown formatting reduced to plain text, each category mapped to a Droid Atlas category; descriptions otherwise verbatim) | awesome-shizuku by timschneeb and contributors |
| [F-Droid](https://f-droid.org) index: summaries, description excerpts, license, categories, anti-features, versions | Each app's own license, stated per record; F-Droid-maintained text is AGPL-3.0-only (fdroiddata) | F-Droid |
| [IzzyOnDroid](https://apt.izzysoft.de/fdroid/) index: the same fields | Each app's own license, stated per record; repository data AGPL-3.0-or-later | IzzyOnDroid |
| GitHub: stars, activity, archived and moved state, fork parent, latest release | Facts; a repository description, shown only when no licensed description exists, belongs to the repository's owner | GitHub |
| Download figures: [F-Droid Metrics](https://fdroid.gitlab.io/metrics/), [IzzyOnDroid download statistics](https://dlstats.izzyondroid.org/), GitHub release assets | Facts; neither publisher states a license for the figures | Each publisher, with the first and last day counted |
| [Android](https://source.android.com): each permission's protection level and label, for the names apps declare | Apache-2.0, with the copyright notices, the NOTICE attribution and the changes in the part's header | Android Open Source Project |
| Droid Atlas's own data: which listings are the same app, regions, computed facets | CC0-1.0 | — |

Long descriptions are cut at about 4,000 characters and marked as excerpts,
with a link to the full text. The ✨ tag from awesome-shizuku is shown as
"Recommended" beside that list's own entry: it is that list maintainer's
recommendation, not ours.

No terms of use restrict reuse of the data beyond its licenses, and the data is
provided without warranty; see each license.

## App icons

Icons belong to each app's authors. The site hosts a copy of an app's icon,
credits it exactly and removes it on request. The policy is in
`docs/LICENSING.md` §1.3:

- the icon comes from the app's entry in the F-Droid or IzzyOnDroid index,
  else from the project's own repository, website or store listing, in the
  order §1.3 gives;
- where the source states a hash, the icon's bytes match it;
- the app is not on the deny list in `pipeline/icon-policy.json`;
- an icon appears only on its own app's entry.

The only changes made are fitting the icon into a square, resizing it to 192
and 384 px WebP and removing metadata. Each hosted icon has an attribution
record (author, the project's license as a source states it, original URL and
hash, project address) in the build's `icons.json`, and the app shows where
each icon came from. Without an icon the app shows a generated monogram; it
never loads an icon from another site.

A project's license is not necessarily its icon's license, and many icons are
logos. If you are an app's author and want its icon removed, see below; it
leaves the site with the next daily build.

## Third-party software

The app bundles open-source packages (Preact, Preact Signals and the lean-qr
encoder) and self-hosts two typefaces, Figtree and Bricolage Grotesque, under
the SIL Open Font License 1.1. Their names, versions and full license
texts are published with every build as `third-party-licenses.txt`, generated
from the packages themselves; the build fails if one of them is under a
license that is unknown or not on the allowed list.

## Trademarks

Android™ is a trademark of Google LLC. F-Droid, IzzyOnDroid, Google Play,
GitHub, GitLab, Codeberg, Shizuku and Obtainium are names of their respective
owners and projects, used here only to say what a link or a fact refers to. The site shows one mark of another
project: F-Droid's, redrawn in one color under the license of its artwork
(above), on the filter that lists the apps F-Droid carries. It claims no
endorsement by F-Droid. No other third-party logo is used: Shizuku's and
IzzyOnDroid's terms do not allow a redrawing, and theirs are not drawn.

## Corrections and removal requests

To report a wrong entry, ask for an app's icon to be removed, or raise a
licensing question, write to **hello@droidatlas.app**.

Entries come from the upstream lists, so a correction to an entry's name, link
or description is best made upstream as well; we act on removal requests in
the next build.
