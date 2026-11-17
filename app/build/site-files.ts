/**
 * The files the build writes beside the bundle, as pure functions of their
 * inputs: the web app manifest, the `_headers` file, and the list of shell
 * files the service worker stores. `shell.ts` is the Vite side that calls
 * them; nothing here touches the file system or Vite.
 */

import { createHash } from "node:crypto";
import { PRODUCT_APP_ID, PRODUCT_DESCRIPTION, PRODUCT_NAME, PRODUCT_REPOSITORY, PRODUCT_SHORT_NAME, THEME_COLORS } from "../src/product.ts";

/** The one policy, used for the page's `<meta>` tag and, with `frame-ancestors`, for the real header. */
export const CONTENT_SECURITY_POLICY = "default-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

export const MANIFEST_FILE = "manifest.webmanifest";
export const WORKER_FILE = "sw.js";
export const HEADERS_FILE = "_headers";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: "image/png";
  purpose: "any" | "maskable" | "monochrome";
}

export const MANIFEST_ICONS: ManifestIcon[] = [
  { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
  { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  { src: "icons/monochrome-192.png", sizes: "192x192", type: "image/png", purpose: "monochrome" },
  { src: "icons/monochrome-512.png", sizes: "512x512", type: "image/png", purpose: "monochrome" },
];

/**
 * The web app manifest. `start_url` and `scope` are relative to the manifest,
 * so the site installs from whatever path it is served at. `id` is fixed and
 * independent of both: it is what makes a later install the same app, so it
 * must never change once the site has users.
 *
 * A manifest carries one theme color and one background color. They are the
 * dark theme's, the app's default; the page's own `theme-color` follows the
 * theme in use once it is running.
 */
export function webManifest(): Record<string, unknown> {
  return {
    id: PRODUCT_APP_ID,
    name: PRODUCT_NAME,
    short_name: PRODUCT_SHORT_NAME,
    description: PRODUCT_DESCRIPTION,
    lang: "en",
    dir: "ltr",
    start_url: "./",
    scope: "./",
    display: "standalone",
    background_color: THEME_COLORS.dark,
    theme_color: THEME_COLORS.dark,
    categories: ["utilities", "productivity"],
    icons: MANIFEST_ICONS,
    shortcuts: [
      { name: "Search", url: "./#/search" },
      { name: "Saved", url: "./#/saved" },
    ],
    /* The app names itself, so a tab can ask whether it is installed already (getInstalledRelatedApps). */
    related_applications: [{ platform: "webapp", url: `./${MANIFEST_FILE}` }],
  };
}

const YEAR = 31_536_000;

/**
 * Response headers for hosts that read a `_headers` file (Cloudflare Workers,
 * Netlify). Paths are from the root of the origin, which is where the site
 * lives: it is published on an origin of its own. Files whose names contain
 * a hash of their content never change and are cached for good; the files
 * that say which of those are current are always revalidated.
 */
export function headersFile(policy: string = CONTENT_SECURITY_POLICY): string {
  const immutable = `  Cache-Control: public, max-age=${YEAR}, immutable`;
  const revalidate = "  Cache-Control: no-cache";
  const rules: [string, string[]][] = [
    ["/*", [
      `  Content-Security-Policy: ${policy}; frame-ancestors 'none'`,
      "  X-Content-Type-Options: nosniff",
      "  Referrer-Policy: no-referrer",
    ]],
    ["/assets/*", [immutable]],
    ["/data/c/*", [immutable]],
    ["/data/icons/*", [immutable]],
    ["/data/upstream/*", [immutable]],
    ["/", [revalidate]],
    ["/index.html", [revalidate]],
    ["/data/version.json", [revalidate]],
    [`/${WORKER_FILE}`, [revalidate]],
    [`/${MANIFEST_FILE}`, [revalidate]],
  ];
  return `${rules.map(([path, lines]) => [path, ...lines].join("\n")).join("\n\n")}\n`;
}

/** Whether a built or public file belongs to the shell the service worker stores. Catalog data, source maps and the files hosts read for themselves do not. */
export function isShellFile(path: string): boolean {
  if (path === WORKER_FILE || path === HEADERS_FILE || path.endsWith(".map")) return false;
  if (path.startsWith("data/") || path.startsWith(".")) return false;
  return true;
}

/** A short identifier that changes whenever any shell file's name or content does. */
export function shellVersion(files: readonly { path: string; content: string | Uint8Array }[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(createHash("sha256").update(file.content).digest());
  }
  return hash.digest("hex").slice(0, 16);
}

/** The environment variable that marks a build as one meant for publication. */
export const RELEASE_FLAG = "DROID_ATLAS_RELEASE";

/**
 * What still stands between a build and publication, as sentences. An
 * ordinary build ignores them; a build made with the release flag fails on
 * them. Corrections and removal requests go to the repository's issues, so
 * the repository's address is what a published build cannot do without.
 */
export function releaseBlockers(repository: string = PRODUCT_REPOSITORY): string[] {
  let host: string | null = null;
  try {
    const url = new URL(repository);
    host = url.protocol === "https:" ? url.hostname : null;
  } catch {
    host = null;
  }
  const placeholder = host === null || /\.(invalid|example|test)$/.test(host);
  return placeholder ? ["PRODUCT_REPOSITORY in src/product.ts is not the address of a real repository: About has nowhere to send corrections and removal requests."] : [];
}

/** Fills the `%NAME%` placeholders of the page template. */
export function fillTemplate(html: string): string {
  const escape = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return html
    .replaceAll("%PRODUCT_NAME%", escape(PRODUCT_NAME))
    .replaceAll("%PRODUCT_DESCRIPTION%", escape(PRODUCT_DESCRIPTION))
    .replaceAll("%THEME_COLOR_DARK%", THEME_COLORS.dark)
    .replaceAll("%THEME_COLOR_LIGHT%", THEME_COLORS.light);
}
