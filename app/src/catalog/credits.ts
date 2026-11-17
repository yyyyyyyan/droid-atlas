/**
 * What the Sources and licenses page says about each origin of the catalog,
 * read from the loaded build itself: the header every part opens with, the
 * manifest that lists the files, and the catalog's own record of each source.
 * Nothing here is written by hand, so the page cannot drift from the data it
 * describes.
 *
 * Every string comes from the build and is untrusted: views render it as
 * text, and a URL reaches an `href` only through `safeWebUrl` or
 * `manifestFileUrl`.
 */

import { safeWebUrl } from "../links.ts";
import { manifestFileUrl, type LoadedCatalog, type ManifestFile } from "./load.ts";
import type { Origin, SourceId } from "./schema.ts";

export interface CreditFile {
  /** The file's name as the manifest gives it, without the directories that lead to it. */
  name: string;
  url: string;
  bytes: number;
  /** "data" for the part itself, "upstream" for a snapshot of what it was made from. */
  kind: "data" | "upstream";
}

export interface SourceCredit {
  origin: Origin | "droid-atlas";
  /** What kind of origin this is, which decides the section it is listed in. */
  group: "catalog" | "facts" | "own";
  title: string;
  url: string | null;
  attribution: string;
  /** SPDX identifier, or a `LicenseRef-`/`NOASSERTION` marker for parts with no single license. */
  license: string;
  /** The license's own page, as the part's header gives it. */
  licenseUrl: string | null;
  /** Upstream commit the part was made from, when the upstream has commits. */
  commit: string | null;
  /** A link to that commit, when the upstream is a GitHub repository. */
  commitUrl: string | null;
  /** ISO time of the commit, the index or the fetch the part reflects. */
  asOf: string | null;
  retrieved: string | null;
  entries: number | null;
  changes: string | null;
  warranty: string | null;
  files: CreditFile[];
}

const ORDER: (Origin | "droid-atlas")[] = ["android-foss", "awesome-shizuku", "fdroid", "izzy", "github", "droid-atlas"];
const COMMIT = /^[0-9a-f]{7,40}$/;

/** A plain SPDX identifier: one license, whose text the build ships under `licenses/`. */
export function isPlainLicense(id: string): boolean {
  return /^[A-Za-z0-9.+-]+$/.test(id) && id !== "NOASSERTION" && !id.startsWith("LicenseRef-");
}

/** The identifiers an SPDX expression names ("GPL-3.0-or-later OR Apache-2.0" gives two). */
export function licenseIds(expression: string): string[] {
  const operators = new Set(["OR", "AND", "WITH"]);
  return [...new Set(expression.split(/[()\s]+/).filter((part) => part && !operators.has(part.toUpperCase()) && isPlainLicense(part)))];
}

/** License identifiers a sentence mentions, for parts whose licenses are stated in prose (the repository indexes). */
export function licensesMentioned(text: string): string[] {
  return [...new Set(text.match(/\b(?:AGPL|LGPL|GPL|CC-BY-SA|CC-BY|CC0|MPL|Apache|MIT)(?:-[0-9]+(?:\.[0-9]+)*)?(?:-only|-or-later)?\b/g) ?? [])]
    .filter((id) => /[0-9]/.test(id) || id === "MIT");
}

/** A GNU license identifier in the bare form SPDX has retired: "GPL-3.0", "AGPL-3.0", "LGPL-2.1". */
const BARE_GNU = /^[AL]?GPL-\d+\.\d+$/;

/**
 * The identifier under which a license's full text is looked for: itself,
 * or for a bare GNU identifier the "-only" form SPDX defines it as, whose
 * text is the same document. Any other spelling is left as it is, so a text
 * is linked only where it is certainly that license's.
 */
export function licenseTextId(id: string): string {
  return BARE_GNU.test(id) ? `${id}-only` : id;
}

/** Where the build ships a license's full text, relative to the data root. */
export function licenseTextPath(id: string): string | null {
  return isPlainLicense(id) ? `licenses/${id}.txt` : null;
}

function commitLink(url: string | null, commit: string | null): string | null {
  if (!url || !commit || !COMMIT.test(commit)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com" || !/^\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/?$/.test(parsed.pathname)) return null;
  return `https://github.com${parsed.pathname.replace(/\/$/, "")}/commit/${commit}`;
}

function creditFile(build: LoadedCatalog, file: ManifestFile, kind: CreditFile["kind"]): CreditFile | null {
  const url = manifestFileUrl(build, file.path);
  if (!url) return null;
  return { name: file.path.split("/").filter((part) => part !== "..").slice(kind === "upstream" ? -1 : 0).join("/"), url, bytes: file.bytes, kind };
}

/** One credit per origin the build was joined from, catalogs first, our own data last. */
export function sourceCredits(build: LoadedCatalog): SourceCredit[] {
  const { catalog, manifest } = build;
  const credits: SourceCredit[] = [];
  for (const part of build.parts) {
    const { file, header } = part;
    const origin = file.origin as SourceCredit["origin"];
    const info = catalog.sources.find((source) => source.id === (origin as SourceId)) ?? null;
    /* The catalog's own record of the source stands in where the header's address is missing or unusable. */
    const url = safeWebUrl(header?.source.url) ?? safeWebUrl(info?.url);
    const commit = header?.source.commit ?? info?.commit ?? null;
    const asOf = info?.committedAt
      ?? (origin === "fdroid" ? catalog.enrichment.fdroidIndexAt : origin === "izzy" ? catalog.enrichment.izzyIndexAt : origin === "github" ? catalog.enrichment.githubFetchedAt : null)
      ?? null;
    const files = [creditFile(build, file, "data")];
    for (const other of manifest.files) {
      if (other.role === "upstream" && other.origin === file.origin) files.push(creditFile(build, other, "upstream"));
    }
    credits.push({
      origin,
      group: file.role === "source" ? "catalog" : file.role === "atlas" ? "own" : "facts",
      title: header?.source.name ?? info?.name ?? file.origin,
      url,
      attribution: header?.attribution ?? file.attribution,
      license: header?.license ?? file.license,
      licenseUrl: safeWebUrl(header?.licenseUrl) ?? safeWebUrl(info?.licenseUrl),
      commit: commit && COMMIT.test(commit) ? commit : null,
      commitUrl: commitLink(url, commit),
      asOf,
      retrieved: header?.source.retrieved ?? null,
      entries: info?.entries ?? null,
      changes: header?.changes ?? null,
      warranty: header?.warranty ?? null,
      files: files.filter((item): item is CreditFile => item !== null),
    });
  }
  const rank = (credit: SourceCredit): number => {
    const index = ORDER.indexOf(credit.origin);
    return index === -1 ? ORDER.length : index;
  };
  return credits.sort((a, b) => rank(a) - rank(b));
}

/** The address of the project's own source code, as the atlas part's header gives it; null while it is a placeholder. */
export function projectUrl(build: LoadedCatalog): string | null {
  const atlas = build.parts.find((part) => part.file.role === "atlas");
  const url = safeWebUrl(atlas?.header?.source.url);
  if (!url) return null;
  /* `.invalid` is reserved for placeholders (RFC 2606): a build made before the address was decided. */
  return /\.(invalid|example|test)$/.test(new URL(url).hostname) ? null : url;
}

/** The kind of place an icon was found in, in a word or two, by the rule the pipeline found it under. */
const ICON_RULE_WORDS: Record<string, string> = {
  "fdroid-index": "F-Droid",
  "izzy-index": "IzzyOnDroid",
  "repo-fastlane": "repository",
  "repo-metadata": "repository",
  "repo-launcher": "repository",
  "readme-logo": "repository",
  "site-icon": "website",
  "store-listing": "store listing",
  "forge-avatar": "repository",
};

/** "F-Droid", "repository", "website"…: where an icon came from, as its credit says it. A rule this version does not know reads as the project itself. */
export function iconSourceWords(rule: string): string {
  return (Object.hasOwn(ICON_RULE_WORDS, rule) ? ICON_RULE_WORDS[rule] : undefined) ?? "project";
}

/** Whose icon it is, as a credit names them: "the Endda/80bee-app project" is "Endda/80bee-app", "the Eden developers" is "Eden developers". */
export function iconOwner(author: string): string {
  return author.replace(/^the (.+) project$/u, "$1").replace(/^the /u, "");
}

/** The groups the icon credits can be narrowed to, each with the rules it covers. */
export const ICON_SOURCE_GROUPS: { id: string; label: string; rules: readonly string[] }[] = [
  { id: "index", label: "F-Droid and IzzyOnDroid", rules: ["fdroid-index", "izzy-index"] },
  { id: "repo", label: "The project’s repository", rules: ["repo-fastlane", "repo-metadata", "repo-launcher", "readme-logo", "forge-avatar"] },
  { id: "web", label: "Website or store listing", rules: ["site-icon", "store-listing"] },
];
