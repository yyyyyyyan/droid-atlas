/**
 * An app's facts as ways into lists: each license an app's sources state,
 * and the owner of its repository when the catalog holds other entries of
 * theirs, lead to the list of entries sharing it. The list is Search with
 * the fact as a removable chip, counted here from the catalog parts; a shared
 * link and a pin with such a token survive a reload and a new build.
 */

import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { requireShape } from "../lib/pick.ts";
import { filteredCount, isLink, licenseStatements, licenseTokensOf, loadBuild, matchingApps, ownerToken, sheetHash, type App } from "../lib/catalog.ts";
import { countStatus, escapeRegExp, launch, ready, sheet } from "../lib/app.ts";

const build = loadBuild();
const FORGES: Record<string, string> = { github: "GitHub", gitlab: "GitLab", codeberg: "Codeberg", sourcehut: "SourceHut" };

const owners = new Map<string, App[]>();
for (const app of build.apps) {
  const token = ownerToken(app);
  if (token) owners.set(token, [...(owners.get(token) ?? []), app]);
}
const ownerGroups = [...owners].sort((a, b) => b[1].length - a[1].length);
const appsOf = (filters: string[], text = ""): App[] => matchingApps(build, text, filters);

/** "fossifyorg on GitHub", as the app's own slug spells the owner. */
function ownerWords(app: App): string {
  const repo = app.atlas.repo;
  return `${repo?.slug?.split("/")[0] ?? ""} on ${FORGES[repo?.host ?? ""] ?? ""}`;
}

function details(page: Page) {
  return sheet(page).getByRole("region", { name: /^Details/ });
}

/** A link from a fact to its list: named by its words and the size of the list it leads to. */
function factLink(page: Page, words: string, token: string) {
  const size = appsOf([token]).length;
  return details(page).getByRole("link", { name: new RegExp(`^${escapeRegExp(words)}, ${size.toLocaleString("en")} apps?$`) });
}

function activeChip(page: Page, label: RegExp) {
  return page.getByRole("main").getByRole("group", { name: "Active filters" }).getByRole("button", { name: label });
}

/** The first spelling of each license an app's sources state, as the sheet shows it, with its token. */
function statedLicenses(app: App): { value: string; token: string }[] {
  const seen = new Set<string>();
  return licenseStatements(app).flatMap((statement) => {
    const tokens = licenseTokensOf(statement.value);
    const [token] = tokens;
    if (tokens.length !== 1 || !token || seen.has(token)) return [];
    seen.add(token);
    return [{ value: statement.value, token }];
  });
}

test("an app's license leads to the apps under it, with the size of that list, and the list says what it holds", async ({ page }) => {
  const subject = build.apps.find((app) => !isLink(app) && statedLicenses(app).length === 1 && appsOf([statedLicenses(app)[0]?.token ?? ""]).length > 1);
  requireShape(subject !== undefined, "app with one stated license shared by other apps");
  if (!subject) return;
  const [license] = statedLicenses(subject);
  if (!license) return;
  await launch(page, sheetHash(subject));
  const link = factLink(page, license.value, license.token);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#/search\\?f=${escapeRegExp(license.token)}$`));
  await expect(countStatus(page)).toHaveText(filteredCount(build, appsOf([license.token])));
  await expect(activeChip(page, /, remove filter$/)).toHaveCount(1);
});

test("two sources stating different licenses: each license leads to its own list", async ({ page }) => {
  const subject = build.apps.find((app) => !isLink(app) && statedLicenses(app).length >= 2);
  requireShape(subject !== undefined, "app whose sources state two different licenses");
  if (!subject) return;
  await launch(page, sheetHash(subject));
  for (const license of statedLicenses(subject)) await expect(factLink(page, license.value, license.token)).toBeVisible();
});

test("the owner of an app's repository leads to the catalog's other entries of theirs, and names a few of them", async ({ page }) => {
  const [token, group] = ownerGroups[0] ?? [];
  requireShape(token !== undefined && group !== undefined && group.length > 1, "repository owner with two entries or more");
  const subject = group?.find((app) => !isLink(app));
  if (!token || !group || !subject) return;
  await launch(page, sheetHash(subject));
  const link = factLink(page, ownerWords(subject), token);
  await expect(link).toBeVisible();
  const others = group.filter((app) => app !== subject).sort((a, b) => a.name.localeCompare(b.name));
  await expect(details(page).getByText(/^Also /)).toContainText(others.length > 3 ? `and ${others.length - 3} more` : others.at(-1)?.name ?? "");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`#/search\\?f=${escapeRegExp(token)}$`));
  await expect(countStatus(page)).toHaveText(filteredCount(build, group));
  const chip = activeChip(page, new RegExp(`^${escapeRegExp(ownerWords(subject))}\\s*, remove filter$`, "i"));
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page).not.toHaveURL(/owner:/);
});

test("an app whose repository's owner has no other entry here, or that has no repository, says nothing of an owner", async ({ page }) => {
  const lone = build.apps.find((app) => !isLink(app) && owners.get(ownerToken(app) ?? "")?.length === 1);
  const none = build.apps.find((app) => !isLink(app) && app.atlas.repo === null);
  requireShape(lone !== undefined, "app whose repository's owner has one entry");
  for (const subject of [lone, none]) {
    if (!subject) continue;
    await launch(page, sheetHash(subject));
    await expect(details(page)).toBeVisible();
    await expect(details(page).getByText("Repository owner")).toHaveCount(0);
  }
});

test("the fact links are links the keyboard reaches and follows", async ({ page }) => {
  const [token, group] = ownerGroups[0] ?? [];
  const subject = group?.find((app) => !isLink(app));
  requireShape(token !== undefined && subject !== undefined, "repository owner with two entries or more");
  if (!token || !subject) return;
  await launch(page, sheetHash(subject));
  const link = factLink(page, ownerWords(subject), token);
  await expect(link).toHaveAttribute("href", `#/search?f=${token}`);
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`f=${escapeRegExp(token)}`));
});

test("an owner or license list narrows further with another filter and with text, and reads right when nothing is left", async ({ page }) => {
  const [token, group] = ownerGroups[0] ?? [];
  requireShape(token !== undefined && group !== undefined, "repository owner with two entries or more");
  if (!token || !group) return;
  await launch(page, `#/search?f=${token},fdroid`);
  await expect(countStatus(page)).toHaveText(filteredCount(build, appsOf([token, "fdroid"])));
  const word = group[0]?.name.split(/\s+/).at(-1) ?? "";
  await launch(page, `#/search?q=${encodeURIComponent(word)}&f=${token}`);
  await expect(countStatus(page)).toHaveText(filteredCount(build, appsOf([token], word)));
  await launch(page, `#/search?q=zzzzqx&f=${token}`);
  await expect(page.getByText("Nothing matches “zzzzqx” with these filters")).toBeVisible();
});

/**
 * Serves the next day's build: a new hash and date, with `change` applied to
 * the atlas part, and the manifest's digest of that part to match.
 */
async function serveNextBuild(page: Page, change: (apps: typeof build.atlas.apps) => typeof build.atlas.apps): Promise<string> {
  const atlasFile = build.manifest.files.find((file) => file.role === "atlas");
  if (!atlasFile) throw new Error("no atlas part");
  const hash = createHash("sha256").update(`next ${build.version.hash}`).digest("hex");
  const generatedAt = new Date(Date.parse(build.version.generatedAt) + 86_400_000).toISOString();
  const atlas = { ...structuredClone(build.atlas), hash, generatedAt };
  atlas.apps = change(atlas.apps);
  const body = JSON.stringify(atlas);
  const manifest = structuredClone(build.manifest);
  manifest.hash = hash;
  const listed = manifest.files.find((file) => file.role === "atlas");
  if (listed) listed.sha256 = createHash("sha256").update(body).digest("hex");
  await page.route("**/data/version.json", (route) => route.fulfill({ json: { ...build.version, hash, generatedAt } }));
  await page.route(`**/data/${build.version.manifest}`, (route) => route.fulfill({ json: manifest }));
  await page.route(`**/${atlasFile.path}`, (route) => route.fulfill({ body, contentType: "application/json" }));
  return hash;
}

/** Loads the page again at `hash`, as a new launch does: a change of hash alone keeps the catalog already loaded. */
async function relaunch(page: Page, hash: string): Promise<void> {
  await page.goto(`/${hash}`);
  await page.reload();
  await ready(page);
}

test.describe("a shared link and a pin with an owner or a license token", () => {
  test("survive a reload and a new catalog build", async ({ page }) => {
    const [owner, group] = ownerGroups[0] ?? [];
    const [license] = [...new Set(build.apps.flatMap((app) => statedLicenses(app).map((stated) => stated.token)))]
      .sort((a, b) => appsOf([b]).length - appsOf([a]).length);
    requireShape(owner !== undefined && license !== undefined && group !== undefined, "repository owner with two entries or more, and a stated license");
    if (!owner || !license || !group) return;
    const unrelated = build.apps.find((app) => ownerToken(app) !== owner && !appsOf([license]).includes(app));
    for (const token of [owner, license]) {
      await launch(page, `#/search?f=${token}`);
      await page.getByRole("button", { name: "Pin", exact: true }).click();
      await expect(page.getByRole("button", { name: "Pinned", exact: true })).toBeVisible();
    }
    const pins = page.getByRole("region", { name: "Pins" });
    const ownerPin = pins.getByRole("button", { name: new RegExp(`on ${FORGES[group[0]?.atlas.repo?.host ?? ""] ?? ""}`) });
    await launch(page, "#/search");
    await expect(ownerPin).toContainText(String(group.length));

    const next = await serveNextBuild(page, (apps) => apps.filter((app) => app.id !== unrelated?.id).reverse());
    await relaunch(page, "#/about/health");
    await expect(page.getByRole("main").getByRole("region", { name: "This catalog" })).toContainText(`Catalog build${next.slice(0, 16)}`);
    for (const token of [owner, license]) {
      await relaunch(page, `#/search?f=${token}`);
      await expect(page).toHaveURL(new RegExp(`f=${escapeRegExp(token)}$`));
      await expect(countStatus(page)).toHaveText(new RegExp(`^${appsOf([token]).length.toLocaleString("en")} of `));
    }
    await relaunch(page, "#/search");
    await expect(ownerPin).toContainText(String(group.length));
    await ownerPin.click();
    await expect(page).toHaveURL(new RegExp(`f=${escapeRegExp(owner)}$`));
  });

  test("a token for an owner the new build no longer holds is dropped, as unknown tokens are", async ({ page }) => {
    const pair = ownerGroups.find(([, apps]) => apps.length === 2);
    requireShape(pair !== undefined, "repository owner with exactly two entries");
    if (!pair) return;
    const [token, apps] = pair;
    const gone = new Set(apps.map((app) => app.id));
    await serveNextBuild(page, (atlasApps) => atlasApps.filter((app) => !gone.has(app.id)));
    await launch(page, `#/search?f=${token},fdroid`);
    const left = appsOf(["fdroid"]).filter((app) => !gone.has(app.id)).length;
    await expect(countStatus(page)).toHaveText(new RegExp(`^${left.toLocaleString("en")} of `));
    await expect(activeChip(page, /, remove filter$/)).toHaveCount(1);
  });
});
