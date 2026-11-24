import { describe, expect, test } from "vitest";
import { app, catalog } from "./fixtures.ts";
import { buildModel, type Entry, type Model } from "./model.ts";
import {
  GROUPS,
  groupNames,
  groupOf,
  levelsNote,
  namesNotShown,
  namesOffered,
  ownNamesToggle,
  permissionLists,
  permissionListsCredited,
  permissionOrigins,
  readAndroidStatements,
  rowSummaries,
  summaryLine,
  upToLine,
  type AndroidStatements,
  type LoadedNames,
} from "./permissions.ts";
import type { IndexFacts } from "./schema.ts";

const NOW = Date.parse("2026-11-11T00:00:00Z");

function index(origin: "fdroid" | "izzy", extra: Partial<IndexFacts> = {}): IndexFacts {
  return {
    origin, pkg: "org.example.app", version: "1.2", updatedAt: null, addedAt: null, minSdk: null, targetSdk: null,
    sizeBytes: null, author: null, antiFeatures: [], antiFeatureReasons: {}, permissionCount: 0, declaresShizuku: false, declaresInternet: true, ...extra,
  };
}

function subject(indexes: IndexFacts[], packages = ["org.example.app"]): { model: Model; entry: Entry } {
  const model = buildModel(catalog({ apps: [app({ id: "p", packages, index: indexes, github: null })] }), NOW);
  return { model, entry: model.byId.get("p") as Entry };
}

function loaded(origin: "fdroid" | "izzy", names: string[], count = names.length, caps: Record<string, number> = {}): LoadedNames {
  return { origin, names, caps, count };
}

/* Real level strings Android 17 states, so the expectations below are about Android's words, not invented ones. */
const ANDROID: AndroidStatements = {
  version: "17",
  apiLevel: 37,
  tag: "android-17.0.0_r1",
  permissions: new Map([
    ["android.permission.ACCEPT_HANDOVER", { protectionLevel: "dangerous", label: null }],
    ["android.permission.CAMERA", { protectionLevel: "dangerous|instant", label: "take pictures and videos" }],
    ["android.permission.POST_NOTIFICATIONS", { protectionLevel: "dangerous", label: "show notifications" }],
    ["android.permission.READ_EXTERNAL_STORAGE", { protectionLevel: "dangerous", label: "read the contents of your shared storage" }],
    ["android.permission.INTERNET", { protectionLevel: "normal|instant", label: "have full network access" }],
    ["android.permission.SYSTEM_ALERT_WINDOW", { protectionLevel: "signature|setup|appop|installer|pre23|development", label: "This app can appear on top of other apps" }],
    ["android.permission.MANAGE_EXTERNAL_STORAGE", { protectionLevel: "signature|appop|preinstalled", label: null }],
    ["android.permission.WRITE_SECURE_SETTINGS", { protectionLevel: "signature|privileged|development|role|installer", label: null }],
  ]),
};

describe("groups by Android's stated level", () => {
  /* Written out by hand from Android's reference for each level and its permissions overview, not computed. */
  const EXPECTED: [string, string, string][] = [
    ["SYSTEM_ALERT_WINDOW", "signature|setup|appop|installer|pre23|development", "Special permissions"],
    ["WRITE_SETTINGS", "signature|preinstalled|appop|pre23|role", "Special permissions"],
    ["FOREGROUND_SERVICE_SPECIAL_USE", "normal|appop|instant", "Special permissions"],
    ["MANAGE_EXTERNAL_STORAGE", "signature|appop|preinstalled", "Special permissions"],
    ["PACKAGE_USAGE_STATS", "signature|privileged|development|appop|retailDemo", "Special permissions"],
    ["WRITE_SECURE_SETTINGS", "signature|privileged|development|role|installer", "Granted with developer tools"],
    ["CHANGE_CONFIGURATION", "signature|privileged|development|role", "Granted with developer tools"],
    ["READ_LOGS", "signature|privileged|development", "Granted with developer tools"],
    ["SET_DEFAULT_ACCOUNT_FOR_CONTACTS", "internal|role|knownSigner", "Granted with a role"],
    ["SYSTEM_CAMERA", "system|signature|role", "Granted with a role"],
    ["MANAGE_WIFI_INTERFACES", "signature|privileged|knownSigner", "Granted by signing key"],
    ["MANAGE_HOTWORD_DETECTION", "internal|preinstalled", "Granted to built-in apps"],
    ["RADIO_SCAN_WITHOUT_LOCATION", "signature|companion", "Granted to built-in apps"],
    ["BIND_ACCESSIBILITY_SERVICE", "signature", "Granted to built-in apps"],
    ["INSTALL_PACKAGES", "signature|privileged", "Granted to built-in apps"],
    ["ANSWER_PHONE_CALLS", "dangerous|runtime", "Runtime permissions"],
    ["CAMERA", "dangerous|instant", "Runtime permissions"],
    ["INTERNET", "normal|instant", "Normal permissions"],
  ];

  test.each(EXPECTED)("%s (%s) is under “%s”", (_name, level, heading) => {
    expect(GROUPS.find((group) => group.id === groupOf(level))?.heading).toBe(heading);
  });

  test("the committed table states each of those levels as written above", async () => {
    const { permissions } = (await import("../../../pipeline/android/permissions.json")).default as { permissions: { name: string; protectionLevel: string }[] };
    const stated = new Map(permissions.map((row) => [row.name.replace(/^android\.permission\./, ""), row.protectionLevel]));
    expect(EXPECTED.map(([name]) => [name, stated.get(name)])).toEqual(EXPECTED.map(([name, level]) => [name, level]));
  });

  test("a level no heading is true of, or no statement at all, is in other names", () => {
    expect(groupOf(undefined)).toBe("other");
    expect(groupOf("signature|pre23")).toBe("other");
    expect(groupOf("signature|instant")).toBe("other");
    expect(groupOf("signature|somethingNew")).toBe("other");
    expect(groupOf("")).toBe("other");
  });

  test("no heading uses a word the interface keeps out", () => {
    for (const { heading } of GROUPS) expect(heading).not.toMatch(/dangerous|safe|risk|sensitive/i);
  });

  test("names keep their index order inside a group, the app's own are apart, and a name with a label carries it", () => {
    const names = [
      "android.permission.INTERNET", "android.permission.POST_NOTIFICATIONS", "android.permission.CAMERA", "com.vendor.push.RECEIVE",
      "org.example.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION", "org.example.application.OTHER",
    ];
    const { groups, own } = groupNames(names, {}, ["org.example.app"], ANDROID);
    expect(own).toEqual(["org.example.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"]);
    expect(groups.map((group) => [group.id, group.names.map((item) => [item.name, item.label])])).toEqual([
      ["runtime", [["android.permission.POST_NOTIFICATIONS", "show notifications"], ["android.permission.CAMERA", "take pictures and videos"]]],
      ["normal", [["android.permission.INTERNET", "have full network access"]]],
      ["other", [["com.vendor.push.RECEIVE", null], ["org.example.application.OTHER", null]]],
    ]);
  });

  test("a name declared only up to an API level below Android's is in a group of its own, with its version, and a cap at or above it changes nothing", () => {
    const { groups } = groupNames(
      ["android.permission.CAMERA", "android.permission.READ_EXTERNAL_STORAGE", "android.permission.POST_NOTIFICATIONS"],
      { "android.permission.READ_EXTERNAL_STORAGE": 18, "android.permission.CAMERA": 37, "android.permission.POST_NOTIFICATIONS": 40 },
      [],
      ANDROID,
    );
    expect(groups.map((group) => [group.heading, group.names])).toEqual([
      ["Runtime permissions", [{ name: "android.permission.CAMERA", label: "take pictures and videos", upTo: null }, { name: "android.permission.POST_NOTIFICATIONS", label: "show notifications", upTo: null }]],
      ["For earlier Android versions", [{ name: "android.permission.READ_EXTERNAL_STORAGE", label: null, upTo: 18 }]],
    ]);
    expect(upToLine(18)).toBe("Up to API level 18");
    expect(upToLine(28)).toBe("Up to Android 9");
  });

  test("without Android's statements every name is in other names, none has a label, and a cap is still shown", () => {
    const { groups } = groupNames(["android.permission.CAMERA", "android.permission.READ_EXTERNAL_STORAGE"], { "android.permission.READ_EXTERNAL_STORAGE": 18 }, [], null);
    expect(groups).toEqual([{ id: "other", heading: "Other names", names: [{ name: "android.permission.CAMERA", label: null, upTo: null }, { name: "android.permission.READ_EXTERNAL_STORAGE", label: null, upTo: 18 }] }]);
  });
});

describe("the lists when the names are open", () => {
  test("the names are asked of each index that counts at least one", () => {
    const { entry } = subject([index("fdroid", { permissionCount: 0 }), index("izzy", { permissionCount: 2 })]);
    expect(permissionOrigins(entry)).toEqual(["izzy"]);
  });

  test("indexes that list the same names with the same caps share one list naming both; lists that differ stay apart, F-Droid first", () => {
    const { model, entry } = subject([index("fdroid", { permissionCount: 2 }), index("izzy", { permissionCount: 2 })]);
    const same = ["android.permission.CAMERA", "android.permission.INTERNET"];
    expect(permissionLists(model, entry, [loaded("izzy", same), loaded("fdroid", [...same])], ANDROID).map((list) => list.sources)).toEqual([["F-Droid", "IzzyOnDroid"]]);
    expect(permissionLists(model, entry, [loaded("izzy", same, 2, { "android.permission.CAMERA": 18 }), loaded("fdroid", [...same])], ANDROID).map((list) => list.sources))
      .toEqual([["F-Droid"], ["IzzyOnDroid"]]);
    const apart = permissionLists(model, entry, [loaded("izzy", ["b.x.Y"]), loaded("fdroid", ["a.x.Y"])], ANDROID);
    expect(apart.map((list) => [list.sources, list.groups[0]?.names[0]?.name])).toEqual([[["F-Droid"], "a.x.Y"], [["IzzyOnDroid"], "b.x.Y"]]);
  });

  test("a list says how many of the names its index counts are not shown, and a list of none still says so", () => {
    const { model, entry } = subject([index("fdroid", { permissionCount: 4 })]);
    expect(permissionLists(model, entry, [loaded("fdroid", ["a.x.Y", "b.x.Y"], 4)], ANDROID)[0]?.hidden).toBe(2);
    expect(permissionLists(model, entry, [loaded("fdroid", [], 3)], ANDROID)).toEqual([{ sources: ["F-Droid"], groups: [], own: [], hidden: 3 }]);
    expect(permissionLists(model, entry, [loaded("fdroid", [], 0)], ANDROID)).toEqual([]);
    expect(namesNotShown(1)).toBe("1 name not shown");
    expect(namesNotShown(12)).toBe("12 names not shown");
  });

  test("the app's own names come from every package id the app and its indexes name, and their fold says what it holds open and closed", () => {
    const { model, entry } = subject([index("fdroid", { permissionCount: 2, pkg: "org.example.app.fdroid" })], ["org.example.app"]);
    const [list] = permissionLists(model, entry, [loaded("fdroid", ["org.example.app.P", "org.example.app.fdroid.Q"])], ANDROID);
    expect(list?.own).toEqual(["org.example.app.P", "org.example.app.fdroid.Q"]);
    expect(list?.groups).toEqual([]);
    expect(ownNamesToggle(2, false)).toBe("Show 2 names under the app's package");
    expect(ownNamesToggle(1, true)).toBe("Hide 1 name under the app's package");
  });

  test("every list names its index when the app is in more than one index, even when only one counts permissions", () => {
    expect(permissionListsCredited(subject([index("fdroid", { permissionCount: 5 })]).entry)).toBe(false);
    expect(permissionListsCredited(subject([index("fdroid", { permissionCount: 5 }), index("izzy", { permissionCount: 0 })]).entry)).toBe(true);
  });
});

describe("the closed row", () => {
  const { model, entry } = subject([index("fdroid", { permissionCount: 3 }), index("izzy", { permissionCount: 2 })]);
  const names = (summary: { runtime: { name: string }[]; special: { name: string }[] }): string[][] => [summary.runtime.map((item) => item.name), summary.special.map((item) => item.name)];

  test("names the runtime and the special permissions each index lists, always both kinds", () => {
    const both = loaded("fdroid", ["android.permission.CAMERA", "android.permission.INTERNET", "android.permission.SYSTEM_ALERT_WINDOW"]);
    const [summary] = rowSummaries(model, entry, [both], ANDROID);
    expect(summary?.sources).toEqual(["F-Droid"]);
    expect(summary && names(summary)).toEqual([["android.permission.CAMERA"], ["android.permission.SYSTEM_ALERT_WINDOW"]]);
    expect(summaryLine(1, 1, true)).toBe("Declares 1 runtime and 1 special permission");
    expect(summaryLine(3, 2, true)).toBe("Declares 3 runtime and 2 special permissions");
    expect(summaryLine(2, 0, true)).toBe("Declares 2 runtime and no special permissions");
    expect(summaryLine(0, 1, true)).toBe("Declares no runtime and 1 special permission");
    expect(summaryLine(0, 0, true)).toBe("Declares no runtime or special permissions");
  });

  test("in each kind, names with a label come before names without one, each part in the list's order", () => {
    const list = loaded("fdroid", [
      "android.permission.ACCEPT_HANDOVER",
      "android.permission.MANAGE_EXTERNAL_STORAGE",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.SYSTEM_ALERT_WINDOW",
      "android.permission.CAMERA",
    ]);
    const [summary] = rowSummaries(model, entry, [list], ANDROID);
    expect(summary && names(summary)).toEqual([
      ["android.permission.POST_NOTIFICATIONS", "android.permission.CAMERA", "android.permission.ACCEPT_HANDOVER"],
      ["android.permission.SYSTEM_ALERT_WINDOW", "android.permission.MANAGE_EXTERNAL_STORAGE"],
    ]);
  });

  test("a name Android states nothing about leaves no \"no\": with neither kind the row says nothing of kinds", () => {
    const [summary] = rowSummaries(model, entry, [loaded("fdroid", ["moe.shizuku.manager.permission.API_V23", "android.permission.INTERNET"])], ANDROID);
    expect(summary).toBeUndefined();
  });

  test("a name Android states nothing about leaves only the kinds found", () => {
    const [summary] = rowSummaries(model, entry, [loaded("fdroid", ["moe.shizuku.manager.permission.API_V23", "android.permission.SYSTEM_ALERT_WINDOW"])], ANDROID);
    expect(summary && names(summary)).toEqual([[], ["android.permission.SYSTEM_ALERT_WINDOW"]]);
    expect(summary?.whole).toBe(false);
    expect(summaryLine(0, 1, false)).toBe("Declares 1 special permission");
    expect(summaryLine(2, 0, false)).toBe("Declares 2 runtime permissions");
    expect(summaryLine(1, 3, false)).toBe("Declares 1 runtime and 3 special permissions");
  });

  test("the app's own names do not stand in the way of a \"no\"", () => {
    const [summary] = rowSummaries(model, entry, [loaded("fdroid", ["org.example.app.permission.RECEIVE"])], ANDROID);
    expect(summary && names(summary)).toEqual([[], []]);
    expect(summary?.whole).toBe(true);
  });

  test("an index and another whose list Android states nothing about do not share a line", () => {
    const fdroid = loaded("fdroid", ["android.permission.CAMERA"]);
    const izzy = loaded("izzy", ["android.permission.CAMERA", "moe.shizuku.manager.permission.API_V23"]);
    expect(rowSummaries(model, entry, [fdroid, izzy], ANDROID).map((summary) => [summary.sources, summary.whole])).toEqual([[["F-Droid"], true], [["IzzyOnDroid"], false]]);
  });

  test("\"Show names\" is offered when a list read holds names, or none was read; not when every list read is empty", () => {
    expect(namesOffered([loaded("fdroid", ["android.permission.CAMERA"])])).toBe(true);
    expect(namesOffered([])).toBe(true);
    expect(namesOffered([loaded("fdroid", [], 4)])).toBe(false);
  });

  test("an app with special permissions only is not told it has nothing to grant", () => {
    const [summary] = rowSummaries(model, entry, [loaded("izzy", ["android.permission.MANAGE_EXTERNAL_STORAGE", "android.permission.INTERNET"])], ANDROID);
    expect(summary && names(summary)).toEqual([[], ["android.permission.MANAGE_EXTERNAL_STORAGE"]]);
  });

  test("a name declared only for earlier versions is not in the summary", () => {
    const capped = loaded("fdroid", ["android.permission.READ_EXTERNAL_STORAGE", "android.permission.INTERNET"], 2, { "android.permission.READ_EXTERNAL_STORAGE": 18 });
    const [summary] = rowSummaries(model, entry, [capped], ANDROID);
    expect(summary && names(summary)).toEqual([[], []]);
  });

  test("indexes that give the same names share a line, and different ones get a line each, F-Droid first", () => {
    const fdroid = loaded("fdroid", ["android.permission.CAMERA"]);
    expect(rowSummaries(model, entry, [loaded("izzy", ["android.permission.CAMERA", "android.permission.INTERNET"]), fdroid], ANDROID).map((summary) => summary.sources)).toEqual([["F-Droid", "IzzyOnDroid"]]);
    expect(rowSummaries(model, entry, [loaded("izzy", ["android.permission.INTERNET"]), fdroid], ANDROID).map((summary) => summary.sources)).toEqual([["F-Droid"], ["IzzyOnDroid"]]);
  });

  test("says nothing of a list shorter than its count, of an index that counts none, or without Android's statements", () => {
    expect(rowSummaries(model, entry, [loaded("fdroid", ["android.permission.CAMERA"], 4)], ANDROID)).toEqual([]);
    expect(rowSummaries(model, entry, [loaded("izzy", [], 0)], ANDROID)).toEqual([]);
    expect(rowSummaries(model, entry, [loaded("fdroid", ["android.permission.CAMERA"])], null)).toEqual([]);
  });
});

describe("reading Android's part", () => {
  const part = {
    header: {},
    android: { version: "17", apiLevel: 37, tag: "android-17.0.0_r1", commit: "a".repeat(40) },
    permissions: {
      "android.permission.CAMERA": { protectionLevel: "dangerous", label: "take pictures and videos" },
      "android.permission.NO_LABEL": { protectionLevel: "normal", label: null },
      "android.permission.BAD_LABEL": { protectionLevel: "normal", label: "a\u0000b" },
      "two words": { protectionLevel: "normal", label: null },
      "android.permission.BAD_LEVEL": { protectionLevel: "<b>normal</b>", label: null },
      "android.permission.NOT_RECORD": "dangerous",
    },
  };

  test("keeps each well-formed statement, drops a label that is not plain text, and leaves out a row in no expected form", () => {
    const read = readAndroidStatements(part);
    expect([read?.version, read?.apiLevel]).toEqual(["17", 37]);
    expect([...(read?.permissions.keys() ?? [])]).toEqual(["android.permission.CAMERA", "android.permission.NO_LABEL", "android.permission.BAD_LABEL"]);
    expect(read?.permissions.get("android.permission.BAD_LABEL")).toEqual({ protectionLevel: "normal", label: null });
    expect(read && levelsNote(read)).toBe("As Android 17 states them in its release's default configuration. A declared permission is not always used. Other versions can differ.");
  });

  test("a part not in the expected form gives no statements", () => {
    expect(readAndroidStatements(null)).toBeNull();
    expect(readAndroidStatements({ ...part, android: { ...part.android, version: "seventeen" } })).toBeNull();
    expect(readAndroidStatements({ ...part, android: { ...part.android, apiLevel: undefined } })).toBeNull();
    expect(readAndroidStatements({ ...part, android: { ...part.android, apiLevel: 37.5 } })).toBeNull();
    expect(readAndroidStatements({ ...part, permissions: [] })).toBeNull();
    const many = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`a.P${i}`, { protectionLevel: "normal", label: null }]));
    expect(readAndroidStatements({ ...part, permissions: many })).toBeNull();
  });
});
