/**
 * Reading icon candidates out of repository trees, Android manifests,
 * READMEs, web pages, web app manifests and store listings.
 *
 * Pure functions over untrusted text: nothing here fetches, and every URL
 * they return has passed `fetchableUrl`. Paths from a repository tree are
 * used only after `safeRepoPath`.
 */

/** A file in a repository tree, with the git blob id the host reports for it. */
export interface TreeEntry {
  path: string;
  /** Git blob SHA-1, which the downloaded bytes are checked against. */
  sha: string;
}

const PRIVATE_HOST_RE = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.arpa)$/i;

/**
 * The URL when it may be fetched: https, a DNS name (no IP literal, no
 * single-label or local name), the default port, no credentials. Anything
 * else is refused, so a README or a web page cannot point the build at the
 * runner's own network.
 */
export function fetchableUrl(raw: string, base?: string): URL | null {
  let url: URL;
  try {
    url = base === undefined ? new URL(raw) : new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || PRIVATE_HOST_RE.test(host)) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return null;
  url.hash = "";
  return url;
}

/**
 * True for an address a fetch must never reach: unspecified, loopback,
 * private (RFC 1918, IPv6 unique local), link-local, carrier-grade NAT,
 * benchmarking, multicast and reserved ranges, IPv4-mapped forms included.
 * Anything that does not parse as an address counts as private.
 */
export function privateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)?.[1] ?? /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip)?.slice(1).map((h) => parseInt(h, 16)).flatMap((n) => [n >> 8, n & 255]).join(".");
  const v4 = mapped ?? (/^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null);
  if (v4 !== null) {
    const parts = v4.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
    const [a = 0, b = 0] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (!/^[0-9a-f:]+$/.test(ip) || !ip.includes(":")) return true;
  if (ip === "::" || ip === "::1") return true;
  const first = parseInt(ip.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || ip.startsWith("::") || (first === 0x2001 && parseInt(ip.split(":")[1] || "0", 16) === 0x0db8);
}

/** A repository path made only of ordinary segments: no `..`, no empty or dot segments, no control characters. */
export function safeRepoPath(path: string): boolean {
  if (!path || path.length > 400 || path.startsWith("/")) return false;
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** Percent-encodes each segment of a repository path for use in a raw-content URL. */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

const IMAGE_EXT = "(png|jpe?g|webp)";
const PREFERRED_LOCALES = ["en-US", "en-GB", "en", "en-AU", "en-CA"];

function localeRank(locale: string): number {
  const index = PREFERRED_LOCALES.indexOf(locale);
  return index === -1 ? PREFERRED_LOCALES.length : index;
}

function byDepthThenPath(a: string, b: string): number {
  return a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0);
}

/** `fastlane/metadata/android/<locale>/images/icon.png`, English locales first, the shallowest copy first. */
export function fastlaneIcons(entries: readonly TreeEntry[]): TreeEntry[] {
  const re = new RegExp(`(^|/)fastlane/metadata/android/([A-Za-z0-9_-]+)/images/icon\\.${IMAGE_EXT}$`, "i");
  return localized(entries, re, 2);
}

/** `metadata/<locale>/images/icon.png` outside a fastlane directory (F-Droid's in-repository metadata). */
export function metadataIcons(entries: readonly TreeEntry[]): TreeEntry[] {
  const re = new RegExp(`(^|/)metadata/([A-Za-z0-9_-]+)/images/icon\\.${IMAGE_EXT}$`, "i");
  return localized(
    entries.filter((e) => !/(^|\/)fastlane\//i.test(e.path)),
    re,
    2,
  );
}

function localized(entries: readonly TreeEntry[], re: RegExp, group: number): TreeEntry[] {
  return entries
    .filter((e) => safeRepoPath(e.path))
    .map((e) => ({ e, locale: re.exec(e.path)?.[group] }))
    .filter((x): x is { e: TreeEntry; locale: string } => typeof x.locale === "string")
    .sort((a, b) => localeRank(a.locale) - localeRank(b.locale) || byDepthThenPath(a.e.path, b.e.path))
    .map((x) => x.e);
}

/** Manifests of Android modules' source sets, `main` and the shallowest first; test, debug and sample code excluded. */
export function manifestPaths(entries: readonly TreeEntry[], limit = 8): string[] {
  return entries
    .map((e) => e.path)
    .filter((p) => safeRepoPath(p) && /(^|\/)src\/[A-Za-z0-9_]+\/AndroidManifest\.xml$/.test(p))
    .filter((p) => !/(^|\/)src\/(test|androidTest|debug|benchmark)[A-Za-z0-9_]*\//i.test(p))
    .filter((p) => !/(^|\/)(test|tests|androidTest|sample|samples|example|examples|demo|benchmark|lint)[^/]*\//i.test(p))
    .sort((a, b) => Number(!/\/src\/main\//.test(a)) - Number(!/\/src\/main\//.test(b)) || byDepthThenPath(a, b))
    .slice(0, limit);
}

/** What an `AndroidManifest.xml` says about the app's icon and whether its module is the launchable app. */
export interface ManifestIcon {
  /** The module directory the manifest belongs to ("" for the repository root). */
  module: string;
  launcher: boolean;
  /** The `<application android:icon>` resource, when it names one directly. */
  resource: { type: "mipmap" | "drawable"; name: string } | null;
}

export function readManifest(path: string, text: string): ManifestIcon {
  const module = path.replace(/\/?src\/[A-Za-z0-9_]+\/AndroidManifest\.xml$/, "");
  const application = /<application\b[^>]*>/is.exec(text)?.[0] ?? "";
  const icon = /\bandroid:icon\s*=\s*"@(mipmap|drawable)\/([A-Za-z0-9_]{1,80})"/.exec(application);
  return {
    module,
    launcher: /android\.intent\.category\.LAUNCHER/.test(text),
    resource: icon?.[1] && icon[2] ? { type: icon[1] as "mipmap" | "drawable", name: icon[2] } : null,
  };
}

/** One entry per module: launchable if any of its manifests launches, the icon of its first manifest that names one. */
export function modulesOf(manifests: readonly ManifestIcon[]): ManifestIcon[] {
  const byModule = new Map<string, ManifestIcon>();
  for (const m of manifests) {
    const known = byModule.get(m.module);
    byModule.set(m.module, known ? { module: m.module, launcher: known.launcher || m.launcher, resource: known.resource ?? m.resource } : m);
  }
  return [...byModule.values()].sort((a, b) => Number(b.launcher) - Number(a.launcher) || Number(b.resource !== null) - Number(a.resource !== null) || byDepthThenPath(a.module || ".", b.module || "."));
}

/** Density rank of a resource directory's qualifiers; `nodpi` holds full-size art, and a directory without a density qualifier ranks below every density. */
const DENSITY: Record<string, number> = { nodpi: 6, xxxhdpi: 6, xxhdpi: 5, xhdpi: 4, hdpi: 3, mdpi: 2, ldpi: 1 };
const UNQUALIFIED_DENSITY = 0.5;

/**
 * Launcher icon files for one module, best first: the 512 px Play Store
 * icon Android Studio writes beside the sources, then the resource's bitmaps
 * by density, the `main` source set before flavors, a round variant only when
 * nothing else exists. Vector-only resources yield nothing.
 */
export function launcherIcons(entries: readonly TreeEntry[], module: string, resource: { name: string } | null): TreeEntry[] {
  const names = [...new Set([resource?.name, "ic_launcher"].filter((n): n is string => typeof n === "string" && /^[A-Za-z0-9_]{1,80}$/.test(n)))];
  const prefix = escapeRe(module ? `${module}/` : "");
  const highRes = new RegExp(`^${prefix}src/main/([A-Za-z0-9_]+-playstore|ic_launcher-web)\\.(png|webp)$|^${prefix}src/main/res/[A-Za-z0-9_-]+/playstore[-_]icon\\.png$`);
  const bitmap = new RegExp(`^${prefix}src/([A-Za-z0-9_]+)/res/(mipmap|drawable)(?:-([A-Za-z0-9-]+))?/(${names.join("|")})(_round)?\\.(png|webp)$`);
  const scored: { entry: TreeEntry; score: number }[] = [];
  for (const entry of entries) {
    if (!safeRepoPath(entry.path)) continue;
    if (highRes.test(entry.path)) {
      scored.push({ entry, score: 1_000 });
      continue;
    }
    const match = bitmap.exec(entry.path);
    if (!match) continue;
    const [, sourceSet, , qualifiers = "", name, round] = match;
    const density = qualifiers === "" ? UNQUALIFIED_DENSITY : qualifiers.split("-").map((q) => DENSITY[q] ?? 0).reduce((a, b) => Math.max(a, b), 0);
    if (!density || /(^|-)(night|television|watch|car)(-|$)/.test(qualifiers)) continue;
    scored.push({ entry, score: (sourceSet === "main" ? 100 : 0) + (name === names[0] ? 60 : 0) + (round ? 0 : 50) + density * 5 });
  }
  return scored.sort((a, b) => b.score - a.score || (a.entry.path < b.entry.path ? -1 : 1)).map((x) => x.entry);
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** README files at the repository root, Markdown first. */
export function readmePath(entries: readonly TreeEntry[]): string | null {
  const roots = entries.map((e) => e.path).filter((p) => !p.includes("/") && /^readme(\.(md|markdown))?$/i.test(p));
  return roots.sort((a, b) => Number(!/\.md$/i.test(a)) - Number(!/\.md$/i.test(b)))[0] ?? null;
}

/** An image a README shows. */
export interface ReadmeImage {
  src: string;
  alt: string;
}

/** Images in Markdown (`![alt](src)`) and inline HTML (`<img src alt>`), in document order. */
export function readmeImages(text: string): ReadmeImage[] {
  const found: { at: number; image: ReadmeImage }[] = [];
  for (const m of text.matchAll(/!\[([^\]]{0,200})\]\(\s*<?([^)\s>]{1,2000})>?(?:\s+"[^"]*")?\s*\)/g)) {
    found.push({ at: m.index ?? 0, image: { alt: m[1] ?? "", src: m[2] ?? "" } });
  }
  for (const m of text.matchAll(/<img\b[^>]{0,2000}>/gi)) {
    const tag = m[0];
    const src = attribute(tag, "src");
    if (src) found.push({ at: m.index ?? 0, image: { src, alt: attribute(tag, "alt") ?? "" } });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.image);
}

/** Hosts that serve badges, buttons and charts, never a project's logo. */
export const BADGE_HOSTS = [
  "img.shields.io",
  "shields.io",
  "badgen.net",
  "badge.fury.io",
  "badges.gitter.im",
  "api.travis-ci.com",
  "travis-ci.org",
  "codecov.io",
  "ci.appveyor.com",
  "hosted.weblate.org",
  "img.buymeacoffee.com",
  "ko-fi.com",
  "liberapay.com",
  "www.paypalobjects.com",
  "api.star-history.com",
  "starchart.cc",
  "repobeats.axiom.co",
  "github-readme-stats.vercel.app",
  "contrib.rocks",
  "fdroid.gitlab.io",
  "play.google.com",
  "gitlab.com/IzzyOnDroid",
];

const NOT_A_LOGO = /badge|shield|button|get[-_ ]?it|download|screenshot|screen[-_]?shot|banner|preview|demo|header|cover|social|sponsor|donat|paypal|kofi|ko-fi|liberapay|patreon|coffee|discord|telegram|matrix|license|fdroid|f-droid|izzy|google[-_ ]?play|play[-_ ]?store|obtainium|github|gitlab|codeberg|workflow|build|status|release|star|chart|feature[-_ ]?graphic|promo/i;

/** True for a host that serves badges. */
export function isBadgeHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return BADGE_HOSTS.some((badge) => {
    const [badgeHost, ...path] = badge.split("/");
    return (host === badgeHost || host.endsWith(`.${badgeHost}`)) && (!path.length || url.pathname.startsWith(`/${path.join("/")}`));
  }) || /\/(workflows|actions)\/.*badge|\/badge(\.svg)?$/i.test(url.pathname);
}

/**
 * The README image that marks itself as the project's logo or icon: its file
 * name or alt text says "logo" or "icon", and nothing about it says badge,
 * screenshot, banner, store button or another project. The first such image
 * in the document wins.
 */
export function readmeLogo(images: readonly ReadmeImage[], resolve: (src: string) => URL | null): URL | null {
  for (const image of images) {
    const url = resolve(image.src.trim());
    if (!url || isBadgeHost(url)) continue;
    const file = decodeURIComponentSafe(url.pathname.split("/").pop() ?? "");
    const marked = /logo|icon/i.test(file) || /logo|icon/i.test(image.alt);
    if (!marked) continue;
    if (NOT_A_LOGO.test(file) || NOT_A_LOGO.test(image.alt.replace(/\blogo\b|\bicon\b/gi, ""))) continue;
    return url;
  }
  return null;
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The value of one attribute of an HTML start tag, entity-decoded for the few entities URLs use. */
export function attribute(tag: string, name: string): string | null {
  const re = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = re.exec(tag);
  const value = m?.[1] ?? m?.[2] ?? m?.[3];
  return value === undefined ? null : value.replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/").replace(/&quot;/g, '"').trim();
}

/** What a web page declares as its icons. */
export interface PageIcons {
  manifest: URL | null;
  /** `apple-touch-icon` links and `rel=icon` links whose declared size is at least `minPx`, largest first. */
  icons: URL[];
}

function declaredSize(sizes: string | null): number {
  if (!sizes) return 0;
  if (/\bany\b/i.test(sizes)) return 10_000;
  return Math.max(0, ...[...sizes.matchAll(/(\d{1,5})x(\d{1,5})/gi)].map((m) => Math.min(Number(m[1]), Number(m[2]))));
}

/** Reads `<link rel=…>` icon declarations from the page's head. */
export function pageIcons(html: string, pageUrl: string, minPx: number): PageIcons {
  const head = html.slice(0, Math.max(0, html.search(/<\/head>/i)) || 200_000);
  let manifest: URL | null = null;
  const icons: { url: URL; size: number }[] = [];
  for (const m of head.matchAll(/<link\b[^>]{0,2000}>/gi)) {
    const tag = m[0];
    const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attribute(tag, "href");
    if (!href) continue;
    const url = fetchableUrl(href, pageUrl);
    if (!url) continue;
    if (rel.includes("manifest")) manifest ??= url;
    else if (rel.includes("apple-touch-icon") || rel.includes("apple-touch-icon-precomposed")) icons.push({ url, size: declaredSize(attribute(tag, "sizes")) || 180 });
    else if (rel.includes("icon")) {
      const size = declaredSize(attribute(tag, "sizes"));
      if (/\.svg(\?|$)/i.test(url.pathname) && (attribute(tag, "type") ?? "image/svg+xml").includes("svg")) icons.push({ url, size: size || 1_000 });
      else if (size >= minPx) icons.push({ url, size });
      else if (!size && /\.(png|webp|jpe?g)(\?|$)/i.test(url.pathname)) icons.push({ url, size: UNDECLARED });
    }
  }
  return { manifest, icons: icons.filter((i) => i.size >= minPx || i.size === UNDECLARED).sort((a, b) => b.size - a.size).map((i) => i.url) };
}

/** Rank of a raster `rel=icon` that declares no size: after every declared one, and kept, since the image gate measures it. */
const UNDECLARED = -1;

/** Icons a web app manifest lists at `minPx` or more, `any` purpose before `maskable`, largest first. */
export function manifestIcons(json: unknown, manifestUrl: string, minPx: number): URL[] {
  const icons = json && typeof json === "object" && Array.isArray((json as { icons?: unknown }).icons) ? (json as { icons: unknown[] }).icons : [];
  const found: { url: URL; size: number; maskable: boolean }[] = [];
  for (const icon of icons.slice(0, 50)) {
    if (!icon || typeof icon !== "object") continue;
    const { src, sizes, purpose } = icon as { src?: unknown; sizes?: unknown; purpose?: unknown };
    if (typeof src !== "string") continue;
    const url = fetchableUrl(src, manifestUrl);
    const size = declaredSize(typeof sizes === "string" ? sizes : null);
    const purposes = typeof purpose === "string" ? purpose.toLowerCase().split(/\s+/) : ["any"];
    if (url && size >= minPx && (purposes.includes("any") || purposes.includes("maskable"))) found.push({ url, size, maskable: !purposes.includes("any") });
  }
  return found.sort((a, b) => Number(a.maskable) - Number(b.maskable) || b.size - a.size).map((f) => f.url);
}

const PLAY_IMAGE_HOST = "play-lh.googleusercontent.com";

/** The app icon of a Google Play listing page, asked for at 512 px, or null when the page names none. */
export function playIcon(html: string): URL | null {
  const tags = [...html.matchAll(/<img\b[^>]{0,3000}>/gi)].map((m) => m[0]).filter((tag) => /\balt\s*=\s*"Icon image"/i.test(tag));
  const meta = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html)?.[1];
  for (const raw of [...tags.map((tag) => attribute(tag, "src")), meta]) {
    if (!raw) continue;
    const url = fetchableUrl(raw);
    if (!url || url.hostname !== PLAY_IMAGE_HOST) continue;
    const id = url.pathname.split("=")[0];
    if (!id || !/^\/[A-Za-z0-9_/-]{20,400}$/.test(id)) continue;
    return new URL(`https://${PLAY_IMAGE_HOST}${id}=s512`);
  }
  return null;
}

/** Lower-cased letters and digits only, for comparing an organization's name with an app's. */
export function nameKey(text: string): string {
  return text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}
