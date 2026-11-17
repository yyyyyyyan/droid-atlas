/**
 * Parses the Android FOSS README (offa/android-foss) into categories and
 * entries.
 *
 * Every line inside the catalog body is a section or category heading, a
 * separator, a blank line, an entry, a variant line, or a recorded anomaly.
 * The table of contents and the introduction before the first section are
 * outside the body.
 */
import type { Anomaly } from "../../schema/catalog.ts";
import { parseStoreLink } from "../forge.ts";
import { hasScheme, httpUrl, markdownToText, normalizeUrl, slug } from "../lib/text.ts";
import type { EntryChannel, ParsedSource, ParsedCategory, SourceEntry } from "./types.ts";

export const ANDROID_FOSS = {
  id: "android-foss",
  name: "Android FOSS",
  url: "https://github.com/offa/android-foss",
  remote: "https://github.com/offa/android-foss.git",
  license: "GPL-3.0-only",
  licenseUrl: "https://github.com/offa/android-foss/blob/master/LICENSE",
  files: ["README.md"],
} as const;

const FILE = "README.md";
const BLOB_BASE = "https://github.com/offa/android-foss/blob/master/";

const SECTION_RE = /^## – (.+?) –\s*$/;
const CATEGORY_RE = /^### • (.+?)\s*$/;
const ENTRY_RE = /^(\s*)\* \[\*\*(.+?)\*\*\]\((\S+?)\)(.*)$/;
const BADGE_RE = /\[\[(F-Droid|IzzyOnDroid)\]\((\S+?)\)\]/g;
const LINK_RE = /\[([^\]]+)\]\((\S+?)\)/g;
const VARIANT_RE = /^\s+([^*[\s][^:]*):\s+(.*)$/;
const SEPARATOR_RE = /^-{3,}$/;

/** Sections that list guides, websites and other catalogs rather than apps. */
const RESOURCE_SECTIONS = new Set(["Tutorials and Guides", "Getting more …"]);
const OWN_REPOSITORY = "https://github.com/offa/android-foss";

/** True for a link to the list's own repository or a document inside it. */
export function isOwnRepository(url: string, own: string): boolean {
  const normal = normalizeUrl(url);
  return normal === own || normal.startsWith(`${own}/`) || normal.startsWith(`${own}#`);
}

function stripEmphasis(text: string): string {
  return text.replace(/<\/?sup>|\*\*/g, "");
}

function resolve(url: string): string | null {
  return hasScheme(url) ? httpUrl(url) : httpUrl(url, BLOB_BASE);
}

interface BadgeResult {
  channels: EntryChannel[];
  unrecognized: { name: string; url: string }[];
}

function parseBadges(text: string, variant: string | null): BadgeResult {
  const result: BadgeResult = { channels: [], unrecognized: [] };
  for (const [, label = "", raw = ""] of stripEmphasis(text).matchAll(BADGE_RE)) {
    const link = parseStoreLink(raw);
    const expected = label === "F-Droid" ? "fdroid" : "izzy";
    if (link && link.type === expected) {
      result.channels.push({ type: link.type, pkg: link.pkg, variant });
    } else {
      const url = resolve(raw);
      if (url) result.unrecognized.push({ name: label, url });
    }
  }
  return result;
}

/** Category id for a heading path: the section, then the category within it. */
function categoryId(section: string, category: string | null): string {
  return category === null ? `android-foss/${slug(section)}` : `android-foss/${slug(section)}-${slug(category)}`;
}

export function parseAndroidFoss(markdown: string): ParsedSource {
  const lines = markdown.split("\n");
  const entries: SourceEntry[] = [];
  const anomalies: Anomaly[] = [];
  const categories: ParsedCategory[] = [];
  const byId = new Map<string, ParsedCategory>();
  let section: string | null = null;
  let category: ParsedCategory | null = null;
  let parent: number | null = null;
  let bodyStart = -1;
  const counts = new Map<string, number>();

  const useCategory = (sectionName: string, name: string | null): ParsedCategory => {
    const id = categoryId(sectionName, name);
    let found = byId.get(id);
    if (!found) {
      found = {
        id,
        source: "android-foss",
        name: name ?? sectionName,
        section: name === null ? null : sectionName,
        order: categories.length,
        note: null,
      };
      byId.set(id, found);
      categories.push(found);
    }
    return found;
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    const sectionMatch = raw.match(SECTION_RE);
    if (sectionMatch) {
      if (bodyStart === -1) bodyStart = index;
      section = sectionMatch[1] ?? "";
      category = null;
      parent = null;
      return;
    }
    if (section === null) return;
    const trimmed = raw.trim();
    if (!trimmed || SEPARATOR_RE.test(trimmed)) return;

    const categoryMatch = raw.match(CATEGORY_RE);
    if (categoryMatch) {
      category = useCategory(section, categoryMatch[1] ?? "");
      parent = null;
      return;
    }

    const entryMatch = raw.match(ENTRY_RE);
    if (entryMatch) {
      const [, indent = "", rawName = "", rawUrl = "", rest = ""] = entryMatch;
      const url = resolve(rawUrl);
      if (!url) {
        anomalies.push({ file: FILE, line, kind: "unsafe-url", text: trimmed });
        return;
      }
      const nested = indent.length > 0;
      if (nested && parent === null) anomalies.push({ file: FILE, line, kind: "nested-without-parent", text: trimmed });
      const badges = parseBadges(rest, null);
      const leftover = stripEmphasis(rest).replace(BADGE_RE, "");
      const extraLinks = [...badges.unrecognized];
      for (const [, extraName = "", extraUrl = ""] of leftover.matchAll(LINK_RE)) {
        const resolved = resolve(extraUrl);
        if (resolved) extraLinks.push({ name: markdownToText(extraName), url: resolved });
        else anomalies.push({ file: FILE, line, kind: "unsafe-url", text: trimmed });
      }
      if (badges.unrecognized.length) anomalies.push({ file: FILE, line, kind: "unrecognized-store-link", text: trimmed });
      const residue = leftover.replace(LINK_RE, "").replace(/[\s/]/g, "");
      if (residue) anomalies.push({ file: FILE, line, kind: "unparsed-trailing-text", text: trimmed });
      const owner = category ?? useCategory(section, null);
      const primary = parseStoreLink(url);
      const channels = [...badges.channels];
      if (primary && !channels.some((c) => c.type === primary.type && c.pkg === primary.pkg)) {
        channels.unshift({ ...primary, variant: null });
      }
      const order = counts.get(owner.id) ?? 0;
      counts.set(owner.id, order + 1);
      entries.push({
        source: "android-foss",
        file: FILE,
        line,
        order,
        kind: RESOURCE_SECTIONS.has(section) || isOwnRepository(url, OWN_REPOSITORY) ? "resource" : "app",
        name: markdownToText(rawName),
        url,
        category: owner.id,
        description: null,
        tags: [],
        license: null,
        parent: nested ? parent : null,
        sourceCode: null,
        channels,
        extraLinks,
        historyKey: normalizeUrl(rawUrl),
        added: null,
      });
      if (!nested) parent = entries.length - 1;
      return;
    }

    const variantMatch = raw.match(VARIANT_RE);
    const last = entries.at(-1);
    if (variantMatch && last) {
      const variant = (variantMatch[1] ?? "").trim();
      const badges = parseBadges(variantMatch[2] ?? "", variant);
      if (badges.channels.length) {
        last.channels.push(...badges.channels);
        last.extraLinks.push(...badges.unrecognized);
        return;
      }
    }

    anomalies.push({ file: FILE, line, kind: "unrecognized-line", text: trimmed });
  });

  return {
    categories,
    entries,
    anomalies,
    lines: lines.at(-1) === "" ? lines.length - 1 : lines.length,
    skipped: bodyStart <= 0 ? [] : [{ file: FILE, line: 1, heading: "Introduction and table of contents", items: lines.slice(0, bodyStart).filter((l) => /^\s*\* /.test(l)).length, reason: "outside the catalog body" }],
    notes: [],
    unknownTokens: [],
  };
}
