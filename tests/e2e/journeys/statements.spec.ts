/**
 * What the app says when it has nothing to show is true of the entry it says
 * it on, and is a row, not a sentence. Checked on entries of every shape the
 * served catalog holds: permissions and anti-features read "Unknown" exactly
 * for an app no index carries, nothing is called "none", the one source the
 * details' heading names is one the entry is in, an app is never said to be
 * absent from a store, and a row without a summary shows where the entry
 * lives instead of an apology.
 */

import { expect, test } from "../lib/fixtures.ts";
import { sheetHash, type App } from "../lib/catalog.ts";
import { build, requireShape } from "../lib/pick.ts";
import { launch, sheet } from "../lib/app.ts";

const sorted = [...build.apps].sort((a, b) => a.id.localeCompare(b.id));
const isApp = (app: App): boolean => app.listings.some((listing) => listing.kind === "app");
const indexed = (app: App): boolean => app.fdroid !== null || app.izzy !== null;
const gone = (app: App): boolean => app.atlas.channels.some((channel) => channel.type !== "play" && channel.listed === false);
const linked = (app: App): boolean => app.atlas.channels.some((channel) => channel.type !== "play");

function first(test: (app: App) => boolean): App | undefined {
  return sorted.find(test);
}

/** Everyone who states something about the entry, by the names the app uses. */
function statedBy(app: App): string[] {
  const catalogs = build.sources.filter((source) => app.sources.has(source.info.id)).map((source) => source.info.name);
  return [...catalogs, ...(app.fdroid ? ["F-Droid"] : []), ...(app.izzy ? ["IzzyOnDroid"] : []), ...(app.github ? ["GitHub"] : [])];
}

const SHAPES: Record<string, App | undefined> = {
  "listed by a catalog only": first((app) => isApp(app) && !indexed(app) && app.github === null && !linked(app)),
  "a catalog and GitHub, no listing linked": first((app) => isApp(app) && !indexed(app) && app.github !== null && !linked(app)),
  "a linked listing its index no longer has": first((app) => isApp(app) && !indexed(app) && gone(app)),
  "carried by F-Droid only": first((app) => app.fdroid !== null && app.izzy === null),
  "carried by IzzyOnDroid only": first((app) => app.izzy !== null && app.fdroid === null),
  "carried by both indexes": first((app) => app.fdroid !== null && app.izzy !== null),
  "no summary from anyone": first((app) => isApp(app) && app.summary === null),
  "no summary, code on GitHub": first((app) => isApp(app) && app.summary === null && app.github !== null),
  "a guide or site": first((app) => !isApp(app)),
};

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the sentences do not depend on the layout; run once, at phone size");
  void page;
});

for (const [shape, app] of Object.entries(SHAPES)) {
  test(`${shape}${app ? ` (${app.id})` : ""}: what is missing is said in rows that are true of the entry`, async ({ page }) => {
    requireShape(Boolean(app), `entry ${shape}`);
    if (!app) return;
    await launch(page, sheetHash(app));
    await expect(sheet(page, app.name)).toBeVisible();
    await expect(sheet(page).getByText("Loading…", { exact: true })).toHaveCount(0);
    const text = (await sheet(page).innerText()).replace(/\s+/g, " ");

    expect(text, "an app is never said to be absent from a store").not.toMatch(/is in neither|in neither F-Droid|is not (in|on) (F-Droid|IzzyOnDroid)|not available (in|on)/i);

    const details = sheet(page).getByRole("region", { name: /^Details/ });
    const stated = (await details.count()) > 0 ? (await details.innerText()).replace(/\s+/g, " ") : "";
    if (isApp(app) && !indexed(app)) {
      expect(stated, "what no index states is unknown").toMatch(/Permissions Unknown/i);
      expect(stated).toMatch(/Anti-features Unknown/i);
    } else {
      expect(stated, "an entry an index carries, or a link, has nothing unknown").not.toMatch(/\bUnknown\b/);
    }
    expect(stated, "unknown is never worded as none").not.toMatch(/(Permissions|Anti-features) (None|No)\b/i);
    expect(text, "what is missing is a row, not a sentence").not.toMatch(/gives? (no|a) (summary|working link)|has (no|a) long description|is linked for this entry|not the same as|states anything more/);

    const heading = (await details.count()) > 0 ? ((await details.getByRole("heading", { level: 3 }).innerText()).replace(/\s+/g, " ")) : "";
    const named = heading.includes(" · ") ? heading.slice(heading.indexOf(" · ") + 3).split(", ") : [];
    const allowed = [...statedBy(app), ...(gone(app) ? ["F-Droid", "IzzyOnDroid"] : [])].map((name) => name.toLowerCase());
    for (const name of named) expect(allowed, `the details' heading names ${name}`).toContain(name.toLowerCase());
  });
}

test("a row without a summary shows where the entry lives, not a sentence about what is missing", async ({ page }) => {
  const app = first((candidate) => isApp(candidate) && candidate.summary === null && candidate.atlas.repo?.slug !== null && candidate.atlas.repo !== null);
  requireShape(Boolean(app), "app with a repository and no summary");
  if (!app) return;
  await launch(page, `#/cat/${app.atlas.category}`);
  const row = page.getByRole("main").locator(`[data-row="${app.id}"]`);
  await row.scrollIntoViewIfNeeded();
  await expect(row).toContainText(app.atlas.repo?.slug ?? "");
  expect(await row.innerText()).not.toMatch(/No summary|no description|not available|unknown/i);
});
