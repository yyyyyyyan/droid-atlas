#!/usr/bin/env node
/**
 * Scans a directory for material that must not be published.
 *
 *   node scripts/leak-scan.mjs --root <dir> [--config scripts/public-export.json] [--deny <file>]
 *   node scripts/leak-scan.mjs --root <site dir> --site
 *
 * Classes, each checked against every file's path and text content:
 *
 * | Class          | Finds |
 * |----------------|-------|
 * | `home-path`    | absolute home directories on Linux, macOS and Windows, and the root user's |
 * | `private-ip`   | RFC 1918, shared (CGNAT, used by tailnets) and link-local IPv4 addresses, and Tailscale's IPv6 prefix |
 * | `tailnet`      | `*.ts.net` names |
 * | `email`        | e-mail addresses other than the documented public contacts and reserved example domains |
 * | `device`       | adb serial arguments, emulator ids, the serial-number system property, MAC addresses, IMEI-length numbers, Samsung model codes |
 * | `deny-list`    | the terms in the deny-list file (accounts, organizations, host and device names), whole words, any case |
 * | `session`      | UUIDs, agent and session references, resume commands, co-author trailers, agent config paths |
 * | `token`        | credentials by shape: GitHub, GitLab, npm, Slack, Google, AWS and Anthropic/OpenAI-style keys, private key blocks, JWTs, bearer tokens |
 * | `not-allowed`  | a file the export allowlist does not cover (only with `--config`) |
 *
 * `--site` scans a built site rather than a source tree: no allowlist, no
 * e-mail class (the third-party notice and upstream text carry authors'
 * addresses by design), and under `data/` only the build reports, for the
 * classes that would expose the machine that built it. A build report quotes
 * upstream web addresses (an icon it could not download), so in those two
 * files a UUID that is part of an `http(s)` address is not a finding; the
 * address is still held to every other rule.
 *
 * A finding the config's `allowFindings` names exactly (path or list of
 * paths, class and matched text, with a reason) is a reviewed exception and is
 * not reported; any other match in the same file still is. An exception lists
 * the config file among its paths, since the config quotes what it excepts.
 *
 * The deny-list defaults to `scripts/leak-scan.deny.txt`, which is itself
 * never exported. Without it the scan still runs every other class and says
 * so. Lines are terms; `#` starts a comment; a line `re:<pattern>` is a
 * regular expression.
 *
 * Exits 1 when anything is found, printing `class  path:line  excerpt`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { matchesAny, walk } from "./lib/files.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG = join(HERE, "public-export.json");
export const DEFAULT_DENY = join(HERE, "leak-scan.deny.txt");

/** Domains reserved for documentation (RFC 2606, RFC 6761) and GitHub's private commit addresses. */
const SAFE_EMAIL_DOMAINS = /(^|\.)(example\.(com|org|net)|example|invalid|test|localhost|users\.noreply\.github\.com)$/i;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

/** True when the text at `index` continues an `http(s)` address: nothing that ends an address lies between its scheme and that point. */
function inWebAddress(text, index) {
  const lineStart = text.lastIndexOf("\n", index - 1) + 1;
  return /https?:\/\/[^\s"'`<>|\\]*$/i.test(text.slice(lineStart, index));
}

export const PATTERNS = {
  "home-path": [/(?<![\w.-])\/home\/[a-z_][a-z0-9_.-]*(?=\/|\b)/g, /(?<![\w.-])\/Users\/[A-Za-z][\w.-]*(?=\/|\b)/g, /\b[A-Za-z]:\\Users\\[^\\\s"'<>]+/g, /(?<![\w.-])\/root\//g],
  "private-ip": [
    /\b10\.(?:\d{1,3}\.){2}\d{1,3}\b/g,
    /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g,
    /\b192\.168\.\d{1,3}\.\d{1,3}\b/g,
    /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g,
    /\b169\.254\.\d{1,3}\.\d{1,3}\b/g,
    /\bfd7a:115c:a1e0:/gi,
  ],
  tailnet: [/\b[\w-]+(?:\.[\w-]+)*\.ts\.net\b/gi],
  email: [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g],
  device: [
    /\badb\s+-s\s+\S+/g,
    /\bemulator-\d{4}\b/g,
    /\bro\.serialno\b/g,
    /\bANDROID_SERIAL=\S+/g,
    /\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/gi,
    /(?<!\d|\d\.)\d{15}(?!\d|\.\d)/g,
    /\bSM-[A-Z]\d{3}[A-Z0-9]{0,3}\b/g,
  ],
  session: [
    UUID,
    /\b(?:claude|codex)\s+(?:--resume|-r|resume)\b/gi,
    /\bclaude\.ai\/(?:code|chat|share|artifact)\//gi,
    /^co-authored-by:/gim,
    /(?<![\w-])\.(?:claude|codex)[\w-]*\//g,
    /\b(?:agentId|session[_-]?id|conversation[_-]?id)\b\s*[:=]\s*[\"'`]?(?=[\w-]*\d)[\w-]{4,}/gi,
  ],
  token: [
    /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g,
    /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    /\bnpm_[A-Za-z0-9]{36}\b/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    /\bAIza[0-9A-Za-z_-]{35}\b/g,
    /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
  ],
};

/** Reads the deny-list: terms become case-insensitive whole-word patterns. */
export function readDenyList(path) {
  if (!path || !existsSync(path)) return null;
  const patterns = [];
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("re:")) patterns.push(new RegExp(line.slice(3), "gi"));
    else patterns.push(new RegExp(`(?<![A-Za-z0-9])${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "gi"));
  }
  return patterns;
}

export function readConfig(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** True when `path` is exported under `config`: an include matches and no exclude does. */
export function allowed(path, config) {
  return matchesAny(path, config.include) && !matchesAny(path, config.exclude ?? []);
}

function isBinary(buffer) {
  return buffer.subarray(0, 8192).includes(0);
}

function emailAllowed(address, contacts) {
  const lower = address.toLowerCase();
  if (contacts.some((c) => c.toLowerCase() === lower)) return true;
  if (lower.startsWith("git@")) return true;
  return SAFE_EMAIL_DOMAINS.test(lower.slice(lower.indexOf("@") + 1));
}

/** Findings for one text: `{ cls, line, match }`. With `quotesAddresses`, a UUID that is part of an `http(s)` address is not one. */
export function scanText(text, { classes, deny = null, contacts = [], quotesAddresses = false }) {
  const findings = [];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (index) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lineStarts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  const run = (cls, patterns) => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        if (cls === "email" && emailAllowed(match[0], contacts)) continue;
        if (pattern === UUID && quotesAddresses && inWebAddress(text, match.index)) continue;
        findings.push({ cls, line: lineOf(match.index), match: match[0] });
      }
    }
  };
  for (const cls of classes) if (cls !== "deny-list" && PATTERNS[cls]) run(cls, PATTERNS[cls]);
  if (deny && classes.includes("deny-list")) run("deny-list", deny);
  return findings;
}

const SOURCE_CLASSES = ["home-path", "private-ip", "tailnet", "email", "device", "deny-list", "session", "token"];
const SITE_CLASSES = SOURCE_CLASSES.filter((c) => c !== "email");
const SITE_REPORT_CLASSES = ["home-path", "deny-list", "session", "token"];

/**
 * Scans every file under `root`. With `config`, files the allowlist does not
 * cover are findings too. Returns `{ findings, files, denyList }`.
 */
export function scanTree(root, { config = null, deny = null, site = false } = {}) {
  const contacts = config?.publicContacts ?? [];
  const exceptions = config?.allowFindings ?? [];
  const excepted = (finding) => exceptions.some((e) => [e.path].flat().includes(finding.path) && e.class === finding.cls && e.match === finding.match);
  const findings = [];
  const files = walk(root);
  for (const path of files) {
    let classes = site ? SITE_CLASSES : SOURCE_CLASSES;
    let quotesAddresses = false;
    if (site && path.startsWith("data/")) {
      if (!/^data\/report\.(json|md)$/.test(path)) continue;
      classes = SITE_REPORT_CLASSES;
      quotesAddresses = true;
    }
    if (config && !site && !allowed(path, config)) findings.push({ path, cls: "not-allowed", line: 0, match: path });
    for (const finding of scanText(path, { classes, deny, contacts })) findings.push({ ...finding, path, line: 0 });
    const buffer = readFileSync(join(root, path));
    if (isBinary(buffer)) continue;
    for (const finding of scanText(buffer.toString("utf8"), { classes, deny, contacts, quotesAddresses })) findings.push({ ...finding, path });
  }
  return { findings: findings.filter((f) => !excepted(f)), files: files.length, denyList: deny !== null };
}

export function formatFinding({ cls, path, line, match }) {
  const excerpt = match.length > 60 ? `${match.slice(0, 57)}...` : match;
  return `${cls.padEnd(12)} ${path}${line ? `:${line}` : " (path)"}  ${excerpt}`;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { root: { type: "string" }, config: { type: "string" }, deny: { type: "string" }, site: { type: "boolean", default: false } },
  });
  if (!values.root) {
    process.stderr.write("usage: leak-scan.mjs --root <dir> [--config <json>] [--deny <file>] [--site]\n");
    process.exit(2);
  }
  const deny = readDenyList(values.deny ?? DEFAULT_DENY);
  const config = values.site ? null : readConfig(values.config ?? DEFAULT_CONFIG);
  const { findings, files } = scanTree(resolve(values.root), { config, deny, site: values.site });
  for (const finding of findings) process.stdout.write(`${formatFinding(finding)}\n`);
  if (!deny) process.stderr.write("leak-scan: no deny-list file; account, host and device names were not checked\n");
  process.stderr.write(`leak-scan: ${files} files, ${findings.length} finding(s)\n`);
  process.exitCode = findings.length ? 1 : 0;
}
