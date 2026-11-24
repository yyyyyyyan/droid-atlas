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
 *   the token's name says. A statement that offers a choice ("Apache-2.0 OR
 *   MIT") is a token for each license offered. A statement that there is no
 *   license ("Proprietary", "No license") is not a license and has no token;
 *   "Closed source" in the panel answers that question.
 *
 * Both are built from an index of the catalog made the first time one is
 * needed, so they cost nothing at start.
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

/** A license term without the version qualifiers the token ignores, in the source's own letters: "GPL-3.0-or-later" is "GPL-3.0". */
function bareTerm(term: string): string {
  return term.trim().replace(/[()]/g, "").replace(/(-only|-or-later|\+)$/i, "").trim();
}

/** The token key of one license term, or null when the term names no license a token can carry. */
export function licenseKey(term: string): string | null {
  const folded = bareTerm(term).toLowerCase().replace(/\s+/g, "-");
  if (!LICENSE_KEY.test(folded) || NOT_A_LICENSE.has(folded)) return null;
  return `${LICENSE_PREFIX}${folded}`;
}

/** A stretch of a stated license, and the token it leads to when it names a license. */
export interface LicensePart {
  text: string;
  key: string | null;
}

/**
 * A stated license cut into the licenses it offers and the words between,
 * so each license can lead to its own list: "Apache-2.0 OR MIT" is
 * "Apache-2.0", " OR ", "MIT". A statement of one license is one part.
 */
export function licenseParts(value: string): LicensePart[] {
  return value
    .split(/(\s+OR\s+|\s*\/\s*)/i)
    .map((text, index) => ({ text, key: index % 2 === 0 ? licenseKey(text) : null }))
    .filter((part) => part.text !== "");
}

/** The license tokens an app is listed under: every license any source states for it. */
export function licenseKeysOf(app: Pick<App, "licenses">): string[] {
  const keys = app.licenses.flatMap((statement) => licenseParts(statement.value).flatMap((part) => (part.key ? [part.key] : [])));
  return [...new Set(keys)];
}

/** The entries one token holds, and what the token is called. */
export interface FactGroup {
  key: string;
  /** What a chip and a list's heading call it: "fossifyorg on GitHub", "MIT". */
  label: string;
  /** By name. */
  entries: Entry[];
  members: Set<Entry>;
}

export interface FactIndex {
  owners: Map<string, FactGroup>;
  licenses: Map<string, FactGroup>;
  /** The owner group an entry belongs to, when its repository is on a named forge. */
  ownerOf(entry: Entry): FactGroup | null;
}

/** The most frequent of a token's spellings; the first seen among equals. */
function commonest(spellings: Map<string, number>): string {
  let best = "";
  let most = 0;
  for (const [spelling, count] of spellings) {
    if (count > most) {
      best = spelling;
      most = count;
    }
  }
  return best;
}

/**
 * Groups the entries by repository owner and by license. Each group is named
 * by the spelling most of its statements use: an owner as most of its slugs
 * spell it, a license as most sources write it without its version qualifier.
 *
 * @param entries the catalog, by name
 */
export function indexFacts(entries: readonly Entry[]): FactIndex {
  const groups = (): Map<string, { entries: Entry[]; spellings: Map<string, number> }> => new Map();
  const owners = groups();
  const licenses = groups();
  const ownerKey = new Map<Entry, string>();
  const add = (into: ReturnType<typeof groups>, key: string, entry: Entry, spelling: string): void => {
    let group = into.get(key);
    if (!group) {
      group = { entries: [], spellings: new Map() };
      into.set(key, group);
    }
    if (group.entries.at(-1) !== entry) group.entries.push(entry);
    group.spellings.set(spelling, (group.spellings.get(spelling) ?? 0) + 1);
  };
  for (const entry of entries) {
    const owner = repositoryOwner(entry.app);
    if (owner) {
      add(owners, owner.key, entry, ownerLabel(owner));
      ownerKey.set(entry, owner.key);
    }
    for (const statement of entry.app.licenses) {
      for (const part of licenseParts(statement.value)) {
        if (part.key) add(licenses, part.key, entry, bareTerm(part.text));
      }
    }
  }
  const finish = (from: ReturnType<typeof groups>): Map<string, FactGroup> =>
    new Map([...from].map(([key, group]) => [key, { key, label: commonest(group.spellings), entries: group.entries, members: new Set(group.entries) }]));
  const ownerGroups = finish(owners);
  return {
    owners: ownerGroups,
    licenses: finish(licenses),
    ownerOf: (entry) => ownerGroups.get(ownerKey.get(entry) ?? "") ?? null,
  };
}
