/**
 * About: one tap from every top-level view; what the app is and where its
 * data comes from in a sentence, six lines on using it, the project on
 * GitHub and where corrections go; and the pages beneath it (settings,
 * sources and licenses, icon credits, data health), each one tap further and
 * each a page of the app itself.
 *
 * Counts on those pages are compared with the files the build publishes: the
 * icon credits with `icons.json`, the entries with the catalog parts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../lib/fixtures.ts";
import { build, requireShape } from "../lib/pick.ts";
import { back, escapeRegExp, launch, navLink, ready } from "../lib/app.ts";
import { REPO_ROOT } from "../site.ts";

const REPOSITORY = "https://github.com/yyyyyyyan/droid-atlas";
const CONTACT = "hello@droidatlas.app";

/** A site built inside a git checkout, or by Actions, knows the commit it was built from. */
const BUILT_FROM_A_COMMIT = existsSync(join(REPO_ROOT, ".git")) || Boolean(process.env.GITHUB_SHA);
const DAY = "[A-Z][a-z]{2} \\d{1,2}, \\d{4}";
const LOCAL = "(, with local changes)?";

interface IconRecord { file: string; app: string; name: string; rule: string; author: string; license: string }

function iconRecords(): IconRecord[] {
  const listed = build.manifest.files.find((file) => file.role === "icons");
  if (!listed) return [];
  return (JSON.parse(readFileSync(join(build.dir, listed.path), "utf8")) as { icons: IconRecord[] }).icons;
}

/** The plain words the credits page groups icon sources under, and the rules each covers. */
const ICON_GROUPS: { label: string; rules: string[] }[] = [
  { label: "F-Droid and IzzyOnDroid", rules: ["fdroid-index", "izzy-index"] },
  { label: "The project’s repository", rules: ["repo-fastlane", "repo-metadata", "repo-launcher", "readme-logo", "forge-avatar"] },
  { label: "Website or store listing", rules: ["site-icon", "store-listing"] },
];

const isResource = (app: (typeof build.apps)[number]): boolean => app.listings.length > 0 && app.listings.every((listing) => listing.kind === "resource");

for (const from of [{ name: "Explore", hash: "#/" }, { name: "Search", hash: "#/search" }, { name: "Saved", hash: "#/saved" }]) {
  test(`About is one tap from ${from.name}`, async ({ page }) => {
    await launch(page, from.hash);
    await navLink(page, "About").click();
    await expect(page).toHaveURL(/#\/about$/);
    await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "About" })).toBeVisible();
    await expect(navLink(page, "About")).toHaveAttribute("aria-current", "page");
  });
}

test("About says what the app is and where the data comes from in one screen, links the project, and sends corrections to its issues", async ({ page }) => {
  await launch(page, "#/about");
  const main = page.getByRole("main");
  const what = main.getByRole("region", { name: "Droid Atlas" });
  for (const source of build.sources) {
    await expect(what.getByRole("link", { name: source.info.name, exact: true })).toHaveAttribute("target", "_blank");
  }
  await expect(what).toContainText("F-Droid");
  await expect(what).toContainText("IzzyOnDroid");
  await expect(what).toContainText("GitHub");
  await expect(what).toContainText("No account and no analytics.");
  await expect(main.getByRole("region", { name: "How to use it" }).getByRole("listitem")).toHaveCount(6);
  const words = (await main.innerText()).split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  expect(words, "About is read in one screen").toBeLessThan(140);

  const project = main.getByRole("navigation", { name: "The project, settings and sources" });
  const github = project.getByRole("link", { name: /^Source code and issues/ });
  await expect(github).toHaveAttribute("href", REPOSITORY);
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(github).toHaveAttribute("rel", /(^|\s)noopener(\s|$)/);
  const contact = project.getByRole("link", { name: /^Corrections and removal/ });
  await expect(contact, "the whole row is the link, as the rows around it are").toHaveClass(/(^|\s)nav-row(\s|$)/);
  await expect(contact).toHaveAttribute("href", `mailto:${CONTACT}`);
  await expect(contact.locator(".contact-address")).toHaveText(CONTACT);

  await expect(main.locator('a[href^="mailto:"]')).toHaveCount(1);
  expect((await main.innerText()).match(/[\w.+-]+@[\w-]+\.[\w.-]+/g), "the only address shown is the project's").toEqual([CONTACT]);

});

test("the site's own version, the commit it was built from and that commit's date, ends About and stands apart from the catalog's build on Data health", async ({ page }) => {
  await launch(page, "#/about/health");
  const main = page.getByRole("main");
  const hash = build.version.hash.slice(0, 16);
  const catalog = main.getByRole("region", { name: "This catalog" });
  await expect(catalog).toContainText(`Catalog build${hash}`);
  await expect(catalog).toContainText(`Data format${build.version.schema}`);
  await expect(catalog).not.toContainText("Site build");

  const site = main.getByRole("region", { name: "This site" });
  await expect(site).toHaveText(new RegExp(`^This siteSite build([0-9a-f]{7}( of ${DAY})?${LOCAL}Copy|Not stated by this build)$`));
  await expect(site).not.toContainText(hash);
  const commit = site.locator("code");
  const stated = (await commit.count()) > 0 ? (await commit.innerText()).trim() : null;
  if (BUILT_FROM_A_COMMIT) expect(stated, "a build that has a commit states it").not.toBeNull();
  const link = site.getByRole("link");
  if ((await link.count()) > 0) {
    await expect(link, "a linked commit is the commit shown").toHaveAttribute("href", new RegExp(`^https://[^?#]+/commit/${stated}[0-9a-f]{33,57}$`));
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /(^|\s)noopener(\s|$)/);
  }
  const linked = await link.count() > 0 ? await link.getAttribute("href") : null;

  await launch(page, "#/about");
  const line = page.getByRole("main").locator(".about-version");
  if (stated === null) {
    await expect(line, "a build that states no commit says nothing on About").toHaveCount(0);
    return;
  }
  await expect(line).toHaveText(new RegExp(`^Site build ${escapeRegExp(stated)}( · ${DAY})?${LOCAL}$`));
  expect(await line.getByRole("link").count() > 0 ? await line.getByRole("link").getAttribute("href") : null, "About and Data health link the same commit, or neither does").toBe(linked);
});

test("on Data health one tap copies the catalog's build and the site's build, each exactly as the page shows it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await launch(page, "#/about/health");
  const main = page.getByRole("main");
  const copied = (): Promise<string> => page.evaluate(() => navigator.clipboard.readText());

  const catalog = main.getByRole("button", { name: "Copy catalog build" });
  await catalog.click();
  expect(await copied()).toBe(build.version.hash.slice(0, 16));
  await expect(page.getByText("catalog build copied")).toHaveCount(1);

  const commit = main.getByRole("region", { name: "This site" }).locator("code");
  const site = main.getByRole("button", { name: "Copy site build" });
  if ((await commit.count()) === 0) {
    await expect(site, "a build that states no commit offers nothing to copy").toHaveCount(0);
    return;
  }
  await site.click();
  expect(await copied()).toBe((await commit.innerText()).trim());
});

test("Sources and licenses says of logos what its own credit says: F-Droid's mark is used, redrawn, and no other", async ({ page }) => {
  await launch(page, "#/about/sources");
  const main = page.getByRole("main");
  await expect(main, "the credit for the mark").toContainText("The F-Droid mark on the “On F-Droid” filter is redrawn in one color from the F-Droid logo");
  const names = main.getByRole("region", { name: "Names and trademarks" });
  await expect(names).toContainText("The one logo used is F-Droid’s, redrawn in one color under GPL-3.0 or later.");
  await expect(main).not.toContainText(/None of their logos|no logo/i);
});

test("wherever the project's address is offered it is shown in full, in the one link that writes to it", async ({ page }) => {
  for (const [hash, where] of [["#/about", "About"], ["#/about/sources", "Sources and licenses"], ["#/about/icons", "Icon credits"]] as const) {
    await launch(page, hash);
    const main = page.getByRole("main");
    const address = main.locator(".contact-address");
    await expect(address, where).toHaveCount(1);
    await expect(address, where).toHaveText(CONTACT);
    const write = main.locator('a[href^="mailto:"]');
    await expect(write, where).toHaveCount(1);
    await expect(write, where).toHaveAttribute("href", `mailto:${CONTACT}`);
    await expect(write, `${where}: the link shows the address it writes to`).toContainText(CONTACT);
    expect(await write.getAttribute("target"), `${where}: a mail link opens no blank tab`).toBeNull();
    expect(await address.evaluate((node) => node.closest("a")?.getAttribute("href") ?? null), `${where}: the address is in that link`).toBe(`mailto:${CONTACT}`);
  }
});

test("Settings, Sources and licenses, Icon credits and Data health are each one tap from About, and Back returns to it", async ({ page }) => {
  await launch(page, "#/");
  await navLink(page, "About").click();
  const pages: [RegExp, string, RegExp][] = [
    [/^Settings$/, "Settings", /#\/settings$/],
    [/^Sources and licenses$/, "Sources and licenses", /#\/about\/sources$/],
    [/^Icon credits/, "Icon credits", /#\/about\/icons$/],
    [/^Data health/, "Data health", /#\/about\/health$/],
  ];
  for (const [link, heading, url] of pages) {
    await page.getByRole("main").getByRole("navigation", { name: "The project, settings and sources" }).getByRole("link", { name: link }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("main").getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(navLink(page, "About")).toHaveAttribute("aria-current", "page");
    await back(page);
    await expect(page).toHaveURL(/#\/about$/);
  }
});

test("a license opens as a page of the app with its text, and is still there after a reload", async ({ page }) => {
  await launch(page, "#/about/sources");
  const document = page.url().split("#")[0];
  const license = page.getByRole("main").getByRole("region", { name: "Catalogs" }).getByRole("link", { name: /^(GPL|CC |Apache|MIT|AGPL)/ }).first();
  await license.click();
  await expect(page).toHaveURL(/#\/about\/license\/[\w.+-]+$/);
  expect(page.url().split("#")[0], "the same document: no file was navigated to").toBe(document);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toBeVisible();
  const id = decodeURIComponent(page.url().split("/").at(-1) ?? "");
  const words = (text: string): string => text.replace(/\s+/g, " ").trim();
  const published = words(readFileSync(join(build.dataRoot, "licenses", `${id}.txt`), "utf8"));
  expect(published.length, "the license text the site publishes").toBeGreaterThan(40);
  const opening = published.slice(0, 400);
  await expect.poll(async () => words(await main.innerText()), { message: "the text of the license, as published" }).toContain(opening);
  await page.reload();
  await ready(page);
  await expect.poll(async () => words(await page.getByRole("main").innerText())).toContain(opening);
  await back(page).catch(() => undefined);
});

test("the icon credits list every record the build publishes, grouped by where each icon came from, and can be searched", async ({ page }) => {
  const records = iconRecords();
  await launch(page, "#/about/icons");
  const main = page.getByRole("main");
  await expect(main.getByRole("status").filter({ hasText: "Loading…" })).toHaveCount(0);
  if (records.length === 0) {
    await expect(main).toContainText("This build ships no icons.");
    return;
  }
  const credits = main.getByRole("region", { name: "Icon credits" });
  const status = credits.getByRole("search").getByRole("status");
  await expect(status).toHaveText(`${records.length.toLocaleString("en")} icons`);
  await expect(credits.getByRole("list", { name: new RegExp(`^${records.length.toLocaleString("en")} icon credits`) })).toBeVisible();
  await expect(main).not.toContainText("This build ships no icons.");

  const groups = credits.getByRole("group", { name: "Where the icons came from" });
  const present = ICON_GROUPS.map((group) => ({ ...group, count: records.filter((record) => group.rules.includes(record.rule)).length })).filter((group) => group.count > 0);
  expect(present.reduce((sum, group) => sum + group.count, 0), "every rule in the file belongs to a group named in plain words").toBe(records.length);
  if (present.length > 1) {
    for (const group of present) {
      await expect(groups.getByRole("button", { name: `${group.label} ${group.count.toLocaleString("en")}`, exact: true })).toBeVisible();
    }
    const [first] = present;
    if (first) {
      await groups.getByRole("button", { name: new RegExp(`^${first.label} `) }).click();
      await expect(status).toHaveText(`${first.count.toLocaleString("en")} of ${records.length.toLocaleString("en")}`);
      await groups.getByRole("button", { name: /^All / }).click();
    }
  }
  await expect(main).not.toContainText(/fdroid-index|izzy-index|repo-fastlane|repo-launcher|readme-logo|forge-avatar|site-icon|store-listing|repo-metadata/);

  const sample = [...records].sort((a, b) => a.name.localeCompare(b.name))[Math.floor(records.length / 2)];
  if (!sample) throw new Error("no record");
  await credits.getByRole("searchbox", { name: "Search the icon credits" }).fill(sample.name);
  await expect(status).toHaveText(/^[\d,]+ of [\d,]+$/);
  const owner = sample.author.replace(/^the (.+) project$/u, "$1").replace(/^the /u, "");
  const row = credits.getByRole("listitem").filter({ hasText: sample.name }).filter({ hasText: `${owner} · ` }).first();
  await expect(row).toBeVisible();
  const kinds = /· (F-Droid|IzzyOnDroid|repository|website|store listing) · /;
  await expect(row.locator(".credit-row-meta")).toHaveText(kinds);
  if (sample.license === "not stated") await expect(row).toContainText("no license stated");
  else await expect(row).not.toContainText("no license stated");

  await credits.getByRole("searchbox", { name: "Search the icon credits" }).fill("");
  await expect(credits.locator("ol.credits"), "every row is made, a slice at a time").toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  for (const width of [320, 384]) {
    await page.setViewportSize({ width, height: 688 });
    for (const group of present) {
      if (present.length > 1) await groups.getByRole("button", { name: new RegExp(`^${group.label} `) }).click();
      const seen = new Set<number>();
      for (const part of [0, 0.25, 0.5, 0.75, 1]) {
        await page.evaluate((fraction) => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * fraction), part);
        await page.waitForTimeout(150);
        const rows = await credits.locator(".credit-row").evaluateAll((items) => items
          .map((item) => ({ item, box: item.getBoundingClientRect() }))
          .filter(({ box }) => box.bottom > 0 && box.top < innerHeight)
          .map(({ item, box }) => {
            const meta = item.querySelector<HTMLElement>(".credit-row-meta");
            const links = item.querySelector<HTMLElement>(".credit-row-links");
            return {
              name: item.querySelector(".credit-row-name")?.textContent ?? "",
              lines: meta ? Math.round(meta.getBoundingClientRect().height / 18) : 0,
              cut: !meta || meta.scrollWidth > meta.clientWidth + 1 || meta.scrollHeight > meta.clientHeight + 1,
              slack: links ? Math.round(box.bottom - links.getBoundingClientRect().bottom) : -1,
              pastEdge: [...item.querySelectorAll("a")].some((link) => link.getBoundingClientRect().right > box.right + 0.5),
              brokenId: [...item.querySelectorAll(".credit-license")].some((word) => word.getClientRects().length > 1),
            };
          }));
        expect(rows.length, "rows on screen").toBeGreaterThan(0);
        expect(rows.filter((row) => row.cut).map((row) => row.name), `${group.label} at ${width} px: every credit is shown whole, license included`).toEqual([]);
        expect(rows.filter((row) => row.slack !== 0).map((row) => `${row.name}: ${row.slack}`), `${group.label} at ${width} px: a row ends where its links end, whatever its credit wraps to`).toEqual([]);
        expect(rows.filter((row) => row.pastEdge).map((row) => row.name), `${group.label} at ${width} px: links wrap and none runs past the row's edge`).toEqual([]);
        expect(rows.filter((row) => row.brokenId).map((row) => row.name), `${group.label} at ${width} px: a license identifier is never broken inside itself`).toEqual([]);
        for (const row of rows) seen.add(row.lines);
      }
      expect(Math.min(...seen), "a credit takes at least one line").toBeGreaterThanOrEqual(1);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }

  await launch(page, "#/about");
  await expect(page.getByRole("main").getByRole("link", { name: new RegExp(`^Icon credits ?${records.length.toLocaleString("en")}$`) })).toBeVisible();
});

test("the credits show a screenful at once, make the rest without holding the page, and a search afterwards makes no row", async ({ page }) => {
  const records = iconRecords();
  test.skip(records.length < 200, "a list this short is made in a pass or two");
  await launch(page, "#/about/icons");
  const credits = page.getByRole("main").getByRole("region", { name: "Icon credits" });
  const list = credits.locator("ol.credits");
  await expect(list.getByRole("listitem").first()).toBeVisible();
  await expect(list).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  expect(await list.evaluate((element) => element.children.length), "one row for every record").toBe(records.length);

  await list.evaluate((element) => {
    for (const row of element.children) (row as HTMLElement & { seen?: boolean }).seen = true;
  });
  const search = credits.getByRole("searchbox", { name: "Search the icon credits" });
  const status = credits.getByRole("search").getByRole("status");
  const sample = [...records].sort((a, b) => a.name.localeCompare(b.name))[Math.floor(records.length / 3)];
  if (!sample) throw new Error("no record");
  await search.fill(sample.name);
  await expect(status).toHaveText(/^[\d,]+ of [\d,]+$/);
  const narrowed = await list.getByRole("listitem").count();
  expect(narrowed).toBeGreaterThan(0);
  expect(narrowed).toBeLessThan(records.length);
  await search.fill("");
  await expect(status).toHaveText(`${records.length.toLocaleString("en")} icons`);
  await expect(list.getByRole("listitem")).toHaveCount(records.length);
  const remade = await list.evaluate((element) => [...element.children].filter((row) => !(row as HTMLElement & { seen?: boolean }).seen).length);
  expect(remade, "clearing the search shows the rows that were hidden; none is made again").toBe(0);
  await expect(list).toHaveAttribute("aria-busy", "false");
  const skipped = await list.evaluate((element) => [...element.children].filter((row) => getComputedStyle(row).contentVisibility !== "visible").length);
  expect(skipped, "every row is painted, so a fling never uncovers one that is not drawn").toBe(0);
});

test("searching the credits with the keyboard up puts the field at the top of the screen and the matches under it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the on-screen keyboard is the phone's");
  const records = iconRecords();
  requireShape(records.length > 0, "icon credits");
  const name = [...records].sort((a, b) => a.name.localeCompare(b.name))[Math.floor(records.length / 2)]?.name ?? "";
  await launch(page, "#/about/icons");
  const credits = page.getByRole("main").getByRole("region", { name: "Icon credits" });
  await expect(credits.locator("ol.credits").getByRole("listitem").first()).toBeVisible();
  const full = page.viewportSize() ?? { width: 384, height: 688 };
  const search = credits.getByRole("searchbox", { name: "Search the icon credits" });
  await search.focus();
  await page.setViewportSize({ width: full.width, height: full.height - 300 });
  await expect(page.locator("html")).toHaveClass(/has-keyboard/);
  await search.pressSequentially(name, { delay: 20 });
  await expect(credits.getByRole("search").getByRole("status")).toHaveText(/^[\d,]+ of [\d,]+$/);
  await page.waitForTimeout(300);
  const field = await search.boundingBox();
  expect(field?.y ?? 999, "the field is at the top of what the keyboard leaves").toBeLessThan(24);
  const first = credits.locator("ol.credits > li:not([hidden])").first();
  await expect(first, "the first match is in view").toBeInViewport({ ratio: 1 });
  await page.setViewportSize(full);
});

test("Back from a license returns to the credit that was in view", async ({ page }) => {
  const records = iconRecords();
  test.skip(records.length < 200, "a list this short does not scroll far");
  await launch(page, "#/about/icons");
  const credits = page.getByRole("main").getByRole("region", { name: "Icon credits" });
  await expect(credits.locator("ol.credits")).toHaveAttribute("aria-busy", "false", { timeout: 20_000 });
  await page.evaluate(() => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) * 0.6)));
  await page.waitForTimeout(300);
  const link = credits.getByRole("link", { name: "License text" }).filter({ visible: true });
  const target = await link.evaluateAll((links) => {
    const at = links.findIndex((item) => {
      const box = item.getBoundingClientRect();
      return box.top > 160 && box.bottom < innerHeight - 120;
    });
    const row = links[at]?.closest(".credit-row");
    return row ? { at, name: row.querySelector(".credit-row-name")?.textContent ?? "", top: Math.round(row.getBoundingClientRect().top) } : null;
  });
  if (!target) throw new Error("no credit with a license text on screen");
  await link.nth(target.at).click();
  await expect(page).toHaveURL(/#\/about\/license\//);
  await back(page);
  await expect(page).toHaveURL(/#\/about\/icons$/);
  const row = page.getByRole("main").locator("ol.credits").getByRole("listitem").filter({ hasText: target.name }).first();
  await expect(row).toBeInViewport();
  await expect.poll(async () => Math.round((await row.boundingBox())?.y ?? -1), { message: "the credit is where it was" }).toBeGreaterThan(target.top - 3);
  expect(Math.round((await row.boundingBox())?.y ?? -1)).toBeLessThan(target.top + 3);
});

test("a credit links its license's text where the site ships that text, also under the spelling SPDX now uses, and nowhere else", async ({ page }) => {
  const records = iconRecords();
  const shipped = (id: string): boolean => existsSync(join(build.dataRoot, "licenses", `${id}.txt`));
  const bare = [...records].sort((a, b) => a.name.localeCompare(b.name)).find((record) => /^[AL]?GPL-\d+\.\d+$/.test(record.license) && !shipped(record.license) && shipped(`${record.license}-only`));
  const unknown = [...records].sort((a, b) => a.name.localeCompare(b.name)).find((record) => record.license !== "not stated" && !/^[\w.+-]+$/.test(record.license));
  requireShape(Boolean(bare), "icon whose project states a bare GNU license identifier");
  if (!bare) return;
  await launch(page, "#/about/icons");
  const credits = page.getByRole("main").getByRole("region", { name: "Icon credits" });
  const search = credits.getByRole("searchbox", { name: "Search the icon credits" });
  await search.fill(bare.name);
  const row = credits.getByRole("listitem").filter({ hasText: bare.name }).filter({ hasText: ` · ${bare.license}` }).first();
  await expect(row.locator(".credit-row-meta"), "the credit states the license as its source spells it").toHaveText(new RegExp(` · ${bare.license.replace(/[.+]/g, "\\$&")}$`));
  await expect(row.getByRole("link", { name: "License text" })).toHaveAttribute("href", `#/about/license/${bare.license}-only`);
  if (unknown) {
    await search.fill(unknown.name);
    const other = credits.getByRole("listitem").filter({ hasText: unknown.name }).filter({ hasText: unknown.license }).first();
    await expect(other).toBeVisible();
    await expect(other.getByRole("link", { name: "License text" }), `“${unknown.license}” is not certainly any license the site ships`).toHaveCount(0);
  }
});

test("icon credits that do not load say so, and Try again loads them", async ({ page }) => {
  const listed = build.manifest.files.find((file) => file.role === "icons");
  test.skip(!listed, "this build publishes no icon credits");
  if (!listed) return;
  let fail = true;
  await page.route(`**/${listed.path}`, (route) => (fail ? route.abort("failed") : route.continue()));
  await launch(page, "#/about/icons");
  const failed = page.getByRole("main").getByRole("alert");
  await expect(failed).toContainText("The credits did not load.");
  fail = false;
  await failed.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("main").getByRole("region", { name: "Icon credits" }).getByRole("search").getByRole("status")).toHaveText(/^[\d,]+ icons?$/);
  await expect(failed).toHaveCount(0);
});

test("Data health states the build, what it holds, and how old each source's figures are; what each figure counts is said once, under its source", async ({ page }) => {
  await launch(page, "#/about/health");
  const main = page.getByRole("main");
  const catalog = main.getByRole("region", { name: "This catalog" });
  await expect(catalog).toContainText(build.version.hash.slice(0, 16));
  const resources = build.apps.filter(isResource).length;
  await expect(catalog).toContainText(`${(build.apps.length - resources).toLocaleString("en")} apps`);
  await expect(catalog).toContainText(`${build.apps.filter((app) => app.atlas.icon).length.toLocaleString("en")} with an icon`);

  const sources = main.getByRole("region", { name: /^Sources/ });
  for (const source of build.sources) {
    const item = sources.getByRole("listitem").filter({ hasText: source.info.name });
    await expect(item).toContainText(source.info.commit.slice(0, 10));
    await expect(item).toContainText(source.info.entries.toLocaleString("en"));
  }
  expect(await sources.evaluate((element) => [...element.querySelectorAll("code")].every((code) => code.getClientRects().length === 1)), "a commit id is never broken across lines").toBe(true);

  const origins = [
    { id: "fdroid", name: "F-Droid", title: /^F-Droid/, counts: "Requests for the app's APK files to F-Droid's own download servers" },
    { id: "izzy", name: "IzzyOnDroid", title: /^IzzyOnDroid/, counts: "Successful APK downloads from the IzzyOnDroid servers that report statistics" },
    { id: "github", name: "GitHub", title: /^GitHub/, counts: "Downloads of the APK files attached to the latest GitHub release" },
  ].map((origin) => ({ ...origin, apps: build.apps.filter((app) => app.downloads.some((stat) => stat.origin === origin.id)).length })).filter((origin) => origin.apps > 0);
  if (origins.length === 0) {
    await expect(main.getByRole("region", { name: /^Download figures/ })).toHaveCount(0);
    return;
  }
  const downloads = main.getByRole("region", { name: /^Download figures/ });
  for (const origin of origins) {
    const item = downloads.getByRole("listitem").filter({ has: page.getByRole("heading", { name: origin.name, exact: true }) });
    await expect(item).toContainText(`Apps with a figure${origin.apps.toLocaleString("en")}`);
    await expect(item).toContainText(/Newest figures[A-Z][a-z]{2} \d{1,2}, \d{4}, (today|[\d,]+\sdays?\sago)|Running totals/);
    await expect(item, "what a figure counts is not said here").not.toContainText(origin.counts);
    const newest = [...build.apps.flatMap((app) => app.downloads)].filter((stat) => stat.origin === origin.id && stat.to !== null).map((stat) => stat.to ?? "").sort().at(-1);
    const age = newest ? Math.floor((Date.now() - Date.parse(newest)) / 86_400_000) : null;
    if (origin.id !== "github" && age !== null && age > 21) {
      await expect(item.getByRole("status"), `${origin.name}'s figures are ${age} days old and the page says so`).toContainText(/^Nothing newer published/);
    }
  }
  expect(await main.innerText()).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  const prose = await main.evaluate((element) => [...element.querySelectorAll("p.page-text, p.page-lead, p.settings-note:not(:has(.health-names))")].map((p) => p.textContent ?? "").join(" "));
  expect(prose.split(/\s+/).filter(Boolean).length, "Data health is a table, not an essay").toBeLessThan(40);

  await launch(page, "#/about/sources?at=facts");
  const facts = page.getByRole("main").getByRole("region", { name: "Facts and descriptions" });
  await expect(facts.getByRole("heading", { level: 2 })).toBeInViewport();
  for (const origin of origins) {
    const block = facts.getByRole("article").filter({ has: page.getByRole("heading", { name: origin.title }) });
    await expect(block, `what ${origin.name}'s figures count is said once, under that source`).toContainText(`Downloads${origin.counts}`);
  }
  const text = await page.getByRole("main").innerText();
  for (const origin of origins) expect(text.split(origin.counts).length - 1, `${origin.name}: said once on the page`).toBe(1);
});

test("the names Data health lists read as a sentence: spaced like words, and no line starts with a comma", async ({ page }) => {
  await launch(page, "#/about/health");
  const lists = page.getByRole("main").locator(".health-names");
  const longest = Math.max(0, ...await lists.evaluateAll((items) => items.map((item) => item.querySelectorAll("a").length)));
  requireShape(longest > 1, "list of two names or more on Data health");
  for (const width of [320, 336, 384]) {
    await page.setViewportSize({ width, height: 688 });
    const faults = await lists.evaluateAll((items) => items.flatMap((item) => {
      const found: string[] = [];
      const start = item.getBoundingClientRect().left;
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = (node.textContent ?? "").indexOf(",");
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + 1);
        if (range.getBoundingClientRect().left <= start + 1) found.push(`a line starts with the comma after “${node.previousSibling?.textContent ?? ""}”`);
      }
      /* The words themselves, not the links' boxes: a box padded to a minimum width moves its text away from the comma. */
      const links = [...item.querySelectorAll("a")].map((link) => {
        const words = document.createRange();
        words.selectNodeContents(link);
        return { name: link.textContent ?? "", box: words.getBoundingClientRect() };
      });
      const gaps = links.slice(1).flatMap((link, index) => {
        const before = links[index];
        return before && Math.abs(link.box.top - before.box.top) < 1 ? [{ name: link.name, gap: link.box.left - before.box.right }] : [];
      });
      const spread = gaps.length > 1 ? Math.max(...gaps.map((pair) => pair.gap)) - Math.min(...gaps.map((pair) => pair.gap)) : 0;
      if (spread > 1.5) found.push(`uneven spacing: ${gaps.map((pair) => `${pair.name} ${pair.gap.toFixed(1)}`).join(", ")}`);
      return found;
    }));
    expect(faults, `at ${width} px`).toEqual([]);
  }
});
