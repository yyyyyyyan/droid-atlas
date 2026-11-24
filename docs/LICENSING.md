# Licensing and publication compliance

How Droid Atlas complies with the licenses of the material it republishes, how
its own code and data are licensed, and what a published copy must carry.
Researched on 2026-11-11 from primary sources (license texts, upstream
repositories, F-Droid, IzzyOnDroid, GitHub, Creative Commons, FSF, Google,
USPTO); URLs are given with each quotation.

This is not legal advice. Neither the author of this document nor the project's
owner is a lawyer. Each conclusion is marked:

- **SETTLED**: follows from the plain text of the license or policy quoted.
- **JUDGMENT**: a reasonable reading. The conservative alternative is named.
- **OPEN**: needs an answer from the upstream maintainer or a lawyer. §3 has
  ready-to-send questions for the ones an upstream can resolve.

Where being conservative costs little, the plan below takes the conservative
option.

---

## 1. Summary and recommended compliance plan

### 1.1 Material, license, use, obligations

| Material | License (as found) | What we do with it | What we must show / ship |
|---|---|---|---|
| **Android FOSS** list (`offa/android-foss` README): app names, project URLs, F-Droid/IzzyOnDroid links, section structure and order, membership | GPL-3.0. `LICENSE` is the GPLv3 text and the README badge says "GPLv3". No "or any later version" statement, so it is treated as **GPL-3.0-only** | Extract into its own file `sources/android-foss.json`. We compute first-seen dates ourselves from git history | A file-level notice: source, commit, license, and the statement "modified by Droid Atlas on <date>". The GPL text is shipped with the site. A credit line on the Sources page and on every listing block. Source: the public repo (pipeline included), plus a snapshot of the upstream README at the pinned commit. No added restrictions |
| **awesome-shizuku** text (`timschneeb/awesome-shizuku`): descriptions, tags, ✨ picks, license tags, closed-source and archived pages, category notes | **CC-BY-SA-3.0 Unported**. Both `LICENSE` and the README "License" section say so | Extract into its own file `sources/awesome-shizuku.json`. This is an Adaptation, released under **CC-BY-SA-3.0**. Text stays verbatim; any trim is marked as an excerpt | A credit on each listing ("From awesome-shizuku · CC BY-SA 3.0", linked). The Sources page gives the title, authors, URI, license URI and a statement of changes. Its text never goes into another file or into the JS bundle |
| **F-Droid index** `index-v2.json`: summary, description excerpt, license id, categories, anti-features, versions, SDK, size, dates, permissions | The index is built from `fdroiddata`, which is **AGPL-3.0** (its `LICENSE` file and GitLab license; no "or later" statement found, so treated as AGPL-3.0-only). Summaries, descriptions and graphics usually come from each app's own repository, under that app's license | `sources/fdroid.json`: facts, the summary and the reason given for each anti-feature. A description excerpt and the permission names are loaded on demand. Booleans are derived from the permission lists | Credit "F-Droid" with a link to the app's F-Droid page. A per-record statement that text is under the app's license (`license` field), and may also be under AGPL-3.0 (fdroiddata). Excerpts are marked. The AGPL and app license texts ship with the site. Source link |
| **IzzyOnDroid index** `index-v2.json` | `repodata` states "**AGPL-3.0-or-later** … with its all content". Descriptions and graphics come from each app's repository through Fastlane | `sources/izzy.json`, handled the same way as F-Droid | The same as F-Droid, with the credit "IzzyOnDroid" |
| **Android's permission statements** (`platform/frameworks/base` at a platform release tag: `core/res/AndroidManifest.xml`, `core/res/res/values/strings.xml`): each permission's name, protection level and English label | **Apache-2.0**. Both files carry "Copyright 2006, The Android Open Source Project" and the Apache License header; the repository's `NOTICE` file holds the attribution notice for Android's own code | A committed table, `pipeline/android/permissions.json` (Apache-2.0 in `REUSE.toml`), written by hand from a pinned tag. Each build ships the rows for the names apps declare as `sources/android-permissions.json` (§2.L) | The license text with the site and in `LICENSES/`. The files' copyright notices, the `NOTICE` attribution and a statement of changes in the table and in the part's header. A credit on the Sources page and, in the app, "Android 17" beside the groups and labels |
| **App icons** | Each app author's work. F-Droid requires that "All assets need to have valid legal licenses". The `NonFreeAssets` anti-feature flags artwork under NC/ND licenses | Self-host 192 and 384 px WebP files from the sources and rules in §1.3, whatever the app's license; remove on request. Never hot-link | `icons.json` attribution records and a generated attribution page. License texts. A link to each app's source. A removal contact |
| **GitHub** (GraphQL): stars, pushed-at, archived, renamed-to, topics, latest release, `.apk` asset, description | GitHub ToS §D/§H and the Acceptable Use Policies (AUP) §7–8. A description belongs to the repository owner | `sources/github.json`: facts. The description is shown only when no licensed description exists | The text label "GitHub" (no logo), a link to the repository, and no personal data |
| **Our code** (pipeline + app) | **GPL-3.0-or-later** (recommended, §2.H) | n/a | `LICENSES/`, SPDX headers / `REUSE.toml`. A "Source code" link in the app that gives the commit |
| **Our own data**: region and category definitions, where each app is filed (the placements of single apps in `pipeline/placements.json` included), identity map, computed facets | **CC0-1.0** (recommended) | `atlas.json`. The mapping from a source's category to ours lives inside that source's file, so it carries that file's license (§2.B) | A REUSE annotation and a line on the Sources page |
| Bundled npm dependencies (Preact, signals, …) | Mostly MIT. Verify each one | Bundled into the app JS | A generated `third-party-licenses.txt` deployed next to the bundle |
| Self-hosted fonts | Usually OFL-1.1 (verify per font) | Served from our origin | The font license text and copyright lines in `LICENSES/` and on the Sources page |
| Third-party names: Android, F-Droid, IzzyOnDroid, Google Play, GitHub, GitLab, Codeberg, Shizuku, Obtainium | Trademarks / names | Used as words, to identify the thing named | "Android is a trademark of Google LLC.", a non-affiliation statement, and no third-party logos, except a mark redrawn where its license allows it, which is F-Droid's alone (§2.G) |

### 1.2 Recommended file layout

**Deployed data.** This replaces the single merged `catalog.json` described in
`ARCHITECTURE.md`. Keeping each source in its own file is what makes the
"aggregate / collection" argument in §2.C hold.

```
data/version.json                               mutable pointer (ours, CC0-1.0)
data/c/<hash>/manifest.json                     every file: path, sha256, SPDX license, source, attribution
data/c/<hash>/atlas.json                        CC0-1.0: identity map (app id ↔ listing keys), region definitions, computed facets
data/c/<hash>/sources/android-foss.json         GPL-3.0-only
data/c/<hash>/sources/awesome-shizuku.json      CC-BY-SA-3.0
data/c/<hash>/sources/fdroid.json               per-record license (app license) + AGPL-3.0-only notice
data/c/<hash>/sources/izzy.json                 per-record license (app license) + AGPL-3.0-or-later notice
data/c/<hash>/sources/github.json               facts; descriptions © their repository owners
data/c/<hash>/sources/android-permissions.json  Apache-2.0: Android's statements about the permissions apps declare
data/c/<hash>/details/<source>/<n>.json         long-text and permission-name shards, one source per shard
data/c/<hash>/icons.json                        one attribution record per shipped icon
data/icons/<content-hash>.webp                  icons (license per record in icons.json)
data/upstream/android-foss/<commit>.md          README snapshot used for the build (GPL source, see §2.A)
data/upstream/awesome-shizuku/<commit>/…        README + pages snapshot (not required; cheap, aids audit)
licenses/<SPDX-id>.txt                          full text of every license referenced by manifest.json or icons.json
third-party-licenses.txt                        bundled JS dependencies
```

Each `sources/*.json` file opens with a header object:

```json
{
  "source": {
    "name": "awesome-shizuku",
    "url": "https://github.com/timschneeb/awesome-shizuku",
    "commit": "<sha>",
    "retrieved": "2026-11-11T05:00:00Z"
  },
  "license": "CC-BY-SA-3.0",
  "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
  "attribution": "awesome-shizuku by timschneeb and contributors",
  "changes": "Adapted by Droid Atlas on 2026-11-11: entries extracted from Markdown into JSON, tags normalized, category → region assignment added; descriptions verbatim.",
  "warranty": "Provided without warranty; see the license."
}
```

**Public source repository.**

```
LICENSES/GPL-3.0-or-later.txt      our code
LICENSES/GPL-3.0-only.txt          android-foss fixtures/snapshots, if any are committed
LICENSES/CC-BY-SA-3.0.txt          awesome-shizuku fixtures, if any are committed
LICENSES/CC0-1.0.txt               our own data
LICENSES/OFL-1.1.txt               fonts (if that is their license)
LICENSES/MIT.txt                   any vendored MIT file
COPYING                            the GPL text again, at the root, for GitHub's license field
REUSE.toml                         annotations for files that cannot carry headers
NOTICE.md                          human-readable sources, licenses, trademarks, icon policy
README.md                          § "License" pointing at NOTICE.md
```

Keep test fixtures for the F-Droid and IzzyOnDroid indexes **synthetic**
(hand-written fake packages). Fixtures copied from the real indexes would bring
AGPL text and every app's license into the repository. Fixtures cut from the two
lists' READMEs are fine, but they must be annotated as in §2.H.

Generated catalog data should not be committed to the public repository. The
current `data/catalog.json` is build output. If it stays, annotate it.

### 1.3 Icon policy (rules a program applies)

Decided on 2026-11-12: an app's icon is taken from any
reasonable source, self-hosted, credited exactly, and removed on request.
Licensing is handled by attribution and a removal route, not by withholding
icons. The earlier license and anti-feature gates no longer apply. The pipeline
(`pipeline/icons.ts`, `icon-discovery.ts`, `icon-sources.ts`, `icon-image.ts`)
applies these rules on every build.

1. **Sources, most trustworthy first.** The first candidate that passes every
   rule below is used.
   1. `fdroid-index`, `izzy-index`: `packages[id].metadata.icon` in the F-Droid
      (`https://f-droid.org/repo`) or IzzyOnDroid
      (`https://apt.izzysoft.de/fdroid/repo`) index, `en-US` first, then the
      first locale. F-Droid before IzzyOnDroid. Whatever the app's license or
      anti-features.
   2. For apps no index gives an icon, the project's repository on GitHub,
      GitLab.com or Codeberg, read at the default branch's head commit:
      `repo-fastlane` (`fastlane/metadata/android/<locale>/images/icon.png`,
      English locales first), `repo-metadata`
      (`metadata/<locale>/images/icon.png`), each only at the repository root or
      above the launchable module, then `repo-launcher`: in the module
      whose `AndroidManifest.xml` declares the launcher activity, the
      `<name>-playstore.png` Android Studio writes beside the sources, else the
      `<application android:icon>` resource's bitmap at the highest density, the
      `main` source set before flavors, a round variant only when nothing else
      exists. When the icon exists only as an adaptive icon in XML, its
      background and foreground layers (colors, VectorDrawables, bitmaps,
      rectangle shapes filled with a color or a linear gradient) are composed and the 72 dp a launcher shows is kept; an icon using anything
      the composer does not understand (theme attributes, tints other than a literal color, sweep
      gradients, animation) is not drawn at all.
   3. `readme-logo`: the first image in the README whose file name or alt text
      says "logo" or "icon" and nothing marks as a badge, button, screenshot,
      banner, preview or another project's mark. Images on badge hosts
      (`BADGE_HOSTS` in `icon-sources.ts`) are never taken.
   4. Only when the repository gave no file under 2: `site-icon`, the icons the
      project's own website declares (web app manifest icons of at least 96 px,
      `any` before `maskable`; `apple-touch-icon`; a `rel=icon` of at least
      96 px or SVG; last, a raster `rel=icon` that declares no size, measured by
      the gates below). A website given as `http://` is read over `https://`. Sites shared by many projects (forges, stores, forums,
      social networks, document hosts; `SHARED_SITES` in `icon-discovery.ts`)
      are never used. Then `store-listing`: the icon of the app's Google Play
      listing (`play-lh.googleusercontent.com`, requested at 512 px).
   5. `forge-avatar`: a GitHub organization's avatar when the organization's
      name is the app's name; a GitLab project's or Codeberg repository's own
      avatar when the project's name is the app's name. Never a user's avatar.

   Guides and links (`kind: "resource"`) take only `site-icon` from their own
   page.
2. **Deny list.** `pipeline/icon-policy.json` holds `deny` (an app id or a
   package, with a reason and a date) and `denySources` (a source rule or a
   host). A denied app gets no icon from any source and nothing is downloaded
   for it; a denied rule or host is never used for any app. Deny always wins.
   The same file holds `sources`: icon files found and inspected by hand for
   apps whose sources the rules in 1 cannot read (a mirror of a self-hosted
   forge, an official store listing the entry does not link). Each names the app,
   the rule for its kind of source, the exact URL, the SHA-256 of the reviewed
   file (a changed file is refused until reviewed again), the commit for a
   repository file, and why it is the app's icon; it is tried after the index
   icons and before the automatic lookups, and passes every rule below.
3. **No hot-linking, safe fetching.** Every icon is downloaded at build time and
   served from our origin. Only `https` URLs with a DNS host name that resolves
   only to public addresses, the default port and no credentials are fetched,
   on every redirect hop; repository paths
   with `..`, empty segments or control characters are ignored. Originals are
   capped at 8 MB and decoding at 4096 × 4096 pixels.
4. **Integrity.** Where the source states a hash, the bytes must match it: the
   SHA-256 the index states, or the git blob id the forge's tree lists for the
   file at that commit. Store listings, websites and avatars state none.
5. **Quality gates.** The file must be a PNG, WebP, JPEG or GIF, or an SVG
   (README logos and site icons only) with no script, event handler, entity,
   document type, foreign object, embedded image or reference outside the file.
   It must decode, have a short side of at least 96 px (index icons excepted:
   the index chose them), be square within 5 % (35 % for index icons; it is
   then padded, never cropped), and not be blank or a single flat color. An
   image that apps of three or more projects share (forks counted with their
   parent) is a template, such as Android Studio's or Flutter's default
   launcher icon, and is refused for all of them, together with the app's other
   launcher files (the same resource at another density, or its round
   variant); each app then tries its next candidate. An image that apps of two
   projects show is set aside for an app that has it from a rule other than an
   index, when another of its candidates is an image no other project shows.
6. **Transformation.** Fitted into a transparent square and written as WebP at
   192 px and, from originals of at least 288 px, at 384 px; metadata removed.
   Nothing else: no crop (beyond an adaptive icon's visible 72 dp), recolor,
   mask, badge or overlay. Each file is named by
   the start of its own SHA-256.
7. **Record.** One `icons.json` entry per app with an icon (`IconRecord` in
   `schema/parts.ts`): both files, the app's id and name, the source rule, the
   exact original URL and the SHA-256 of its bytes, the repository commit or the
   index timestamp, the retrieval date, the author or project as a source names
   it, the project's license as a source states it ("not stated" when none
   does; it is not necessarily the icon's own license), the project's address,
   and what was changed. The texts of the SPDX licenses these records name are
   shipped when the SPDX list has them. Validation fails the build if an icon
   has no record or a record no icon.
8. **Display.** The app sheet says where the icon came from; the Sources page
   links to an icon credits page generated from `icons.json`.
9. **Re-evaluation and caching.** Index icons are decided afresh on every build.
   Lookups under 1.2–1.5 are cached per app and repeated only for new apps,
   apps whose repository, website or store link changed, apps with no
   candidate after a back-off (7, 14, 28, then 56 days), and a rotating slice of
   about one app in 28 per day. A lookup or download that fails or is
   rate-limited never fails the build and never removes an icon the previous
   build had: that icon is kept unless the app or its source is now denied or
   its original failed a rule in this run.
10. **Fallback.** Without an icon the app shows a generated monogram, and a guide
    or link a link glyph.

**Removal procedure.** Anyone may ask for an icon to be removed, and the
request is granted without discussion. Requests go to the project contact
(configured as `PRODUCT_CONTACT` in `app/src/product.ts` and passed to the
pipeline as `--project-contact`, which names it in the header of
`icons.json`); a build run without that option names the issue tracker of the
project's repository instead. The
maintainer adds a `deny` entry to `pipeline/icon-policy.json` (the app id or
package, the date, "removal request") and commits it; the next build, at the
latest the next daily refresh, no longer ships the file, and the credits page
no longer lists it. A request against a class of source (a host, or a rule
such as `store-listing`) becomes a `denySources` entry.

**Residual risk** (§2.E): an icon's copyright belongs to its authors and many
icons are logos, which no copyright license makes free of trademark rights.
The license in a record is the project's, as a source states it. Self-hosting
is a judgment that identifying an app by its own icon, credited and removable
on request, is what comparable catalogs do; it is not a license grant. Known
upstream restrictions (Shizuku's README forbids using its launcher icons
except to display Shizuku itself) are respected by showing an icon only on its
own app's entry, never in our branding or on another app's.

---

## 2. Analysis

### A. Android FOSS (GPL-3.0)

**What the license can cover.** Copyright protects expression and original
selection or arrangement, not facts.

- 17 U.S.C. §102(b): "In no case does copyright protection for an original work
  of authorship extend to any idea, procedure, process, system, method of
  operation, concept, principle, or discovery"
  (https://www.law.cornell.edu/uscode/text/17/102).
- A compilation is "a work formed by the collection and assembling of
  preexisting materials or of data that are selected, coordinated, or arranged
  in such a way that the resulting work as a whole constitutes an original work
  of authorship" (§101, https://www.law.cornell.edu/uscode/text/17/101). Its
  copyright "extends only to the material contributed by the author" (§103(b),
  https://www.law.cornell.edu/uscode/text/17/103).
- *Feist v. Rural* (499 U.S. 340, 1991,
  https://www.law.cornell.edu/supremecourt/text/499/340): "facts are not
  copyrightable; the other, that compilations of facts generally are", and "the
  copyright in a factual compilation is thin. Notwithstanding a valid copyright,
  a subsequent compiler remains free to use the facts contained in another's
  publication to aid in preparing a competing work, so long as the competing
  work does not feature the same selection and arrangement."
- In the EU, Database Directive 96/9/EC Art. 3 protects databases "which, by
  reason of the selection or arrangement of their contents, constitute the
  author's own intellectual creation". Art. 7 adds a *sui generis* right
  against "extraction and/or re-utilization of the whole or of a substantial
  part" where there was "a substantial investment"
  (https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:31996L0009).

Applied to what we take from Android FOSS:

| Element | Status |
|---|---|
| App names, project URLs, store package links | Facts |
| First-seen dates | Facts we compute from public commit history |
| Category names | Short phrases, individually unlikely to be protected |
| Which apps are in the list (selection), and the section structure and order (arrangement) | Plausibly an original compilation. We reproduce **the same selection and arrangement**, which is exactly what *Feist* says a later compiler may not take freely |

**JUDGMENT:** treat `android-foss.json` as a covered work under GPL-3.0. In
the EU, the GPL's definition "'Copyright' also means copyright-like laws that
apply to other kinds of works" arguably extends the grant to the sui generis
right as well.

**Version.** The repository ships the GPLv3 text and a "GPLv3" badge, and says
nothing about later versions. GPLv3 §14 offers "any later version" only if the
Program says so. **JUDGMENT:** label the file `GPL-3.0-only`. This is the
conservative label, and it costs nothing because our code license is compatible
either way.

**Who contributed, and under what.** GitHub ToS §D.6: "Whenever you add Content
to a repository containing notice of a license, you license that Content under
the same terms"
(https://docs.github.com/en/site-policy/github-terms/github-terms-of-service).
So contributors' entries fall under the same license. 128 contributors at the
time of writing; no copyright line names a holder. Credit as "Android FOSS by
offa and contributors".

**Serving it from a website is conveying (SETTLED).** GPLv3 §0: to "propagate"
includes "making available to the public", and to "convey" means "any kind of
propagation that enables other parties to make or receive copies". The GPL FAQ
(#v3MakingAvailable, https://www.gnu.org/licenses/gpl-faq.en.html#v3MakingAvailable)
says: "One example of 'making available to the public' is putting the software
on a public web or FTP server … we defined conveying to include this activity."
The browser and the service worker receive copies of the JSON.

**What conveying requires** (GPLv3, https://www.gnu.org/licenses/gpl-3.0.txt):

- **§4, notices and license copy.** We must "conspicuously and appropriately
  publish on each copy an appropriate copyright notice; keep intact all notices
  stating that this License … appl[ies] … keep intact all notices of the absence
  of any warranty; and give all recipients a copy of this License". In
  practice: the file header (§1.2), `licenses/GPL-3.0-only.txt` deployed, and
  the Sources page. SETTLED.
- **§5(a), statement of changes.** "The work must carry prominent notices
  stating that you modified it, and giving a relevant date." Converting Markdown
  to JSON, adding regions and adding dates is a modification. The `changes`
  field in the header plus a line on the Sources page satisfy it. SETTLED.
- **§5(b) and §5(c).** The work must say it is under this License, and "You must
  license the entire work, as a whole, under this License". The "work" is
  `android-foss.json`, not the site (see the aggregate point below). SETTLED.
- **§5(d), Appropriate Legal Notices.** This applies only to a work with
  "interactive user interfaces". The JSON has none. **JUDGMENT:** the app's
  Sources page shows the notice, the no-warranty statement and how to view the
  license anyway, so the question does not matter.
- **Corresponding source.** "The 'source code' for a work means the preferred
  form of the work for making modifications to it" (§1), and "The Corresponding
  Source for a work in source code form is that same work."
  - **JUDGMENT:** pretty-printable JSON is a reasonable preferred form for
    editing an extracted dataset. On that reading, conveying the JSON conveys
    its source.
  - Conservative alternative, adopted because it is cheap: treat the JSON as
    generated. Make the generator public (the repository, which carries the
    pipeline under GPL-3.0-or-later). Record the upstream commit in the header.
    Deploy the README snapshot used (`data/upstream/android-foss/<commit>.md`).
    §6 says that for non-source forms "you remain obligated to ensure that it is
    available for as long as needed"; relying on upstream keeping that commit
    would not satisfy this, and the snapshot does.
- **§10, no further restrictions.** "You may not impose any further
  restrictions on the exercise of the rights granted or affirmed under this
  License." No terms of use that limit reuse of the data, no "all rights
  reserved" footer covering it, and no obfuscation of the data files. SETTLED.

**Does the data's GPL force our app code to be GPL?** Two provisions bear on it.

- GPLv3 §5, final paragraph: "A compilation of a covered work with other
  separate and independent works, which are not by their nature extensions of
  the covered work, and which are not combined with it such as to form a larger
  program, … is called an 'aggregate' … Inclusion of a covered work in an
  aggregate does not cause this License to apply to the other parts of the
  aggregate."
- FAQ #MereAggregation: the line between two programs and one depends on "the
  mechanism of communication … and the semantics of the communication". FAQ
  #GPLOutput: "the copyright status of the output inherits that of the input it
  was generated from".

**JUDGMENT:** a program that fetches a separate data file at runtime and
displays it is not a work based on that data, provided the data is not
compiled into the bundle. The question is moot in any case: §2.H recommends
GPL-3.0-or-later for the code, which can be combined with GPL-3.0-only data. Do
not inline GPL data into the JS bundle. It would be legal, but it would mix
licenses in one file for no gain.

### B. awesome-shizuku (CC-BY-SA-3.0)

**License confirmed (SETTLED).**

- The `LICENSE` file begins `License: CC-BY-SA-3.0` / `Creative Commons
  Attribution-ShareAlike 3.0 Unported` and contains the full 3.0 Unported legal
  code. It is unchanged since the initial commit of 2022-10-09.
- README § "License": "This list is licensed under the [Creative Commons
  Attribution-ShareAlike 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/deed.en)
  License." (https://github.com/timschneeb/awesome-shizuku)

Inconsistencies found:

- **None of substance.**
- **GitHub's license API reports `NOASSERTION`.** The cause is formatting: the
  file is laid out like a Debian `copyright` file, with a header line, every line
  indented, and `.` for blank lines, so GitHub's detector does not recognize it.
- **Not every page carries its own notice.** `pages/CLOSED_SOURCE.md`,
  `pages/ARCHIVED.md`, `pages/RISH.md` and the translated READMEs have none.
  **JUDGMENT:** they are covered by the repository-level `LICENSE` and by ToS
  §D.6 "inbound=outbound". Ask the maintainer to confirm (§3).
- **The ✨ tag is the maintainer's personal pick**, per the README annotations:
  "✨ - My personal recommendation". Show it as "awesome-shizuku maintainer's
  pick", never as our recommendation. CC 3.0 §4(c) forbids implying
  "connection with, sponsorship or endorsement".

**Credit and title.** Credit as "awesome-shizuku by timschneeb and
contributors". The title is "awesome-shizuku"; the URI is the repository.
There are 71 contributors at the time of writing.

**What we produce is an Adaptation, not a Collection (JUDGMENT).** The 3.0
definitions (https://creativecommons.org/licenses/by-sa/3.0/legalcode):

- A "Collection" is a work in which "the Work is included in its entirety in
  unmodified form along with one or more other contributions".
- An "Adaptation" is "a work based upon the Work, or upon the Work and other
  pre-existing works … recast, transformed, or adapted including in any form
  recognizably derived from the original".

We extract entries, restructure Markdown into JSON, and sometimes trim. That is
not inclusion "in its entirety in unmodified form", so treat
`awesome-shizuku.json` as an Adaptation.

**(i) Verbatim descriptions** need the §4(a) and §4(c) items. Under §4(a): "You
must include a copy of, or the Uniform Resource Identifier (URI) for, this
License with every copy … keep intact all notices that refer to this License
and to the disclaimer of warranties". Under §4(c), "reasonable to the medium":

- the name of the Original Author / Attribution Parties;
- the title of the Work;
- the URI the Licensor specifies;
- for an Adaptation, "a credit identifying the use of the Work in the
  Adaptation".

The CC FAQ (https://creativecommons.org/faq/) confirms that a link to a page
holding the attribution is acceptable: "you may satisfy the attribution
requirement by providing a link to a place where the attribution information
may be found".

**(ii) Adaptations** (restructured file, trimmed text, region assignment)
additionally need:

- §3(b): the Adaptation "takes reasonable steps to clearly label, demarcate or
  otherwise identify that changes were made". Use the `changes` header, and an
  "excerpt" marker on any trimmed description.
- §4(b) ShareAlike: "You may Distribute or Publicly Perform an Adaptation only
  under the terms of: (i) this License; (ii) a later version of this License
  with the same License Elements …; (iii) a Creative Commons jurisdiction
  license …; (iv) a Creative Commons Compatible License." No terms that
  restrict the license, and no technical restrictions.

SETTLED.

**Category mapping.** Store the Droid Atlas category each awesome-shizuku
category maps into *inside* `awesome-shizuku.json`, so it carries
CC-BY-SA-3.0. Our regions, our categories and where each app is filed stay in
`atlas.json`, which is CC0. The mapping is mostly our arrangement, but this
placement removes the question at no cost.

**Later versions: 3.0 → 4.0 is allowed (SETTLED).** It is allowed by §4(b)(ii),
and the CC compatible-licenses page
(https://creativecommons.org/share-your-work/licensing-considerations/compatible-licenses/)
says: "Your contributions to adaptations of BY-SA 3.0 materials may only be
licensed under: BY-SA 3.0, or a later version of the BY-SA license. … Currently,
no non-CC licenses have been designated as compatible with BY-SA 3.0."

**4.0 → GPLv3 is real, one-way, and for 4.0 only (SETTLED).**

- The same CC page: "GPLv3: The GNU General Public License version 3 was declared
  a 'BY-SA–Compatible License' for version 4.0 on 8 October 2015. Note that
  compatibility with the GPLv3 is one-way only, which means you may license your
  contributions to adaptations of BY-SA 4.0 materials under GPLv3, but you may
  not license your contributions to adaptations of GPLv3 projects under BY-SA
  4.0."
- FSF license list (https://www.gnu.org/licenses/license-list.en.html#ccbysa):
  "CC BY-SA 4.0 is one-way compatible with the GNU GPL version 3 … you can not
  license your adapted CC BY-SA works under the terms of 'GNU GPL version 3, or
  (at your option) any later version.'"
- The FSF list has no compatibility entry for BY-SA 3.0, and CC lists none.

**Is chaining 3.0 → 4.0 → GPLv3 usable here? No (OPEN as law; avoided in
practice).**

1. Nothing published by CC or the FSF endorses moving 3.0 material to GPLv3 in
   two hops, and BY-SA 4.0 §2(a)(5)(B)'s downstream offer comes from "the
   Licensor", who only ever offered 3.0.
2. CC's own guidance limits the mechanism: "This one-way compatibility
   mechanism with GPLv3 is not for general use … Please take advantage of it
   only when you are adapting BY-SA 4.0 works and incorporating the adaptation
   into GPLv3 software in ways that make it difficult or impossible for
   downstream users to distinguish the content from code"
   (https://wiki.creativecommons.org/wiki/ShareAlike_compatibility:_GPLv3).

Our content is trivially distinguishable from code.

**Recommendation (simplest clearly compliant structure):**

- Keep the awesome-shizuku extract in its own file under the **same license,
  CC-BY-SA-3.0**. 4.0 is permitted but buys nothing here, because GPL
  convergence is not wanted.
- Never let its text enter a GPL file or the JS bundle.
- Credit it on every listing block and on the Sources page.

**Database right caveat (JUDGMENT).** The CC Data FAQ
(https://wiki.creativecommons.org/wiki/Data) says "the 3.0 unported licenses …
do not expressly license sui generis database rights … a licensee may need
separate permission to use the database in a way that implicates sui generis
database rights (although arguably an implied license to exercise those rights
may be deemed granted in some jurisdictions)." For a community list published
for reuse, an implied license is the reasonable reading. The conservative fix
is the maintainer's confirmation (§3).

### C. Combining A and B in one product

**JUDGMENT: per-source files plus a runtime merge is a defensible
aggregate/collection.**

- GPLv3 §5 (above) keeps the GPL to the covered work inside an aggregate.
- CC 3.0 §4(b): "This Section 4(b) applies to the Adaptation as incorporated in
  a Collection, but this does not require the Collection apart from the
  Adaptation itself to be made subject to the terms of the Applicable License."
- `awesome-shizuku.json` (our Adaptation) is shipped *whole and unmodified*
  beside separate and independent works, which is the 3.0 "Collection" shape.
- The merged view is assembled in the visitor's browser from those files. Each
  source keeps its own block, with its own name, text, tags and credit.
- CC FAQ: "If the combination does not create an adaptation, then you may
  combine any CC-licensed content so long as you provide attribution", and on
  collections, "You may choose a license for the collection, however this does
  not change the license applicable to the original material."

**What would make it not an aggregate** (do not do these):

- A single record or text field mixing sources: a synthesized description, an
  awesome-shizuku description edited using F-Droid text, a machine summary
  "merged" from several sources.
- A merged data file in which awesome-shizuku text and GPL/AGPL text live in the
  same JSON records. That file would arguably be one work under two
  incompatible copyleft licenses. This is why `ARCHITECTURE.md`'s single
  `catalog.json` should become per-source files.
- Compiling awesome-shizuku text into the GPL JS bundle or into a
  service-worker precache file that mixes licenses. Separate cached copies of
  separate files are fine.
- Any terms of use, DRM, or "all rights reserved" notice over the data.
- Presenting the whole as our work under one license.

**Notices.** Each file carries its own header (§1.2). `manifest.json` lists
each file's SPDX license. The Sources page shows one block per source (§2.H).

### D. F-Droid and IzzyOnDroid metadata

**F-Droid.**

- `fdroiddata` ("Data for the main F-Droid repository") ships the AGPLv3 text
  as `LICENSE`, and GitLab reports its license as `agpl-3.0`
  (https://gitlab.com/fdroid/fdroiddata). No "or later" statement was found in
  its README or CONTRIBUTING, hence **AGPL-3.0-only** (JUDGMENT, conservative).
- The website footer carries only "© 2010-2026 F-Droid Contributors"; no
  license statement for site content was found (https://f-droid.org/en/about/).
- Where text comes from (https://f-droid.org/docs/All_About_Descriptions_Graphics_and_Screenshots/):
  - "it is **strongly encouraged** to add metadata in the application's source
    repo … Metadata from the repository is copied to the F-Droid repo
    automatically", and this is "the only way to provide images, such as the app
    icon".
  - Precedence: "The metadata file … overwrites _fdroiddata_ files … The
    _fdroiddata_ files overwrite metadata from the app source."
  - So a given summary or description may be fdroiddata text (AGPL) or the
    app's own Fastlane / Triple-T text (the app repository's license). The index
    does not say which.

**IzzyOnDroid.**

- `repodata` README: "This repository with its all content is licensed as
  AGPL-3.0-or-later (see the `LICENSE.txt`), unless explicitly stated
  otherwise" (https://codeberg.org/IzzyOnDroid/repodata).
- Its inclusion policy: "Metadata (app description and graphics) must be
  available in the app's repo, using Fastlane structures."
  (https://izzyondroid.org/docs/general/AppInclusionPolicy/) So descriptions and
  icons come from app repositories.
- No statement about reuse of the index, mirroring or hot-linking was found on
  https://apt.izzysoft.de/fdroid/index/info, https://izzyondroid.org/faq/ or the
  policy page. **OPEN**, worth asking (§3).

**Summaries and truncated descriptions with attribution and a link: acceptable
if notices are kept (JUDGMENT).** Every license these texts can be under
(AGPL/GPL/Apache/MIT/BSD/MPL, and occasionally CC) permits redistribution with
notice. Truncation is a modification, so mark it ("excerpt — full text on
F-Droid"). This also meets GPLv3/AGPLv3 §5(a)'s "prominent notices stating that
you modified it". Per record, state the text's license as the app's `license`
value, with a file-level note that F-Droid-maintained text is AGPL-3.0-only and
IzzyOnDroid's is AGPL-3.0-or-later. Whatever the actual origin, the compliance
actions are the same: credit, license notice, license text, source available,
modification marked. **OPEN residual:** an app that licenses its Fastlane text
separately (for example under CC BY-SA) would be mislabeled. This is rare, and
it is cured on request.

**Derived booleans are use of facts (SETTLED as to copyright).** Permission
names such as `android.permission.INTERNET` are API identifiers, and "declares
X" / "does not declare Y" are facts (§102(b), *Feist*). The EU sui generis right
in the indexes is **JUDGMENT**. We extract a subset (the apps on our lists), and
both indexes exist to be consumed by any client. The AGPL grant also covers
"copyright-like laws".

**What AGPL-3.0 requires of a static site (JUDGMENT).**

- AGPL §13: "if you modify the Program, your modified version must prominently
  offer all users interacting with it remotely through a computer network (if
  your version supports such interaction) an opportunity to receive the
  Corresponding Source" (https://www.gnu.org/licenses/agpl-3.0.txt).
- A static JSON file that is downloaded does not "support such interaction". It
  is conveyed, so the ordinary §4–§6 duties apply: notice, license text, source.
- Conservative and free: the app's prominent "Source code" link (commit hash
  plus repository) also meets §13 if it were held to apply.

**AGPL and GPL data side by side (SETTLED).**

- GPLv3 §13: "you have permission to link or combine any covered work with a
  work licensed under version 3 of the GNU Affero General Public License into a
  single combined work … the special requirements of the GNU Affero General
  Public License, section 13, concerning interaction through a network will
  apply to the combination as such."
- AGPLv3 §13 grants the mirror permission.
- Kept as separate files, they are an aggregate, so §13 is not even needed.
- Note that **CC-BY-SA-3.0 has no such bridge.** That is why separation matters
  for awesome-shizuku in particular.

**Fetch etiquette.** One daily fetch per index, with conditional requests
(`If-None-Match` / `If-Modified-Since`). IzzyOnDroid publishes mirrors in its
index (`repo.mirrors`); prefer a mirror for the 14 MB download.

### E. Icons

**Who owns them.** Each app's authors. Only their license lets us copy an icon,
and only their trademark rights constrain using it as a logo.

**F-Droid main repo (SETTLED as to policy, JUDGMENT as to each icon).**

- https://f-droid.org/en/docs/Inclusion_Policy/: "All applications in the
  repository must be Free, Libre and Open Source Software (FLOSS)". For licenses
  it defers to "Debian Free Software Guidelines ( DFSG ), Free Software
  Foundation ( FSF ), GNU , and Open Source Initiative ( OSI )".
- On assets: "Non-functional assets including artwork and fonts can utilize less
  restrictive licenses which include game art specific to the project but must
  allow redistribution when using non-commercial licenses. All assets need to
  have valid legal licenses or be in the public domain while being free of
  copyright infringement."
- On trademarks: "Applications need to obtain necessary trademark and copyright
  permissions."
- Anti-features (https://f-droid.org/en/docs/Anti-Features/): **NonFreeAssets**
  "is applied to apps that contain and make use of Non-Free assets. The most
  common case is apps using artwork - images, sounds, music, etc. - under a
  license that restricts commercial usage or making derivative works (for
  example, any Creative Commons license with a 'Non-Commercial' (NC) or 'No
  Derivatives' (ND) restriction)."

So for a main-repo app without `NonFreeAssets`, F-Droid's review asserts that
the artwork is under a free license. That license is **not necessarily** the one
in `metadata.license`.

**IzzyOnDroid.**

- Inclusion requires "a libre license, approved by OSI/FSF" and "there should be
  no proprietary components. While some of them might be tolerable if they are
  essential for the app's core functionality"
  (https://izzyondroid.org/docs/general/AppInclusionPolicy/).
- The policy says nothing about artwork licenses.
- Its index defines `NonFreeAssets` ("This app contains non-free assets"),
  `NonFreeComp` ("This app contains non-free components/libraries") and
  `UpstreamNonFree` ("The upstream source code is not entirely Free") in
  `repo.antiFeatures` (https://apt.izzysoft.de/fdroid/repo/index-v2.json).
- **JUDGMENT:** with no explicit artwork review, the license gate plus the
  absence of `NonFreeAssets`/`UpstreamNonFree` is the best available automatic
  signal. It is weaker than F-Droid's, which is why F-Droid is preferred when
  both carry the app.

**Under what conditions we may redistribute a downscaled icon (JUDGMENT).**

- When its license is free and its notices travel with it: the attribution
  record, the license text, and a link to the app's source.
- **Resizing is a modification under copyleft licenses, and is recorded as
  one.** CC treats changes of format as non-adaptations: "all CC licenses allow
  the user to exercise the rights … in any format or medium. Those changes are
  not considered adaptations".
- For GPL-licensed icons, the "preferred form for making modifications" may be
  an SVG or layered file in the app's repository. Conservative and cheap: the
  record links to the app's `sourceCode`, and keeps the original PNG's URL and
  hash.
- Apache-2.0 §4(d) NOTICE files cannot practically be reproduced per icon.
  Residual risk, small.

**A concrete counter-example: code license ≠ icon license.** Shizuku's code is
Apache-2.0, but its README says "You are **FORBIDDEN** to use
`manager/src/main/res/mipmap*/ic_launcher*.png` image files, unless for
displaying Shizuku itself" (https://github.com/RikkaApps/Shizuku). Showing that
icon on Shizuku's own listing is "displaying Shizuku itself", so it is allowed.
Such restrictions are why the denylist/allowlist file exists.

**Trademark vs copyright.**

- Many icons are logos. A copyright license does not grant trademark rights:
  Apache-2.0 §6 says so expressly, and GPLv3 §7(e) lets authors decline
  trademark rights.
- Identifying an app by its own icon in a catalog entry is a referential use.
- Rules: never use an app's icon in our own branding; never alter it; show
  nothing that suggests endorsement; state non-affiliation.

**Residual risk:**

- Maintainers may have missed an unflagged non-free icon.
- License-field ≠ asset-license mismatches like Shizuku's.
- Trademark objections.
- Missing Apache NOTICE text.

All are low-probability and remedied by removal. Publish a contact for removal
requests and act on them in the next build.

**Hot-linking from f-droid.org instead (not recommended).**

- Privacy: every icon view would send the visitor's IP, User-Agent and Referer
  to F-Droid's servers. That breaks `ARCHITECTURE.md`'s rule that "the app makes
  no request to any third party unless the user taps a link". F-Droid's own
  servers are privacy-conscious, per "Privacy design of f-droid.org webservers"
  (2024, https://f-droid.org/en/2024/03/08/privacy-design-of-fdroid.org-webservers.html):
  "we've configured our web servers to log country codes instead of IP
  addresses … Our servers also delete log data after 14 days". Mirrors may
  differ.
- Load: no F-Droid or IzzyOnDroid statement permitting or forbidding
  hot-linking was found. The mirror documentation stresses keeping "the load on
  the f-droid.org originserver small" (https://f-droid.org/docs/Running_a_Mirror/).
- Reliability: icon paths are hashed and change between versions, so links
  break, and offline PWA use fails.
- Legally, hot-linking narrows the reproduction question but does not answer
  whether we may display the image. **JUDGMENT:** self-hosting under the policy
  is cleaner on every axis.

### F. GitHub

**Facts** (stars, pushed-at, archived, renamed-to, release tag and date, `.apk`
asset present, topics) are not copyrightable (SETTLED as to copyright). Topics
are short tags.

**Terms of Service and Acceptable Use**
(https://docs.github.com/en/site-policy/github-terms/github-terms-of-service,
https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies):

- ToS §H (API Terms):
  - "Abuse or excessively frequent requests to GitHub via the API may result in
    the temporary or permanent suspension of your Account's access to the API."
  - "You may not share API tokens to exceed GitHub's rate limitations."
  - "You may not use the API to download data or Content from GitHub for
    spamming purposes, including for the purposes of selling GitHub users'
    personal information".
  - "GitHub may offer subscription-based access to our API for those Users who
    require high-throughput access or access that would result in resale of
    GitHub's Service."
- AUP §7: "You may use information from our Service for the following reasons,
  regardless of whether the information was scraped, collected through our API,
  or obtained otherwise: Researchers may use public, non-personal information …
  for research purposes, only if any publications resulting from that research
  are open access. Archivists may use public information … for archival
  purposes." It continues: "You may not use information from the Service … for
  spamming purposes".
- AUP §8: "If you collect any personal information from the Service, you agree
  that you will only use that personal information for the purpose for which
  that User has authorized it."
- AUP §6: "You will not reproduce, duplicate, copy, sell, resell or exploit any
  portion of the Service … without our express written permission."

**JUDGMENT.** Displaying public, non-personal repository facts collected through
the API, at a polite rate, with links back, is the use the API exists for. Many
package indexes and badges do exactly this. AUP §7 lists research and archiving
without saying "only", and §6 is most naturally read as about the Service
itself, not facts about public repositories. Conservative measures, all cheap:

- One authenticated GraphQL pass per day.
- No token sharing; the token lives in CI secrets.
- No personal data: no e-mails, contributor lists or avatars. The owner login
  appears only inside the repository URL.
- Every figure links to the repository.

**Repository descriptions are the owner's text (JUDGMENT).**

- ToS §D.5's license to other users covers use "through the Service as permitted
  by GitHub's functionality", not reuse elsewhere.
- §D.6 inbound=outbound covers Content added *to a repository*. Whether the
  description field is such Content is unclear.
- Most descriptions are short and functional, and showing one to identify the
  repository it describes is a low-risk, referential use.
- Conservative choice, adopted: show the GitHub description only when neither
  list nor index supplies a licensed description, and label it "Description
  from the repository on GitHub".

**Names and logos.** ToS §G.2: "If you'd like to use GitHub's trademarks, you
must follow all of our trademark guidelines, including those on our logos
page". The logos page (https://brand.github.com/foundations/logo, redirected
from https://github.com/logos) says:

- Permitted: "Use a permitted GitHub logo to link to GitHub."
- Prohibited: "Do not use the GitHub name or any GitHub logo in a way that
  suggests you are GitHub, or that GitHub is endorsing you or your offering or
  project", "Do not modify the permitted GitHub logos", and "Do not use GitHub
  trademarks, logos, or artwork without GitHub's prior written permission."
- The page also says "GitHub is always one word with a capitalized G and H."

**Recommendation (JUDGMENT):** use the word only ("GitHub stars", "on GitHub")
as a plain label. No Invertocat; it would be permitted as a link, but adds
nothing.

### G. Third-party names and logos used as labels

General rule (JUDGMENT): naming a product to identify that product is
referential, or nominative, use. It is widely accepted in the US and recognized
in the EU (EU Trade Mark Regulation 2017/1001, Art. 14(1)(c); not re-fetched
for this document). It requires using no more than needed, no logos, and no
implied endorsement. Add a footer line: "Droid Atlas is an independent project,
not affiliated with or endorsed by Google, GitHub, F-Droid, IzzyOnDroid or the
developers of the apps listed."

| Name | Facts found | Use |
|---|---|---|
| **Android** | Google's brand guidelines (https://developer.android.com/distribute/marketing-tools/brand-guidelines): "Android™ should have a trademark symbol the first time it appears in a creative." / "Android is a trademark of Google LLC." / "Any use of the Android name needs to include this attribution in your communication." On names: "'Android', or anything confusingly similar to 'Android', cannot be used in names of applications … Instead, use 'for Android'". Listed as **Don't**: "Android MediaPlayer" and "**Ndroid** MediaPlayer". As a descriptor: "Android may be used as a descriptor in text, as long as it is followed by a proper generic term and is not the name of your product". On the robot: it "can be reproduced and/or modified as long as the following Creative Commons attribution line is included: 'The Android robot is reproduced or modified from work created and shared by Google and used according to terms described in the Creative Commons 3.0 Attribution License.'" | Write "Android™" on first use, "apps for Android", and "Android apps". Put the attribution line on the About/Sources page. Do not use the robot; if it is ever used, add the CC-BY-3.0 line. Never use the Android wordmark |
| **"Droid" in "Droid Atlas"** | USPTO TSDR: **DROID**, Reg. 4,225,902 (Class 9, interactive entertainment / game software), owner Lucasfilm Entertainment Company Ltd. LLC, LIVE, renewed 2023-05-12 (https://tsdr.uspto.gov/statusview/sn77580336). Reg. 2,553,167 (Class 9, "interactive entertainment software … featuring science fiction"), LIVE, renewed 2023 (https://tsdr.uspto.gov/statusview/rn2553167). Lucasfilm's 2009 application for "Wireless communications devices, namely, mobile phones …" (SN 77845682) is **DEAD/abandoned** (https://tsdr.uspto.gov/statusview/sn77845682). Wikipedia (secondary) says "The term 'Droid' has been used by Verizon Wireless under license from Lucasfilm" (https://en.wikipedia.org/wiki/Droid_(Star_Wars)). Google's "Ndroid" example shows Google regards "-droid" coinages near "Android" as confusingly similar *in app names*. Many FOSS projects use "Droid" (F-Droid, Droid-ify, IzzyOnDroid), which shows common practice, **not** clearance | **OPEN** (lawyer / clearance search). Live DROID registrations found here cover game software, not a catalog website, and no live phone registration was found. Still, the risk is not zero, given two possible objectors: Lucasfilm (the "Droid" mark) and Google ("confusingly similar to Android"). Renaming costs little before launch and much after. Decide before publishing; at minimum, search USPTO, EUIPO and WIPO for "DROID ATLAS" / "DROIDATLAS" |
| **F-Droid** | No published trademark policy found. F-Droid artwork repository: `SPDX-License-Identifier: GPL-3.0-or-later` (https://gitlab.com/fdroid/artwork). Inclusion policy expects apps to "obtain necessary trademark and copyright permissions" | The word as a source label and in "Open in F-Droid". From 2026-11-16, by the owner's decision, also its mark, redrawn in one color, on the one filter that lists what F-Droid carries: see "The one mark" below |
| **IzzyOnDroid** | No policy found | The word as a source label |
| **Obtainium** | The app is GPL-3.0 (GitHub API). Droid-ify (GPL-3.0) and ObtainX (`dev.bikram.obtainx`, a GPL-3.0 fork of Obtainium) were looked at too | The word "Obtainium" on its hand-off button. The app names no F-Droid client and no fork of Obtainium: Android decides which installed app answers a link. Their icons appear only through the icon policy, on their own listing, not on our buttons |
| **Shizuku** | README: "You are **FORBIDDEN** to use `Shizuku` as app name or use `moe.shizuku.privileged.api` as application id", plus the icon restriction quoted in §2.E | Use as a descriptive word ("works with Shizuku", "Shizuku apps"). Never in our product name |
| **GitHub** | §2.F | The word only |

**The one mark (owner's decision, 2026-11-16).** The rule above was "no
logos". The owner lifted it for a mark whose license allows a redrawing, and
only for that: a mark is never copied, and is redrawn in one color in the
app's own icon style where its terms permit an adaptation.

| Mark | Terms, read at the source on 2026-11-16 | Result |
|---|---|---|
| **F-Droid** | `fdroid-logo-2015/README.md` in https://gitlab.com/fdroid/artwork: "The F-Droid logo / Copyright 2012 William Theaker / Copyright 2013 Robert Martinez / Copyright 2015 Andrew Nayenko / Dual-licensed (pick either) under CC-BY-SA 3.0 Unported … and GPLv3 … or later versions of that license". The repository's `REUSE.toml` says the same for `fdroid-logo-2015/fdroid-logo.svg`: `CC-BY-SA-3.0 or GPL-3.0-or-later` | Redrawn, taken under **GPL-3.0-or-later**, the license of our own code, so nothing is combined across licenses. Kept with it: the three copyright lines, the license, and a notice of the change with its date (GPL-3.0 §5(a)), in `app/src/ui/Icon.tsx`, `REUSE.toml` and `NOTICE.md`, and a credit on the app's Sources and licenses page |
| **Shizuku** | README, License: "You are **FORBIDDEN** to use `manager/src/main/res/mipmap*/ic_launcher*.png` image files, unless for displaying Shizuku itself." The icon exists in the repository only as those files. The Apache-2.0 statement on Wikimedia Commons is the uploader's | Not drawn. The filter wears a drop, which is what the word means and is not Shizuku's icon |
| **IzzyOnDroid** | https://codeberg.org/IzzyOnDroid/assets: "the graphic must be used unaltered, as provided", only "in association with IzzyOnDroid", and it contains a registered trademark | Not drawn: a one-color redrawing is an alteration. The filter wears the letters "Iz", drawn by us |

What the license settles is copyright. The trademark question this section
raised for F-Droid's logo is not settled by it and stays a JUDGMENT: the mark
identifies F-Droid on the filter that lists the apps F-Droid carries, at icon
size, beside the words "On F-Droid", never as Droid Atlas's own sign, and the
non-affiliation statement stands. F-Droid publishes no trademark policy; its
artwork repository points to "How to use an F-Droid badge"
(https://f-droid.org/docs/Badges/), which is about the badge, not this use.
If F-Droid objects, the letter in a tile drawn for the same review takes the
mark's place in one commit. Worth asking upstream before launch (§3).

### H. Our own license choice

**(i) Code: GPL-3.0-or-later (JUDGMENT, recommended).**

- **It sits beside GPL-3.0-only and AGPL data without friction.** If data or
  fixtures ever do get combined with the code, GPLv3 §13 and version
  compatibility cover it.
- **It matches the ethos of the sources and of the apps we promote.**
- **"or-later" keeps future options open.**

A permissive license (MIT) would also work, because the data is an aggregate.
But it invites a mixed-license repository, where fixtures and snapshots are GPL
anyway, for no benefit. Do not use the CC→GPL bridge for awesome-shizuku
content. It stays CC-BY-SA-3.0.

**(ii) Our own data** (region and category definitions, where each app is
filed, identity map, computed facets): **CC0-1.0**. It is facts and our own grouping, CC0 is maximally reusable, and
the FSF says CC0 is "compatible with the GNU GPL"
(https://www.gnu.org/licenses/license-list.en.html#CC0). That covers the
hand-kept files the pipeline reads, `pipeline/placements.json` among them:
its reasons are our own words about where an app is filed. The mapping from
a source's category to ours lives inside that source's file and carries that
file's license (§2.B). The docs can follow the code license; no separate documentation
license is needed.

**Expressing it (REUSE 3.3, https://reuse.software/spec-3.3/).**

- "Each License File MUST be placed in the `LICENSES/` directory in the root of
  the Project", named by "the SPDX License Identifier of the license followed by
  an appropriate file extension". The directory "MUST NOT include any other
  files".
- Source files get comment headers, which are "the RECOMMENDED method":

  ```
  // SPDX-FileCopyrightText: 2026 Droid Atlas contributors
  // SPDX-License-Identifier: GPL-3.0-or-later
  ```

- Uncommentable files (JSON fixtures, images) are covered by `REUSE.toml`, or
  by a `.license` sidecar file. Example:

  ```toml
  version = 1

  [[annotations]]
  path = ["pipeline/fixtures/android-foss/**"]
  precedence = "override"
  SPDX-FileCopyrightText = "Android FOSS contributors <https://github.com/offa/android-foss>"
  SPDX-License-Identifier = "GPL-3.0-only"

  [[annotations]]
  path = ["pipeline/fixtures/awesome-shizuku/**"]
  precedence = "override"
  SPDX-FileCopyrightText = "awesome-shizuku contributors <https://github.com/timschneeb/awesome-shizuku>"
  SPDX-License-Identifier = "CC-BY-SA-3.0"

  [[annotations]]
  path = ["app/public/fonts/**"]
  SPDX-FileCopyrightText = "<font copyright line>"
  SPDX-License-Identifier = "OFL-1.1"

  [[annotations]]
  path = ["**/*.json", "schema/**"]
  SPDX-FileCopyrightText = "2026 Droid Atlas contributors"
  SPDX-License-Identifier = "GPL-3.0-or-later"
  ```

- Check with `reuse lint` in CI.
- `NOTICE.md` (repository) restates, in prose, the §1.1 table, the icon policy,
  the trademark lines and the removal contact.

**What must appear in the app UI.** A "Sources and licenses" page reachable from
every screen (menu or footer) carries:

1. One block per source: name and link; license name with links to our hosted
   copy and the canonical URL; credit line ("Android FOSS by offa and
   contributors", "awesome-shizuku by timschneeb and contributors", "F-Droid",
   "IzzyOnDroid"); upstream commit or index timestamp; statement of changes with
   date (from `manifest.json`); no-warranty statement.
2. Links to the raw data files and to the source code at the deployed commit.
   This is the GPL/AGPL source offer.
3. The icon policy in one paragraph, with a link to the generated icon
   attribution list.
4. Trademark lines ("Android is a trademark of Google LLC.") and the
   non-affiliation statement.
5. Third-party software and font licenses (a link to
   `third-party-licenses.txt`).
6. A contact for corrections and removal requests.

Per listing block: a short credit with license ("From awesome-shizuku · CC BY-SA
3.0", "From F-Droid"), and "excerpt" on any truncated text. Per app detail: the
icon credit. Footer: "Code GPL-3.0-or-later · data under its sources' licenses ·
Sources and licenses".

**What must be in the repository:**

- `LICENSES/`, SPDX headers and `REUSE.toml`;
- `NOTICE.md`;
- the README license section;
- the pipeline, including the icon policy and its denylist/allowlist file;
- no unannotated third-party material.

### I. Publication hygiene

`scripts/export-public.mjs` applies these points: it writes a fresh tree from
an allowlist (`scripts/public-export.json`) and scans it with
`scripts/leak-scan.mjs`. §4 lists what the published copy must carry. Design
points (not legal):

- **Fresh history is recommended over filtered history.**
  - Fresh means a new repository whose first commit is a reviewed snapshot of
    the tree. History is the likeliest place for leaks (early drafts, absolute
    paths, session notes, tokens later removed). `git filter-repo`
    (https://github.com/newren/git-filter-repo) can rewrite history, but every
    blob in every commit then has to be proven clean, and a single miss
    publishes it.
  - Fresh history loses the development record, which can stay in the private
    repository.
  - Filtered history is only worth it if the public history has real value to
    readers.
- **Scan both the tree and any history you publish.** Use gitleaks
  (https://github.com/gitleaks/gitleaks, MIT) and trufflehog
  (https://github.com/trufflesecurity/trufflehog, AGPL-3.0).
- **Commit identity.** GitHub's ID-based noreply address takes the form
  `ID+USERNAME@users.noreply.github.com`
  (https://docs.github.com/en/account-and-profile/how-tos/email-preferences/setting-your-commit-email-address).
  Configure it as `user.email` in the public repository before the first
  commit. Enable "Keep my email address private" and "Block command line pushes
  that expose my email".

### J. Download statistics

Researched on 2026-11-12 against the live publications.

| Publisher | What is published | License stated | What we do |
|---|---|---|---|
| **F-Droid Metrics** (https://fdroid.gitlab.io/metrics/, built by `fdroid/metrics` on GitLab) | One JSON file per server and week: requests per URL path, from logs in a privacy-preserving format. A hit is any request answered below HTTP 400, partial ones included. Paths with fewer than 100 hits on a server in a week are left out of the file (`HIT_MIN` in `compile-logs-into-hits.py`). Third-party mirrors are not counted. On 2026-11-12 the newest complete week is 17–23 August 2026: the project's weekly scheduled job has failed every week since 7 September 2026, so nothing newer is published. A figure therefore always carries its first and last day, and the app shows them | The code is AGPL-3.0 (GitLab license field; the site footer says AGPL-3.0-or-later). No license is stated for the data | `sources/fdroid.json`: per app, the sum of the hits on its APK files over the front-end download servers (`http0N.fdroid.net`) and the last four weeks they all cover completely, with the first and last day counted |
| **IzzyOnDroid download statistics** (https://dlstats.izzyondroid.org/, built by `IzzyOnDroid/iod-stats-collector` on Codeberg) | Per-day download counts per package, from the logs of the IzzyOnDroid servers that report statistics (successful APK downloads). The collector's README invites projects to integrate them | The collector is AGPL-3.0-or-later. No license is stated for the data | `sources/izzy.json`: per app, the sum of the daily counts over the last 30 days published, with the first and last day |
| **GitHub** release assets (GraphQL `releaseAssets { downloadCount }`) | A running count of downloads per release asset | GitHub Terms of Service, as §F | `sources/github.json`: per app, the latest release's `.apk` assets summed, from the release's publication day to the day of the fetch |

**JUDGMENT.** A download count is a fact, and a number per app is not a
substantial part of either publication; neither publisher claims rights in the
figures, and IzzyOnDroid invites reuse. We copy no code and no text, credit each
publisher in the part's header with its address and the retrieval date
(`downloadSource` in the part, `enrichment.downloads` in the catalog), and
state exactly what each figure counts and over which days (`DOWNLOAD_MEANING`
in `schema/catalog.ts`). The conservative alternative, asking both publishers
first, costs little and is listed in §3.

**Not used.** F-Droid's `originserver` and `fdroid.link` files (mirror
synchronization and link redirects, not downloads by people), its per-country
fields, IzzyOnDroid's per-client split and its `__helpers` files, which the
collector says may change without notice.

### K. Screenshots in the repository

Decided on 2026-11-17, with the README's screenshots (`docs/images/`).

The site keeps each source's material in a file of its own, because the
sources' licenses do not combine into one work (§2.C). A screenshot of the app
is one file that shows several sources at once, so each screenshot needs its
own answer.

| Screenshot | What it shows | License stated in `REUSE.toml` |
|---|---|---|
| `explore-*.webp` | Our interface, our regions and their counts. No source's text, no app's icon | GPL-3.0-or-later |
| `category-*.webp`, `app-*.webp` | Our interface; six Android FOSS entries (names, membership of the list); for each, the summary and icon the F-Droid index carries, and for one the description | GPL-3.0-or-later AND GPL-3.0-only AND AGPL-3.0-only |

**Why those six apps (JUDGMENT).** The screens were chosen so that every
license on them is one the repository already ships and one that combines with
the others:

- All six apps are listed by Android FOSS only, so no awesome-shizuku text is
  on screen. CC-BY-SA-3.0 text in the same image as GPL material is the
  combination §2.C avoids, and this project does not use the CC-to-GPL bridge
  for it (§2.H).
- Each app's F-Droid record states GPL-3.0-only (Auxio, Booming Music,
  CuteMusic, Dialog Music Player, Fossify Music Player) or GPL-3.0-or-later
  (Gramophone). Summaries, descriptions and icons are the app's own material
  under that license (§2.D), so nothing on screen needs a license text the
  repository lacks.
- F-Droid index text "may also be under AGPL-3.0" (§1.1, §2.D). The
  conservative reading is taken: AGPL-3.0-only is part of the expression, and
  its text is exported with the repository. GPLv3 §13 allows a GPL-3.0 work
  and an AGPL-3.0 work to be combined and conveyed together.
- Every icon appears on its own app's entry, as the icon policy requires
  (§1.3).

**What is done for it.** `REUSE.toml` names the license expression and each
copyright holder, with the app each one wrote. `NOTICE.md` lists the six apps,
the sources and the date the screenshots were captured, which is the notice of
modification GPLv3 §5(a) asks for. The license texts are in `LICENSES/`.

**Removal.** The daily build drops a removed icon from the site (§1.3), but a
screenshot is a committed file. A removal request for one of the six apps is
met by retaking the two screenshots without that app.

**Rule for a new screenshot.** Show our own screens where they tell the story.
Where apps must be on screen, choose apps listed by Android FOSS only, with
text and icon from an index, under licenses already in `LICENSES/`. Name them
in `REUSE.toml` and `NOTICE.md`.

**The conservative alternative**, if this judgment is not accepted: screenshots
of our own screens only (Explore, About, the filters), or of a catalog built
from the invented entries in `scripts/fixture/`.

---

### L. Android's permission statements

Researched on 2026-11-24 against `platform/frameworks/base` at
`android-17.0.0_r1` (commit `94b4c163b7dfe5ce3607f7bb8456f9573f7de57d`) and
the Apache License 2.0 as SPDX publishes it.

**What is used.** From `core/res/AndroidManifest.xml`, each `<permission>`
element's name and protection level; from `core/res/res/values/strings.xml`,
the default English text of the string its `android:label` names. Not the
descriptions (`android:description`), not other languages, not the groups.
Both files open with "Copyright 2006, The Android Open Source Project" and
the Apache License 2.0 header. The repository carries `MODULE_LICENSE_APACHE2`
and a `NOTICE` file whose first section is the notice for "Android Code".

**What the license asks of a redistribution (§4).**

| Clause | Asks | What Droid Atlas does |
|---|---|---|
| 4(a) | Give recipients a copy of the license | `LICENSES/Apache-2.0.txt` in the repository; `data/licenses/Apache-2.0.txt` on the site, linked from the Sources page |
| 4(b) | Modified files carry prominent notices stating that they were changed | The table's `changes` field and the part header's `changes` say what was extracted and how: escapes resolved, labels that are not plain text left out, declarations behind a build flag resolved by the release configuration, only the names apps declare kept, written to JSON, with the date. The Sources page shows it |
| 4(c) | Keep the copyright, patent, trademark and attribution notices of the source form that pertain to the part distributed | The part header's attribution quotes both files' copyright notice and names the files, the repository and the tag. `REUSE.toml` gives the table "2006 The Android Open Source Project" |
| 4(d) | Include the attribution notices of the work's `NOTICE` file that pertain to the derivative work | The part header quotes the "Android Code" section of `NOTICE` (`AOSP_NOTICE` in `pipeline/android-part.ts`): "Android Code. Copyright 2005-2008 The Android Open Source Project. This product includes software developed as part of The Android Open Source Project (http://source.android.com)." The other sections cover third-party code (Apache Commons, Unicode data and others), none of which the table is taken from |
| 6 | No trademark rights | "Android" is used as a word, to say whose statement it is; the trademark notice is §2.G's |

**JUDGMENT.** The table and the part are a derivative of the two files, and
are kept under Apache-2.0 in a file of their own, as the other sources are:
Apache-2.0 text may be combined with GPL-3.0 code, but keeping it apart
leaves its terms plain and the part replaceable. Short labels such as "record
audio" may not be protected at all; they are handled as if they were. The
build never fetches Android: a person regenerates the table from a newer tag
by hand (`pipeline/NOTES.md`).

## 3. Things to ask upstream

These have not been sent. Each removes a JUDGMENT or OPEN item. The answers
should be recorded in `NOTICE.md` with links.

**To the Android FOSS maintainer** (issue or discussion on `offa/android-foss`):

```
Hello, and thank you for maintaining Android FOSS.

I'm building Droid Atlas, a free, open-source static web app for browsing FOSS
Android apps. It reads your README at build time and shows each entry's name,
links and category, with a credit and link back to this repository on every
entry and on a "Sources and licenses" page. The data we derive from the list is
published under GPL-3.0 with the license text, a statement of changes and the
generator's source.

Two quick questions:
1. Is the list licensed GPL-3.0-only, or GPL-3.0-or-later?
2. Is there an attribution wording you'd prefer (currently "Android FOSS by
   offa and contributors")?

Happy to adjust anything you'd like done differently.
```

**To the awesome-shizuku maintainer** (issue on `timschneeb/awesome-shizuku`):

```
Hello, and thank you for awesome-shizuku.

I'm building Droid Atlas, a free, open-source static web app for browsing
Android apps. It shows awesome-shizuku entries (name, link, your one-line
description, tags, license tag, and the closed-source and archived pages) in a
separate, clearly credited "awesome-shizuku" block on each app, under
CC BY-SA 3.0 Unported, with a link back here and a statement of what we changed.
The ✨ tag is shown as "awesome-shizuku maintainer's pick".

Could you confirm a few things?
1. The CC BY-SA 3.0 Unported license also covers pages/CLOSED_SOURCE.md,
   pages/ARCHIVED.md and the translated READMEs.
2. Your preferred attribution (currently "awesome-shizuku by timschneeb and
   contributors").
3. You're fine with us quoting category notes (for example, the note about the
   official Shizuku app on Android 17) with that attribution.
4. Optional: would you consider also offering the list under CC BY-SA 4.0? It
   covers database rights explicitly, which helps reusers in the EU. Entirely
   your call; we comply with 3.0 as it is.
```

**To IzzyOnDroid** (issue on `codeberg.org/IzzyOnDroid/repodata`, or the
contact page):

```
Hello, and thank you for the IzzyOnDroid repo.

I'm building Droid Atlas, a free, open-source static web app that lists FOSS
Android apps. Once a day it would fetch your index-v2.json (with conditional
requests, preferably from a mirror) and show, for apps in our catalog, the
summary, a marked excerpt of the description, license, categories,
anti-features, version and size. Each item is credited "IzzyOnDroid" with a
link to your listing.

1. Does the AGPL-3.0-or-later statement for repodata also cover the generated
   index-v2.json? We understand descriptions and graphics come from each app's
   repository via Fastlane and carry that app's license.
2. We self-host small copies of app icons from the index (192 and 384 px
   WebP), each credited in a per-icon attribution list and removed on request.
   Any objection, or a rule you'd prefer?
3. Is there a mirror you'd prefer automated daily fetches to use, and an
   attribution wording you prefer?
4. We show each app's downloads over the last 30 days from
   dlstats.izzyondroid.org, credited to you with the dates counted. Is that
   fine, and is there a license or wording you want for the figures?
```

**Optional, to F-Droid** (forum or `fdroiddata` issue): whether fdroiddata is
AGPL-3.0-only or -or-later; whether they object to a static site
self-hosting resized icons under the policy in §1.3; whether the per-week APK
hit counts on fdroid.gitlab.io/metrics may be shown per app with their dates,
and whether that publication is still updated (its newest week on 2026-11-12
was 10–16 August 2026); and, since the app now shows it, whether they are
content with a one-color redrawing of the 2015 logo, taken under
GPL-3.0-or-later with its credit, as the icon of the filter "On F-Droid"
(§2.G, "The one mark").

---

## 4. What a published copy must carry

Whoever publishes this repository, or a site built from it, owes the same
things, this project included. Each follows from a section above.

**In the repository**

- `LICENSES/` holds the text of every license `REUSE.toml` names, and nothing
  else (§2.H).
- `COPYING` at the root is a copy of `LICENSES/GPL-3.0-or-later.txt`. GitHub
  reads a repository's license only from a root file, and REUSE ignores a
  root `COPYING`. It names the code's license only: the data's licenses are
  in `NOTICE.md` and `REUSE.toml`.
- Every file is covered by an SPDX header or by `REUSE.toml`, third-party
  material included: fixtures, fonts, snapshots and screenshots (§2.H, §2.K).
  `reuse lint` passes; continuous integration runs it on the repository and on
  the exported tree.
- `NOTICE.md` and the README's license section name the sources, the credits
  and the contact (§2.H).
- The pipeline is published with the data, the icon policy file and its deny
  list included (§1.3, §2.A).

**On the deployed site**

- Android's statements keep, in their part's header, the files' copyright
  notices, the `NOTICE` attribution and the statement of changes (§2.L).
- The license texts under `data/licenses/`, each build's `manifest.json` and
  `icons.json`, and `third-party-licenses.txt` (§1.2, §2.H).
  `scripts/assemble-site.mjs` refuses a site that lacks one of them.
- The Sources and licenses page, with a link to the source code and to the
  raw data files: this is the GPL and AGPL source offer (§2.H).
- The address of the project's own source code in the atlas part's header.
  The pipeline's default is a placeholder; a build for publication is given
  the address with `--project-url`, and the daily refresh refuses to deploy
  without one (`scripts/refresh-config.mjs`).
- A contact for corrections and for the removal of an icon (§1.3).

**In each data file**

- The source, its commit or index time, its license, its credit and the
  changes made, with the date (§2.A, §2.B, §2.D). No restriction is added to
  any source's license.
