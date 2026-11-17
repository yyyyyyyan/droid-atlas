/**
 * Recognizes the two kinds of link that carry identity: source repositories
 * on known forges, and store listings that name an Android package.
 */
import type { ChannelType, Repo } from "../schema/catalog.ts";
import { httpUrl, normalizeUrl } from "./lib/text.ts";

/** A repository as linked by a source, before any rename is followed. */
export interface RepoRef {
  host: Repo["host"];
  /** `owner/name` (GitLab: `group/subgroup/name`); null on unknown hosts. */
  slug: string | null;
  url: string;
  /** Lower-cased identity key, `host:slug` or `other:<host><path>`. */
  key: string;
}

/** The schema's package pattern: dot-separated segments, each starting with a letter. */
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
/** The schema's slug-segment pattern for the four named forges. */
const SLUG_SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;

export function isRepoSlug(value: string): boolean {
  const segments = value.split("/");
  return segments.length >= 2 && segments.every((segment) => SLUG_SEGMENT_RE.test(segment) && segment !== "." && segment !== "..");
}

export function isPackageId(value: string): boolean {
  return PACKAGE_RE.test(value) && value.length <= 255;
}

/** A path inside a repository that still identifies the repository itself rather than a document in it. */
function isRepoSubpath(rest: string[]): boolean {
  if (rest.length === 0) return true;
  const [kind, , ...path] = rest;
  if (kind === "releases" || kind === "tags" || kind === "wiki") return true;
  if (kind === "blob" || kind === "tree") {
    if (path.length === 0) return kind === "tree";
    return path.length === 1 && /^readme/i.test(path[0] ?? "");
  }
  return false;
}

/**
 * The repository a URL points to, or null when it points to something else
 * (a profile, a document inside a repository, a sub-directory of a monorepo).
 * `explicit` marks a link a source labels as source code, which is the only
 * case a repository on an unknown host is accepted.
 */
export function parseRepo(raw: string, explicit = false): RepoRef | null {
  const href = httpUrl(raw);
  if (!href) return null;
  const url = new URL(href);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  const named = (forge: Repo["host"], base: string, owner: string, name: string): RepoRef => {
    const cleanName = name.replace(/\.git$/i, "");
    const slug = `${owner}/${cleanName}`;
    return { host: forge, slug, url: `${base}/${slug}`, key: `${forge}:${slug.toLowerCase()}` };
  };
  const checked = (ref: RepoRef | null): RepoRef | null => (ref && ref.slug !== null && !isRepoSlug(ref.slug) ? null : ref);

  if (host === "github.com" || host === "codeberg.org") {
    const [owner, name, ...rest] = parts;
    if (!owner || !name || !isRepoSubpath(rest)) return null;
    const forge = host === "github.com" ? "github" : "codeberg";
    return checked(named(forge, `https://${host}`, owner, name));
  }
  if (host === "gitlab.com") {
    const dash = parts.indexOf("-");
    const legacy = parts.findIndex((part, i) => i >= 2 && ["tree", "blob", "releases", "tags", "wikis"].includes(part));
    const cut = dash !== -1 ? dash : legacy;
    const path = cut === -1 ? parts : parts.slice(0, cut);
    const rest = dash !== -1 ? parts.slice(dash + 1) : legacy !== -1 ? parts.slice(legacy) : [];
    if (path.length < 2 || !isRepoSubpath(rest)) return null;
    return checked(named("gitlab", "https://gitlab.com", path.slice(0, -1).join("/"), path.at(-1) ?? ""));
  }
  if (host === "git.sr.ht") {
    const [owner, name, ...rest] = parts;
    if (!owner?.startsWith("~") || !name || !isRepoSubpath(rest)) return null;
    return checked(named("sourcehut", "https://git.sr.ht", owner, name));
  }
  if (!explicit || parts.length < 2) return null;
  const path = parts.join("/").replace(/\.git$/i, "");
  const repoUrl = httpUrl(`https://${host}/${path}`);
  return repoUrl ? { host: "other", slug: null, url: repoUrl, key: `other:${normalizeUrl(repoUrl).replace(/^https:\/\//, "")}` } : null;
}

export interface StoreLink {
  type: ChannelType;
  pkg: string;
}

/** The package a store listing URL names (F-Droid, IzzyOnDroid, Google Play), or null. */
export function parseStoreLink(raw: string): StoreLink | null {
  const href = httpUrl(raw);
  if (!href) return null;
  const url = new URL(href);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let type: ChannelType | null = null;
  let pkg: string | undefined;
  if (host === "f-droid.org") {
    const index = parts.indexOf("packages");
    if (index !== -1 && index <= 1 && parts.length === index + 2) {
      type = "fdroid";
      pkg = parts[index + 1];
    }
  } else if (host === "apt.izzysoft.de") {
    if (parts[0] === "packages" && parts.length === 2) pkg = parts[1];
    if (parts[0] === "fdroid" && parts[1] === "index" && parts[2] === "apk" && parts.length === 4) pkg = parts[3];
    if (pkg) type = "izzy";
  } else if (host === "play.google.com" && url.pathname.replace(/\/+$/, "") === "/store/apps/details") {
    type = "play";
    pkg = url.searchParams.get("id") ?? undefined;
  }
  if (!type || !pkg || !isPackageId(pkg)) return null;
  return { type, pkg };
}

/** Known suffixes that mark another build of the same app (`org.app.fdroid` beside `org.app`). */
const VARIANT_SUFFIXES: Record<string, string> = {
  fdroid: "F-Droid build",
  foss: "FOSS build",
  floss: "FOSS build",
  libre: "Libre build",
  oss: "FOSS build",
  free: "Free build",
  play: "Play Store build",
  playstore: "Play Store build",
  gplay: "Play Store build",
  reproducible: "Reproducible build",
  stable: "Stable",
  beta: "Beta",
  alpha: "Alpha",
  nightly: "Nightly",
  preview: "Preview",
  canary: "Canary",
  edge: "Edge",
};

/** The bare id and label when the package ends in a known variant suffix, else null. */
export function variantOf(pkg: string): { base: string; label: string } | null {
  const cut = pkg.lastIndexOf(".");
  const suffix = pkg.slice(cut + 1).toLowerCase();
  const base = pkg.slice(0, cut);
  const label = VARIANT_SUFFIXES[suffix];
  return label && base.includes(".") ? { base, label } : null;
}

/** Hosts whose pages and icons belong to the host, not to an app they mention. */
export const SHARED_SITES = [
  "github.com",
  "gitlab.com",
  "codeberg.org",
  "sourceforge.net",
  "f-droid.org",
  "apt.izzysoft.de",
  "izzyondroid.org",
  "play.google.com",
  "apps.apple.com",
  "galaxystore.samsung.com",
  "xdaforums.com",
  "xda-developers.com",
  "reddit.com",
  "t.me",
  "telegram.me",
  "discord.gg",
  "discord.com",
  "youtube.com",
  "youtu.be",
  "medium.com",
  "sites.google.com",
  "docs.google.com",
  "drive.google.com",
  "apkmirror.com",
  "apkpure.com",
  "appteka.store",
  "uptodown.com",
  "patreon.com",
  "ko-fi.com",
  "buymeacoffee.com",
  "gumroad.com",
  "linktr.ee",
  "wikipedia.org",
  "archive.org",
  "notion.site",
  "gitbook.io",
  "blogspot.com",
  "wordpress.com",
  "tumblr.com",
  "twitter.com",
  "x.com",
  "mastodon.social",
];

/** Host names that are, by their first label, a forge instance serving many projects. */
const FORGE_HOST_RE = /^(git|gitlab|gitea|forgejo|code|codeberg|src|source|hg|svn|repo|repos)\./i;

/** True when the host's icon would be the host's, not the project's. */
export function sharedSite(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (/\.github\.io$|\.gitlab\.io$|\.codeberg\.page$/.test(host)) return false;
  return FORGE_HOST_RE.test(host) || SHARED_SITES.some((shared) => host === shared || host.endsWith(`.${shared}`));
}
