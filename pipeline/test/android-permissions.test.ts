import assert from "node:assert/strict";
import { test } from "node:test";
import {
  androidVersionOf,
  buildTable,
  checkAndroidTable,
  isProtectionLevel,
  parseBuildFlagValue,
  parseFlagValues,
  parseReleaseConfig,
  permissionDeclarations,
  readAndroidTable,
  resolveFlags,
  resourceText,
  serializeTable,
  stringResources,
  type AndroidTable,
  type ReleaseConfig,
} from "../lib/android-permissions.ts";
import { parseXml } from "../lib/xml.ts";

/* Invented in the shape of core/res/AndroidManifest.xml: no declaration is copied from Android. */
const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<!-- A comment with <permission android:name="x.y.IN_A_COMMENT"/> &Tab; inside. -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="android">
    <permission android:name="org.fixture.permission.PICTURES"
        android:label="@string/permlab_pictures"
        android:protectionLevel="dangerous|instant" />
    <permission android:name="org.fixture.permission.NETWORK"
        android:label="@string/permlab_network" />
    <permission android:name="org.fixture.permission.TYPO"
        android.label="@string/permlab_network"
        android:protectionLevel="dangerous" />
    <permission android:name="org.fixture.permission.OVERLAY"
        android:label="@string/permlab_overlay"
        android:protectionLevel="signature|setup|appop|pre23|development" />
    <permission android:name="org.fixture.permission.NEW_THING"
        android:featureFlag="org.fixture.flags.new_thing"
        android:protectionLevel="dangerous" />
    <permission android:name="org.fixture.permission.SWITCHED"
        android:featureFlag="!org.fixture.flags.switched"
        android:protectionLevel="signature" />
    <permission android:name="org.fixture.permission.SWITCHED"
        android:featureFlag="org.fixture.flags.switched"
        android:protectionLevel="signature|role" />
    <permission android:name="org.fixture.permission.UNSET"
        android:featureFlag="org.fixture.flags.unset"
        android:protectionLevel="normal" />
    <permission android:name="org.fixture.permission.WIDE"
        android:label="@string/permlab_wide"
        android:protectionLevel="normal" />
    <application android:label="ignored" />
</manifest>
`;

const STRINGS = `<?xml version="1.0" encoding="utf-8"?>
<resources xmlns:xliff="urn:oasis:names:tc:xliff:document:1.2">
    <string name="permlab_pictures">take invented pictures</string>
    <string name="permlab_network">reach the invented
        network \\"freely\\" and don\\'t ask</string>
    <string name="permlab_overlay" product="tablet">draw over a tablet</string>
    <string name="permlab_overlay" product="default">draw over &lt;other&gt; apps</string>
    <string name="permlab_wide">use <xliff:g id="what">%1$s</xliff:g> widely</string>
    <string name="unrelated">"  kept  spaces  "</string>
</resources>
`;

const FLAGS = new Map([
  ["org.fixture.flags.new_thing", true],
  ["org.fixture.flags.switched", true],
]);

test("declarations are the permission elements under the manifest, and nothing in a comment", () => {
  const declarations = permissionDeclarations(MANIFEST);
  assert.deepEqual(declarations.map((d) => d.name), [
    "org.fixture.permission.PICTURES",
    "org.fixture.permission.NETWORK",
    "org.fixture.permission.TYPO",
    "org.fixture.permission.OVERLAY",
    "org.fixture.permission.NEW_THING",
    "org.fixture.permission.SWITCHED",
    "org.fixture.permission.SWITCHED",
    "org.fixture.permission.UNSET",
    "org.fixture.permission.WIDE",
  ]);
  assert.equal(declarations[1]?.protectionLevel, "normal", "a declaration with no level is normal, as Android reads it");
  assert.equal(declarations[2]?.label, null, "a label outside Android's namespace is not Android's label");
});

test("the table keeps each name's level as stated and its label's English text, as Android resolves the string", () => {
  const { rows, counts } = buildTable(permissionDeclarations(MANIFEST), stringResources(STRINGS), FLAGS);
  assert.deepEqual(rows, [
    { name: "org.fixture.permission.NETWORK", protectionLevel: "normal", label: `reach the invented network "freely" and don't ask` },
    { name: "org.fixture.permission.NEW_THING", protectionLevel: "dangerous", label: null },
    { name: "org.fixture.permission.OVERLAY", protectionLevel: "signature|setup|appop|pre23|development", label: "draw over <other> apps" },
    { name: "org.fixture.permission.PICTURES", protectionLevel: "dangerous|instant", label: "take invented pictures" },
    { name: "org.fixture.permission.SWITCHED", protectionLevel: "signature|role", label: null },
    { name: "org.fixture.permission.TYPO", protectionLevel: "dangerous", label: null },
    { name: "org.fixture.permission.WIDE", protectionLevel: "normal", label: null },
  ]);
  assert.deepEqual(counts, { declarations: 9, leftOutByFlag: 2, flagNotSet: 1, rows: 7, labels: 3 });
});

test("a label with a format placeholder is not a label", () => {
  const strings = stringResources(STRINGS);
  assert.equal(strings.get("permlab_wide"), "use %1$s widely");
  const { rows } = buildTable(permissionDeclarations(MANIFEST), strings, FLAGS);
  assert.equal(rows.find((row) => row.name.endsWith("WIDE"))?.label, null);
});

test("string escapes, quotes and whitespace follow Android's rules", () => {
  assert.equal(resourceText(`  two   words\n  here  `), "two words here");
  assert.equal(resourceText(`"  kept  "`), "  kept  ");
  assert.equal(resourceText(`a\\nb\\tc\\u2011d\\@e\\?f`), "a\nb\tc‑d@e?f");
  assert.throws(() => resourceText("ends in \\"));
  assert.throws(() => resourceText("bad \\u12"));
});

test("two declarations of one name that both hold for the release are refused", () => {
  const both = permissionDeclarations(MANIFEST.replace(`android:featureFlag="!org.fixture.flags.switched"`, ""));
  assert.throws(() => buildTable(both, stringResources(STRINGS), FLAGS), /declared twice/);
});

test("malformed manifests and strings are refused", () => {
  const cases: [string, string, RegExp][] = [
    ["unclosed element", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission android:name="a.B">`, /unclosed/],
    ["mismatched end", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"></resources>`, /closing/],
    ["document type", `<!DOCTYPE manifest [<!ENTITY x "y">]><manifest/>`, /document type/],
    ["unknown entity", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission android:name="a.B&x;"/></manifest>`, /unknown entity/],
    ["bare ampersand", `<manifest xmlns:android="http://schemas.android.com/apk/res/android">a & b</manifest>`, /bare ampersand/],
    ["second root", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"/><manifest/>`, /second root/],
    ["unquoted attribute", `<manifest xmlns:android=x/>`, /without quotes/],
    ["no namespace", `<manifest><permission name="a.B"/></manifest>`, /namespace/],
    ["wrong root", `<resources xmlns:android="http://schemas.android.com/apk/res/android"/>`, /not <manifest>/],
    ["bad name", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission android:name="two words"/></manifest>`, /permission named/],
    ["unknown level", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission android:name="a.B" android:protectionLevel="dangerous|sometimes"/></manifest>`, /unknown protection level/],
    ["two bases", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission android:name="a.B" android:protectionLevel="normal|dangerous"/></manifest>`, /unknown protection level/],
    ["bad flag", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission android:name="a.B" android:featureFlag="Not A Flag"/></manifest>`, /feature flag/],
    ["empty", ``, /no root/],
    ["forbidden character reference", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission android:name="a.B&#x1;"/></manifest>`, /XML does not allow/],
    ["noncharacter reference", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission android:name="a.B&#xFFFE;"/></manifest>`, /XML does not allow/],
    ["prefix rebound", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission xmlns:android="urn:other" android:name="a.B"/></manifest>`, /binds Android/],
    ["namespace bound again", `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission xmlns:a="http://schemas.android.com/apk/res/android" a:name="a.B" a:protectionLevel="signature"/></manifest>`, /binds Android/],
    ["namespace bound twice at the root", `<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:a="http://schemas.android.com/apk/res/android"/>`, /exactly one prefix/],
  ];
  for (const [what, xml, error] of cases) assert.throws(() => permissionDeclarations(xml), error, what);
  assert.throws(() => stringResources(`<resources><string>no name</string></resources>`), /no name/);
  assert.throws(() => stringResources(`<resources><string name="a">x</string><string name="a">y</string></resources>`), /twice/);
  assert.throws(() => parseXml("<a>" + "<b>".repeat(40) + "</b>".repeat(40) + "</a>"), /nested deeper/);
  assert.throws(() => parseXml("<a/>", { characters: 3, elements: 10, depth: 4, attributesPerElement: 4 }), /longer than/);
  assert.throws(() => parseXml("<a>" + "<b/>".repeat(20) + "</a>", { characters: 1000, elements: 10, depth: 4, attributesPerElement: 4 }), /more than 10 elements/);
  assert.equal(parseXml("<a b=\"&#x9;&#x10FFFF;\"/>").attributes.get("b"), "\t\u{10FFFF}", "every character XML allows is read");

  const huge = "x".repeat(7_000_000);
  for (const document of [`<a ${huge}/>`, `<a ${huge.slice(0, 300)}="1"/>`, `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><permission android:name="${huge.slice(0, 2000)} y"/></manifest>`]) {
    try {
      permissionDeclarations(document);
      assert.fail("refused");
    } catch (error) {
      assert.ok(error instanceof Error && error.message.length < 300, `a message of ${error instanceof Error ? error.message.length : 0} characters`);
    }
  }
});

test("release flags come from every configuration a release inherits, and one set both ways is refused", () => {
  const configs = new Map<string, ReleaseConfig>(
    [
      `name: "base"\naconfig_value_sets: "set-base"`,
      `name: "mid"\ninherits: "base"\naconfig_value_sets: "set-mid"`,
      `name: "top"\ninherits: "mid"\ninherits: "base"\naconfig_value_sets: "set-top"`,
    ].map((text) => {
      const config = parseReleaseConfig(text);
      return [config.name, config];
    }),
  );
  const values = new Map([
    ["set-base", parseFlagValues(`flag_value {\n  package: "org.fixture.flags"\n  name: "a"\n  state: ENABLED\n  permission: READ_ONLY\n}\n# a comment\nflag_value { package: "org.fixture.flags" name: "b" state: DISABLED }`)],
    ["set-mid", parseFlagValues(`flag_value { package: "org.fixture.flags" name: "c" state: ENABLED }`)],
    ["set-top", parseFlagValues(`flag_value { package: "org.fixture.flags" name: "a" state: ENABLED }\nflag_value { package: "org.fixture.flags" name: "z" state: DISABLED }`)],
  ]);
  const wanted = new Set(["org.fixture.flags.a", "org.fixture.flags.b", "org.fixture.flags.c"]);
  assert.deepEqual(resolveFlags("top", configs, values, wanted), new Map([["org.fixture.flags.a", true], ["org.fixture.flags.b", false], ["org.fixture.flags.c", true]]));

  const conflicting = new Map(values).set("set-mid", parseFlagValues(`flag_value { package: "org.fixture.flags" name: "b" state: ENABLED }`));
  assert.throws(() => resolveFlags("top", configs, conflicting, wanted), /set both ways/);
  assert.doesNotThrow(() => resolveFlags("top", configs, conflicting, new Set(["org.fixture.flags.a"])), "a flag no declaration depends on is not looked at");
  assert.throws(() => resolveFlags("nowhere", configs, values, wanted), /no release configuration/);
  const cyclic = new Map(configs).set("base", { name: "base", inherits: ["top"], valueSets: [] });
  assert.throws(() => resolveFlags("top", cyclic, values, wanted), /cycle/);
  assert.throws(() => parseFlagValues(`flag_value { package: "org.fixture.flags" name: "a" state: MAYBE }`), /malformed/);
  assert.throws(() => parseReleaseConfig(`inherits: "x"`), /exactly one name/);

  const permissions = parseFlagValues(
    `flag_value { package: "org.fixture.flags" name: "ro" state: ENABLED permission: READ_ONLY }\nflag_value { package: "org.fixture.flags" name: "rw" state: DISABLED permission: READ_WRITE }\nflag_value { package: "org.fixture.flags" name: "unstated" state: ENABLED }`,
    "permission",
  );
  assert.deepEqual(permissions, new Map([["org.fixture.flags.ro", true], ["org.fixture.flags.rw", false]]), "read-only is true, read-write false, and a value that states neither is left out");
});

function fixtureTable(): AndroidTable {
  const { rows } = buildTable(permissionDeclarations(MANIFEST), stringResources(STRINGS), FLAGS);
  return {
    source: {
      name: "Android Open Source Project",
      repository: "https://android.googlesource.com/platform/frameworks/base",
      tag: "android-17.0.0_r1",
      commit: "a".repeat(40),
      files: ["core/res/AndroidManifest.xml", "core/res/res/values/strings.xml"],
      releaseRepository: "https://android.googlesource.com/platform/build/release",
      releaseCommit: "b".repeat(40),
      releaseConfig: "cp2a",
      retrieved: "2026-11-24",
      license: "Apache-2.0",
    },
    androidVersion: "17",
    apiLevel: 37,
    changes: "Extracted by Droid Atlas.",
    permissions: rows,
  };
}

test("the committed form reads back as the same table, one row per line", () => {
  const text = serializeTable(fixtureTable());
  assert.deepEqual(checkAndroidTable(JSON.parse(text)), fixtureTable());
  assert.ok(text.includes(`\n    {"name":"org.fixture.permission.NETWORK","protectionLevel":"normal","label":"reach the invented network \\"freely\\" and don't ask"},\n`));
});

test("a table that fails any check is refused when read", () => {
  const good = fixtureTable();
  const bad: [string, (t: AndroidTable) => unknown][] = [
    ["unsorted", (t) => ({ ...t, permissions: [...t.permissions].reverse() })],
    ["repeated", (t) => ({ ...t, permissions: [t.permissions[0], t.permissions[0]] })],
    ["markup label", (t) => ({ ...t, permissions: [{ ...t.permissions[0], label: "a\u0000b" }] })],
    ["long label", (t) => ({ ...t, permissions: [{ ...t.permissions[0], label: "x".repeat(201) }] })],
    ["unknown level", (t) => ({ ...t, permissions: [{ ...t.permissions[0], protectionLevel: "dangerous|maybe" }] })],
    ["bad name", (t) => ({ ...t, permissions: [{ ...t.permissions[0], name: "<script>" }] })],
    ["extra field", (t) => ({ ...t, permissions: [{ ...t.permissions[0], note: "x" }] })],
    ["other host", (t) => ({ ...t, source: { ...t.source, repository: "https://example.org/base" } })],
    ["other license", (t) => ({ ...t, source: { ...t.source, license: "MIT" } })],
    ["version not the tag's", (t) => ({ ...t, androidVersion: "16" })],
    ["API level not a whole number", (t) => ({ ...t, apiLevel: 37.5 })],
    ["API level missing", (t) => ({ ...t, apiLevel: undefined })],
    ["not a release tag", (t) => ({ ...t, source: { ...t.source, tag: "main" } })],
    ["too many rows", (t) => ({ ...t, permissions: Array.from({ length: 5001 }, (_, i) => ({ name: `a.P${String(i).padStart(5, "0")}`, protectionLevel: "normal", label: null })) })],
  ];
  for (const [what, change] of bad) assert.throws(() => checkAndroidTable(change(structuredClone(good))), Error, what);
});

test("a build flag value gives its name and string, and anything else is refused", () => {
  assert.deepEqual(parseBuildFlagValue(`name:  "RELEASE_PLATFORM_SDK_VERSION"\nvalue:  {\n  string_value:  "37"\n}\n`), { name: "RELEASE_PLATFORM_SDK_VERSION", value: "37" });
  assert.throws(() => parseBuildFlagValue(`name: "RELEASE_PLATFORM_SDK_VERSION"\nvalue: { bool_value: true }`), /string value/);
});

test("levels are a known base and known flags, each once", () => {
  assert.ok(isProtectionLevel("signature|privileged|development|appop|retailDemo"));
  assert.ok(isProtectionLevel("signatureOrSystem"));
  assert.ok(!isProtectionLevel("signature|signature"));
  assert.ok(!isProtectionLevel(""));
  assert.equal(androidVersionOf("android-17.0.0_r1"), "17");
  assert.throws(() => androidVersionOf("android-security-17.0.0_r2"));
});

test("the committed table passes its own check and names its tag", () => {
  const table = readAndroidTable();
  assert.equal(androidVersionOf(table.source.tag), table.androidVersion);
  assert.ok(table.permissions.length > 500);
  assert.ok(table.permissions.some((row) => row.name === "android.permission.INTERNET" && row.protectionLevel.split("|")[0] === "normal"));
});
