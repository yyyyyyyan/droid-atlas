/**
 * Parses timschneeb/awesome-shizuku: the main list (`README.md`, `## Apps`
 * with `###` categories and `####` vendor sub-categories), the closed-source
 * page and the archive page.
 *
 * An entry is
 *   * [Name](url) [✨] [`Tag`…] [💰] - description `License` [`Tag`…] [(Source code)](repo)
 * Every line is a heading, an entry, a note, a separator or blank line, part
 * of a section deliberately skipped (recorded with the reason), or a recorded
 * anomaly. The tag vocabulary is checked against the list's own Annotations
 * section, so a new annotation upstream surfaces as an anomaly.
 */
import type { Anomaly, ListingTag } from "../../schema/catalog.ts";
import { parseStoreLink } from "../forge.ts";
import { classifyLicense } from "../lib/licenses.ts";
import { hasScheme, httpUrl, markdownLinks, markdownToText, normalizeUrl, slug } from "../lib/text.ts";
import { isOwnRepository } from "./android-foss.ts";
import type { LooseNote, ParsedSource, SkippedSection, ParsedCategory, SourceEntry } from "./types.ts";

export const AWESOME_SHIZUKU = {
  id: "awesome-shizuku",
  name: "awesome-shizuku",
  url: "https://github.com/timschneeb/awesome-shizuku",
  remote: "https://github.com/timschneeb/awesome-shizuku.git",
  license: "CC-BY-SA-3.0",
  licenseUrl: "https://github.com/timschneeb/awesome-shizuku/blob/master/LICENSE",
  files: ["README.md", "pages/CLOSED_SOURCE.md", "pages/ARCHIVED.md"],
} as const;

const OWN_REPOSITORY = "https://github.com/timschneeb/awesome-shizuku";
const BLOB_BASE = "https://github.com/timschneeb/awesome-shizuku/blob/master/";

type Page = "main" | "closed" | "archived";

/** Annotation → listing tag. Null marks a known annotation that carries no tag. */
const TOKENS: Record<string, ListingTag | null> = {
  "✨": "recommended",
  Paid: "paid",
  IAP: "iap",
  Ads: "ads",
  Root: "root",
  "💰": null,
  "No Ads": null,
};
const TRIAL_RE = /^(\d+|n)-(minute|hour|day|week|month)s? trial$/i;
/** License strings the list uses for "not under a FOSS license" (its own rule, CONTRIBUTING.md). */
const PROPRIETARY_RE = /^(proprietary|propietary|no license)$/i;

const ENTRY_RE = /^(\s*)\* \[([^\]]+)\]\(([^)\s]+)\)(.*)$/;
const HEAD_TOKENS_RE = /^((?:\s*(?:✨|💰|`[^`]+`))*)\s+-\s+(.*)$/;
const SOURCE_LINK_RE = /\s*\[\(Source code\)\]\(([^)\s]+)\)\s*$/;
const TAIL_TOKENS_RE = /^(.*?)((?:\s*`[^`]+`)+)\s*$/;
const TOKEN_RE = /✨|💰|`([^`]+)`/g;
const NOTE_START_RE = /^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;
/** A quoted line that is one link and nothing else: a pointer to another page, which says nothing once the link is text. */
const LINK_ALONE_RE = /^\[[^\]]+\]\([^)\s]+\)$/;

export function classifyToken(token: string): { known: boolean; tag: ListingTag | null } {
  if (token in TOKENS) return { known: true, tag: TOKENS[token] ?? null };
  if (TRIAL_RE.test(token)) return { known: true, tag: "trial" };
  return { known: false, tag: null };
}

function resolve(url: string, file: string): string | null {
  if (hasScheme(url)) return httpUrl(url);
  const dir = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  return url.startsWith("/") ? httpUrl(url.slice(1), BLOB_BASE) : httpUrl(url, BLOB_BASE + dir);
}

interface ParseState {
  categories: ParsedCategory[];
  entries: SourceEntry[];
  anomalies: Anomaly[];
  skipped: SkippedSection[];
  notes: LooseNote[];
  unknownTokens: Map<string, number>;
  annotations: Set<string>;
  lines: number;
}

function anomaly(state: ParseState, file: string, line: number, kind: string, text: string): void {
  state.anomalies.push({ file, line, kind, text });
}

function countToken(state: ParseState, token: string): void {
  state.unknownTokens.set(token, (state.unknownTokens.get(token) ?? 0) + 1);
}

interface Context {
  file: string;
  page: Page;
  category: ParsedCategory | null;
  /** Index into `entries` of the last top-level entry in the current category. */
  parent: number | null;
  /** Skipped section the lines currently belong to, if any. */
  skipping: SkippedSection | null;
  /** Heading of a pointer section ("Closed-source apps" in the main list), whose prose and notes are kept as loose notes. */
  pointer: string | null;
  inVendor: boolean;
  inAnnotations: boolean;
  counts: Map<string, number>;
}

function categoryFor(state: ParseState, page: Page, name: string, vendor: boolean): ParsedCategory {
  const prefix = { main: "", closed: "closed-", archived: "" }[page];
  const id = page === "archived" ? "awesome-shizuku/archived" : `awesome-shizuku/${prefix}${vendor ? "vendor-" : ""}${slug(name)}`;
  const existing = state.categories.find((c) => c.id === id);
  if (existing) return existing;
  const section =
    page === "archived" ? null : page === "closed" ? (vendor ? "Closed-source apps › Vendor-specific" : "Closed-source apps") : vendor ? "Vendor-specific" : "Apps";
  const category: ParsedCategory = {
    id,
    source: "awesome-shizuku",
    name,
    section,
    order: state.categories.length,
    note: null,
  };
  state.categories.push(category);
  return category;
}

function addNote(state: ParseState, context: Context, line: number, text: string): void {
  if (!text) return;
  if (context.category && !context.pointer) {
    context.category.note = context.category.note ? `${context.category.note}\n\n${text}` : text;
    return;
  }
  state.notes.push({ file: context.file, line, text, placement: context.pointer ? `pointer section “${context.pointer}”` : "page introduction" });
}

function parseEntry(state: ParseState, context: Context, raw: string, line: number): void {
  const match = raw.match(ENTRY_RE);
  const category = context.category;
  if (!match || !category) {
    anomaly(state, context.file, line, category ? "unparsed-entry" : "entry-outside-category", raw.trim());
    return;
  }
  const [, indent = "", rawName = "", rawUrl = "", restRaw = ""] = match;
  const url = resolve(rawUrl, context.file);
  if (!url) {
    anomaly(state, context.file, line, "unsafe-url", raw.trim());
    return;
  }

  let rest = restRaw;
  let sourceCode: string | null = null;
  const sourceMatch = rest.match(SOURCE_LINK_RE);
  if (sourceMatch) {
    sourceCode = resolve(sourceMatch[1] ?? "", context.file);
    if (!sourceCode) anomaly(state, context.file, line, "unsafe-url", raw.trim());
    rest = rest.slice(0, sourceMatch.index);
  }

  const tokens: string[] = [];
  let body = rest;
  const head = rest.match(HEAD_TOKENS_RE);
  if (head) {
    for (const t of (head[1] ?? "").matchAll(TOKEN_RE)) tokens.push(t[1] ?? t[0]);
    body = head[2] ?? "";
  } else if (rest.trim()) {
    for (const t of rest.matchAll(TOKEN_RE)) tokens.push(t[1] ?? t[0]);
    if (rest.replace(TOKEN_RE, "").trim()) anomaly(state, context.file, line, "missing-description-separator", raw.trim());
    body = "";
  }

  let license: string | null = null;
  const tail = body.match(TAIL_TOKENS_RE);
  if (tail) {
    const trailing = [...(tail[2] ?? "").matchAll(TOKEN_RE)].map((t) => t[1] ?? t[0]);
    license = trailing[0]?.trim() || null;
    tokens.push(...trailing.slice(1));
    body = tail[1] ?? "";
  } else if (body.trim()) {
    anomaly(state, context.file, line, "missing-license", raw.trim());
  }

  const tags = new Set<ListingTag>();
  for (const token of tokens) {
    const { known, tag } = classifyToken(token.trim());
    if (!known) {
      countToken(state, token.trim());
      anomaly(state, context.file, line, "unknown-tag", `\`${token}\` in ${raw.trim()}`);
    }
    if (tag) tags.add(tag);
  }
  const licenseClass = classifyLicense(license);
  if (license && licenseClass === "unknown" && !PROPRIETARY_RE.test(license)) countToken(state, `license: ${license}`);
  if (context.page === "closed") tags.add("closed-source");
  else if (context.page === "main" && license && (PROPRIETARY_RE.test(license) || licenseClass === "nonfree")) tags.add("source-available");
  if (context.page === "archived") tags.add("archived");

  const nested = indent.length > 0;
  if (nested && context.parent === null) anomaly(state, context.file, line, "nested-without-parent", raw.trim());
  const description = markdownToText(body.replace(/\s+-\s*$/, "")) || null;
  const order = context.counts.get(category.id) ?? 0;
  context.counts.set(category.id, order + 1);
  const store = parseStoreLink(url);
  const sourceStore = sourceCode ? parseStoreLink(sourceCode) : null;
  state.entries.push({
    source: "awesome-shizuku",
    file: context.file,
    line,
    order,
    kind: isOwnRepository(url, OWN_REPOSITORY) ? "resource" : "app",
    name: markdownToText(rawName) || rawName.trim(),
    url,
    category: category.id,
    description,
    tags: [...tags].sort(),
    license,
    parent: nested ? context.parent : null,
    sourceCode: sourceStore ? null : sourceCode,
    channels: [store, sourceStore].filter((s) => s !== null).map((s) => ({ type: s.type, pkg: s.pkg, variant: null })),
    extraLinks: markdownLinks(body, BLOB_BASE).filter((l) => l.url !== url),
    historyKey: normalizeUrl(rawUrl),
    added: null,
  });
  if (!nested) context.parent = state.entries.length - 1;
}

function parseFile(state: ParseState, file: string, page: Page, markdown: string): void {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  state.lines += lines.length;
  const context: Context = {
    file,
    page,
    category: null,
    parent: null,
    skipping: { file, line: 1, heading: "Page introduction and table of contents", items: 0, reason: "outside the catalog body" },
    pointer: null,
    inVendor: false,
    inAnnotations: false,
    counts: new Map(),
  };
  state.skipped.push(context.skipping as SkippedSection);
  let note: { line: number; parts: string[] } | null = null;

  const flushNote = (): void => {
    if (note) addNote(state, context, note.line, note.parts.join(" ").replace(/ ?\n\n ?/g, "\n\n").replace(/\s+$/, ""));
    note = null;
  };
  const skip = (line: number, heading: string, reason: string): void => {
    context.skipping = { file, line, heading, items: 0, reason };
    state.skipped.push(context.skipping);
    context.category = null;
    context.pointer = null;
  };

  lines.forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();

    if (trimmed.startsWith(">")) {
      const content = trimmed.replace(/^>\s?/, "");
      if (LINK_ALONE_RE.test(content.trim())) {
        state.notes.push({ file, line, text: markdownToText(content), placement: `a link alone${context.category ? ` under “${context.category.name}”` : ""}: a pointer to another page, kept out of the category's note` });
        return;
      }
      if (NOTE_START_RE.test(trimmed)) {
        flushNote();
        note = { line, parts: [] };
      } else if (note) {
        note.parts.push(content.trim() ? markdownToText(content) : "\n\n");
      } else if (!context.skipping) {
        note = { line, parts: [markdownToText(content)] };
      }
      return;
    }
    flushNote();

    const h2 = raw.match(/^## (.+?)\s*$/);
    const h3 = raw.match(/^### (.+?)\s*$/);
    const h4 = raw.match(/^#### (.+?)\s*$/);
    if (h2) {
      const heading = h2[1] ?? "";
      context.inAnnotations = false;
      context.inVendor = false;
      if ((page === "main" && heading === "Apps") || (page === "closed" && heading === "Closed-source apps")) {
        context.skipping = null;
        context.category = null;
        context.pointer = null;
      } else if (page === "archived" && heading === "Archived apps") {
        context.skipping = null;
        context.pointer = null;
        context.category = categoryFor(state, page, "Archived apps", false);
        context.parent = null;
      } else if (heading === "Development libraries" || heading === "Miscellaneous content") {
        skip(line, heading, "libraries and other content for developers, not apps");
      } else if (heading === "Annotations") {
        skip(line, heading, "tag vocabulary, checked against the parser's");
        context.inAnnotations = true;
      } else if (heading === "License" || heading === "Table of contents") {
        skip(line, heading, heading === "License" ? "the list's own license, recorded in the source info" : "navigation");
      } else {
        anomaly(state, file, line, "unknown-section", raw.trim());
        skip(line, heading, "unknown section: not imported, reported as an anomaly");
      }
      return;
    }
    if (h3 || h4) {
      if (context.skipping) return;
      const heading = (h3 ?? h4)?.[1] ?? "";
      context.parent = null;
      if (h3) {
        context.inVendor = heading === "Vendor-specific";
        context.pointer = page === "main" && (heading === "Closed-source apps" || heading === "Unlisted apps") ? heading : null;
        context.category = context.inVendor || context.pointer ? null : categoryFor(state, page, heading, false);
      } else if (context.inVendor) {
        context.category = categoryFor(state, page, heading, true);
      } else {
        anomaly(state, file, line, "sub-heading-outside-vendor-section", raw.trim());
      }
      return;
    }
    if (/^#{1,6} /.test(trimmed)) {
      if (!context.skipping) anomaly(state, file, line, "unexpected-heading", trimmed);
      return;
    }

    if (context.skipping) {
      if (/^\s*[*-] /.test(raw)) context.skipping.items++;
      if (context.inAnnotations) {
        const annotation = trimmed.match(/^- (✨|`[^`]+`(?: 💰)?)\s+-\s+/);
        if (annotation) {
          const token = (annotation[1] ?? "").replace(/ 💰$/, "").replace(/`/g, "");
          state.annotations.add(token);
          if (!classifyToken(token).known && !PROPRIETARY_RE.test(token)) {
            anomaly(state, file, line, "unknown-annotation", trimmed);
          }
        }
      }
      return;
    }

    if (!trimmed || /^-{3,}$/.test(trimmed)) return;
    if (/^\s*\* \[/.test(raw)) {
      if (context.pointer) {
        state.notes.push({ file, line, text: markdownToText(trimmed), placement: `pointer section “${context.pointer}”` });
        return;
      }
      parseEntry(state, context, raw, line);
      return;
    }
    if (/^\s+\* /.test(raw) && context.parent !== null) {
      const parent = state.entries[context.parent];
      const links = markdownLinks(trimmed.slice(2), BLOB_BASE);
      if (parent) for (const link of links) if (!parent.extraLinks.some((l) => l.url === link.url)) parent.extraLinks.push(link);
      state.notes.push({ file, line, text: markdownToText(trimmed.slice(2)), placement: `attached to “${parent?.name ?? ""}”; ${links.length} link(s) kept as further links` });
      return;
    }
    if (!/^\s*[*-] /.test(raw) && (context.category || context.pointer)) {
      const entriesInCategory = context.category ? (context.counts.get(context.category.id) ?? 0) : 0;
      if (entriesInCategory === 0 || context.pointer) {
        addNote(state, context, line, markdownToText(trimmed));
        return;
      }
    }
    anomaly(state, file, line, "unrecognized-line", trimmed);
  });
  flushNote();
}

/** Tokens the Annotations section lists that are not in the parser's vocabulary are anomalies; so are missing ones. */
function checkVocabulary(state: ParseState): void {
  for (const token of ["✨", "Paid", "IAP", "Ads", "Root"]) {
    if (!state.annotations.has(token)) anomaly(state, "README.md", 0, "annotation-missing-upstream", token);
  }
}

export function parseAwesomeShizuku(read: (file: string) => string): ParsedSource {
  const state: ParseState = {
    categories: [],
    entries: [],
    anomalies: [],
    skipped: [],
    notes: [],
    unknownTokens: new Map(),
    annotations: new Set(),
    lines: 0,
  };
  const pages: [string, Page][] = [
    ["README.md", "main"],
    ["pages/CLOSED_SOURCE.md", "closed"],
    ["pages/ARCHIVED.md", "archived"],
  ];
  for (const [file, page] of pages) parseFile(state, file, page, read(file));
  checkVocabulary(state);
  return {
    categories: state.categories,
    entries: state.entries,
    anomalies: state.anomalies,
    lines: state.lines,
    skipped: state.skipped,
    notes: state.notes,
    unknownTokens: [...state.unknownTokens].map(([token, count]) => ({ token, count })).sort((a, b) => (a.token < b.token ? -1 : 1)),
  };
}
