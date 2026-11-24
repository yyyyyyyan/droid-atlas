import { describe, expect, test } from "vitest";
import { app, catalog } from "./fixtures.ts";
import { buildModel, type Entry, type Model } from "./model.ts";
import {
  GROUPS,
  groupNames,
  groupOf,
  levelsNote,
  namesNotShown,
  ownNamesLine,
  permissionLists,
  permissionListsCredited,
  permissionOrigins,
  readAndroidStatements,
  runtimeLine,
  runtimeSummaries,
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

/* Invented names in the shape of Android's; the levels are words Android's reference lists. */
const ANDROID: AndroidStatements = {
  version: "17",
  tag: "android-17.0.0_r1",
  permissions: new Map([
    ["android.permission.PICTURES", { protectionLevel: "dangerous|instant", label: "take invented pictures" }],
    ["android.permission.NOTIFY", { protectionLevel: "dangerous", label: null }],
    ["android.permission.NETWORK", { protectionLevel: "normal|instant", label: "reach the network" }],
    ["android.permission.OVERLAY", { protectionLevel: "signature|setup|appop|installer|pre23|development", label: "draw over apps" }],
    ["android.permission.SPECIAL_SERVICE", { protectionLevel: "normal|appop|instant", label: null }],
    ["android.permission.SECURE_SETTINGS", { protectionLevel: "signature|privileged|development|role|installer", label: null }],
    ["android.permission.DEFAULTS", { protectionLevel: "internal|role", label: null }],
    ["android.permission.KNOWN", { protectionLevel: "signature|knownSigner", label: null }],
    ["android.permission.SYSTEM_ONLY", { protectionLevel: "signature|privileged|recents|module", label: null }],
  ]),
};

describe("groups by Android's stated level", () => {
  test("each base level and flag goes where its heading is true", () => {
    expect(groupOf("dangerous")).toBe("runtime");
    expect(groupOf("dangerous|runtime")).toBe("runtime");
    expect(groupOf("normal|appop")).toBe("special");
    expect(groupOf("signature|appop|preinstalled")).toBe("special");
    expect(groupOf("internal|appop")).toBe("special");
    expect(groupOf("normal")).toBe("install");
    expect(groupOf("normal|instant")).toBe("install");
    expect(groupOf("signature|privileged|development")).toBe("developer");
    expect(groupOf("signature|privileged|development|role")).toBe("developer");
    expect(groupOf("signature|role")).toBe("role");
    expect(groupOf("internal|role|knownSigner")).toBe("role");
    expect(groupOf("signature|knownSigner")).toBe("signer");
    expect(groupOf("signature")).toBe("builtin");
    expect(groupOf("signatureOrSystem")).toBe("builtin");
    expect(groupOf("internal")).toBe("builtin");
    expect(groupOf("signature|privileged|vendorPrivileged|oem|verifier")).toBe("builtin");
  });

  test("a level no heading is true of, or no statement at all, is in other names", () => {
    expect(groupOf(undefined)).toBe("other");
    expect(groupOf("signature|pre23")).toBe("other");
    expect(groupOf("signature|instant")).toBe("other");
    expect(groupOf("signature|somethingNew")).toBe("other");
    expect(groupOf("")).toBe("other");
  });

  test("the headings are the interface's own words and never Android's level names", () => {
    expect(GROUPS.map((group) => group.id)).toEqual(["runtime", "special", "install", "developer", "role", "signer", "builtin", "other"]);
    for (const { heading } of GROUPS) expect(heading).not.toMatch(/dangerous|signature|appop|normal|safe|risk/i);
  });

  test("names keep their index order inside a group, the app's own are apart, and a name with a label carries it", () => {
    const names = [
      "android.permission.NETWORK", "android.permission.NOTIFY", "android.permission.PICTURES", "com.vendor.push.RECEIVE",
      "org.example.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION", "org.example.application.OTHER",
    ];
    const { groups, own } = groupNames(names, ["org.example.app"], ANDROID);
    expect(own).toEqual(["org.example.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"]);
    expect(groups.map((group) => [group.id, group.names])).toEqual([
      ["runtime", [{ name: "android.permission.NOTIFY", label: null }, { name: "android.permission.PICTURES", label: "take invented pictures" }]],
      ["install", [{ name: "android.permission.NETWORK", label: "reach the network" }]],
      ["other", [{ name: "com.vendor.push.RECEIVE", label: null }, { name: "org.example.application.OTHER", label: null }]],
    ]);
  });

  test("without Android's statements every name is in other names and none has a label", () => {
    const { groups } = groupNames(["android.permission.PICTURES"], [], null);
    expect(groups).toEqual([{ id: "other", heading: "Other names", names: [{ name: "android.permission.PICTURES", label: null }] }]);
  });
});

describe("the lists when the names are open", () => {
  test("the names are asked of each index that counts at least one", () => {
    const { entry } = subject([index("fdroid", { permissionCount: 0 }), index("izzy", { permissionCount: 2 })]);
    expect(permissionOrigins(entry)).toEqual(["izzy"]);
  });

  test("indexes that list the same names share one list naming both; lists that differ stay apart, F-Droid first", () => {
    const { model, entry } = subject([index("fdroid", { permissionCount: 2 }), index("izzy", { permissionCount: 2 })]);
    const same = ["android.permission.NETWORK", "android.permission.PICTURES"];
    const shared = permissionLists(model, entry, [{ origin: "izzy", names: same, count: 2 }, { origin: "fdroid", names: [...same], count: 2 }], ANDROID);
    expect(shared.map((list) => list.sources)).toEqual([["F-Droid", "IzzyOnDroid"]]);
    const apart = permissionLists(model, entry, [{ origin: "izzy", names: ["b.x.Y"], count: 1 }, { origin: "fdroid", names: ["a.x.Y"], count: 1 }], ANDROID);
    expect(apart.map((list) => [list.sources, list.groups[0]?.names[0]?.name])).toEqual([[["F-Droid"], "a.x.Y"], [["IzzyOnDroid"], "b.x.Y"]]);
  });

  test("a list says how many of the names its index counts are not shown, and a list of none still says so", () => {
    const { model, entry } = subject([index("fdroid", { permissionCount: 4 })]);
    expect(permissionLists(model, entry, [{ origin: "fdroid", names: ["a.x.Y", "b.x.Y"], count: 4 }], ANDROID)[0]?.hidden).toBe(2);
    expect(permissionLists(model, entry, [{ origin: "fdroid", names: [], count: 3 }], ANDROID)).toEqual([{ sources: ["F-Droid"], groups: [], own: [], hidden: 3 }]);
    expect(permissionLists(model, entry, [{ origin: "fdroid", names: [], count: 0 }], ANDROID)).toEqual([]);
    expect(namesNotShown(1)).toBe("1 name not shown");
    expect(namesNotShown(12)).toBe("12 names not shown");
  });

  test("the app's own names come from every package id the app and its indexes name", () => {
    const { model, entry } = subject([index("fdroid", { permissionCount: 2, pkg: "org.example.app.fdroid" })], ["org.example.app"]);
    const [list] = permissionLists(model, entry, [{ origin: "fdroid", names: ["org.example.app.P", "org.example.app.fdroid.Q"], count: 2 }], ANDROID);
    expect(list?.own).toEqual(["org.example.app.P", "org.example.app.fdroid.Q"]);
    expect(list?.groups).toEqual([]);
    expect(ownNamesLine(2)).toBe("2 under the app's package name");
  });

  test("every list names its index when the app is in more than one index, even when only one counts permissions", () => {
    expect(permissionListsCredited(subject([index("fdroid", { permissionCount: 5 })]).entry)).toBe(false);
    expect(permissionListsCredited(subject([index("fdroid", { permissionCount: 5 }), index("izzy", { permissionCount: 0 })]).entry)).toBe(true);
  });
});

describe("the closed row", () => {
  const { model, entry } = subject([index("fdroid", { permissionCount: 3 }), index("izzy", { permissionCount: 2 })]);
  const fdroid: LoadedNames = { origin: "fdroid", names: ["android.permission.NETWORK", "android.permission.PICTURES", "org.example.app.C2D"], count: 3 };

  test("names what each index lists that Android asks for while the app runs, or says it lists none", () => {
    expect(runtimeSummaries(model, entry, [fdroid], ANDROID)).toEqual([{ sources: ["F-Droid"], names: [{ name: "android.permission.PICTURES", label: "take invented pictures" }] }]);
    const izzy: LoadedNames = { origin: "izzy", names: ["android.permission.NETWORK", "org.example.app.C2D"], count: 2 };
    expect(runtimeSummaries(model, entry, [izzy, fdroid], ANDROID).map((summary) => [summary.sources, summary.names.length])).toEqual([[["F-Droid"], 1], [["IzzyOnDroid"], 0]]);
    expect(runtimeLine(0)).toBe("Declares none asked for while it runs");
    expect(runtimeLine(2)).toBe("Declares 2 asked for while it runs");
  });

  test("indexes that give the same names share a line", () => {
    const izzy: LoadedNames = { origin: "izzy", names: ["android.permission.PICTURES"], count: 1 };
    expect(runtimeSummaries(model, entry, [fdroid, izzy], ANDROID).map((summary) => summary.sources)).toEqual([["F-Droid", "IzzyOnDroid"]]);
  });

  test("says nothing of a list shorter than its count, of an index that counts none, or without Android's statements", () => {
    expect(runtimeSummaries(model, entry, [{ ...fdroid, count: 4 }], ANDROID)).toEqual([]);
    expect(runtimeSummaries(model, entry, [{ origin: "izzy", names: [], count: 0 }], ANDROID)).toEqual([]);
    expect(runtimeSummaries(model, entry, [fdroid], null)).toEqual([]);
  });
});

describe("reading Android's part", () => {
  const part = {
    header: {},
    android: { version: "17", tag: "android-17.0.0_r1", commit: "a".repeat(40) },
    permissions: {
      "android.permission.PICTURES": { protectionLevel: "dangerous", label: "take invented pictures" },
      "android.permission.NO_LABEL": { protectionLevel: "normal", label: null },
      "android.permission.BAD_LABEL": { protectionLevel: "normal", label: "a\u0000b" },
      "two words": { protectionLevel: "normal", label: null },
      "android.permission.BAD_LEVEL": { protectionLevel: "<b>normal</b>", label: null },
      "android.permission.NOT_RECORD": "dangerous",
    },
  };

  test("keeps each well-formed statement, drops a label that is not plain text, and leaves out a row in no expected form", () => {
    const read = readAndroidStatements(part);
    expect(read?.version).toBe("17");
    expect([...(read?.permissions.keys() ?? [])]).toEqual(["android.permission.PICTURES", "android.permission.NO_LABEL", "android.permission.BAD_LABEL"]);
    expect(read?.permissions.get("android.permission.BAD_LABEL")).toEqual({ protectionLevel: "normal", label: null });
    expect(read && levelsNote(read)).toBe("As Android 17 states them. Other versions can differ. A declared permission is not always used.");
  });

  test("a part not in the expected form gives no statements", () => {
    expect(readAndroidStatements(null)).toBeNull();
    expect(readAndroidStatements({ ...part, android: { version: "seventeen", tag: "android-17.0.0_r1" } })).toBeNull();
    expect(readAndroidStatements({ ...part, permissions: [] })).toBeNull();
    const many = Object.fromEntries(Array.from({ length: 5001 }, (_, i) => [`a.P${i}`, { protectionLevel: "normal", label: null }]));
    expect(readAndroidStatements({ ...part, permissions: many })).toBeNull();
  });
});

describe("the committed table of Android's statements", () => {
  test("every level it states goes to a group with a heading, none to other names", async () => {
    const { permissions } = (await import("../../../pipeline/android/permissions.json")).default as { permissions: { name: string; protectionLevel: string }[] };
    const ungrouped = permissions.filter((row) => groupOf(row.protectionLevel) === "other").map((row) => `${row.name} ${row.protectionLevel}`);
    expect(permissions.length).toBeGreaterThan(500);
    expect(ungrouped).toEqual([]);
  });
});
