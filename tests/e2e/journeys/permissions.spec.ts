/**
 * What an index says of an app's permissions and anti-features, in its own
 * words, and what Android says of each permission, in its words.
 *
 * Closed, the permission row says how many runtime and special permissions
 * the app declares and names them, from the shard the sheet reads for the
 * description and no other; when that read fails it waits for the
 * description's one "Try again". It says "no" of a kind only where Android
 * states a level for every name of the list but the app's own; with neither
 * kind and a name Android states nothing about it says nothing of kinds.
 * Opened from the keyboard, the names are in
 * groups by Android's stated level, each name under the heading written out
 * below; names under the app's package fold into one line; a name the app
 * declares only for earlier versions has a group of its own; a list shorter
 * than its count says so; where two indexes count permissions, each list
 * says whose it is and the second index's shard is fetched only when the
 * names are asked for. Under an anti-feature, the reason is quoted.
 */

import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { androidPartOf, detailsOf, permissionNamesOf, sheetHash, type App } from "../lib/catalog.ts";
import { serveChanged } from "../lib/inject.ts";
import { build, requireShape } from "../lib/pick.ts";
import { launch, sheet } from "../lib/app.ts";
import { cacheDir } from "../audit/audit-config.ts";
import { readCache } from "../audit/cache.ts";

const sorted = [...build.apps].sort((a, b) => a.id.localeCompare(b.id));
const android = androidPartOf(build);
const counts = (app: App, origin: "fdroid" | "izzy"): number => app[origin]?.facts.permissionCount ?? 0;
const caps = (app: App, origin: "fdroid" | "izzy"): Record<string, number> => detailsOf(build, app.id, origin).permissionCaps ?? {};
const complete = (app: App, origin: "fdroid" | "izzy"): boolean => permissionNamesOf(build, app.id, origin).length === counts(app, origin) && counts(app, origin) > 0;
const hasDescription = (app: App): boolean => Boolean(detailsOf(build, app.id, "fdroid").description?.trim());
/** In F-Droid alone, with a description and a complete list: the sheet reads that one shard and the row sums it up. */
const fdroidAlone = sorted.filter((app) => app.izzy === null && hasDescription(app) && complete(app, "fdroid"));
const ownPackages = (app: App, origin: "fdroid" | "izzy"): string[] => [...app.atlas.packages, app[origin]?.facts.pkg ?? ""].filter(Boolean);
/** Whether Android states a level for every name of the list that is neither the app's own nor declared only for earlier versions. */
const known = (app: App, origin: "fdroid" | "izzy"): boolean => permissionNamesOf(build, app.id, origin).every((name) =>
  ownPackages(app, origin).some((pkg) => name.startsWith(`${pkg}.`))
  || (android !== null && (caps(app, origin)[name] ?? Infinity) < android.android.apiLevel)
  || (android?.permissions[name] !== undefined));
const declaring = (name: string): App | undefined => sorted.find((app) => permissionNamesOf(build, app.id, "fdroid").includes(name) && !(name in caps(app, "fdroid")));

/*
 * The heading each permission must be under, written out by hand from
 * Android's reference for its level and its permissions overview. The levels
 * are Android 17's; a test below holds them to the committed table.
 */
const EXPECTED: [string, string][] = [
  ["SYSTEM_ALERT_WINDOW", "Special permissions"],
  ["WRITE_SETTINGS", "Special permissions"],
  ["FOREGROUND_SERVICE_SPECIAL_USE", "Special permissions"],
  ["MANAGE_EXTERNAL_STORAGE", "Special permissions"],
  ["WRITE_SECURE_SETTINGS", "Granted with developer tools"],
  ["CHANGE_CONFIGURATION", "Granted with developer tools"],
  ["SET_DEFAULT_ACCOUNT_FOR_CONTACTS", "Granted with a role"],
  ["SYSTEM_CAMERA", "Granted with a role"],
  ["MANAGE_WIFI_INTERFACES", "Granted by signing key"],
  ["MANAGE_HOTWORD_DETECTION", "Granted to built-in apps"],
  ["RADIO_SCAN_WITHOUT_LOCATION", "Granted to built-in apps"],
  ["BIND_ACCESSIBILITY_SERVICE", "Granted to built-in apps"],
  ["ANSWER_PHONE_CALLS", "Runtime permissions"],
  ["POST_NOTIFICATIONS", "Runtime permissions"],
  ["INTERNET", "Normal permissions"],
];

async function openDetails(page: Page, app: App) {
  await launch(page, sheetHash(app));
  return sheet(page, app.name).getByRole("region", { name: /^Details/ });
}

/**
 * The names the open list shows under a heading, read from the page once the
 * list is there. The list renders a frame after "Show names", every group at
 * once, so a read before it would find some headings and not others.
 */
async function namesUnder(details: ReturnType<Page["locator"]>, heading: string): Promise<string[]> {
  await expect(details.locator(".perm-lists")).toBeVisible();
  const group = details.locator(".perm-group").filter({ has: details.page().getByRole("heading", { level: 4, name: heading, exact: true }) });
  return group.locator(".perm-name").allTextContents();
}

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the row does not depend on the layout; run once, at phone size");
  void page;
});

test("Android's statements are the committed table's, word for word, for every name an app declares", () => {
  requireShape(android !== null, "android part");
  if (!android) return;
  const table = JSON.parse(readFileSync(new URL("../../../pipeline/android/permissions.json", import.meta.url), "utf8")) as {
    source: { tag: string; commit: string };
    androidVersion: string;
    apiLevel: number;
    permissions: { name: string; protectionLevel: string; label: string | null }[];
  };
  expect(android.android).toEqual({ version: table.androidVersion, apiLevel: table.apiLevel, tag: table.source.tag, commit: table.source.commit });
  const declared = new Set(build.manifest.files.filter((f) => f.role === "details").flatMap((f) => {
    const shard = JSON.parse(readFileSync(`${build.dir}/${f.path}`, "utf8")) as Record<string, { permissions?: string[] }>;
    return Object.values(shard).flatMap((entry) => entry.permissions ?? []);
  }));
  const expected = Object.fromEntries(table.permissions.filter((row) => declared.has(row.name)).map((row) => [row.name, { protectionLevel: row.protectionLevel, label: row.label }]));
  expect(android.permissions).toEqual(expected);
});

for (const [short, heading] of EXPECTED) {
  const name = `android.permission.${short}`;
  const app = declaring(name);
  test(`${short} is under “${heading}”${app ? ` (${app.id})` : ""}`, async ({ page }) => {
    test.skip(!app || !android, "no app in this catalog declares it in its F-Droid list");
    if (!app) return;
    const details = await openDetails(page, app);
    await details.getByRole("button", { name: "Show names" }).click();
    expect(await namesUnder(details, heading)).toContain(name);
  });
}

const bothKinds = fdroidAlone.find((app) => app.id === "com.farmerbb.taskbar") ?? fdroidAlone.find((app) => {
  const names = permissionNamesOf(build, app.id, "fdroid");
  return ["android.permission.POST_NOTIFICATIONS", "android.permission.CAMERA"].some((name) => names.includes(name)) && ["android.permission.SYSTEM_ALERT_WINDOW", "android.permission.MANAGE_EXTERNAL_STORAGE"].some((name) => names.includes(name));
});

test(`the closed row names the runtime and special permissions the open list holds, and credits the index and Android${bothKinds ? ` (${bothKinds.id})` : ""}`, async ({ page }) => {
  requireShape(bothKinds !== undefined && android !== null, "app in F-Droid alone declaring runtime and special permissions");
  if (!bothKinds || !android) return;
  const shards: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/details/")) shards.push(request.url());
  });
  const details = await openDetails(page, bothKinds);
  const line = details.locator(".perm-summary");
  await expect(line).toHaveCount(1);
  await expect(line.locator(".fact-source")).toHaveText(`F-Droid, Android ${android.android.version}`);
  expect(shards.filter((url) => !url.includes("/details/fdroid/")), "no shard but the one the description is in").toEqual([]);
  const closed = await line.locator(".fact-detail").allTextContents();

  await details.getByRole("button", { name: "Show names" }).click();
  const runtime = await namesUnder(details, "Runtime permissions");
  const special = await namesUnder(details, "Special permissions");
  expect(runtime.length + special.length).toBeGreaterThan(0);
  const noun = (n: number, kind: string): string => `${n} ${kind} ${n === 1 ? "permission" : "permissions"}`;
  const said = (r: number, s: number): string => {
    if (r > 0 && s > 0) return `Declares ${r} runtime and ${noun(s, "special")}`;
    if (!known(bothKinds, "fdroid")) return `Declares ${r > 0 ? noun(r, "runtime") : noun(s, "special")}`;
    return r === 0 && s === 0 ? "Declares no runtime or special permissions" : `Declares ${r === 0 ? "no" : r} runtime and ${s === 0 ? "no special permissions" : noun(s, "special")}`;
  };
  await expect(line.locator(".fact-value")).toHaveText(said(runtime.length, special.length));
  const labelOf = (name: string): string | null => android.permissions[name]?.label ?? null;
  const labelled = (names: string[]): string => [...names.filter((name) => labelOf(name)), ...names.filter((name) => !labelOf(name))]
    .slice(0, 6).map((name) => labelOf(name) ?? name).join(", ") + (names.length > 6 ? `, and ${names.length - 6} more` : "");
  expect(closed).toEqual([...(runtime.length ? [`Runtime: ${labelled(runtime)}`] : []), ...(special.length ? [`Special: ${labelled(special)}`] : [])]);
});

const cache = cacheDir() ? readCache(cacheDir() ?? "") : null;
const latest = (pkg: string) => {
  const versions = Object.values(cache?.fdroid.packages[pkg]?.versions ?? {});
  return versions.sort((a, b) => (b.manifest?.versionCode ?? 0) - (a.manifest?.versionCode ?? 0))[0]?.manifest as { usesPermission?: { name: string }[]; usesPermissionSdk23?: { name: string }[] } | undefined;
};
const sdk23Only = (app: App): string[] => {
  const manifest = latest(app.fdroid?.facts.pkg ?? "");
  const plain = new Set((manifest?.usesPermission ?? []).map((item) => item.name.trim()));
  return (manifest?.usesPermissionSdk23 ?? []).map((item) => item.name.trim()).filter((name) => !plain.has(name));
};
const withSdk23 = cache ? fdroidAlone.find((app) => sdk23Only(app).some((name) => android?.permissions[name]?.protectionLevel.split("|").includes("dangerous"))) : undefined;

test(`a runtime permission declared only with uses-permission-sdk-23 is counted, listed and in the closed row${withSdk23 ? ` (${withSdk23.id})` : ""}`, async ({ page }) => {
  test.skip(!cache, "needs the cache the build was made from");
  requireShape(withSdk23 !== undefined, "app in F-Droid alone with a runtime permission only in uses-permission-sdk-23");
  if (!withSdk23 || !android) return;
  const name = sdk23Only(withSdk23).find((item) => android.permissions[item]?.protectionLevel.split("|").includes("dangerous")) ?? "";
  const manifest = latest(withSdk23.fdroid?.facts.pkg ?? "");
  const all = new Set([...(manifest?.usesPermission ?? []), ...(manifest?.usesPermissionSdk23 ?? [])].map((item) => item.name.trim()));
  expect(counts(withSdk23, "fdroid"), "the count is both elements' distinct names").toBe(all.size);
  const details = await openDetails(page, withSdk23);
  await expect(details.locator(".perm-summary .fact-detail").first()).toContainText(android.permissions[name]?.label ?? name);
  await details.getByRole("button", { name: "Show names" }).click();
  expect(await namesUnder(details, "Runtime permissions")).toContain(name);
});

const capped = fdroidAlone.find((app) => known(app, "fdroid") && android !== null && Object.entries(caps(app, "fdroid")).some(([name, cap]) => cap < android.android.apiLevel && android.permissions[name]?.protectionLevel.split("|").includes("dangerous")));

test(`a name declared only up to an earlier version is in a group of its own with that version, and not in the closed row${capped ? ` (${capped.id})` : ""}`, async ({ page }) => {
  requireShape(capped !== undefined && android !== null, "app in F-Droid alone declaring a runtime permission only up to an earlier API level");
  if (!capped || !android) return;
  const [name = "", cap = 0] = Object.entries(caps(capped, "fdroid")).find(([item, level]) => level < android.android.apiLevel && android.permissions[item]?.protectionLevel.split("|").includes("dangerous")) ?? [];
  const details = await openDetails(page, capped);
  await expect(details.locator(".perm-summary")).toHaveCount(1);
  if (android.permissions[name]?.label) await expect(details.locator(".perm-summary")).not.toContainText(android.permissions[name]?.label ?? "");
  await details.getByRole("button", { name: "Show names" }).click();
  expect(await namesUnder(details, "For earlier Android versions")).toContain(name);
  expect(await namesUnder(details, "Runtime permissions")).not.toContain(name);
  const item = details.locator(".perm-item").filter({ hasText: name });
  await expect(item.locator(".perm-cap")).toHaveText(new RegExp(`^Up to (Android [0-9.L]+|API level ${cap})$`));
});

const fdroidOnly = fdroidAlone.filter((app) => known(app, "fdroid")).find((app) => {
  const names = permissionNamesOf(build, app.id, "fdroid");
  return names.some((name) => [app.atlas.packages, [app.fdroid?.facts.pkg]].flat().some((pkg) => pkg && name.startsWith(`${pkg}.`)));
});

test(`the names and the app's own open and close from the keyboard, each control saying what it does${fdroidOnly ? ` (${fdroidOnly.id})` : ""}`, async ({ page }) => {
  requireShape(fdroidOnly !== undefined && android !== null, "app in F-Droid alone with a name of its own");
  if (!fdroidOnly || !android) return;
  const details = await openDetails(page, fdroidOnly);
  const toggle = details.getByRole("button", { name: "Show names" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  const open = details.getByRole("button", { name: "Hide names" });
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(open).toBeFocused();
  await expect(details.getByText(`Levels and labels from Android ${android.android.version}`, { exact: true })).toBeVisible();
  await expect(details.getByText("A declared permission is not always used. Other versions can differ.", { exact: true })).toBeVisible();
  await expect(details.getByText(/^From /)).toHaveCount(0);

  const names = permissionNamesOf(build, fdroidOnly.id, "fdroid");
  const packages = [...fdroidOnly.atlas.packages, fdroidOnly.fdroid?.facts.pkg ?? ""].filter(Boolean);
  const own = names.filter((name) => packages.some((pkg) => name.startsWith(`${pkg}.`)));
  const grouped = await details.locator(".perm-group .perm-name").allTextContents();
  expect(new Set(grouped)).toEqual(new Set(names.filter((name) => !own.includes(name))));
  const headings = await details.getByRole("heading", { level: 4 }).allTextContents();
  const ORDER = ["Runtime permissions", "Special permissions", "Normal permissions", "Granted with developer tools", "Granted with a role", "Granted by signing key", "Granted to built-in apps", "For earlier Android versions", "Other names"];
  expect(headings).toEqual(ORDER.filter((heading) => headings.includes(heading)));

  const noun = own.length === 1 ? "name" : "names";
  const fold = details.getByRole("button", { name: `Show ${own.length} ${noun} under the app's package` });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.focus();
  await page.keyboard.press("Enter");
  const unfolded = details.getByRole("button", { name: `Hide ${own.length} ${noun} under the app's package` });
  await expect(unfolded).toHaveAttribute("aria-expanded", "true");
  await expect(details.locator(".perm-own .perm-name")).toHaveText(own);

  await open.focus();
  await page.keyboard.press("Space");
  await expect(details.getByRole("button", { name: "Show names" })).toHaveAttribute("aria-expanded", "false");
  await expect(details.getByRole("list")).toHaveCount(0);
});

test(`when the shard fails the row waits, and the description's one "Try again" brings both back with one update check${fdroidOnly ? ` (${fdroidOnly.id})` : ""}`, async ({ page }) => {
  requireShape(fdroidOnly !== undefined && android !== null, "app in F-Droid alone with permission names");
  if (!fdroidOnly) return;
  let fail = true;
  let checks = 0;
  await page.route("**/details/fdroid/**", (route) => (fail ? route.abort("internetdisconnected") : route.continue()));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/data/version.json")) checks += 1;
  });
  const details = await openDetails(page, fdroidOnly);
  const box = sheet(page, fdroidOnly.name);
  await expect(box.getByText("The description did not load.")).toBeVisible();
  const before = checks;
  await expect(details.locator(".perm-summary")).toHaveCount(0);
  await expect(details.getByRole("button", { name: "Show names" })).toHaveCount(0);
  await expect(box.getByRole("button", { name: "Try again" })).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(checks - before, "the failed read makes one update check at most").toBeLessThanOrEqual(1);

  fail = false;
  await box.getByRole("button", { name: "Try again" }).click();
  await expect(details.locator(".perm-summary")).toHaveCount(1);
  await expect(details.getByRole("button", { name: "Show names" })).toBeVisible();
  await expect(box.getByText("The description did not load.")).toHaveCount(0);
});

test(`without Android's part the names are listed ungrouped, and the row neither sums them up nor credits Android${fdroidOnly ? ` (${fdroidOnly.id})` : ""}`, async ({ page }) => {
  requireShape(fdroidOnly !== undefined && android !== null, "app in F-Droid alone with permission names");
  if (!fdroidOnly) return;
  const manifest = JSON.parse(JSON.stringify(build.manifest)) as typeof build.manifest;
  manifest.files = manifest.files.filter((file) => file.role !== "android");
  await page.route(`**/data/${build.version.manifest}`, (route) => route.fulfill({ json: manifest }));
  const details = await openDetails(page, fdroidOnly);
  await expect(details.locator(".fact").filter({ hasText: /^Permissions/ })).toBeVisible();
  await expect(details.locator(".perm-summary")).toHaveCount(0);
  await details.getByRole("button", { name: "Show names" }).click();
  await expect(details.locator(".perm-item").first()).toBeVisible();
  await expect(details.getByRole("heading", { level: 4 })).toHaveCount(0);
  await expect(details.getByText(/^Levels and labels from/)).toHaveCount(0);
});

test(`a list shorter than its count says how many names are not shown, and the closed row says nothing of it${fdroidOnly ? ` (${fdroidOnly.id})` : ""}`, async ({ page }) => {
  requireShape(fdroidOnly !== undefined, "app in F-Droid alone with permission names");
  if (!fdroidOnly) return;
  await serveChanged(page, build, [{
    role: "index",
    origin: "fdroid",
    change(part) {
      const facts = (part.apps as Record<string, { facts: { permissionCount: number } }>)[fdroidOnly.id]?.facts;
      if (facts) facts.permissionCount += 3;
    },
  }]);
  const details = await openDetails(page, fdroidOnly);
  await details.getByRole("button", { name: "Show names" }).click();
  await expect(details.getByText("3 names not shown", { exact: true })).toBeVisible();
  await expect(details.locator(".perm-summary")).toHaveCount(0);
});

/* Its own names and names Android states nothing about, such as Shizuku's: a complete list the row can say nothing of kinds about. */
const unknownOnly = [...sorted].sort((a, b) => Number(b.id === "com.eiyooooo.foldswitcher") - Number(a.id === "com.eiyooooo.foldswitcher")).find((app) => {
  if (app.izzy !== null || !complete(app, "fdroid") || android === null) return false;
  const others = permissionNamesOf(build, app.id, "fdroid").filter((name) => !ownPackages(app, "fdroid").some((pkg) => name.startsWith(`${pkg}.`)));
  return others.length > 0 && others.every((name) => android.permissions[name] === undefined);
});

test(`a complete list with neither kind and a name Android states nothing about says nothing of kinds, and its names still open${unknownOnly ? ` (${unknownOnly.id})` : ""}`, async ({ page }) => {
  requireShape(unknownOnly !== undefined && android !== null, "app in F-Droid alone whose names are its own or ones Android states nothing about");
  if (!unknownOnly || !android) return;
  const details = await openDetails(page, unknownOnly);
  const row = details.locator(".fact").filter({ has: page.locator("dt", { hasText: /^Permissions$/ }) });
  const toggle = row.getByRole("button", { name: "Show names" });
  await expect(toggle).toBeVisible();
  await expect(row.locator(".perm-summary")).toHaveCount(0);
  await expect(row).not.toContainText("Declares");
  await expect(row).toContainText(String(counts(unknownOnly, "fdroid")));
  await toggle.click();
  const own = ownPackages(unknownOnly, "fdroid");
  const others = permissionNamesOf(build, unknownOnly.id, "fdroid").filter((name) => !own.some((pkg) => name.startsWith(`${pkg}.`)));
  expect(new Set(await namesUnder(details, "Other names"))).toEqual(new Set(others));
});

test(`"Show names" is not offered when the shard holds no names for the app${fdroidOnly ? ` (${fdroidOnly.id})` : ""}`, async ({ page }) => {
  requireShape(fdroidOnly !== undefined, "app in F-Droid alone with permission names");
  if (!fdroidOnly) return;
  await serveChanged(page, build, [{
    role: "details",
    origin: "fdroid",
    holding: fdroidOnly.id,
    change(part) {
      const entry = (part as Record<string, { permissions?: string[]; permissionCaps?: Record<string, number> }>)[fdroidOnly.id];
      if (entry) {
        delete entry.permissions;
        delete entry.permissionCaps;
      }
    },
  }]);
  const details = await openDetails(page, fdroidOnly);
  await expect(sheet(page).getByText("Loading…", { exact: true })).toHaveCount(0);
  await expect(details.locator(".fact").filter({ has: page.locator("dt", { hasText: /^Permissions$/ }) })).toContainText(String(counts(fdroidOnly, "fdroid")));
  await expect(details.getByRole("button", { name: "Show names" })).toHaveCount(0);
  await expect(details.locator(".perm-summary")).toHaveCount(0);
});

/* The description comes from F-Droid's shard here, so IzzyOnDroid's is fetched for the names alone. */
const bothCounting = sorted.find((app) => counts(app, "fdroid") > 0 && counts(app, "izzy") > 0 && hasDescription(app) && complete(app, "fdroid") && known(app, "fdroid"));

test(`with two indexes and one shard read, the closed row names the index it describes, and each list names its own when opened${bothCounting ? ` (${bothCounting.id})` : ""}`, async ({ page }) => {
  requireShape(bothCounting !== undefined && android !== null, "app whose permissions both indexes count");
  if (!bothCounting || !android) return;
  const izzyShards: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/details/izzy/")) izzyShards.push(request.url());
  });
  const details = await openDetails(page, bothCounting);
  await expect(sheet(page).getByText("Loading…", { exact: true })).toHaveCount(0);
  await expect(details.locator(".perm-summary .fact-source")).toHaveText([`F-Droid, Android ${android.android.version}`]);
  expect(izzyShards, "nothing of IzzyOnDroid's is fetched before the names are asked for").toEqual([]);

  await details.getByRole("button", { name: "Show names" }).click();
  await expect(details.locator(".perm-list").first()).toBeVisible();
  expect(izzyShards).toHaveLength(1);
  const fdroid = permissionNamesOf(build, bothCounting.id, "fdroid");
  const izzy = permissionNamesOf(build, bothCounting.id, "izzy");
  const lists = details.locator(".perm-list");
  const same = fdroid.join() === izzy.join() && counts(bothCounting, "fdroid") === counts(bothCounting, "izzy") && JSON.stringify(caps(bothCounting, "fdroid")) === JSON.stringify(caps(bothCounting, "izzy"));
  if (same) {
    await expect(lists).toHaveCount(1);
    await expect(lists.first().getByText("From F-Droid, IzzyOnDroid", { exact: true })).toBeVisible();
  } else {
    await expect(lists).toHaveCount(2);
    await expect(lists.nth(0).getByText("From F-Droid", { exact: true })).toBeVisible();
    await expect(lists.nth(1).getByText("From IzzyOnDroid", { exact: true })).toBeVisible();
  }
});

const withReason = sorted.find((app) => Object.keys(app.fdroid?.facts.antiFeatureReasons ?? {}).length > 0);

test(`an anti-feature quotes the reason its index gives${withReason ? ` (${withReason.id})` : ""}`, async ({ page }) => {
  requireShape(withReason !== undefined, "anti-feature with a reason");
  if (!withReason) return;
  const details = await openDetails(page, withReason);
  await expect(details.locator(".fact-quote").first()).toBeVisible();
  const quoted = await details.locator(".fact-quote").allTextContents();
  for (const reason of Object.values(withReason.fdroid?.facts.antiFeatureReasons ?? {})) {
    expect(quoted, "each reason is quoted word for word").toContain(reason);
  }
});
