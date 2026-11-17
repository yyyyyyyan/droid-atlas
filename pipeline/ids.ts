/**
 * Permanent app ids.
 *
 * An id is assigned once and carried forward: each new app is matched to an
 * app in the previous good catalog by any of its keys (package ids, canonical
 * repository, source + listing URL) and keeps that app's id. A new app gets an
 * id from its main package, else its repository, else a slug of its first
 * listing; when that is already taken it is made unique with a short hash of
 * the app's own key, never with its position in a list. Ids that stop
 * existing are written to `redirects`, pointing at their successor or null.
 */
import type { App, Catalog } from "../schema/catalog.ts";
import { parseRepo } from "./forge.ts";
import { sha256 } from "./lib/hash.ts";
import { normalizeUrl, slug } from "./lib/text.ts";

export interface AppKeys {
  packages: string[];
  /** Canonical repository key (`github:owner/name`), or null. */
  repo: string | null;
  /** `<source> <normalized listing URL>` for each listing. */
  listings: string[];
  /** `<source> <category> <normalized URL>` for each listing, to tell apart two apps behind the same URL. */
  placedListings: string[];
}

/**
 * Keys of an app as it appears in a catalog. A fork's package ids are not its
 * keys: it shares them with the app it was forked from, which owns them.
 */
export function keysOf(app: Pick<App, "packages" | "repo" | "listings" | "github">): AppKeys {
  const repo = app.repo ? (parseRepo(app.repo.url, true)?.key ?? `url:${normalizeUrl(app.repo.url)}`) : null;
  return {
    packages: app.github?.forkOf ? [] : [...app.packages],
    repo,
    listings: app.listings.map((l) => `${l.source} ${normalizeUrl(l.url)}`),
    placedListings: app.listings.map((l) => `${l.source} ${l.category} ${normalizeUrl(l.url)}`),
  };
}

export interface IdCandidate {
  keys: AppKeys;
  /** The id this app would get if it were new. */
  base: string;
  /** A key unique to this app, hashed to disambiguate a taken base. */
  uniqueKey: string;
}

export interface IdAssignment {
  ids: string[];
  redirects: Record<string, string | null>;
  /** Ids that did not exist in the previous catalog. */
  created: string[];
  /** Previous ids that no longer name an app. */
  retired: string[];
  /** For the report: how each carried-forward id was matched. */
  matches: { id: string; by: string }[];
}

const SCORE = { package: 4, repo: 3, placed: 2, listing: 1 } as const;

/** The id a new app would get, before any disambiguation. */
export function baseId(packages: string[], repoKey: string | null, firstListing: { source: string; name: string }): string {
  if (packages[0]) return packages[0];
  if (repoKey) return slug(repoKey.replace(":", "-"));
  return `${firstListing.source}-${slug(firstListing.name) || "entry"}`;
}

function shortHash(text: string): string {
  return sha256(text).slice(0, 6);
}

interface Match {
  previousId: string;
  score: number;
  by: string;
}

function bestMatches(candidate: IdCandidate, index: Map<string, string[]>): Match[] {
  const found = new Map<string, Match>();
  const consider = (kind: keyof typeof SCORE, key: string): void => {
    for (const previousId of index.get(`${kind} ${key}`) ?? []) {
      const current = found.get(previousId);
      if (!current || current.score < SCORE[kind]) found.set(previousId, { previousId, score: SCORE[kind], by: `${kind} ${key}` });
    }
  };
  for (const pkg of candidate.keys.packages) consider("package", pkg);
  if (candidate.keys.repo) consider("repo", candidate.keys.repo);
  for (const key of candidate.keys.placedListings) consider("placed", key);
  for (const key of candidate.keys.listings) consider("listing", key);
  return [...found.values()].sort((a, b) => b.score - a.score || (a.previousId < b.previousId ? -1 : 1));
}

/**
 * Assigns ids to `candidates` (in any order; the result does not depend on it)
 * given the previous catalog, or null on a bootstrap build.
 */
export function assignIds(candidates: IdCandidate[], previous: Pick<Catalog, "apps" | "redirects"> | null): IdAssignment {
  const previousApps = previous?.apps ?? [];
  const index = new Map<string, string[]>();
  const add = (key: string, id: string): void => {
    const list = index.get(key) ?? [];
    if (!list.includes(id)) list.push(id);
    index.set(key, list);
  };
  for (const app of previousApps) {
    const keys = keysOf(app);
    for (const pkg of keys.packages) add(`package ${pkg}`, app.id);
    if (keys.repo) add(`repo ${keys.repo}`, app.id);
    for (const key of keys.placedListings) add(`placed ${key}`, app.id);
    for (const key of keys.listings) add(`listing ${key}`, app.id);
  }

  const matchesOf = candidates.map((c) => bestMatches(c, index));
  const pairs = matchesOf.flatMap((matches, candidate) => matches.map((match) => ({ candidate, match })));
  pairs.sort(
    (a, b) =>
      b.match.score - a.match.score ||
      (a.match.previousId < b.match.previousId ? -1 : a.match.previousId > b.match.previousId ? 1 : 0) ||
      (candidates[a.candidate]?.uniqueKey ?? "").localeCompare(candidates[b.candidate]?.uniqueKey ?? ""),
  );

  const ids: (string | null)[] = candidates.map(() => null);
  const taken = new Set<string>();
  const matchRecords: IdAssignment["matches"] = [];
  for (const { candidate, match } of pairs) {
    if (ids[candidate] !== null || taken.has(match.previousId)) continue;
    ids[candidate] = match.previousId;
    taken.add(match.previousId);
    matchRecords.push({ id: match.previousId, by: match.by });
  }

  const reserved = new Set<string>([...previousApps.map((a) => a.id), ...Object.keys(previous?.redirects ?? {})]);
  const fresh = candidates.map((c, i) => (ids[i] === null ? i : -1)).filter((i) => i !== -1);
  const baseCount = new Map<string, number>();
  for (const i of fresh) {
    const base = candidates[i]?.base ?? "";
    baseCount.set(base, (baseCount.get(base) ?? 0) + 1);
  }
  const created: string[] = [];
  for (const i of fresh) {
    const candidate = candidates[i];
    if (!candidate) continue;
    let id = candidate.base;
    if (reserved.has(id) || taken.has(id) || (baseCount.get(id) ?? 0) > 1) id = `${candidate.base}-${shortHash(candidate.uniqueKey)}`;
    let attempt = 2;
    while (taken.has(id) || reserved.has(id)) id = `${candidate.base}-${shortHash(`${candidate.uniqueKey}#${attempt++}`)}`;
    ids[i] = id;
    taken.add(id);
    created.push(id);
  }

  const finalIds = ids.map((id) => id ?? "");
  const current = new Set(finalIds);
  const redirects: Record<string, string | null> = {};
  const retired: string[] = [];
  for (const app of previousApps) {
    if (current.has(app.id)) continue;
    retired.push(app.id);
    const successor = pairs.find((p) => p.match.previousId === app.id);
    redirects[app.id] = successor ? (finalIds[successor.candidate] ?? null) : null;
  }
  for (const [from, to] of Object.entries(previous?.redirects ?? {})) {
    if (current.has(from) || from in redirects) continue;
    let target = to;
    const seen = new Set<string>([from]);
    while (target !== null && !current.has(target) && !seen.has(target)) {
      seen.add(target);
      target = redirects[target] ?? previous?.redirects[target] ?? null;
    }
    redirects[from] = target !== null && current.has(target) ? target : null;
  }
  for (const [from, to] of Object.entries(redirects)) {
    if (to !== null && !current.has(to)) redirects[from] = redirects[to] ?? null;
  }

  return {
    ids: finalIds,
    redirects: Object.fromEntries(Object.entries(redirects).sort(([a], [b]) => (a < b ? -1 : 1))),
    created: previous ? created.sort() : [],
    retired: retired.sort(),
    matches: matchRecords.sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}
