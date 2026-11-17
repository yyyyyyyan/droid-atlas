/**
 * Builds every external link the app renders. Nothing else constructs a URL
 * that leaves the app.
 *
 * The app names no Android app in a link. Android decides what opens each
 * one, from the apps the person has installed and the links they have set
 * those apps to open; someone who uses a fork of F-Droid or of Obtainium has
 * it answer for the original.
 *
 * - A store listing is the store's own web address, opened in a new tab. An
 *   F-Droid client that claims the address takes it; with none, the listing's
 *   web page opens beside the app. The listing is its own fallback.
 * - Every other web address opens in a new tab too, a repository included.
 *   An app that claims the host still takes the link, and when none does the
 *   page opens beside the app instead of replacing it, which in the
 *   installed app would cost a reload on the way back.
 * - Adding to Obtainium is an `intent:` URL of the `obtainium` scheme with no
 *   package and the project page as its browser fallback, in the same window.
 *   It behaves like the plain scheme when an app answers, and is the only
 *   form that does something when none does.
 * - An `https` address is never wrapped in an `intent:`.
 *
 * These forms were tapped on a phone from a Chrome tab, from the installed
 * app and from Firefox, and are the same for all three, so nothing here
 * depends on the browser. The one distinction left is Android or not: an
 * `intent:` URL means nothing elsewhere.
 *
 * Every URL form is in `LINK_FORMS`, and only there. Each is assembled from
 * validated parts: a package id, a forge host we name ourselves, an owner and
 * a repository name. None is built from a raw upstream URL. Ordinary web
 * links may come from upstream, and are kept only when they parse as `http:`
 * or `https:`.
 *
 * Each action is meant to be rendered as a real `<a href>` and followed by a
 * direct tap. docs/VERIFICATION.md records which forms were observed where.
 * Nothing here claims an install or an import succeeded.
 */

import type { App, Channel } from "./catalog/schema.ts";

/** Where the page runs, as far as links care: on Android, where an app can answer a link, or anywhere else. */
/** Where the app runs, as far as links and wording care: Android, where apps answer `intent:` links; an iPhone or iPad; anything else, taken for a computer. */
export type Platform = "android" | "ios" | "desktop";
export type ActionKind = "store" | "import" | "source" | "web";
/** "_blank" opens a new tab, as every web address does; null navigates the current window, which only the `intent:` link needs. */
export type LinkTarget = "_blank" | null;

export interface Action {
  id: string;
  kind: ActionKind;
  /** What it is. */
  label: string;
  /** Which package, repository or host it targets. */
  detail: string | null;
  href: string;
  target: LinkTarget;
  /** Plain https page for the same destination, or null. */
  webHref: string | null;
  /** Text worth offering through "copy link". */
  copyText: string | null;
  /** One sentence on what tapping does. */
  note: string | null;
  /** What the link needs before it can do anything, and where to get that; null when it needs nothing. */
  needs: { text: string; label: string; href: string } | null;
  /** The catalog points here but the destination is gone. */
  stale: boolean;
}

const PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SLUG_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/**
 * Every URL form the app produces for a destination outside itself, and how
 * each is opened. `href` receives parts that have already been validated.
 */
export const LINK_FORMS = {
  fdroid: { name: "F-Droid", href: (pkg: string): string => `https://f-droid.org/packages/${pkg}/`, target: "_blank" },
  izzy: { name: "IzzyOnDroid", href: (pkg: string): string => `https://apt.izzysoft.de/fdroid/index/apk/${pkg}`, target: "_blank" },
  play: { name: "Google Play", href: (pkg: string): string => `https://play.google.com/store/apps/details?id=${pkg}`, target: "_blank" },
  /**
   * `source` is the page Obtainium should track. It goes into the path raw,
   * because Obtainium reads everything after `add/` as the URL, and encoded
   * into the fallback, which is where the browser goes when no app answers.
   */
  obtainium: {
    name: "Obtainium",
    href: (source: string): string => `intent://add/${source}#Intent;scheme=obtainium;S.browser_fallback_url=${encodeURIComponent(source)};end`,
    target: null,
  },
  github: { name: "GitHub", href: (slug: string): string => `https://github.com/${slug}`, target: "_blank" },
  gitlab: { name: "GitLab", href: (slug: string): string => `https://gitlab.com/${slug}`, target: "_blank" },
  codeberg: { name: "Codeberg", href: (slug: string): string => `https://codeberg.org/${slug}`, target: "_blank" },
  /** An ordinary page: a project site, a guide, a forge we do not know by name. */
  web: { name: "Web page", href: (url: string): string => url, target: "_blank" },
} as const satisfies Record<string, { name: string; href(part: string): string; target: LinkTarget }>;

/** Obtainium's own page, for someone who does not have the app. */
export const OBTAINIUM_HOME = "https://github.com/ImranR98/Obtainium";

const STORE_TYPES = ["fdroid", "izzy", "play"] as const;
const FORGE_HOSTS = ["github", "gitlab", "codeberg"] as const;

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

interface PlatformHints {
  /** `navigator.userAgentData.platform`, where the browser gives it: "Android", "Windows", "macOS", "Linux", "Chrome OS". */
  platform?: string;
  /** `navigator.maxTouchPoints`. An iPad asks for desktop pages and calls itself a Macintosh; a Macintosh has no touch screen. */
  maxTouchPoints?: number;
}

function browserHints(): PlatformHints {
  const navigator = globalThis.navigator as (Navigator & { userAgentData?: { platform?: string } }) | undefined;
  return { platform: navigator?.userAgentData?.platform, maxTouchPoints: navigator?.maxTouchPoints };
}

/**
 * The one place the platform is decided; everything that depends on it reads
 * this. The browser's own statement (`userAgentData.platform`) where there is
 * one, the user agent otherwise.
 */
export function platformOf(userAgent: string = globalThis.navigator?.userAgent ?? "", hints: PlatformHints = browserHints()): Platform {
  if (hints.platform) {
    if (/^android$/i.test(hints.platform)) return "android";
    if (/^(ios|ipados)$/i.test(hints.platform)) return "ios";
    return "desktop";
  }
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && (hints.maxTouchPoints ?? 0) > 1)) return "ios";
  return "desktop";
}

/** True when the page is shown inside another page's frame, where links must not be offered. */
export function isFramed(): boolean {
  try {
    return globalThis.top !== globalThis.self;
  } catch {
    return true;
  }
}

export function isValidPackage(pkg: unknown): pkg is string {
  return typeof pkg === "string" && pkg.length <= 255 && PACKAGE_PATTERN.test(pkg);
}

/** `owner/name`, each segment from the unreserved URL characters and neither `.` nor `..`. */
export function isValidSlug(slug: unknown): slug is string {
  if (typeof slug !== "string" || slug.length > 200) return false;
  const parts = slug.split("/");
  return parts.length === 2 && parts.every((part) => SLUG_SEGMENT.test(part) && part !== "." && part !== "..");
}

/** Returns the URL when it is an absolute `http:` or `https:` URL, otherwise null. For ordinary web links only. */
export function safeWebUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The host a web address leads to, without a leading `www.`; null when the address is not a web address. */
export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Forges whose addresses name a project in their first two path segments. */
const FORGES = new Set(["github.com", "gitlab.com", "codeberg.org"]);

/**
 * The site a link leads to, in one short line: the host, and for a forge the
 * project too (`github.com/offa/android-foss`). Never a deeper path, so the
 * line is never cut inside one.
 */
export function siteOf(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (!FORGES.has(host)) return host;
  const project = new URL(url).pathname.split("/").filter(Boolean).slice(0, 2);
  return [host, ...project].join("/");
}

/** A web address as a person reads it: host and path, without the scheme, a leading `www.`, a trailing slash, or the query. */
export function readableUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    let path: string;
    try {
      path = decodeURIComponent(parsed.pathname);
    } catch {
      path = parsed.pathname;
    }
    return `${parsed.hostname.replace(/^www\./, "")}${path.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

function storeAction(channel: Channel): Action | null {
  if (!isValidPackage(channel.pkg) || !isOneOf(STORE_TYPES, channel.type)) return null;
  /* A listing its repository no longer has is not offered: an F-Droid client that takes the link can only say the app was not found. */
  if (channel.listed === false) return null;
  const form = LINK_FORMS[channel.type];
  const href = form.href(channel.pkg);
  return {
    id: `${channel.type}:${channel.pkg}`,
    kind: "store",
    label: channel.variant ? `${channel.variant} · ${form.name}` : form.name,
    detail: channel.pkg,
    href,
    target: form.target,
    webHref: href,
    copyText: href,
    note: null,
    needs: null,
    stale: false,
  };
}

/** The repository as it should be linked today: GitHub's own rename target when it reports one. */
function repoSlug(app: App): string | null {
  if (!app.repo) return null;
  if (app.repo.host === "github" && isValidSlug(app.github?.movedTo)) return app.github.movedTo;
  return isValidSlug(app.repo.slug) ? app.repo.slug : null;
}

/**
 * The source Obtainium should track: GitHub releases when the latest release
 * is known to carry an APK, otherwise a live F-Droid listing, otherwise a live
 * IzzyOnDroid listing. Returns null when none of those is verified.
 */
function importSource(app: App): { url: string; via: string } | null {
  const slug = repoSlug(app);
  if (app.repo?.host === "github" && slug && app.github?.release?.hasApk) {
    return { url: LINK_FORMS.github.href(slug), via: "GitHub releases" };
  }
  for (const type of ["fdroid", "izzy"] as const) {
    const channel = app.channels.find((c) => c.type === type && c.variant === null && c.listed === true && isValidPackage(c.pkg));
    if (channel) return { url: LINK_FORMS[type].href(channel.pkg).replace(/\/$/, ""), via: LINK_FORMS[type].name };
  }
  return null;
}

/**
 * On Android, an `intent:` link that opens Obtainium with the source filled
 * in, or the page Obtainium would track when it is not installed. Nothing
 * else answers an `intent:` link, so elsewhere the row is the page itself:
 * the releases on GitHub, where the APK is, named for what it is. A source
 * that is a store listing is already its own row there, and is not repeated.
 */
function importAction(app: App, platform: Platform): Action | null {
  const source = importSource(app);
  if (!source) return null;
  if (platform !== "android") {
    if (!source.url.startsWith("https://github.com/")) return null;
    const href = `${source.url}/releases`;
    return {
      id: "releases", kind: "import", label: "GitHub releases", detail: repoSlug(app) ?? hostOf(href) ?? href,
      href, target: "_blank", webHref: href, copyText: href, note: null, needs: null, stale: false,
    };
  }
  const form = LINK_FORMS.obtainium;
  return {
    id: "obtainium",
    kind: "import",
    label: `Add to ${form.name}`,
    detail: `via ${source.via}`,
    href: form.href(source.url),
    target: form.target,
    webHref: null,
    copyText: source.url,
    note: null,
    needs: { text: `Needs the ${form.name} app.`, label: `Get ${form.name}`, href: OBTAINIUM_HOME },
    stale: false,
  };
}

function sourceAction(app: App): Action | null {
  const repo = app.repo;
  if (!repo) return null;
  const slug = repoSlug(app);
  if (slug && isOneOf(FORGE_HOSTS, repo.host)) {
    const form = LINK_FORMS[repo.host];
    const href = form.href(slug);
    return {
      id: "source", kind: "source", label: form.name, detail: slug,
      href, target: form.target, webHref: href, copyText: href, note: null, needs: null, stale: app.repoMissing,
    };
  }
  const href = safeWebUrl(repo.url);
  if (!href) return null;
  return {
    id: "source", kind: "source", label: "Source code", detail: hostOf(href),
    href: LINK_FORMS.web.href(href), target: LINK_FORMS.web.target, webHref: href, copyText: href, note: null, needs: null, stale: app.repoMissing,
  };
}

function webAction(id: string, label: string, url: string): Action | null {
  const href = safeWebUrl(url);
  if (!href) return null;
  return {
    id, kind: "web", label, detail: readableUrl(href),
    href: LINK_FORMS.web.href(href), target: LINK_FORMS.web.target, webHref: href, copyText: href, note: null, needs: null, stale: false,
  };
}

/** True when every listing of the entry is a guide, a site or further reading: a link, not an installable app. */
export function isResource(app: App): boolean {
  return app.listings.length > 0 && app.listings.every((listing) => listing.kind === "resource");
}

/**
 * The page a resource entry is a link to: the address its catalog gives for
 * it. Null for an app, and for a resource whose address is not a web address.
 */
export function resourceLink(app: App): Action | null {
  if (!isResource(app)) return null;
  for (const listing of app.listings) {
    const action = webAction("link", "Open the page", listing.url);
    if (action) return action;
  }
  return null;
}

/**
 * Ordered list of external actions for one entry. For an app: store listings,
 * Obtainium, the source repository, then plain links. For a resource: the page
 * it is a link to, then whatever else its catalog attaches. Empty when the
 * page is framed, and for entries that carry nothing usable.
 */
export function actionsFor(app: App, platform: Platform = platformOf(), framed: boolean = isFramed()): Action[] {
  if (framed) return [];
  const actions: Action[] = [];
  const add = (action: Action | null): void => {
    if (action && !actions.some((other) => other.id === action.id || other.href === action.href)) actions.push(action);
  };
  add(resourceLink(app));
  for (const channel of app.channels) add(storeAction(channel));
  add(importAction(app, platform));
  add(sourceAction(app));
  if (app.website) add(webAction("website", "Project site", app.website));
  app.listings.flatMap((listing) => listing.extraLinks).forEach((link, index) => add(webAction(`extra-${index}`, link.name, link.url)));
  return actions;
}

/**
 * The single action a sheet's primary button should offer: a resource's own
 * page, else the first live store listing, else Obtainium where it can answer
 * (on Android) or the GitHub releases that stand for it elsewhere, else the
 * first live link that is an ordinary page.
 */
export function primaryAction(app: App, platform: Platform = platformOf(), framed: boolean = isFramed()): Action | null {
  const actions = actionsFor(app, platform, framed);
  return actions.find((a) => a.id === "link")
    ?? actions.find((a) => a.kind === "store" && !a.stale)
    ?? actions.find((a) => a.kind === "import" && (platform === "android" || a.id === "releases"))
    ?? actions.find((a) => !a.stale && a.kind !== "import")
    ?? actions.find((a) => !a.stale)
    ?? actions[0]
    ?? null;
}

/** Stable deep link to an app: the share form of the route, on whatever origin and path the app runs from. */
export function shareUrl(appId: string, pageUrl: string): string {
  const url = new URL(pageUrl);
  url.search = "";
  url.hash = `#/app/${encodeURIComponent(appId)}`;
  return url.toString();
}
