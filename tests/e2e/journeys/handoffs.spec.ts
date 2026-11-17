/**
 * Outbound links: for entries of every shape in the served catalog, every
 * action in the sheet is compared with the forms that were tapped on the
 * device (docs/UX-REVIEW.md § 1), under three user agents. Links are read,
 * never followed: the guard in lib/fixtures.ts cancels and fails any
 * activation.
 */

import type { Page } from "@playwright/test";
import { expect, test } from "../lib/fixtures.ts";
import { featuredApp, requireShape } from "../lib/pick.ts";
import { loadBuild, sheetHash, type App } from "../lib/catalog.ts";
import { FORBIDDEN_IN_LINKS, OBTAINIUM_HOME, expectedActions, expectedPrimary, isResource, type Section } from "../lib/links-oracle.ts";
import { ANDROID_CHROME_UA, DESKTOP_UA, FIREFOX_ANDROID_UA, escapeRegExp, ready, sheet } from "../lib/app.ts";

const build = loadBuild();

function firstWhere(predicate: (app: App) => boolean): App | undefined {
  return [...build.apps].sort((a, b) => a.id.localeCompare(b.id)).find(predicate);
}

const live = (app: App, type: string): boolean => app.atlas.channels.some((c) => c.type === type && c.listed === true);

/** One entry per shape of outbound links the catalog can hold. */
const SHAPES: Record<string, App | undefined> = {
  "F-Droid only": firstWhere((a) => live(a, "fdroid") && !live(a, "izzy")),
  "IzzyOnDroid only": firstWhere((a) => live(a, "izzy") && !live(a, "fdroid")),
  "F-Droid and IzzyOnDroid": build.byId.get("org.fossify.gallery") ?? firstWhere((a) => live(a, "fdroid") && live(a, "izzy")),
  "GitHub APK only": firstWhere((a) => a.atlas.channels.length === 0 && a.atlas.repo?.host === "github" && a.github?.release?.hasApk === true),
  "GitHub without an APK and no listing": firstWhere((a) => !isResource(a) && a.atlas.channels.length === 0 && a.atlas.repo?.host === "github" && a.github !== null && a.github.release?.hasApk !== true),
  GitLab: firstWhere((a) => a.atlas.repo?.host === "gitlab"),
  Codeberg: firstWhere((a) => a.atlas.repo?.host === "codeberg"),
  "another forge": firstWhere((a) => a.atlas.repo?.host === "other"),
  "a listing its repository no longer has": firstWhere((a) => a.atlas.channels.some((c) => c.listed === false)),
  "only listings that are gone": firstWhere((a) => a.atlas.channels.length > 0 && a.atlas.channels.every((c) => c.listed === false)),
  "moved repository": firstWhere((a) => Boolean(a.github?.movedTo)),
  "missing repository": firstWhere((a) => a.atlas.repoMissing),
  "Google Play": firstWhere((a) => a.atlas.channels.some((c) => c.type === "play")),
  "a variant build": firstWhere((a) => a.atlas.channels.some((c) => c.variant !== null)),
  "extra links": firstWhere((a) => !isResource(a) && a.listings.some((l) => l.extraLinks.length > 0)),
  "closed source with Shizuku": firstWhere((a) => a.atlas.facets.openness === "closed-source" && a.atlas.facets.shizuku),
  "a resource": firstWhere((a) => isResource(a) && a.github === null),
  "a resource that is a GitHub repository": firstWhere((a) => isResource(a) && a.github !== null),
};

const SECTIONS: Section[] = ["Where it leads", "Get it", "Links"];

interface RenderedAction { section: string; href: string; target: string | null; rel: string | null; gone: boolean }

async function renderedActions(page: Page): Promise<RenderedAction[]> {
  const found: RenderedAction[] = [];
  for (const section of SECTIONS) {
    const region = sheet(page).getByRole("region", { name: section, exact: true });
    if (!(await region.count())) continue;
    for (const item of await region.getByRole("listitem").all()) {
      const main = item.getByRole("link").first();
      found.push({
        section,
        href: (await main.getAttribute("href")) ?? "",
        target: await main.getAttribute("target"),
        rel: await main.getAttribute("rel"),
        gone: (await main.getByText("Gone", { exact: true }).count()) > 0,
      });
    }
  }
  return found;
}

/** The order the oracle lists actions in, with a resource's own page first, is the order the sheet shows them in, section by section. */
function bySection<T extends { section: string }>(actions: T[]): T[] {
  return SECTIONS.flatMap((section) => actions.filter((action) => action.section === section));
}

async function openSheet(page: Page, app: App): Promise<void> {
  await page.goto(`/${sheetHash(app)}`);
  await ready(page);
  await expect(sheet(page, app.name)).toBeVisible();
}

const AGENTS: { name: string; ua: string; android: boolean }[] = [
  { name: "Android Chrome", ua: ANDROID_CHROME_UA, android: true },
  { name: "Firefox Android", ua: FIREFOX_ANDROID_UA, android: true },
  { name: "desktop Chrome", ua: DESKTOP_UA, android: false },
];

for (const agent of AGENTS) {
  test.describe(`${agent.name} user agent`, () => {
    test.use({ userAgent: agent.ua });
    test.beforeEach(({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "phone", "link strings do not depend on the layout; run once, at phone size");
      void page;
    });

    for (const [shape, app] of Object.entries(SHAPES)) {
      test(`${shape}${app ? ` (${app.id})` : ""}: every action's href, target and rel`, async ({ page }) => {
        requireShape(Boolean(app), `entry of the shape "${shape}"`);
        if (!app) return;
        await openSheet(page, app);
        const expected = bySection(expectedActions(app, agent.android));
        const rendered = await renderedActions(page);
        expect(rendered.map((r) => [r.section, r.href, r.target])).toEqual(expected.map((e) => [e.section, e.href, e.target]));
        for (const [index, action] of rendered.entries()) {
          const want = expected[index];
          if (!want) continue;
          if (action.target === "_blank") expect((action.rel ?? "").split(/\s+/), `rel of ${action.href}`).toContain("noopener");
          expect(action.gone, `"gone" mark of ${action.href}`).toBe(want.gone);
          expect(action.href, "a link the device review ruled out").not.toMatch(FORBIDDEN_IN_LINKS);
          expect(action.href).not.toMatch(/apt\.izzysoft\.de\/packages\//);
        }
        const every = await sheet(page).locator("a[href]").evaluateAll((links) => links.map((link) => ({ href: link.getAttribute("href") ?? "", target: link.getAttribute("target"), rel: link.getAttribute("rel") ?? "" })));
        for (const link of every) {
          expect(link.href, "a link the device review ruled out").not.toMatch(FORBIDDEN_IN_LINKS);
          if (/^https?:/.test(link.href)) {
            expect(link.target, `${link.href} must open beside the app, never in its window`).toBe("_blank");
            expect(link.rel.split(/\s+/), `rel of ${link.href}`).toContain("noopener");
          }
        }
        const sameWindow = every.filter((link) => link.target !== "_blank" && !link.href.startsWith("#"));
        expect(sameWindow.every((link) => link.href.startsWith("intent://add/")), `links that navigate the window: ${sameWindow.map((link) => link.href).join(" ")}`).toBe(true);

        const primary = expectedPrimary(app, expectedActions(app, agent.android));
        if (primary) {
          const foot = sheet(page).getByRole("link", { name: new RegExp(`^${escapeRegExp(primary.primaryName)}( Gone)?$`) });
          await expect(foot).toHaveAttribute("href", primary.href);
          if (primary.gone) await expect(foot, "one word for a repository that is gone, on the button as on its link").toContainText("Gone");
          expect(await foot.locator(".btn-what").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "where the button leads is shown whole").toBe(true);
          if (primary.target) await expect(foot).toHaveAttribute("target", primary.target);
          else await expect(foot).not.toHaveAttribute("target", /.+/);
        } else {
          await expect(sheet(page).getByText("No working link")).toHaveCount(1);
        }
      });
    }

    test("the exact strings tapped on the device for Fossify Gallery", async ({ page }) => {
      const gallery = build.byId.get("org.fossify.gallery");
      requireShape(Boolean(gallery), "Fossify Gallery, the app whose links were tapped on the device");
      if (!gallery) return;
      await openSheet(page, gallery);
      const store = sheet(page).getByRole("region", { name: "Get it", exact: true });
      const fdroid = store.getByRole("link", { name: /^F-Droid org\.fossify\.gallery/ });
      const izzy = store.getByRole("link", { name: /^IzzyOnDroid org\.fossify\.gallery/ });
      await expect(fdroid).toHaveAttribute("href", "https://f-droid.org/packages/org.fossify.gallery/");
      await expect(fdroid).toHaveAttribute("target", "_blank");
      await expect(fdroid).toHaveAttribute("rel", /(^|\s)noopener(\s|$)/);
      await expect(izzy).toHaveAttribute("href", "https://apt.izzysoft.de/fdroid/index/apk/org.fossify.gallery");
      await expect(izzy).toHaveAttribute("target", "_blank");
      await expect(izzy).toHaveAttribute("rel", /(^|\s)noopener(\s|$)/);
      const add = store.getByRole("link", { name: /^Add to Obtainium/ });
      const source = gallery.github?.release?.hasApk ? "https://github.com/FossifyOrg/Gallery" : "https://f-droid.org/packages/org.fossify.gallery";
      if (!agent.android) {
        await expect(add, "nothing but Android answers an intent link").toHaveCount(0);
        await expect(store.getByText(/^Needs /)).toHaveCount(0);
        if (gallery.github?.release?.hasApk) await expect(store.getByRole("link", { name: /^GitHub releases/ })).toHaveAttribute("href", `${source}/releases`);
        return;
      }
      expect(await store.getByRole("listitem").last().getByRole("link", { name: /^Add to Obtainium/ }).count(), "Obtainium is the last way to get it").toBe(1);
      await expect(add).toHaveAttribute("href", `intent://add/${source}#Intent;scheme=obtainium;S.browser_fallback_url=${encodeURIComponent(source)};end`);
      await expect(add).not.toHaveAttribute("target", /.+/);
      const needs = store.getByText(/^Needs the Obtainium app\./);
      await expect(needs).toBeVisible();
      const get = needs.getByRole("link", { name: "Get Obtainium" });
      await expect(get).toHaveAttribute("href", OBTAINIUM_HOME);
      await expect(get).toHaveAttribute("target", "_blank");
      await expect(get).toHaveAttribute("rel", /(^|\s)noopener(\s|$)/);
    });

    test("the stores and Obtainium are called by their own names, and no fork is named anywhere in the sheet", async ({ page }) => {
      const app = SHAPES["F-Droid and IzzyOnDroid"];
      requireShape(Boolean(app), "app in both repositories");
      if (!app) return;
      await openSheet(page, app);
      const text = (await sheet(page).innerText()).replace(/\s+/g, " ");
      expect(text).toContain("F-Droid");
      expect(text).toContain("IzzyOnDroid");
      if (agent.android) expect(text).toContain("Add to Obtainium");
      else expect(text).not.toContain("Obtainium");
      expect(text).not.toMatch(/Droid-?ify|ObtainX|Neo ?Store/i);
    });
  });
}

test.describe("an app with no usable link (synthetic: the real catalog has none)", () => {
  test.use({ userAgent: ANDROID_CHROME_UA });

  test("renders no action, and says so once, where the button would be", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "run once");
    const target = featuredApp();
    const { createHash } = await import("node:crypto");
    const atlasFile = build.manifest.files.find((f) => f.role === "atlas");
    if (!atlasFile) throw new Error("no atlas part");
    const atlas = JSON.parse(JSON.stringify(build.atlas)) as typeof build.atlas;
    const entry = atlas.apps.find((a) => a.id === target.id);
    if (!entry) throw new Error("app missing from atlas");
    entry.channels = [];
    entry.repo = null;
    entry.website = null;
    const atlasBody = JSON.stringify(atlas);
    const manifest = JSON.parse(JSON.stringify(build.manifest)) as typeof build.manifest;
    const listed = manifest.files.find((f) => f.role === "atlas");
    if (listed) listed.sha256 = createHash("sha256").update(atlasBody).digest("hex");
    await page.route(`**/data/${build.version.manifest}`, (route) => route.fulfill({ json: manifest }));
    await page.route(`**/${atlasFile.path}`, (route) => route.fulfill({ body: atlasBody, contentType: "application/json" }));
    await openSheet(page, target);
    for (const section of SECTIONS) {
      await expect(sheet(page).getByRole("region", { name: section, exact: true })).toHaveCount(0);
    }
    await expect(sheet(page).getByText("No working link")).toHaveCount(1);
    await expect(sheet(page).getByText("No working link")).toBeVisible();
  });
});

test.describe("framed", () => {
  test.use({ userAgent: ANDROID_CHROME_UA });

  test("no action renders when the app is shown inside another page's frame", async ({ page, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "phone", "run once");
    const gallery = featuredApp();
    await page.setContent(`<!doctype html><iframe title="framed" src="${baseURL}${sheetHash(gallery)}" style="width:384px;height:688px;border:0"></iframe>`);
    const frame = page.frameLocator('iframe[title="framed"]');
    const dialog = frame.getByRole("dialog", { name: gallery.name });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText("Open Droid Atlas in its own tab to use links.")).toBeVisible();
    for (const section of SECTIONS) {
      await expect(dialog.getByRole("region", { name: section, exact: true })).toHaveCount(0);
    }
    await expect(dialog.getByText("No working link")).toBeVisible();
    const handoffs = await dialog.locator("a[href]").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? "").filter((href) => /^(intent|obtainium):/.test(href)));
    expect(handoffs).toEqual([]);
  });
});
