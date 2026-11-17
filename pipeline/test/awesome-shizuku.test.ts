/**
 * awesome-shizuku parser. The fixture follows the list's format (CC-BY-SA-3.0,
 * timschneeb/awesome-shizuku); entries are invented except for the format.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyToken, parseAwesomeShizuku } from "../sources/awesome-shizuku.ts";

const README = `# awesome-shizuku

Intro prose.

> [!NOTE]
> Top-level note about changelogs.

- [Apps](#apps)

--------------------

## Apps

### Shizuku implementations

> [!NOTE]
> The official app is broken on Android 17.
>
> Uninstall it first.

* [Alpha](https://github.com/example/alpha) - First fork \`Apache-2.0\`
* [Beta](https://github.com/example/beta) ✨ - Second fork \`MIT\`
  * [Beta Plus](https://github.com/example/beta-plus) - Fork of Beta \`MIT\`

### Audio

* [Gamma](https://play.google.com/store/apps/details?id=org.example.gamma) \`Paid\` 💰 - Paid equalizer with \`code\` in text \`GPL-3.0\` [(Source code)](https://github.com/example/gamma)
* [Delta](https://f-droid.org/packages/org.example.delta/) \`15-day trial\` \`IAP\` 💰 - Trial app \`Proprietary\`
* [Epsilon](https://github.com/example/epsilon) \`Root\` - Needs root, see [CVE](https://nvd.nist.gov/vuln/detail/cve-0000-0000) \`PolyForm-Noncommercial-1.0.0\`
* [Zeta](https://github.com/example/zeta) \`Shiny\` - Unknown tag \`MIT\`
* [Eta](https://example.org/eta) - No license here
  * Eta has forks, including [EtaX](https://github.com/example/etax) and [EtaY](https://github.com/example/etay)

### Vendor-specific

#### Samsung OneUI

* [Theta](https://github.com/example/theta) - Samsung tweak \`MIT\`

### Closed-source apps

Closed-source apps live elsewhere.

> [!NOTE]
> Why they are separate.

--------------------

## Development libraries

### Core

* [LibA](https://github.com/example/liba) - A library \`MIT\`

## Annotations
- ✨ - Recommendation
- \`Paid\` 💰 - Paid application
- \`IAP\` 💰 - In-app purchases
- \`Ads\` - Contains ads
- \`Proprietary\` - Not FOSS
- \`n-day trial\` - Trial
- \`Root\` - Root mode

## License

CC-BY-SA-3.0.
`;

const CLOSED = `# awesome-shizuku (closed-source apps)

> [!NOTE]
> Page-level note.

## Closed-source apps

### Audio

* [Iota](https://play.google.com/store/apps/details?id=org.example.iota) - Closed EQ \`Proprietary\` \`No Ads\`

### Terminals

* [Kappa](https://example.org/kappa) - Shell \`Proprietary\`


> [!NOTE]
> Use rish with any terminal.
`;

const ARCHIVED = `## Archived apps

All projects in this section have been abandoned.

* [Lambda](https://github.com/example/lambda) - Old app \`No license\`
`;

const FILES: Record<string, string> = { "README.md": README, "pages/CLOSED_SOURCE.md": CLOSED, "pages/ARCHIVED.md": ARCHIVED };
const parse = () => parseAwesomeShizuku((file) => FILES[file] ?? "");

test("reads categories from the main list, vendor sub-sections, the closed-source page and the archive", () => {
  const { categories } = parse();
  assert.deepEqual(
    categories.map((c) => [c.id, c.section]),
    [
      ["awesome-shizuku/shizuku-implementations", "Apps"],
      ["awesome-shizuku/audio", "Apps"],
      ["awesome-shizuku/vendor-samsung-oneui", "Vendor-specific"],
      ["awesome-shizuku/closed-audio", "Closed-source apps"],
      ["awesome-shizuku/closed-terminals", "Closed-source apps"],
      ["awesome-shizuku/archived", null],
    ],
  );
});

test("carries category notes, including multi-paragraph admonitions and prose under a heading", () => {
  const { categories } = parse();
  const byId = new Map(categories.map((c) => [c.id, c.note]));
  assert.equal(byId.get("awesome-shizuku/shizuku-implementations"), "The official app is broken on Android 17.\n\nUninstall it first.");
  assert.equal(byId.get("awesome-shizuku/closed-terminals"), "Use rish with any terminal.");
  assert.equal(byId.get("awesome-shizuku/archived"), "All projects in this section have been abandoned.");
  assert.equal(byId.get("awesome-shizuku/audio"), null);
});

test("a quoted line that is only a link is a pointer, not a note on the category: it is reported and kept off the category", () => {
  const readme = "# list\n\n## Apps\n\n### Audio\n\n> [See here more audio apps (closed-source)](pages/CLOSED_SOURCE.md#audio)\n\n> Real advice about audio, with a [link](https://example.org/a) inside.\n\n* [Gamma](https://github.com/example/gamma) - An equalizer `MIT`\n";
  const { categories, notes } = parseAwesomeShizuku((file) => (file === "README.md" ? readme : ""));
  assert.equal(categories.find((c) => c.id === "awesome-shizuku/audio")?.note, "Real advice about audio, with a link inside.");
  assert.ok(notes.some((n) => n.text === "See here more audio apps (closed-source)" && n.placement.startsWith("a link alone under “Audio”")));
});

test("keeps notes outside categories as loose notes with their placement", () => {
  const { notes } = parse();
  assert.ok(notes.some((n) => n.text === "Top-level note about changelogs." && n.placement === "page introduction"));
  assert.ok(notes.some((n) => n.text === "Closed-source apps live elsewhere." && n.placement.includes("Closed-source apps")));
  assert.ok(notes.some((n) => n.file === "pages/CLOSED_SOURCE.md" && n.text === "Page-level note."));
});

test("parses names, links, descriptions, licenses and tags", () => {
  const { entries } = parse();
  const gamma = entries.find((e) => e.name === "Gamma");
  assert.deepEqual(gamma?.tags, ["paid"]);
  assert.equal(gamma?.license, "GPL-3.0");
  assert.equal(gamma?.description, "Paid equalizer with code in text");
  assert.equal(gamma?.sourceCode, "https://github.com/example/gamma");
  assert.deepEqual(gamma?.channels, [{ type: "play", pkg: "org.example.gamma", variant: null }]);
  const beta = entries.find((e) => e.name === "Beta");
  assert.deepEqual(beta?.tags, ["recommended"]);
});

test("normalizes trial tags and marks Proprietary in the main list as source-available", () => {
  const { entries } = parse();
  const delta = entries.find((e) => e.name === "Delta");
  assert.deepEqual(delta?.tags, ["iap", "source-available", "trial"]);
  assert.deepEqual(delta?.channels, [{ type: "fdroid", pkg: "org.example.delta", variant: null }]);
  const epsilon = entries.find((e) => e.name === "Epsilon");
  assert.deepEqual(epsilon?.tags, ["root", "source-available"]);
  assert.deepEqual(epsilon?.extraLinks, [{ name: "CVE", url: "https://nvd.nist.gov/vuln/detail/cve-0000-0000" }]);
});

test("tags every closed-source page entry closed-source and every archived entry archived", () => {
  const { entries } = parse();
  assert.deepEqual(entries.find((e) => e.name === "Iota")?.tags, ["closed-source"]);
  assert.deepEqual(entries.find((e) => e.name === "Lambda")?.tags, ["archived"]);
});

test("records an unknown tag as an anomaly without dropping the entry", () => {
  const { entries, anomalies, unknownTokens } = parse();
  assert.ok(entries.some((e) => e.name === "Zeta"));
  assert.ok(anomalies.some((a) => a.kind === "unknown-tag" && a.text.includes("Shiny")));
  assert.ok(unknownTokens.some((t) => t.token === "Shiny"));
});

test("records an entry without a license as an anomaly", () => {
  const { anomalies } = parse();
  assert.ok(anomalies.some((a) => a.kind === "missing-license" && a.text.includes("Eta")));
});

test("nests forks under their parent and folds prose sub-bullets into the parent's links", () => {
  const { entries, notes } = parse();
  const beta = entries.findIndex((e) => e.name === "Beta");
  assert.equal(entries.find((e) => e.name === "Beta Plus")?.parent, beta);
  const eta = entries.find((e) => e.name === "Eta");
  assert.deepEqual(
    eta?.extraLinks.map((l) => l.name),
    ["EtaX", "EtaY"],
  );
  assert.ok(notes.some((n) => n.placement.startsWith("attached to “Eta”")));
});

test("skips development libraries, annotations and the license section, counting their items", () => {
  const { entries, skipped } = parse();
  assert.ok(!entries.some((e) => e.name === "LibA"));
  const libraries = skipped.find((s) => s.heading === "Development libraries");
  assert.equal(libraries?.items, 1);
  assert.ok(skipped.some((s) => s.heading === "Annotations"));
  assert.ok(skipped.some((s) => s.heading === "License"));
});

test("has no anomalies other than the deliberate ones", () => {
  const { anomalies } = parse();
  assert.deepEqual(anomalies.map((a) => a.kind).sort(), ["missing-license", "unknown-tag"]);
});

test("flags an annotation the parser does not know and an unknown section", () => {
  const readme = README.replace("- `Root` - Root mode", "- `Root` - Root mode\n- `NSFW` - Adult").replace("## Annotations", "## Mystery\n\n* [X](https://x.example) - x `MIT`\n\n## Annotations");
  const { anomalies, entries } = parseAwesomeShizuku((file) => (file === "README.md" ? readme : (FILES[file] ?? "")));
  assert.ok(anomalies.some((a) => a.kind === "unknown-annotation"));
  assert.ok(anomalies.some((a) => a.kind === "unknown-section"));
  assert.ok(!entries.some((e) => e.name === "X"));
});

test("records the file of every anomaly, without prefixing its text", () => {
  const closed = CLOSED.replace("### Audio", "### Audio\n\nstray text after nothing\n* [Mu](https://example.org/mu) - m `MIT`\nmore stray");
  const { anomalies } = parseAwesomeShizuku((file) => (file === "pages/CLOSED_SOURCE.md" ? closed : (FILES[file] ?? "")));
  const closedAnomaly = anomalies.find((a) => a.kind === "unrecognized-line");
  assert.equal(closedAnomaly?.file, "pages/CLOSED_SOURCE.md");
  assert.equal(closedAnomaly?.text, "more stray");
});

test("classifies the annotation vocabulary", () => {
  assert.deepEqual(classifyToken("✨"), { known: true, tag: "recommended" });
  assert.deepEqual(classifyToken("7-day trial"), { known: true, tag: "trial" });
  assert.deepEqual(classifyToken("15-minute trial"), { known: true, tag: "trial" });
  assert.deepEqual(classifyToken("No Ads"), { known: true, tag: null });
  assert.deepEqual(classifyToken("Shiny"), { known: false, tag: null });
});

test("refuses a non-http entry link", () => {
  const readme = README.replace("* [Alpha](https://github.com/example/alpha)", "* [Alpha](javascript:alert(1))");
  const { anomalies, entries } = parseAwesomeShizuku((file) => (file === "README.md" ? readme : (FILES[file] ?? "")));
  assert.ok(!entries.some((e) => e.name === "Alpha"));
  assert.ok(anomalies.some((a) => a.kind === "unsafe-url" || a.kind === "unparsed-entry"));
});
