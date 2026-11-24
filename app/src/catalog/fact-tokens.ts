/**
 * Facts with many values, reached from an app rather than from the filter
 * panel: the owner of the app's repository, and a license a source states.
 * Each value is a filter token like any other (`filters.ts`), so a list it
 * leads to can be narrowed further, pinned and shared; but no token of these
 * families is offered in the panel or as a lens.
 *
 * - `owner:<host>/<owner>`: the first segment of `Repo.slug` on one of the
 *   four named forges, lower-cased. Owners are compared without regard to
 *   case; the same name on two forges is two owners.
 * - `license:<license>`: a license as sources state it, lower-cased, with
 *   white space as hyphens and without `-only`, `-or-later` or `+`, so
 *   "GPL-3.0-only", "GPL-3.0-or-later" and GitHub's "GPL-3.0" are one token:
 *   each of those apps may be used under version 3 of the GPL, which is all
 *   the token's name says. A statement of several licenses is a token for
 *   each (`licenseTerms`). A statement that there is no license
 *   ("Proprietary", "No license") is not a license and has no token; "Closed
 *   source" in the panel answers that question.
 *
 * Both are built from an index of the catalog made when the page is first
 * idle, or sooner by whatever needs it, so they cost nothing at start.
 */

import type { App, Repo } from "./schema.ts";
import type { Entry } from "./model.ts";

export const OWNER_PREFIX = "owner:";
export const LICENSE_PREFIX = "license:";

type Forge = Exclude<Repo["host"], "other">;

const FORGE_NAMES: Record<Forge, string> = { github: "GitHub", gitlab: "GitLab", codeberg: "Codeberg", sourcehut: "SourceHut" };

const SEGMENT = /^[A-Za-z0-9._~-]{1,100}$/;

/** A license name the token can carry: letters, digits, dots and hyphens, and not too long to be one. */
const LICENSE_KEY = /^[a-z0-9][a-z0-9.-]{0,63}$/;

/** Wordings sources use to say that a project has no license, folded as license keys are. */
const NOT_A_LICENSE = new Set(["proprietary", "propietary", "no-license", "none", "noassertion", "all-rights-reserved", "unlicensed"]);

export interface Owner {
  key: string;
  host: Forge;
  /** The owner as the slug spells it. */
  name: string;
}

/** The owner of the app's repository on a named forge; null for a repository elsewhere, or none. */
export function repositoryOwner(app: Pick<App, "repo">): Owner | null {
  const { repo } = app;
  if (!repo?.slug || repo.host === "other" || !Object.hasOwn(FORGE_NAMES, repo.host)) return null;
  const name = repo.slug.split("/")[0] ?? "";
  if (!SEGMENT.test(name)) return null;
  return { key: `${OWNER_PREFIX}${repo.host}/${name.toLowerCase()}`, host: repo.host, name };
}

/** "fossifyorg on GitHub": who owns a repository, and where. */
export function ownerLabel(owner: Pick<Owner, "host" | "name">): string {
  return `${owner.name} on ${FORGE_NAMES[owner.host]}`;
}

const QUALIFIER = /(-only|-or-later|\+)$/i;

/** A license term without the version qualifiers the token ignores, in the source's own letters: "GPL-3.0-or-later" is "GPL-3.0". */
function bareTerm(term: string): string {
  return term.replace(/[()]/g, "").trim().replace(QUALIFIER, "").trim();
}

/** A license term as its token spells it. */
function foldTerm(term: string): string {
  return bareTerm(term).toLowerCase().replace(/\s+/g, "-");
}

/** The token key of one license term, or null when the term names no license a token can carry. */
export function licenseKey(term: string): string | null {
  const folded = foldTerm(term);
  if (!LICENSE_KEY.test(folded) || NOT_A_LICENSE.has(folded)) return null;
  return `${LICENSE_PREFIX}${folded}`;
}

/** The terms of a stated license: what `OR`, `AND` and `/` join, each without the exception a `WITH` adds to it. Only SPDX's capitals are operators. */
function termsOf(value: string): string[] {
  return value
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .split(/\s+(?:OR|AND)\s+|\s*\/\s*/)
    .map((term) => (term.split(/\s+WITH\s+/)[0] ?? "").trim())
    .filter(Boolean);
}

/** One license a statement names: how the source writes it without its version qualifier, and its token. */
export interface LicenseTerm {
  term: string;
  key: string;
}

/**
 * The licenses a stated license names, each once, in the order stated. Each
 * term is read on its own, without parentheses and without its version
 * qualifier, so "(MIT OR Apache-2.0)" names MIT and Apache-2.0, and
 * "GPL-3.0-only" is GPL-3.0 wherever it stands.
 *
 * - "A OR B" and "A / B" offer a choice: the app may be used under each, so
 *   each is named.
 * - "A AND B" applies both, to different parts of the app: the app is under
 *   each, so each is named.
 * - "A WITH E" is license A with an SPDX exception, which only adds
 *   permissions: A is named; the exception is not a license and is not.
 *
 * Only SPDX's capitals are operators: in "Apache 2.0 with Commons Clause" or
 * "GPL-3.0 or later" the small words are part of what the source calls its
 * license, which is then a license of its own. A statement with a term that
 * says there is no license ("Proprietary AND MIT") names none, since what it
 * says of the app as a whole is unclear.
 */
export function licenseTerms(value: string): LicenseTerm[] {
  const all = termsOf(value);
  if (all.some((term) => NOT_A_LICENSE.has(foldTerm(term)))) return [];
  const terms: LicenseTerm[] = [];
  for (const term of all) {
    const key = licenseKey(term);
    if (key && !terms.some((known) => known.key === key)) terms.push({ term: bareTerm(term), key });
  }
  return terms;
}

/** Whether a stated license names its licenses without a version qualifier, as GitHub's "GPL-3.0" does beside an index's "GPL-3.0-only". */
export function isBareLicense(value: string): boolean {
  return termsOf(value).every((term) => !QUALIFIER.test(term));
}

/** The license tokens an app is listed under: every license any source states for it. */
export function licenseKeysOf(app: Pick<App, "licenses">): string[] {
  return [...new Set(app.licenses.flatMap((statement) => licenseTerms(statement.value).map((term) => term.key)))];
}


/** The entries one token holds, and what the token is called. */
export interface FactGroup {
  key: string;
  /** What a chip and a list's heading call it: "fossifyorg on GitHub", "MIT". */
  label: string;
  /** By name. */
  entries: Entry[];
}

export interface FactIndex {
  owners: Map<string, FactGroup>;
  licenses: Map<string, FactGroup>;
  /** The owner group an entry belongs to, when its repository is on a named forge. */
  ownerOf(entry: Entry): FactGroup | null;
  /** Whether an entry is among those an owner or license token holds. */
  holds(entry: Entry, key: string): boolean;
}

/** The most frequent spelling; the first seen among equals. */
function commonest(spellings: readonly string[]): string {
  const first = spellings[0] ?? "";
  if (spellings.every((spelling) => spelling === first)) return first;
  const counts = new Map<string, number>();
  for (const spelling of spellings) counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
  let best = first;
  for (const [spelling, count] of counts) if (count > (counts.get(best) ?? 0)) best = spelling;
  return best;
}

interface Draft {
  entries: Entry[];
  spellings: string[];
}

function addTo(groups: Map<string, Draft>, key: string, entry: Entry, spelling: string): void {
  const group = groups.get(key);
  if (!group) {
    groups.set(key, { entries: [entry], spellings: [spelling] });
    return;
  }
  if (group.entries.at(-1) !== entry) group.entries.push(entry);
  group.spellings.push(spelling);
}

/**
 * Groups the entries by repository owner and by license. Each group is named
 * by the spelling most of its statements use: an owner as most of its slugs
 * spell it, a license as most sources write it without its version qualifier.
 *
 * @param entries the catalog, by name
 */
export function indexFacts(entries: readonly Entry[]): FactIndex {
  const owners = new Map<string, Draft>();
  const licenses = new Map<string, Draft>();
  const hosts = new Map<string, Owner["host"]>();
  const keysOf = new Map<Entry, string[]>();
  /* Sources spell few licenses many times over, so each spelling is read once. */
  const read = new Map<string, { key: string; term: string }[]>();
  for (const entry of entries) {
    const keys: string[] = [];
    const owner = repositoryOwner(entry.app);
    if (owner) {
      addTo(owners, owner.key, entry, owner.name);
      hosts.set(owner.key, owner.host);
      keys.push(owner.key);
    }
    for (const statement of entry.app.licenses) {
      let terms = read.get(statement.value);
      if (!terms) {
        terms = licenseTerms(statement.value);
        read.set(statement.value, terms);
      }
      for (const { key, term } of terms) {
        addTo(licenses, key, entry, term);
        if (!keys.includes(key)) keys.push(key);
      }
    }
    if (keys.length > 0) keysOf.set(entry, keys);
  }
  const finish = (drafts: Map<string, Draft>, label: (key: string, spelling: string) => string): Map<string, FactGroup> => {
    const done = new Map<string, FactGroup>();
    for (const [key, draft] of drafts) done.set(key, { key, label: label(key, commonest(draft.spellings)), entries: draft.entries });
    return done;
  };
  const ownerGroups = finish(owners, (key, name) => ownerLabel({ host: hosts.get(key) ?? "github", name }));
  return {
    owners: ownerGroups,
    licenses: finish(licenses, (_key, term) => term),
    ownerOf: (entry) => {
      const key = keysOf.get(entry)?.[0];
      return key?.startsWith(OWNER_PREFIX) ? ownerGroups.get(key) ?? null : null;
    },
    holds: (entry, key) => keysOf.get(entry)?.includes(key) ?? false,
  };
}
