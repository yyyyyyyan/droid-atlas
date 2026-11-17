/**
 * Guides, sites and further reading are links and are shown as a reading
 * list: a row leads straight to its page in a new tab, names the site it
 * leads to, gives a description when its catalog gives one and nothing in its
 * place otherwise, and sits under its category's full name. None of the tools
 * of an app list are offered, not even the bookmark, and a catalog's category
 * name with a trailing ellipsis never reaches a heading or a chip.
 */

import { expect, test } from "../lib/fixtures.ts";
import type { App } from "../lib/catalog.ts";
import { appsInCategory, appsInRegion, build, categoriesIn, requireShape, resourceRegion, shownName } from "../lib/pick.ts";
import { entryOf, launch, navLink, seedStorage, snapshot } from "../lib/app.ts";

const GUIDES = resourceRegion();

/** The site a link leads to: the host without `www.`, and for a forge the project's two path segments. */
function site(url: string): string {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "");
  if (!["github.com", "gitlab.com", "codeberg.org"].includes(host)) return host;
  return [host, ...parsed.pathname.split("/").filter(Boolean).slice(0, 2)].join("/");
}

function described(app: App): string | null {
  return app.listings.find((listing) => listing.description)?.description ?? app.summary ?? null;
}

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the list of links is the same in both layouts; run once, at phone size");
  void page;
});

test("a region of guides is a list of links under full category names, with none of an app list's tools", async ({ page }) => {
  requireShape(GUIDES !== null, "region that holds only guides and sites");
  if (!GUIDES) return;
  await launch(page, `#/region/${GUIDES.id}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1, name: GUIDES.name })).toBeVisible();
  await expect(main.getByRole("button", { name: /^Filters/ })).toHaveCount(0);
  await expect(main.getByRole("button", { name: /^Sort/ })).toHaveCount(0);

  const list = main.getByRole("region", { name: `Links in ${GUIDES.name}` });
  const categories = categoriesIn(GUIDES.id);
  if (categories.length === 1) {
    /* One category needs no heading to tell its links from another's: the list is all of it. */
    await expect(list.getByRole("heading", { level: 2 })).toHaveCount(0);
    await expect(list.getByRole("list").getByRole("listitem")).toHaveCount(appsInCategory(categories[0]?.id ?? "").length);
  }
  for (const category of categories.length > 1 ? categories : []) {
    const heading = list.getByRole("heading", { level: 2, name: shownName(category), exact: true });
    await expect(heading).toBeVisible();
    expect(await heading.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `“${shownName(category)}” is shown whole`).toBe(true);
    await expect(list.getByRole("list", { name: shownName(category), exact: true }).getByRole("listitem")).toHaveCount(appsInCategory(category.id).length);
  }
  const text = await main.innerText();
  expect(text, "a catalog's trailing ellipsis").not.toMatch(/…\s*$|\.\.\.\s*$/m);
  expect(text).not.toMatch(/No summary|no description|gives no|Loading/i);
});

test("each link's row leads to its own page in a new tab, shows where it leads, and describes it only when its catalog does", async ({ page }) => {
  requireShape(GUIDES !== null, "region that holds only guides and sites");
  if (!GUIDES) return;
  await launch(page, `#/region/${GUIDES.id}`);
  const before = await snapshot(page);
  for (const app of appsInRegion(GUIDES.id)) {
    const item = page.getByRole("main").locator(`[data-row="${app.id}"]`);
    const link = item.getByRole("link");
    const address = new URL(app.listings[0]?.url ?? "").href;
    await expect(link, app.name).toHaveAttribute("href", address);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /(^|\s)noopener(\s|$)/);
    const shown = (await link.innerText()).replace(/\s+/g, " ").replace(/, opens in a new tab$/, "").trim();
    const description = described(app);
    const expected = `${app.name} ${site(address)}${description ? ` ${description.replace(/\s+/g, " ").trim()}` : ""}`;
    expect(shown, `what the row for ${app.name} says`).toBe(expected);
    await expect(item.getByRole("button"), "a link has no bookmark").toHaveCount(0);
  }
  expect(entryOf(await snapshot(page)), "reading the rows navigated nowhere").toEqual(entryOf(before));
});

test("a link saved before stays in Saved, where it can be removed", async ({ page }) => {
  requireShape(GUIDES !== null, "region that holds only guides and sites");
  if (!GUIDES) return;
  const [app] = appsInRegion(GUIDES.id);
  if (!app) throw new Error("the region has no entry");
  await seedStorage(page, { "droid-atlas:v1:saved": JSON.stringify({ v: 1, items: [{ id: app.id, packages: [], repo: null, savedAt: 1 }] }) });
  await launch(page, "#/saved");
  await expect(page.getByRole("main").locator(`[data-row="${app.id}"]`)).toBeVisible();
  await page.getByRole("button", { name: `Remove ${app.name} from saved` }).click();
  await expect(page.getByRole("main").locator(`[data-row="${app.id}"]`)).toHaveCount(0);
  await expect(navLink(page, "Saved")).toBeVisible();
});

test("a catalog's category whose name ends in an ellipsis reaches no heading or chip: its entries are headed by Droid Atlas's own category", async ({ page }) => {
  const trailing = [...build.sourceCategories.values()].filter((source) => /(…|\.\.\.)$/.test(source.name) && source.category !== null);
  requireShape(trailing.length > 0, "catalog category whose name ends in an ellipsis");
  for (const source of trailing) {
    const category = build.categories.get(source.category ?? "");
    if (!category || appsInCategory(category.id).length === 0) continue;
    await launch(page, `#/cat/${category.id}`);
    await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(shownName(category));
    await launch(page, `#/region/${category.region}`);
    expect(await page.getByRole("main").innerText()).not.toContain(source.name);
  }
});
