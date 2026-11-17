import { describe, expect, test } from "vitest";
import { app, listing } from "./catalog/fixtures.ts";
import type { App } from "./catalog/schema.ts";
import {
  LINK_FORMS,
  actionsFor,
  hostOf,
  isResource,
  isValidPackage,
  isValidSlug,
  platformOf,
  primaryAction,
  readableUrl,
  siteOf,
  resourceLink,
  safeWebUrl,
  shareUrl,
  type Platform,
} from "./links.ts";

const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";
const SAMSUNG_INTERNET = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/150.0.0.0 Mobile Safari/537.36";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 17; Mobile; rv:146.0) Gecko/146.0 Firefox/146.0";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15";

const PLATFORMS: Platform[] = ["android", "ios", "desktop"];
const ELSEWHERE: Platform[] = ["ios", "desktop"];

function obtainium(source: string): string {
  return `intent://add/${source}#Intent;scheme=obtainium;S.browser_fallback_url=${encodeURIComponent(source)};end`;
}

const gallery = app({
  repo: { host: "github", url: "https://github.com/FossifyOrg/Gallery", slug: "FossifyOrg/Gallery" },
  github: { stars: 1, pushedAt: "2026-10-01T00:00:00Z", archived: false, movedTo: null, forkOf: null, release: { tag: "1", publishedAt: "2026-10-01T00:00:00Z", hasApk: false } },
  channels: [
    { type: "fdroid", pkg: "org.fossify.gallery", variant: null, listed: true },
    { type: "izzy", pkg: "org.fossify.gallery", variant: null, listed: true },
  ],
});

function actions(subject: App, platform: Platform) {
  return actionsFor(subject, platform, false);
}

function find(subject: App, platform: Platform, id: string) {
  const action = actions(subject, platform).find((a) => a.id === id);
  if (!action) throw new Error(`no action ${id}`);
  return action;
}

describe("link forms", () => {
  test("tells Android, an iPhone or iPad, and a computer apart, from the browser's own statement where it gives one and the user agent otherwise", () => {
    const none = { platform: undefined, maxTouchPoints: 0 };
    expect(platformOf(CHROME_ANDROID, none)).toBe("android");
    expect(platformOf(SAMSUNG_INTERNET, none)).toBe("android");
    expect(platformOf(FIREFOX_ANDROID, none)).toBe("android");
    expect(platformOf(DESKTOP, none)).toBe("desktop");
    expect(platformOf(IPHONE, { platform: undefined, maxTouchPoints: 5 })).toBe("ios");
    expect(platformOf(IPAD_AS_MAC, { platform: undefined, maxTouchPoints: 5 })).toBe("ios");
    expect(platformOf(IPAD_AS_MAC, none), "a Macintosh without a touch screen is a computer").toBe("desktop");
    expect(platformOf(DESKTOP, { platform: "Android" })).toBe("android");
    expect(platformOf(CHROME_ANDROID, { platform: "Windows" }), "the browser's statement wins over its user agent").toBe("desktop");
    expect(platformOf(DESKTOP, { platform: "macOS" })).toBe("desktop");
  });

  test.each(PLATFORMS)("an F-Droid listing is the plain https address in a new tab (%s)", (platform) => {
    const [fdroid] = actions(gallery, platform);
    expect(fdroid).toMatchObject({ label: "F-Droid", href: "https://f-droid.org/packages/org.fossify.gallery/", target: "_blank" });
  });

  test.each(PLATFORMS)("an IzzyOnDroid listing is the plain https address in a new tab (%s)", (platform) => {
    const [, izzy] = actions(gallery, platform);
    expect(izzy).toMatchObject({ label: "IzzyOnDroid", href: "https://apt.izzysoft.de/fdroid/index/apk/org.fossify.gallery", target: "_blank" });
  });

  test("on Android, adding to Obtainium is an intent of the obtainium scheme with no package, the raw source and the project page as fallback, in the same window", () => {
    const add = find(app(), "android", "obtainium");
    expect(add.href).toBe(
      "intent://add/https://github.com/accrescent/accrescent#Intent;scheme=obtainium;S.browser_fallback_url=https%3A%2F%2Fgithub.com%2Faccrescent%2Faccrescent;end",
    );
    expect(add).toMatchObject({ label: "Add to Obtainium", target: null, copyText: "https://github.com/accrescent/accrescent" });
  });

  test("an F-Droid or IzzyOnDroid listing as the Obtainium source is given the same way", () => {
    expect(find(gallery, "android", "obtainium").href).toBe(
      "intent://add/https://f-droid.org/packages/org.fossify.gallery#Intent;scheme=obtainium;S.browser_fallback_url=https%3A%2F%2Ff-droid.org%2Fpackages%2Forg.fossify.gallery;end",
    );
    const izzyOnly = app({ github: null, channels: [{ type: "izzy", pkg: "com.nahnah.florid", variant: null, listed: true }] });
    expect(find(izzyOnly, "android", "obtainium").href).toBe(
      "intent://add/https://apt.izzysoft.de/fdroid/index/apk/com.nahnah.florid#Intent;scheme=obtainium;S.browser_fallback_url=https%3A%2F%2Fapt.izzysoft.de%2Ffdroid%2Findex%2Fapk%2Fcom.nahnah.florid;end",
    );
  });

  test("a Google Play listing is its web address", () => {
    const subject = app({ channels: [{ type: "play", pkg: "com.example.paid", variant: null, listed: null }] });
    const [play] = actions(subject, "android");
    expect(play).toMatchObject({ label: "Google Play", href: "https://play.google.com/store/apps/details?id=com.example.paid", target: "_blank", stale: false });
  });

  test("a GitHub repository is its plain address in a new tab, so the page never replaces the app", () => {
    expect(find(app(), "android", "source")).toMatchObject({ href: "https://github.com/accrescent/accrescent", target: "_blank" });
  });

  test.each(ELSEWHERE)("off Android there is no intent link: the row is the GitHub releases page in a new tab, and copies that address (%s)", (platform) => {
    const all = actions(app(), platform);
    expect(all.map((action) => action.href).filter((href) => href.startsWith("intent:"))).toEqual([]);
    expect(find(app(), platform, "releases")).toMatchObject({
      kind: "import", label: "GitHub releases", href: "https://github.com/accrescent/accrescent/releases", target: "_blank", copyText: "https://github.com/accrescent/accrescent/releases", needs: null,
    });
    expect(actions(gallery, platform).some((action) => action.kind === "import"), "a store listing as the source is already its own row").toBe(false);
  });

  test.each(PLATFORMS)("the Obtainium link is the only one that navigates the app's own window, and only on Android (%s)", (platform) => {
    const everything = app({
      channels: [{ type: "fdroid", pkg: "org.example.app", variant: null, listed: true }, { type: "play", pkg: "org.example.app", variant: null, listed: null }],
      website: "https://example.org/",
      listings: [listing({ extraLinks: [{ name: "Forum", url: "https://forum.example.org/" }] })],
    });
    const all = actions(everything, platform);
    expect(all.filter((action) => action.target !== "_blank").map((action) => action.id)).toEqual(platform === "android" ? ["obtainium"] : []);
    expect(all.length).toBeGreaterThanOrEqual(platform === "android" ? 6 : 5);
  });

  test("on Android the Obtainium link says what it needs and where to get it; no other link, and nothing elsewhere, needs anything", () => {
    for (const platform of PLATFORMS) {
      const all = actions(gallery, platform);
      expect(all.filter((action) => action.needs !== null).map((action) => action.id)).toEqual(platform === "android" ? ["obtainium"] : []);
    }
    expect(find(gallery, "android", "obtainium").needs).toEqual({ text: "Needs the Obtainium app.", label: "Get Obtainium", href: "https://github.com/ImranR98/Obtainium" });
  });

  test("no link, label or note names an Android app's package or a fork of a store", () => {
    const subjects = [
      gallery,
      app(),
      app({ channels: [{ type: "fdroid", pkg: "gone.app", variant: null, listed: false }] }),
      app({ channels: [{ type: "izzy", pkg: "org.example.app.beta", variant: "Beta", listed: true }], github: null }),
      app({ channels: [{ type: "play", pkg: "com.example.paid", variant: null, listed: null }], repo: null, github: null }),
    ];
    for (const subject of subjects) {
      for (const platform of PLATFORMS) {
        for (const action of actions(subject, platform)) {
          const said = [action.href, action.label, action.detail, action.note, action.copyText, action.webHref].join(" ");
          expect(said).not.toMatch(/package=|droid-?ify|obtainx|com\.looker|dev\.bikram|neo ?store|fdroid\.app|market:/i);
          expect(said).not.toMatch(/intent:\/\/(?!add\/)/);
          expect(said).not.toMatch(/(^|\s)obtainium:\/\//);
        }
      }
    }
  });

  test("every form is in the one table: a fixed https host, the Obtainium intent, or a web address passed through", () => {
    for (const form of Object.values(LINK_FORMS)) {
      expect(form.href("PART")).toMatch(/^(https:\/\/(f-droid\.org|apt\.izzysoft\.de|play\.google\.com|github\.com|gitlab\.com|codeberg\.org)\/.*PART\/?|intent:\/\/add\/PART#Intent;scheme=obtainium;S\.browser_fallback_url=PART;end|PART)$/);
    }
  });

  test("falls back to the F-Droid listing as the Obtainium source when GitHub ships no APK", () => {
    const add = find(gallery, "android", "obtainium");
    expect(add.href).toBe(obtainium("https://f-droid.org/packages/org.fossify.gallery"));
    expect(add.detail).toBe("via F-Droid");
  });

  test("offers no Obtainium action when no source is verified", () => {
    const bare = app({ github: { stars: 1, pushedAt: "2026-10-01T00:00:00Z", archived: false, movedTo: null, forkOf: null, release: null } });
    expect(actions(bare, "android").find((a) => a.id === "obtainium")).toBeUndefined();
  });

  test("follows a moved GitHub repository", () => {
    const moved = app({ github: { stars: 1, pushedAt: "2026-10-01T00:00:00Z", archived: false, movedTo: "new-owner/new-name", forkOf: null, release: { tag: "1", publishedAt: "2026-10-01T00:00:00Z", hasApk: true } } });
    expect(find(moved, "android", "obtainium").href).toBe(obtainium("https://github.com/new-owner/new-name"));
    expect(find(moved, "android", "source").href).toBe("https://github.com/new-owner/new-name");
  });

  test("a listing its repository no longer has is not offered at all", () => {
    const stale = app({ channels: [{ type: "fdroid", pkg: "gone.app", variant: null, listed: false }] });
    expect(actions(stale, "android").map((action) => action.id)).toEqual(["obtainium", "source"]);
    expect(primaryAction(stale, "android", false)?.id).toBe("obtainium");
    const live = app({ channels: [{ type: "fdroid", pkg: "gone.app", variant: null, listed: false }, { type: "izzy", pkg: "here.app", variant: null, listed: true }] });
    expect(actions(live, "android")[0]).toMatchObject({ id: "izzy:here.app", stale: false });
  });

  test("a link says nothing about what a tap does", () => {
    for (const platform of PLATFORMS) {
      for (const action of [...actions(gallery, platform), ...actions(app(), platform)]) expect(action.note, action.id).toBeNull();
    }
  });

  test("off Android the releases page stands where Obtainium would, after the stores and before the repository", () => {
    const githubOnly = app();
    expect(primaryAction(githubOnly, "android", false)?.id).toBe("obtainium");
    expect(primaryAction(githubOnly, "desktop", false)?.id).toBe("releases");
    expect(primaryAction(githubOnly, "ios", false)?.id).toBe("releases");
    expect(primaryAction(gallery, "desktop", false)?.label).toBe("F-Droid");
  });
});

describe("resources", () => {
  const guide = app({
    repo: null,
    github: null,
    website: "https://android.izzysoft.de/applists/perms",
    listings: [listing({ kind: "resource", name: "Android App Permissions", url: "https://android.izzysoft.de/applists/perms", extraLinks: [{ name: "Mirror", url: "https://example.org/perms/" }] })],
  });

  test("a resource's first action is the page it is a link to", () => {
    expect(isResource(guide)).toBe(true);
    expect(actions(guide, "android").map((a) => [a.id, a.kind, a.detail, a.href, a.target])).toEqual([
      ["link", "web", "android.izzysoft.de/applists/perms", "https://android.izzysoft.de/applists/perms", "_blank"],
      ["extra-0", "web", "example.org/perms", "https://example.org/perms/", "_blank"],
    ]);
    expect(primaryAction(guide, "android", false)?.id).toBe("link");
  });

  test("an app is never treated as a link, even when one of its listings is a resource", () => {
    const both = app({ listings: [listing(), listing({ kind: "resource" })] });
    expect(isResource(both)).toBe(false);
    expect(resourceLink(both)).toBeNull();
  });

  test("a resource whose address is not a web address offers no page", () => {
    const broken = app({ repo: null, github: null, listings: [listing({ kind: "resource", url: "javascript:alert(1)" })] });
    expect(resourceLink(broken)).toBeNull();
    expect(actions(broken, "android")).toEqual([]);
  });

  test("addresses are shown the way they are read", () => {
    expect(readableUrl("https://www.example.org/a/b/?x=1#y")).toBe("example.org/a/b");
    expect(readableUrl("https://en.wikipedia.org/wiki/List_of_free_and_open-source_Android_applications")).toBe("en.wikipedia.org/wiki/List_of_free_and_open-source_Android_applications");
    expect(readableUrl("https://f-droid.org/")).toBe("f-droid.org");
    expect(readableUrl("mailto:someone@example.org")).toBeNull();
    expect(hostOf("https://www.f-droid.org/packages/x/")).toBe("f-droid.org");
    expect(hostOf("intent://x#Intent;end")).toBeNull();
  });

  test("a link's site is its host, and for a forge the project, never a deeper path", () => {
    expect(siteOf("https://github.com/offa/android-foss/blob/master/doc/Install-Rooted-OTA.md")).toBe("github.com/offa/android-foss");
    expect(siteOf("https://www.github.com/MuntashirAkon/android-debloat-list")).toBe("github.com/MuntashirAkon/android-debloat-list");
    expect(siteOf("https://gitlab.com/group/project/-/wikis/home")).toBe("gitlab.com/group/project");
    expect(siteOf("https://codeberg.org/someone")).toBe("codeberg.org/someone");
    expect(siteOf("https://android.izzysoft.de/articles/named/android-permissions")).toBe("android.izzysoft.de");
    expect(siteOf("https://www.example.org/")).toBe("example.org");
    expect(siteOf("mailto:someone@example.org")).toBeNull();
  });
});

describe("what the schema adds", () => {
  test("a variant build is a separate store action labeled with its variant", () => {
    const subject = app({
      channels: [
        { type: "fdroid", pkg: "dev.patrickgold.florisboard", variant: null, listed: true },
        { type: "izzy", pkg: "dev.patrickgold.florisboard.beta", variant: "Beta", listed: true },
      ],
    });
    const stores = actions(subject, "desktop").filter((a) => a.kind === "store");
    expect(stores.map((a) => a.label)).toEqual(["F-Droid", "Beta · IzzyOnDroid"]);
    expect(stores.map((a) => a.detail)).toEqual(["dev.patrickgold.florisboard", "dev.patrickgold.florisboard.beta"]);
  });

  test("a variant is never the source Obtainium tracks", () => {
    const subject = app({
      github: null,
      channels: [{ type: "izzy", pkg: "org.example.app.beta", variant: "Beta", listed: true }],
    });
    expect(actions(subject, "android").find((a) => a.id === "obtainium")).toBeUndefined();
  });

  test("GitLab and Codeberg repositories are built from the slug and open in a new tab", () => {
    const gitlab = app({ repo: { host: "gitlab", url: "https://gitlab.com/x/y", slug: "fdroid/fdroidclient" }, github: null });
    expect(find(gitlab, "android", "source")).toMatchObject({ href: "https://gitlab.com/fdroid/fdroidclient", target: "_blank", label: "GitLab" });
    const codeberg = app({ repo: { host: "codeberg", url: "https://codeberg.org/x/y", slug: "owner/name" }, github: null });
    expect(find(codeberg, "android", "source").href).toBe("https://codeberg.org/owner/name");
  });

  test("another forge is linked by its own URL as an ordinary page", () => {
    const other = app({ repo: { host: "other", url: "https://git.server47.de/jens/Automation", slug: null }, github: null });
    expect(find(other, "android", "source")).toMatchObject({ href: "https://git.server47.de/jens/Automation", target: "_blank", label: "Source code" });
  });

  test("a missing repository is marked stale", () => {
    const missing = app({ repoMissing: true, github: null });
    expect(find(missing, "android", "source").stale).toBe(true);
    expect(primaryAction(missing, "android", false)?.id).toBe("source");
  });

  test("the project site and extra links are ordinary web links", () => {
    const subject = app({ repo: null, github: null, website: "https://f-droid.org", listings: [listing({ extraLinks: [{ name: "Forum", url: "https://forum.f-droid.org/" }] })] });
    expect(actions(subject, "android").map((a) => [a.id, a.kind, a.target, a.href])).toEqual([
      ["website", "web", "_blank", "https://f-droid.org/"],
      ["extra-0", "web", "_blank", "https://forum.f-droid.org/"],
    ]);
  });

  test("no actions are offered when the page is framed", () => {
    expect(actionsFor(gallery, "android", true)).toEqual([]);
    expect(primaryAction(gallery, "android", true)).toBeNull();
  });

  test("the share link is the share form of the route on the page's own origin and path", () => {
    expect(shareUrl("org.fossify.gallery", "https://atlas.example/sub/?x=1#/region/media?app=org.fossify.gallery")).toBe(
      "https://atlas.example/sub/#/app/org.fossify.gallery",
    );
    expect(shareUrl("a b/c", "http://127.0.0.1:4320/")).toBe("http://127.0.0.1:4320/#/app/a%20b%2Fc");
  });
});

describe("hostile input", () => {
  const HOSTILE_PACKAGES = [
    "org.example#Intent;scheme=http;package=evil.app;end",
    "org.example;S.browser_fallback_url=https://evil.example;end",
    "org.example/../../x",
    "org.example?x=1",
    "org.example app",
    "org.example\n.app",
    "org..example",
    ".org.example",
    "single",
    "org.9lives",
    "org.exämple.app",
    "",
  ];

  test.each(HOSTILE_PACKAGES)("package id %j is rejected and builds no action", (pkg) => {
    expect(isValidPackage(pkg)).toBe(false);
    const subject = app({
      repo: null,
      github: null,
      channels: [
        { type: "fdroid", pkg, variant: null, listed: true },
        { type: "izzy", pkg, variant: null, listed: true },
        { type: "play", pkg, variant: null, listed: null },
      ],
    });
    expect(actions(subject, "android")).toEqual([]);
  });

  const HOSTILE_SLUGS = [
    "owner/name#Intent;scheme=http;package=evil.app;end",
    "owner/name;end",
    "owner/name/extra",
    "owner",
    "owner/",
    "/name",
    "../name",
    "owner/..",
    "owner/na me",
    "owner/name?tab=x",
    "owner/name%2F..",
    "owner\\name",
  ];

  test.each(HOSTILE_SLUGS)("repository slug %j is rejected and builds no link", (slug) => {
    expect(isValidSlug(slug)).toBe(false);
    const subject = app({ repo: { host: "github", url: "javascript:alert(1)", slug } });
    expect(actions(subject, "android")).toEqual([]);
  });

  test.each(HOSTILE_SLUGS)("a hostile rename target %j is ignored in favor of the validated slug", (movedTo) => {
    const subject = app({ github: { stars: 1, pushedAt: "2026-10-01T00:00:00Z", archived: false, movedTo, forkOf: null, release: { tag: "1", publishedAt: "2026-10-01T00:00:00Z", hasApk: true } } });
    expect(find(subject, "android", "source").href).toBe("https://github.com/accrescent/accrescent");
    expect(find(subject, "android", "obtainium").href).toBe(obtainium("https://github.com/accrescent/accrescent"));
  });

  test("an unknown channel type or forge host builds nothing from a slug", () => {
    const subject = app({
      repo: { host: "sourcehut", url: "data:text/html,x", slug: "~owner/name" },
      github: null,
      channels: [{ type: "market" as "play", pkg: "org.example.app", variant: null, listed: true }],
    });
    expect(actions(subject, "android")).toEqual([]);
  });

  test.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "intent://evil#Intent;scheme=http;end",
    "obtainium://add/https://evil.example",
    "file:///etc/passwd",
    "//evil.example/x",
    "/relative/path",
    "not a url",
    "",
  ])("web link %j is dropped", (url) => {
    expect(safeWebUrl(url)).toBeNull();
    const subject = app({ repo: { host: "other", url, slug: null }, github: null, website: url, listings: [listing({ extraLinks: [{ name: "x", url }] })] });
    expect(actions(subject, "android")).toEqual([]);
  });

  test("every link built from a package id or a slug leads to one of the fixed hosts", () => {
    const subject = app({
      channels: [
        { type: "fdroid", pkg: "org.example.app", variant: "x#Intent;end", listed: true },
        { type: "izzy", pkg: "org.example.app", variant: null, listed: true },
        { type: "play", pkg: "org.example.app", variant: null, listed: null },
      ],
    });
    const built = actions(subject, "android");
    expect(built).toHaveLength(5);
    for (const action of built) {
      expect(action.href).toMatch(/^(https:\/\/(f-droid\.org\/packages\/|apt\.izzysoft\.de\/fdroid\/index\/apk\/|play\.google\.com\/store\/apps\/details\?id=|github\.com\/)[A-Za-z0-9._~\/-]+|intent:\/\/add\/https:\/\/github\.com\/[A-Za-z0-9._~\/-]+#Intent;scheme=obtainium;S\.browser_fallback_url=[A-Za-z0-9%._~-]+;end)$/);
    }
  });
});
