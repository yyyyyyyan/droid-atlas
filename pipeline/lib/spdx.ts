/**
 * SPDX license expressions against the pinned SPDX license list
 * (`pipeline/spdx/licenses.json`), and license texts for `licenses/`.
 *
 * The icon policy's license gate (docs/LICENSING.md §1.3 rule 3) lives here:
 * every license id in the expression, `OR` alternatives included, must be in
 * the pinned list and be OSI-approved or FSF-libre; deprecated ids are mapped
 * to their current form; `LicenseRef-*`, `PublicDomain` and unknown `WITH`
 * exceptions are rejected.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { retry } from "./retry.ts";

export interface SpdxList {
  licenseListVersion: string;
  tag: string;
  licenses: Record<string, { osi: boolean; fsf: boolean; deprecated: boolean }>;
  exceptions: string[];
}

const LIST_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "spdx", "licenses.json");

export function loadSpdxList(path = LIST_PATH): SpdxList {
  return JSON.parse(readFileSync(path, "utf8")) as SpdxList;
}

export type SpdxNode =
  | { type: "license"; id: string; plus: boolean; exception: string | null }
  | { type: "and" | "or"; left: SpdxNode; right: SpdxNode };

/** Parses an SPDX license expression; throws on anything malformed. */
export function parseSpdx(text: string): SpdxNode {
  const tokens = text.match(/\(|\)|[A-Za-z0-9.+:-]+/g) ?? [];
  if (tokens.join("").length !== text.replace(/\s+/g, "").length) throw new Error(`unexpected characters in "${text}"`);
  let position = 0;
  const peek = (): string | undefined => tokens[position];
  const take = (): string => {
    const token = tokens[position++];
    if (token === undefined) throw new Error(`unexpected end of "${text}"`);
    return token;
  };
  const isOperator = (token: string | undefined, operator: string): boolean => token?.toUpperCase() === operator;

  const atom = (): SpdxNode => {
    const token = take();
    if (token === "(") {
      const inner = orExpression();
      if (take() !== ")") throw new Error(`unbalanced parentheses in "${text}"`);
      return inner;
    }
    if (token === ")" || ["AND", "OR", "WITH"].includes(token.toUpperCase())) throw new Error(`unexpected "${token}" in "${text}"`);
    const plus = token.endsWith("+");
    const id = plus ? token.slice(0, -1) : token;
    let exception: string | null = null;
    if (isOperator(peek(), "WITH")) {
      take();
      exception = take();
    }
    return { type: "license", id, plus, exception };
  };
  const andExpression = (): SpdxNode => {
    let left = atom();
    while (isOperator(peek(), "AND")) {
      take();
      left = { type: "and", left, right: atom() };
    }
    return left;
  };
  const orExpression = (): SpdxNode => {
    let left = andExpression();
    while (isOperator(peek(), "OR")) {
      take();
      left = { type: "or", left, right: andExpression() };
    }
    return left;
  };
  if (!tokens.length) throw new Error("empty license expression");
  const tree = orExpression();
  if (position !== tokens.length) throw new Error(`trailing "${tokens.slice(position).join(" ")}" in "${text}"`);
  return tree;
}

function leaves(node: SpdxNode): Extract<SpdxNode, { type: "license" }>[] {
  return node.type === "license" ? [node] : [...leaves(node.left), ...leaves(node.right)];
}

/** The current id for a license id as written, or null when the list has no current form of it. */
export function currentId(id: string, plus: boolean, list: SpdxList): string | null {
  const known = Object.keys(list.licenses).find((k) => k.toLowerCase() === id.toLowerCase());
  if (!known) return null;
  const entry = list.licenses[known];
  if (!entry) return null;
  if (!entry.deprecated) return known;
  const replacement = plus ? `${known}-or-later` : `${known}-only`;
  return list.licenses[replacement] && !list.licenses[replacement]?.deprecated ? replacement : null;
}

export interface LicenseGate {
  ok: boolean;
  /** Current license ids in the expression, for license texts. */
  ids: string[];
  /** Exceptions named with WITH. */
  exceptions: string[];
  reason: string;
}

/** Rule 3 of the icon policy. */
export function licenseGate(expression: string | null, list: SpdxList): LicenseGate {
  const refuse = (reason: string): LicenseGate => ({ ok: false, ids: [], exceptions: [], reason });
  if (!expression) return refuse("no license stated");
  let tree: SpdxNode;
  try {
    tree = parseSpdx(expression);
  } catch (error) {
    return refuse(`not an SPDX expression: ${error instanceof Error ? error.message : String(error)}`);
  }
  const ids: string[] = [];
  const exceptions: string[] = [];
  for (const leaf of leaves(tree)) {
    if (/^LicenseRef-/i.test(leaf.id) || /^DocumentRef-/i.test(leaf.id)) return refuse(`${leaf.id} is not a listed license`);
    const id = currentId(leaf.id, leaf.plus, list);
    if (!id) return refuse(`${leaf.id}${leaf.plus ? "+" : ""} is not in SPDX license list ${list.licenseListVersion}`);
    const entry = list.licenses[id];
    if (!entry?.osi && !entry?.fsf) return refuse(`${id} is neither OSI-approved nor FSF-libre`);
    if (leaf.exception !== null) {
      const exception = list.exceptions.find((e) => e.toLowerCase() === leaf.exception?.toLowerCase());
      if (!exception) return refuse(`unknown exception ${leaf.exception}`);
      if (!exceptions.includes(exception)) exceptions.push(exception);
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, ids: ids.sort(), exceptions: exceptions.sort(), reason: `${ids.join(", ")} in SPDX ${list.licenseListVersion}` };
}

/**
 * The current SPDX ids and exceptions an expression names, when every one of
 * them is in the list; empty for anything that is not a listed expression
 * ("not stated", `LicenseRef-…`, free text). Used to ship the texts of the
 * licenses icon credits mention, whatever those licenses are.
 */
export function listedLicenseIds(expression: string, list: SpdxList): string[] {
  let tree: SpdxNode;
  try {
    tree = parseSpdx(expression);
  } catch {
    return [];
  }
  const ids = new Set<string>();
  for (const leaf of leaves(tree)) {
    const id = /^(LicenseRef|DocumentRef)-/i.test(leaf.id) ? null : currentId(leaf.id, leaf.plus, list);
    if (!id) return [];
    ids.add(id);
    if (leaf.exception !== null) {
      const exception = list.exceptions.find((e) => e.toLowerCase() === leaf.exception?.toLowerCase());
      if (!exception) return [];
      ids.add(exception);
    }
  }
  return [...ids].sort();
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Reads a text file from spdx/license-list-data through the GitHub GraphQL API (`<tag>:<path>`). */
export async function readSpdxBlob(expression: string, token: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<string> {
  const query = `query($expr: String!) { repository(owner: "spdx", name: "license-list-data") { object(expression: $expr) { ... on Blob { text isTruncated isBinary } } } }`;
  return retry(async () => {
    const response = await fetchImpl("https://api.github.com/graphql", {
      method: "POST",
      headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "droid-atlas-pipeline" },
      body: JSON.stringify({ query, variables: { expr: expression } }),
    });
    if (!response.ok) throw new Error(`GitHub GraphQL: HTTP ${response.status}`);
    const body = (await response.json()) as { data?: { repository?: { object?: { text?: string | null; isTruncated?: boolean; isBinary?: boolean } | null } } };
    const blob = body.data?.repository?.object;
    if (!blob || typeof blob.text !== "string" || blob.isTruncated || blob.isBinary) throw new Error(`spdx/license-list-data ${expression}: not a readable text blob`);
    return blob.text;
  });
}

export interface LicenseTexts {
  /** Text for each requested id, or the ids that could not be obtained. */
  texts: Map<string, string>;
  missing: string[];
}

/** License and exception texts from the cache, fetching the missing ones unless offline. */
export async function licenseTexts(
  ids: string[],
  list: SpdxList,
  options: { cacheDir: string; offline: boolean; token: () => string },
): Promise<LicenseTexts> {
  const dir = join(options.cacheDir, list.tag);
  mkdirSync(dir, { recursive: true });
  const texts = new Map<string, string>();
  const missing: string[] = [];
  let token: string | null = null;
  for (const id of [...new Set(ids)].sort()) {
    if (!/^[A-Za-z0-9.+-]+$/.test(id)) {
      missing.push(id);
      continue;
    }
    const path = join(dir, `${id}.txt`);
    if (existsSync(path)) {
      texts.set(id, readFileSync(path, "utf8"));
      continue;
    }
    if (options.offline) {
      missing.push(id);
      continue;
    }
    try {
      token ??= options.token();
      const text = await readSpdxBlob(`${list.tag}:text/${id}.txt`, token);
      writeFileSync(path, text);
      texts.set(id, text);
    } catch {
      missing.push(id);
    }
  }
  return { texts, missing };
}
