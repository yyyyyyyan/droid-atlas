/**
 * A small, separate reading of the upstream list snapshots a build ships
 * under `data/upstream/`. It follows the lists' own Markdown grammar and the
 * documented annotation rules (awesome-shizuku's "Annotations" section and
 * pipeline/NOTES.md § Parsing), and shares no code with the pipeline, so its
 * counts and values can be held against the pipeline's.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Build } from "../lib/catalog.ts";

export interface UpstreamEntry {
  source: "android-foss" | "awesome-shizuku";
  file: string;
  line: number;
  /** Section heading above the category, or null ("Apps", "Games", "Closed-source apps", "Vendor-specific"). */
  section: string | null;
  category: string;
  name: string;
  url: string;
  nested: boolean;
  fdroid: string | null;
  izzy: string | null;
  /** Normalized tags by the list's own annotation rules. */
  tags: string[];
  description: string | null;
  license: string | null;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'" };

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

/** Markdown inline → plain text: links keep their text, emphasis and code markers go. */
export function plain(markdown: string): string {
  return decode(markdown)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(^|\W)[*_](\S[^*_]*\S|\S)[*_](?=\W|$)/g, "$1$2")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function upstreamFiles(build: Build): { source: string; path: string; file: string }[] {
  return build.manifest.files
    .filter((file) => file.role === "upstream")
    .map((file) => {
      const path = join(build.dir, file.path);
      const file2 = file.origin === "android-foss" ? "README.md" : file.path.split("/").slice(-2).join("/").replace(/^[0-9a-f]{40}\//, "");
      return { source: file.origin, path, file: file2 };
    });
}

export function parseAndroidFoss(text: string): UpstreamEntry[] {
  const entries: UpstreamEntry[] = [];
  let section: string | null = null;
  let category: string | null = null;
  let inBody = false;
  text.split("\n").forEach((raw, index) => {
    const sectionMatch = /^## – (.+) –\s*$/.exec(raw);
    if (sectionMatch?.[1]) {
      inBody = true;
      section = decode(sectionMatch[1]);
      category = null;
      return;
    }
    if (/^## /.test(raw)) {
      inBody = false;
      return;
    }
    const categoryMatch = /^### • (.+?)\s*$/.exec(raw);
    if (categoryMatch?.[1]) {
      category = decode(categoryMatch[1]);
      return;
    }
    if (!inBody) return;
    const entry = /^(\s*)[*-] \[\*\*(.+?)\*\*\]\(([^)]+)\)(.*)$/.exec(raw);
    if (!entry) return;
    const [, indent = "", name = "", url = "", rest = ""] = entry;
    entries.push({
      source: "android-foss",
      file: "README.md",
      line: index + 1,
      section: category ? section : null,
      category: category ?? section ?? "",
      name: decode(name),
      url,
      nested: indent.length > 0,
      fdroid: /\[\[F-Droid\]\(([^)]+)\)\]/.exec(rest)?.[1] ?? null,
      izzy: /\[\[IzzyOnDroid\]\(([^)]+)\)\]/.exec(rest)?.[1] ?? null,
      tags: [],
      description: null,
      license: null,
    });
  });
  return entries;
}

const TAGS: Record<string, string> = { Paid: "paid", IAP: "iap", Ads: "ads", Root: "root" };
/** License words the list's own rules say mean "not FOSS" (CONTRIBUTING, Annotations; pipeline/NOTES.md). */
const NOT_FOSS = /^(Proprietary|Propietary|No license)$|PolyForm-Noncommercial|-NC-|-NC$|-ND-|-ND$/i;

/**
 * One awesome-shizuku entry line: `* [Name](url) [✨] [`Tag` …] - Description `License` [extra links]`.
 * Tags are the backticked tokens before the dash; the license is the last
 * backticked token after it.
 */
function parseShizukuLine(raw: string): Omit<UpstreamEntry, "source" | "file" | "line" | "section" | "category"> | null {
  const head = /^(\s*)[*-] \[([^\]]+)\]\(([^)]+)\)(.*)$/.exec(raw);
  if (!head) return null;
  const [, indent = "", name = "", url = "", rest = ""] = head;
  const dash = rest.search(/\s[-–]\s/);
  const before = dash === -1 ? rest : rest.slice(0, dash);
  const after = dash === -1 ? "" : rest.slice(dash).replace(/^\s[-–]\s/, "");
  const tags: string[] = [];
  if (before.includes("✨")) tags.push("recommended");
  const backticked = (part: string): string[] => [...part.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
  const annotation = (token: string): boolean => Boolean(TAGS[token]) || /^\d+-\w+ trial$/i.test(token) || token === "No Ads";
  const tokens = backticked(before);
  const afterTokens = backticked(after);
  const license = afterTokens.filter((token) => !annotation(token)).at(-1) ?? null;
  for (const token of [...tokens, ...afterTokens]) {
    if (TAGS[token]) tags.push(TAGS[token]);
    else if (/^\d+-\w+ trial$/i.test(token)) tags.push("trial");
  }
  /* The description ends where the trailing run of backticked tokens (license, markers) begins; further links may follow that run. */
  const trailing = /(?:\s*`[^`]+`\s*💰?)+(?:\s*\[[^\]]*\]\([^)]*\))*\s*$/u.exec(after);
  let description = trailing ? after.slice(0, trailing.index) : after;
  description = plain(description.replace(/`[^`]*`\s*💰?/g, "")).replace(/\s+$/, "");
  return {
    name: decode(name),
    url,
    nested: indent.length > 0,
    fdroid: null,
    izzy: null,
    tags,
    description: description || null,
    license,
  };
}

export function parseAwesomeShizuku(files: { file: string; text: string }[]): UpstreamEntry[] {
  const entries: UpstreamEntry[] = [];
  for (const { file, text } of files) {
    const page = file.includes("CLOSED_SOURCE") ? "closed" : file.includes("ARCHIVED") ? "archived" : "main";
    let inBody = page === "archived";
    let section: string | null = page === "closed" ? "Closed-source apps" : page === "main" ? "Apps" : null;
    let category: string | null = page === "archived" ? "Archived apps" : null;
    let vendorParent = false;
    text.split("\n").forEach((raw, index) => {
      const h2 = /^## (.+?)\s*$/.exec(raw);
      if (h2?.[1]) {
        inBody = page === "main" ? h2[1] === "Apps" : page === "closed" ? h2[1] === "Closed-source apps" : true;
        if (page === "archived") category = "Archived apps";
        return;
      }
      const h3 = /^### (.+?)\s*$/.exec(raw);
      if (h3?.[1]) {
        const name = decode(h3[1]);
        vendorParent = name === "Vendor-specific";
        if (page === "main" && (name === "Closed-source apps" || name === "Unlisted apps")) {
          category = null;
          return;
        }
        category = name;
        section = page === "closed" ? "Closed-source apps" : "Apps";
        return;
      }
      const h4 = /^#### (.+?)\s*$/.exec(raw);
      if (h4?.[1] && vendorParent) {
        category = decode(h4[1]);
        section = page === "closed" ? "Closed-source apps › Vendor-specific" : "Vendor-specific";
        return;
      }
      if (!inBody || !category) return;
      const parsed = parseShizukuLine(raw);
      if (!parsed) return;
      const tags = [...parsed.tags];
      if (page === "closed") tags.push("closed-source");
      else if (page === "archived") tags.push("archived");
      else if (parsed.license && NOT_FOSS.test(parsed.license)) tags.push("source-available");
      entries.push({ ...parsed, tags, source: "awesome-shizuku", file, line: index + 1, section, category });
    });
  }
  return entries;
}

export function readUpstream(build: Build): { androidFoss: UpstreamEntry[]; awesomeShizuku: UpstreamEntry[] } {
  const files = upstreamFiles(build);
  const af = files.find((f) => f.source === "android-foss");
  const shizuku = files.filter((f) => f.source === "awesome-shizuku").map((f) => ({ file: f.file, text: readFileSync(f.path, "utf8") }));
  return {
    androidFoss: af ? parseAndroidFoss(readFileSync(af.path, "utf8")) : [],
    awesomeShizuku: parseAwesomeShizuku(shizuku),
  };
}

/** For matching an upstream entry to a listing: scheme, `www.`, trailing slash and case of the host do not matter. */
export function normaliseUrl(url: string): string {
  return url.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "").replace(/^[^/]+/, (host) => host.toLowerCase());
}
