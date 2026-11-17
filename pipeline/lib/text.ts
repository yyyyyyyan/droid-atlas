/**
 * Helpers for treating upstream text as data: URL checks, markup stripping,
 * slugs. Nothing here executes or interpolates upstream content anywhere.
 */

/** Returns the URL as a normalized string when it parses as http(s), otherwise null. */
export function httpUrl(value: string | null | undefined, base?: string): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = base === undefined ? new URL(value) : new URL(value, base);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (!parsed.hostname || parsed.username || parsed.password) return null;
  return parsed.href;
}

/** True when the string carries an explicit URL scheme ("https:", "javascript:", "mailto:"). */
export function hasScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

/** Lower-cased URL with http upgraded to https and trailing slashes removed, for comparisons only. */
export function normalizeUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^http:/, "https:")
    .replace(/\/+$/, "");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Removes control characters other than newline and tab, which upstream text has no use for. */
function dropControls(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "");
}

/** Converts an HTML fragment from an index description into plain text with paragraph breaks. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = decodeEntities(
    html
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/<\s*(br|\/p|\/li|\/h\d|\/ul|\/ol|\/div)\s*\/?>/gi, "\n")
      .replace(/<\s*li[^>]*>/gi, "• ")
      .replace(/<[^>]*>/g, ""),
  );
  const cleaned = dropControls(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned || null;
}

/**
 * Converts a line of Markdown into plain text: links keep their text, images
 * and inline HTML are dropped, emphasis and code markers are removed.
 */
export function markdownToText(markdown: string): string {
  const text = markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1");
  return dropControls(decodeEntities(text)).replace(/\s+/g, " ").trim();
}

/** Markdown links in a line, with their text stripped to plain text and URLs kept only when http(s). */
export function markdownLinks(markdown: string, base?: string): { name: string; url: string }[] {
  const links: { name: string; url: string }[] = [];
  for (const match of markdown.matchAll(/(?<!!)\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g)) {
    const url = httpUrl(match[2], base);
    if (url) links.push({ name: markdownToText(match[1] ?? ""), url });
  }
  return links;
}

/** Lower-case ASCII slug: letters and digits separated by single hyphens. */
export function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Shortens text at a word boundary, marking the cut with an ellipsis. */
export function truncate(text: string | null, limit: number): string | null {
  if (text === null || text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > limit - 80 ? space : limit).trimEnd()}…`;
}

/** Converts an index timestamp in milliseconds to an ISO string, or null. */
export function isoFromMillis(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
}

/** First ten characters of an ISO timestamp, converted to UTC. */
export function isoDate(value: string): string | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}
