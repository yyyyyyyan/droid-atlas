/**
 * What an index says of an app's permissions and anti-features, in its own
 * words, and what Android says of each permission, in its words.
 *
 * Closed, the permission row names what the app declares that Android asks
 * for while it runs, from the shard the sheet reads for the description and
 * no other. Opened from the keyboard, the names are grouped by Android's
 * stated level as docs/ARCHITECTURE.md lists the groups, each with Android's
 * label where it has one; names under the app's package fold into one line;
 * a list shorter than its count says so; where two indexes count
 * permissions, each list says whose it is and the second index's shard is
 * fetched only when the names are asked for. Under an anti-feature, the
 * reason the index gives is quoted.
 */

import { readFileSync } from "node:fs";
import { expect, test } from "../lib/fixtures.ts";
import { androidPartOf, detailsOf, permissionNamesOf, sheetHash, type App } from "../lib/catalog.ts";
import { serveChanged } from "../lib/inject.ts";
import { build, requireShape } from "../lib/pick.ts";
import { launch, sheet } from "../lib/app.ts";

const sorted = [...build.apps].sort((a, b) => a.id.localeCompare(b.id));
const android = androidPartOf(build);
const counts = (app: App, origin: "fdroid" | "izzy"): number => app[origin]?.facts.permissionCount ?? 0;
const levelOf = (name: string): string | undefined => (android && Object.hasOwn(android.permissions, name) ? android.permissions[name]?.protectionLevel : undefined);
const labelOf = (name: string): string | null => (android && Object.hasOwn(android.permissions, name) ? (android.permissions[name]?.label ?? null) : null);

/** The groups as docs/ARCHITECTURE.md states them, in the order the sheet shows them. */
const HEADINGS: [string, string][] = [
  ["runtime", "Asked for while it runs"],
  ["special", "Special access"],
  ["install", "Granted at install"],
  ["developer", "Granted with developer tools"],
  ["role", "Granted with a role"],
  ["signer", "Granted by signing key"],
  ["builtin", "Granted to built-in apps"],
  ["other", "Other names"],
];
const BUILT_IN = new Set(["privileged", "system", "preinstalled", "installer", "verifier", "setup", "oem", "vendorPrivileged", "textClassifier", "configurator", "incidentReportApprover", "appPredictor", "companion", "retailDemo", "recents", "module"]);

function groupOf(level: string | undefined): string {
  if (level === undefined) return "other";
  const words = new Set(level.split("|"));
  if (words.has("dangerous")) return "runtime";
  if (words.has("appop")) return "special";
  if (words.has("normal")) return "install";
  const bases = ["signature", "signatureOrSystem", "internal"].filter((word) => words.delete(word));
  if (bases.length !== 1) return "other";
  if (words.has("development")) return "developer";
  if (words.has("role")) return "role";
  if (words.has("knownSigner")) return "signer";
  return [...words].every((word) => BUILT_IN.has(word)) ? "builtin" : "other";
}

function ownOf(app: App, names: readonly string[]): string[] {
  const packages = [...app.atlas.packages, app.fdroid?.facts.pkg, app.izzy?.facts.pkg].filter((pkg): pkg is string => typeof pkg === "string");
  return names.filter((name) => packages.some((pkg) => name.startsWith(`${pkg}.`)));
}

/** The text a list item reads as: Android's label, when it has one, then the name. */
const itemText = (name: string): string => `${labelOf(name) ?? ""}${name}`;

const fdroidOnly = sorted.find((app) => {
  const names = permissionNamesOf(build, app.id, "fdroid");
  return counts(app, "fdroid") > 0 && app.izzy === null && names.length === counts(app, "fdroid") && ownOf(app, names).length > 0
    && names.some((name) => groupOf(levelOf(name)) === "runtime") && Boolean(detailsOf(build, app.id, "fdroid").description?.trim());
});
const withoutRuntime = sorted.find((app) => {
  const names = permissionNamesOf(build, app.id, "fdroid");
  return counts(app, "fdroid") > 0 && app.izzy === null && names.length === counts(app, "fdroid") && !names.some((name) => groupOf(levelOf(name)) === "runtime")
    && Boolean(detailsOf(build, app.id, "fdroid").description?.trim());
});
/* The description comes from F-Droid's shard here, so IzzyOnDroid's is fetched for the names alone. */
const bothCounting = sorted.find((app) => counts(app, "fdroid") > 0 && counts(app, "izzy") > 0 && Boolean(detailsOf(build, app.id, "fdroid").description?.trim()));
const withReason = sorted.find((app) => Object.keys(app.fdroid?.facts.antiFeatureReasons ?? {}).length > 0);

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the disclosure does not depend on the layout; run once, at phone size");
  void page;
});

test("Android's statements are the committed table's, word for word, for every name an app declares", () => {
  requireShape(android !== null, "android part");
  if (!android) return;
  const table = JSON.parse(readFileSync(new URL("../../../pipeline/android/permissions.json", import.meta.url), "utf8")) as {
    source: { tag: string; commit: string };
    androidVersion: string;
    permissions: { name: string; protectionLevel: string; label: string | null }[];
  };
  expect(android.android).toEqual({ version: table.androidVersion, tag: table.source.tag, commit: table.source.commit });
  const declared = new Set(build.manifest.files.filter((f) => f.role === "details").flatMap((f) => {
    const shard = JSON.parse(readFileSync(`${build.dir}/${f.path}`, "utf8")) as Record<string, { permissions?: string[] }>;
    return Object.values(shard).flatMap((entry) => entry.permissions ?? []);
  }));
  const expected = Object.fromEntries(table.permissions.filter((row) => declared.has(row.name)).map((row) => [row.name, { protectionLevel: row.protectionLevel, label: row.label }]));
  expect(android.permissions).toEqual(expected);
});

test(`the closed row names what the app declares that Android asks for while it runs, from the description's shard alone${fdroidOnly ? ` (${fdroidOnly.id})` : ""}`, async ({ page }) => {
  requireShape(fdroidOnly !== undefined && android !== null, "app in F-Droid only with a description, a runtime name and a name of its own");
  if (!fdroidOnly || !android) return;
  const shards: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/details/")) shards.push(request.url());
  });
  await launch(page, sheetHash(fdroidOnly));
  const details = sheet(page, fdroidOnly.name).getByRole("region", { name: /^Details/ });
  const runtime = permissionNamesOf(build, fdroidOnly.id, "fdroid").filter((name) => groupOf(levelOf(name)) === "runtime");
  const line = details.locator(".perm-summary");
  await expect(line.locator(".fact-value")).toHaveText(`Declares ${runtime.length} asked for while it runs`);
  await expect(line.locator(".fact-source")).toContainText(`Android ${android.android.version}`);
  await expect(line.locator(".fact-detail")).toHaveText(runtime.map((name) => labelOf(name) ?? name).join(", "));
  expect(shards.filter((url) => url.includes("/details/fdroid/"))).toHaveLength(1);
  expect(shards.filter((url) => !url.includes("/details/fdroid/")), "no shard but the one the description is in").toEqual([]);
});

test(`the closed row says when the app declares none Android asks for while it runs${withoutRuntime ? ` (${withoutRuntime.id})` : ""}`, async ({ page }) => {
  requireShape(withoutRuntime !== undefined && android !== null, "app in F-Droid only with a description and no runtime name");
  if (!withoutRuntime) return;
  await launch(page, sheetHash(withoutRuntime));
  const details = sheet(page, withoutRuntime.name).getByRole("region", { name: /^Details/ });
  await expect(details.locator(".perm-summary .fact-value")).toHaveText("Declares none asked for while it runs");
  await expect(details.locator(".perm-summary .fact-detail")).toHaveCount(0);
});

test(`the names open and close from the keyboard, in Android's groups, with the app's own folded${fdroidOnly ? ` (${fdroidOnly.id})` : ""}`, async ({ page }) => {
  requireShape(fdroidOnly !== undefined && android !== null, "app in F-Droid only with a runtime name and a name of its own");
  if (!fdroidOnly || !android) return;
  await launch(page, sheetHash(fdroidOnly));
  const details = sheet(page, fdroidOnly.name).getByRole("region", { name: /^Details/ });
  const toggle = details.getByRole("button", { name: "Show names" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(details.getByRole("list")).toHaveCount(0);

  await toggle.focus();
  await page.keyboard.press("Enter");
  const open = details.getByRole("button", { name: "Hide names" });
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(open).toBeFocused();
  await expect(details.getByText(`Groups and labels from Android ${android.android.version}`, { exact: true })).toBeVisible();
  await expect(details.getByText(/^From /)).toHaveCount(0);

  const names = permissionNamesOf(build, fdroidOnly.id, "fdroid");
  const own = ownOf(fdroidOnly, names);
  const grouped = HEADINGS.map(([id, heading]) => ({ heading, names: names.filter((name) => !own.includes(name) && groupOf(levelOf(name)) === id) })).filter((group) => group.names.length > 0);
  await expect(details.getByRole("heading", { level: 4 })).toHaveText(grouped.map((group) => group.heading));
  await expect(details.getByRole("listitem")).toHaveText(grouped.flatMap((group) => group.names.map(itemText)));

  const fold = details.getByRole("button", { name: `${own.length} under the app's package name` });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await fold.focus();
  await page.keyboard.press("Enter");
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  await expect(details.locator(".perm-own").getByRole("listitem")).toHaveText(own);

  await open.focus();
  await page.keyboard.press("Space");
  await expect(details.getByRole("button", { name: "Show names" })).toHaveAttribute("aria-expanded", "false");
  await expect(details.getByRole("list")).toHaveCount(0);
});

test(`a list shorter than its count says how many names are not shown, and the closed row says nothing of it${fdroidOnly ? ` (${fdroidOnly.id})` : ""}`, async ({ page }) => {
  requireShape(fdroidOnly !== undefined, "app in F-Droid only with permission names");
  if (!fdroidOnly) return;
  await serveChanged(page, build, [{
    role: "index",
    origin: "fdroid",
    change(part) {
      const facts = (part.apps as Record<string, { facts: { permissionCount: number } }>)[fdroidOnly.id]?.facts;
      if (facts) facts.permissionCount += 3;
    },
  }]);
  await launch(page, sheetHash(fdroidOnly));
  const details = sheet(page, fdroidOnly.name).getByRole("region", { name: /^Details/ });
  await details.getByRole("button", { name: "Show names" }).click();
  await expect(details.getByText("3 names not shown", { exact: true })).toBeVisible();
  await expect(details.locator(".perm-summary")).toHaveCount(0);
});

test(`where both indexes count permissions, the second index's names are fetched only when asked for, and each list names its index${bothCounting ? ` (${bothCounting.id})` : ""}`, async ({ page }) => {
  requireShape(bothCounting !== undefined, "app whose permissions both indexes count");
  if (!bothCounting) return;
  const izzyShards: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/details/izzy/")) izzyShards.push(request.url());
  });
  await launch(page, sheetHash(bothCounting));
  const details = sheet(page, bothCounting.name).getByRole("region", { name: /^Details/ });
  await expect(sheet(page).getByText("Loading…", { exact: true })).toHaveCount(0);
  expect(izzyShards, "nothing of IzzyOnDroid's is fetched before the names are asked for").toEqual([]);

  await details.getByRole("button", { name: "Show names" }).click();
  await expect(details.locator(".perm-list").first()).toBeVisible();
  expect(izzyShards).toHaveLength(1);

  const fdroid = permissionNamesOf(build, bothCounting.id, "fdroid");
  const izzy = permissionNamesOf(build, bothCounting.id, "izzy");
  const lists = details.locator(".perm-list");
  const shown = (names: string[]): string[] => {
    const own = ownOf(bothCounting, names);
    return HEADINGS.flatMap(([id]) => names.filter((name) => !own.includes(name) && groupOf(levelOf(name)) === id)).map(itemText);
  };
  if (fdroid.join() === izzy.join() && counts(bothCounting, "fdroid") === counts(bothCounting, "izzy")) {
    await expect(lists).toHaveCount(1);
    await expect(lists.first().getByText("From F-Droid, IzzyOnDroid", { exact: true })).toBeVisible();
    await expect(lists.first().locator(".perm-group").getByRole("listitem")).toHaveText(shown(fdroid));
  } else {
    await expect(lists).toHaveCount(2);
    await expect(lists.nth(0).getByText("From F-Droid", { exact: true })).toBeVisible();
    await expect(lists.nth(1).getByText("From IzzyOnDroid", { exact: true })).toBeVisible();
    await expect(lists.nth(0).locator(".perm-group").getByRole("listitem")).toHaveText(shown(fdroid));
    await expect(lists.nth(1).locator(".perm-group").getByRole("listitem")).toHaveText(shown(izzy));
  }
});

test(`an anti-feature quotes the reason its index gives${withReason ? ` (${withReason.id})` : ""}`, async ({ page }) => {
  requireShape(withReason !== undefined, "anti-feature with a reason");
  if (!withReason) return;
  await launch(page, sheetHash(withReason));
  const details = sheet(page, withReason.name).getByRole("region", { name: /^Details/ });
  await expect(details.locator(".fact-quote").first()).toBeVisible();
  const quoted = await details.locator(".fact-quote").allTextContents();
  for (const reason of Object.values(withReason.fdroid?.facts.antiFeatureReasons ?? {})) {
    expect(quoted, "each reason is quoted word for word").toContain(reason);
  }
});
