import assert from "node:assert/strict";
import { test } from "node:test";
import { androidPermissionsPart, AOSP_NOTICE } from "../android-part.ts";
import type { AndroidTable } from "../lib/android-permissions.ts";

const TABLE: AndroidTable = {
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
  changes: "Extracted by Droid Atlas on 2026-11-24.",
  permissions: [
    { name: "org.fixture.permission.A", protectionLevel: "dangerous", label: "do a" },
    { name: "org.fixture.permission.B", protectionLevel: "normal", label: null },
    { name: "org.fixture.permission.UNUSED", protectionLevel: "signature", label: "never declared" },
  ],
};

test("the part keeps Android's statement for every name an app declares, and no other", () => {
  const part = androidPermissionsPart(
    TABLE,
    {
      fdroid: { one: { description: "x", permissions: ["org.fixture.permission.A", "org.other.OWN"] }, two: { description: "y" } },
      izzy: { one: { permissions: ["org.fixture.permission.B"] } },
    },
    "2026-11-25",
  );
  assert.deepEqual(part.permissions, {
    "org.fixture.permission.A": { protectionLevel: "dangerous", label: "do a" },
    "org.fixture.permission.B": { protectionLevel: "normal", label: null },
  });
  assert.deepEqual(part.android, { version: "17", apiLevel: 37, tag: "android-17.0.0_r1", commit: "a".repeat(40) });
});

test("the header names the release, its license, the files' notices and what was changed", () => {
  const { header } = androidPermissionsPart(TABLE, { fdroid: {}, izzy: {} }, "2026-11-25");
  assert.equal(header.license, "Apache-2.0");
  assert.equal(header.source.commit, "a".repeat(40));
  assert.match(header.source.name, /^Android 17\b/);
  assert.ok(header.attribution.includes("platform/frameworks/base at android-17.0.0_r1"));
  assert.ok(!header.attribution.includes("https://"), "the address is the source link, not a word that cannot wrap");
  assert.ok(header.attribution.includes("Copyright 2006, The Android Open Source Project"));
  assert.ok(header.attribution.endsWith(AOSP_NOTICE));
  assert.ok(header.changes.startsWith(TABLE.changes));
  assert.match(header.changes, /2026-11-25/);
});
