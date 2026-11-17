/**
 * Android FOSS parser, ported from the prototype's tests and extended. The
 * fixture lines are cut from the shape of the real README (GPL-3.0-only,
 * offa/android-foss); names and links are kept to a handful of well-known apps.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAndroidFoss } from "../sources/android-foss.ts";

const FIXTURE = `# Android FOSS

* [Apps](#-apps-)

## – App Store –

* [**F-Droid**](https://f-droid.org)
    * [**Droid-ify**](https://github.com/Iamlooker/Droid-ify) <sup>**[[F-Droid](https://f-droid.org/packages/com.looker.droidify)]**</sup> <sup>**[[IzzyOnDroid](https://apt.izzysoft.de/packages/com.looker.droidify)]**</sup>
* [**Accrescent**](https://github.com/accrescent/accrescent)

------------------------

## – Apps –

### • Keyboard

* [**FlorisBoard**](https://github.com/florisboard/florisboard) <sup>**[[F-Droid](https://f-droid.org/packages/dev.patrickgold.florisboard)]**</sup>
    FlorisBoard Beta:  <sup>**[[IzzyOnDroid](https://apt.izzysoft.de/packages/dev.patrickgold.florisboard.beta)]**</sup>
* [**FairScan**](https://github.com/pynicolas/FairScan) <sup>[**[F-Droid](https://f-droid.org/packages/org.fairscan.app)]**</sup>

## – Tutorials and Guides –

* [**Open Android Projects**](doc/OpenAndroidProjects.md)
* [**IzzyOnDroid F-Droid Repository**](https://apt.izzysoft.de/fdroid/) / [**IzzyOnDroid Website**](https://izzyondroid.org/)
`;

test("parses sections, categories and entries in order", () => {
  const { entries, categories, anomalies } = parseAndroidFoss(FIXTURE);
  assert.deepEqual(anomalies, []);
  assert.deepEqual(
    categories.map((c) => [c.id, c.name, c.section]),
    [
      ["android-foss/app-store", "App Store", null],
      ["android-foss/apps-keyboard", "Keyboard", "Apps"],
      ["android-foss/tutorials-and-guides", "Tutorials and Guides", null],
    ],
  );
  assert.deepEqual(
    entries.map((e) => e.name),
    ["F-Droid", "Droid-ify", "Accrescent", "FlorisBoard", "FairScan", "Open Android Projects", "IzzyOnDroid F-Droid Repository"],
  );
});

test("ignores the table of contents before the first section and records it as skipped", () => {
  const { entries, skipped } = parseAndroidFoss(FIXTURE);
  assert.ok(entries.every((e) => e.name !== "Apps"));
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]?.items, 1);
});

test("links a nested entry to its parent and resets at the next top-level entry", () => {
  const { entries } = parseAndroidFoss(FIXTURE);
  assert.equal(entries[1]?.parent, 0);
  assert.equal(entries[2]?.parent, null);
});

test("extracts package ids from both badge kinds", () => {
  const { entries } = parseAndroidFoss(FIXTURE);
  assert.deepEqual(entries[1]?.channels, [
    { type: "fdroid", pkg: "com.looker.droidify", variant: null },
    { type: "izzy", pkg: "com.looker.droidify", variant: null },
  ]);
});

test("attaches a variant line to the preceding entry as a labeled channel", () => {
  const { entries } = parseAndroidFoss(FIXTURE);
  assert.deepEqual(entries[3]?.channels.at(-1), { type: "izzy", pkg: "dev.patrickgold.florisboard.beta", variant: "FlorisBoard Beta" });
});

test("tolerates misplaced emphasis markers around a badge", () => {
  const { entries } = parseAndroidFoss(FIXTURE);
  assert.equal(entries[4]?.channels[0]?.pkg, "org.fairscan.app");
});

test("resolves relative links against the upstream repository", () => {
  const { entries } = parseAndroidFoss(FIXTURE);
  assert.equal(entries[5]?.url, "https://github.com/offa/android-foss/blob/master/doc/OpenAndroidProjects.md");
});

test("keeps a second link on the same line", () => {
  const { entries } = parseAndroidFoss(FIXTURE);
  assert.deepEqual(entries[6]?.extraLinks, [{ name: "IzzyOnDroid Website", url: "https://izzyondroid.org/" }]);
});

test("marks guides and further reading as resources, apps as apps", () => {
  const { entries } = parseAndroidFoss(FIXTURE);
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["app", "app", "app", "app", "app", "resource", "resource"],
  );
});

test("numbers entries within their category", () => {
  const { entries } = parseAndroidFoss(FIXTURE);
  assert.deepEqual(
    entries.map((e) => e.order),
    [0, 1, 2, 0, 1, 0, 1],
  );
});

test("reports a line it cannot classify instead of dropping it", () => {
  const { anomalies } = parseAndroidFoss("## – Apps –\n\nSome stray prose\n");
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]?.kind, "unrecognized-line");
});

test("reports trailing text it cannot interpret", () => {
  const { anomalies } = parseAndroidFoss("## – Apps –\n\n* [**App**](https://example.org) (paid)\n");
  assert.equal(anomalies[0]?.kind, "unparsed-trailing-text");
});

test("refuses a non-http link and records it", () => {
  const { entries, anomalies } = parseAndroidFoss("## – Apps –\n\n* [**Bad**](javascript:alert(1))\n");
  assert.equal(entries.length, 0);
  assert.equal(anomalies[0]?.kind, "unsafe-url");
});

test("records a badge whose link names no package", () => {
  const { entries, anomalies } = parseAndroidFoss(
    "## – Apps –\n\n* [**App**](https://example.org) <sup>**[[F-Droid](https://f-droid.org/en/about/)]**</sup>\n",
  );
  assert.equal(anomalies[0]?.kind, "unrecognized-store-link");
  assert.deepEqual(entries[0]?.channels, []);
  assert.equal(entries[0]?.extraLinks[0]?.url, "https://f-droid.org/en/about/");
});

test("reports a nested entry with nothing to nest under", () => {
  const { anomalies } = parseAndroidFoss("## – Apps –\n\n### • Tools\n\n    * [**Orphan**](https://example.org)\n");
  assert.equal(anomalies[0]?.kind, "nested-without-parent");
});

test("rejects a package id whose segment starts with a digit", () => {
  const { entries, anomalies } = parseAndroidFoss(
    "## – Games –\n\n### • Puzzle\n\n* [**2048**](https://example.org) <sup>**[[F-Droid](https://f-droid.org/packages/com.example.2048)]**</sup>\n",
  );
  assert.deepEqual(entries[0]?.channels, []);
  assert.equal(anomalies[0]?.kind, "unrecognized-store-link");
});
