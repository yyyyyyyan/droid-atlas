/**
 * The outbound links an entry's sheet should carry, built from the forms that
 * were tapped on the device (docs/UX-REVIEW.md § 1) and nothing in the app:
 *
 * - An F-Droid listing is `https://f-droid.org/packages/<id>/` and an
 *   IzzyOnDroid listing `https://apt.izzysoft.de/fdroid/index/apk/<id>`, each
 *   a plain link in a new tab with `rel` containing `noopener`. The listing's
 *   web page is its own fallback.
 * - Adding to Obtainium is
 *   `intent://add/<raw source>#Intent;scheme=obtainium;S.browser_fallback_url=<encoded source>;end`,
 *   in the same window, with no package.
 * - No link names a package, wraps an `https` address in an `intent:`, or uses
 *   the plain `obtainium:`, `fdroid.app:` or `market:` schemes.
 * - A listing its repository no longer has is not offered at all.
 * - Every other web address, a repository included, opens in a new tab with
 *   `rel` containing `noopener`, so no page ever replaces the app's window.
 *   The Obtainium link is the only one that navigates the window itself.
 * - Beside the Obtainium link the sheet says the link needs the Obtainium app
 *   and links to where to get it.
 * - Only Android answers an `intent:` link. Anywhere else the Obtainium row is
 *   the GitHub releases page in a new tab when the source is GitHub, and is
 *   left out when the source is a store listing, which is already a row.
 *
 * The forms are the same in every Android browser, so the oracle asks only
 * whether the page runs on Android.
 */

import type { App } from "./catalog.ts";

export type Section = "Get it" | "Links" | "Where it leads";

export interface ExpectedAction {
  section: Section;
  href: string;
  target: "_blank" | null;
  /** True for a link to a repository that no longer exists. */
  gone: boolean;
  /** True for the link that hands the app to Obtainium, or off Android the releases page that stands for it: the last way to get it. */
  obtainium?: boolean;
  /** The name of the sheet's main button when this action is the primary one. */
  primaryName: string;
}

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** What no outbound link may contain: a package name, a wrapped https address, or a scheme the device review ruled out. */
export const FORBIDDEN_IN_LINKS = /package=|com\.looker|dev\.bikram|droid-?ify|obtainx|^obtainium:|^fdroid\.app:|^market:|^intent:\/\/(?!add\/)/i;

function validSlug(slug: string | null | undefined): slug is string {
  if (!slug) return false;
  const parts = slug.split("/");
  return parts.length === 2 && parts.every((part) => SEGMENT.test(part) && part !== "." && part !== "..");
}

function httpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function host(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

const STORE_NAMES = { fdroid: "F-Droid", izzy: "IzzyOnDroid", play: "Google Play" } as const;

export function storePage(type: "fdroid" | "izzy" | "play", pkg: string): string {
  if (type === "fdroid") return `https://f-droid.org/packages/${pkg}/`;
  if (type === "izzy") return `https://apt.izzysoft.de/fdroid/index/apk/${pkg}`;
  return `https://play.google.com/store/apps/details?id=${pkg}`;
}

/** Where the sheet sends someone who does not have Obtainium. */
export const OBTAINIUM_HOME = "https://github.com/ImranR98/Obtainium";

export function obtainiumLink(source: string): string {
  return `intent://add/${source}#Intent;scheme=obtainium;S.browser_fallback_url=${encodeURIComponent(source)};end`;
}

function githubSlug(app: App): string | null {
  if (app.atlas.repo?.host !== "github") return null;
  const moved = app.github?.movedTo;
  if (validSlug(moved)) return moved;
  return validSlug(app.atlas.repo.slug) ? app.atlas.repo.slug : null;
}

export function isResource(app: App): boolean {
  return app.listings.length > 0 && app.listings.every((listing) => listing.kind === "resource");
}

/** The source Obtainium would track: GitHub releases with an APK, else a live F-Droid listing, else a live IzzyOnDroid one. */
export function obtainiumSource(app: App): string | null {
  const slug = githubSlug(app);
  if (slug && app.github?.release?.hasApk) return `https://github.com/${slug}`;
  for (const type of ["fdroid", "izzy"] as const) {
    const channel = app.atlas.channels.find((c) => c.type === type && c.variant === null && c.listed === true && PACKAGE.test(c.pkg));
    if (channel) return storePage(type, channel.pkg).replace(/\/$/, "");
  }
  return null;
}

export function expectedActions(app: App, android = true): ExpectedAction[] {
  const out: ExpectedAction[] = [];
  const push = (action: ExpectedAction): void => {
    if (!out.some((other) => other.href === action.href)) out.push(action);
  };
  const resource = isResource(app);

  if (resource) {
    for (const listing of app.listings) {
      const href = httpUrl(listing.url);
      if (href) {
        push({ section: "Where it leads", href, target: "_blank", gone: false, primaryName: `Open ${host(href)}` });
        break;
      }
    }
  }

  for (const channel of app.atlas.channels) {
    if (!PACKAGE.test(channel.pkg) || channel.listed === false) continue;
    const label = STORE_NAMES[channel.type];
    push({ section: "Get it", href: storePage(channel.type, channel.pkg), target: "_blank", gone: false, primaryName: `View on ${label}` });
  }

  const source = obtainiumSource(app);
  if (source && android) push({ section: "Get it", href: obtainiumLink(source), target: null, gone: false, obtainium: true, primaryName: "Add to Obtainium" });
  if (source && !android && source.startsWith("https://github.com/")) {
    push({ section: "Get it", href: `${source}/releases`, target: "_blank", gone: false, obtainium: true, primaryName: "View GitHub releases" });
  }

  const links: Section = resource ? "Where it leads" : "Links";
  const repoActions: ExpectedAction[] = [];
  const repo = app.atlas.repo;
  if (repo) {
    const bases: Record<string, [string, string]> = { github: ["https://github.com", "GitHub"], gitlab: ["https://gitlab.com", "GitLab"], codeberg: ["https://codeberg.org", "Codeberg"] };
    const forge = bases[repo.host];
    const forgeSlug = repo.host === "github" ? githubSlug(app) : validSlug(repo.slug) ? repo.slug : null;
    if (forge && forgeSlug) {
      repoActions.push({ section: links, href: `${forge[0]}/${forgeSlug}`, target: "_blank", gone: app.atlas.repoMissing, primaryName: `Open on ${forge[1]}` });
    } else {
      const href = httpUrl(repo.url);
      if (href) repoActions.push({ section: links, href, target: "_blank", gone: app.atlas.repoMissing, primaryName: "Open source code" });
    }
  }

  if (!resource) for (const action of repoActions) push(action);
  const website = httpUrl(app.atlas.website);
  if (website) push({ section: links, href: website, target: "_blank", gone: false, primaryName: "Open project site" });
  for (const link of app.listings.flatMap((listing) => listing.extraLinks)) {
    const href = httpUrl(link.url);
    if (href) push({ section: links, href, target: "_blank", gone: false, primaryName: `Open ${link.name}` });
  }
  if (resource) for (const action of repoActions) push(action);
  return out;
}

/**
 * The sheet's main button: a resource's own page, else the first store
 * listing, else Obtainium on Android or the GitHub releases elsewhere, else the
 * first link to something that still exists, else the first link.
 */
export function expectedPrimary(app: App, actions: ExpectedAction[]): ExpectedAction | null {
  const own = isResource(app) ? actions[0] : undefined;
  return own
    ?? actions.find((a) => a.section === "Get it" && !a.obtainium)
    ?? actions.find((a) => a.obtainium)
    ?? actions.find((a) => !a.gone && !a.obtainium)
    ?? actions.find((a) => !a.gone)
    ?? actions[0]
    ?? null;
}
