/**
 * Identity: one App per real app, one Listing per appearance, permanent ids.
 *
 * Rules (docs/ARCHITECTURE.md § Identity):
 * 1. The package id is the primary key. It is verified when the entry links a
 *    store listing naming it, or when exactly one index entry declares the
 *    entry's canonical repository as its source code.
 * 2. A repository identifies an app only when it ships one app: a repository
 *    that carries two or more distinct packages in any index, or is linked by
 *    entries with different verified packages, is never merged on.
 * 3. Suffix variants (`.fdroid`, `.foss`, `.beta`…) count as the same app as
 *    the bare id only through a shared single-app repository; they become a
 *    channel with `variant` set.
 * 4. Forks are separate apps even when they keep the upstream package id.
 * 5. Resources (guides, sites, further reading) never merge.
 * Names never merge entries; equal and near-equal names that stay apart are
 * reported for review.
 */
import { existsSync, readFileSync } from "node:fs";
import type { App, Catalog, Channel, GithubFacts, Listing, Repo, SourceCategory, Sourced, SourceId } from "../schema/catalog.ts";
import {
  categoryAnswers,
  deriveDownloads,
  deriveIndex,
  deriveLicense,
  deriveLicenses,
  deriveName,
  deriveSearch,
  deriveSummary,
  type AppStatements,
  type IndexStatement,
} from "../schema/join.ts";
import { githubFigure } from "./enrich/downloads.ts";
import type { GithubLookup, GithubRepo } from "./enrich/github.ts";
import type { IndexData, IndexRecord } from "./enrich/index-v2.ts";
import { sourceCodeKeys } from "./enrich/index-v2.ts";
import { computeEvidence, computeFacets } from "./facets.ts";
import { isPackageId, parseRepo, parseStoreLink, sharedSite, variantOf, type RepoRef } from "./forge.ts";
import { assignIds, baseId, keysOf, type IdAssignment, type IdCandidate } from "./ids.ts";
import { httpUrl, normalizeUrl, slug, truncate } from "./lib/text.ts";
import type { SourceEntry } from "./sources/types.ts";
import { categoryById, mappingsOf, resolveCategory, type Placement, type Resolution } from "./taxonomy.ts";

export const DESCRIPTION_LIMIT = 4000;
export const SOURCE_ORDER: SourceId[] = ["android-foss", "awesome-shizuku", "droid-atlas"];
const CHANNEL_ORDER: Channel["type"][] = ["fdroid", "izzy", "play"];

export interface IdentityInput {
  entries: SourceEntry[];
  categories: SourceCategory[];
  /** Apps placed by hand into a Droid Atlas category, by app id (`pipeline/placements.json`). */
  placements?: ReadonlyMap<string, Placement>;
  fdroid: IndexData;
  izzy: IndexData;
  github: GithubLookup;
  previous: Pick<Catalog, "apps" | "redirects"> | null;
  overrides: IdentityOverrides;
}

/** An entry named in `identity-overrides.json`: its source and its main link, and its category when one source lists that link twice. */
export interface OverrideRef {
  source: SourceId;
  url: string;
  category?: string;
}

/** An entry declared to be the app an index lists under `pkg`, for an entry that links no listing and no repository an index names. */
export interface PackageOverride {
  entry: OverrideRef;
  pkg: string;
  reason: string;
  date: string;
}

export interface OverridePair {
  a: OverrideRef;
  b: OverrideRef;
  reason: string;
  date: string;
}

/** Rule 8: pairs declared the same app or different apps, overriding every other rule. */
export interface IdentityOverrides {
  same: OverridePair[];
  different: OverridePair[];
  packages: PackageOverride[];
}

export const NO_OVERRIDES: IdentityOverrides = { same: [], different: [], packages: [] };

export function readOverrides(path: string): IdentityOverrides {
  if (!existsSync(path)) return NO_OVERRIDES;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<IdentityOverrides>;
  const check = (list: unknown, kind: string): OverridePair[] => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new Error(`${path}: "${kind}" must be a list`);
    return list.map((item, i) => {
      const pair = item as Partial<OverridePair>;
      const ref = (r: Partial<OverrideRef> | undefined): r is OverrideRef => typeof r?.source === "string" && typeof r.url === "string";
      if (!ref(pair.a) || !ref(pair.b) || typeof pair.reason !== "string" || !pair.reason.trim() || typeof pair.date !== "string") {
        throw new Error(`${path}: ${kind}[${i}] needs a, b ({source, url}), reason and date`);
      }
      return { a: pair.a, b: pair.b, reason: pair.reason, date: pair.date };
    });
  };
  const packages = (parsed as { packages?: unknown }).packages;
  if (packages !== undefined && !Array.isArray(packages)) throw new Error(`${path}: "packages" must be a list`);
  return {
    same: check(parsed.same, "same"),
    different: check(parsed.different, "different"),
    packages: (packages ?? []).map((item: unknown, i: number) => {
      const o = item as Partial<PackageOverride>;
      const ref = o.entry;
      if (typeof ref?.source !== "string" || typeof ref.url !== "string" || (ref.category !== undefined && typeof ref.category !== "string") || typeof o.pkg !== "string" || !isPackageId(o.pkg) || typeof o.reason !== "string" || !o.reason.trim() || typeof o.date !== "string") {
        throw new Error(`${path}: packages[${i}] needs entry ({source, url, category?}), a package id, reason and date`);
      }
      return { entry: ref, pkg: o.pkg, reason: o.reason, date: o.date };
    }),
  };
}

/** How an entry without a store link was matched to an index package, or a candidate that was not applied, with the evidence. */
export interface IndexMatch {
  entry: EntryRef;
  pkg: string;
  /** The index's name for the package. */
  indexName: string | null;
  rule: "override" | "source-code" | "website";
  /** The link both sides state, or the override's reason. */
  evidence: string;
  applied: boolean;
  /** Why a candidate was not applied; null when it was. */
  note: string | null;
}

export interface EntryRef {
  source: SourceId;
  file: string;
  line: number;
  name: string;
  url: string;
}

export interface MergeRecord {
  app: string;
  /** What joined the entries: `package:<id>` or `repo:<key>`. */
  identifier: string;
  crossSource: boolean;
  entries: EntryRef[];
}

export interface NonMergeRecord {
  a: EntryRef & { app: string };
  b: EntryRef & { app: string };
  similarity: "equal" | "near";
}

export interface IdentityResult {
  apps: App[];
  /** What each origin states about each app, by app id: what the per-origin parts are written from. */
  statements: Map<string, AppStatements>;
  /** Long descriptions by origin, then app id. */
  details: { fdroid: Record<string, string>; izzy: Record<string, string> };
  redirects: Record<string, string | null>;
  ids: IdAssignment;
  merges: MergeRecord[];
  nonMerges: NonMergeRecord[];
  verifications: { entry: EntryRef; pkg: string; via: "store-link" | "index-source-code" | "index-website" | "override" }[];
  /** Every index match made for an entry without a store link by an override, an unparsed source link or a website, and every candidate set aside. */
  indexMatches: IndexMatch[];
  /** Every package override with the entries it names; it applies only when it names exactly one. */
  packageOverrides: { override: PackageOverride; entries: EntryRef[] }[];
  /** Repositories that ship more than one app and were therefore not merged on. */
  multiPackageRepos: { repo: string; packages: string[]; entries: EntryRef[] }[];
  /** Entries whose repository GitHub records as a fork; labeled, and never merged on the fork relation alone. */
  forks: { entry: EntryRef; repo: string; forkOf: string; packages: string[] }[];
  /** Every override in identity-overrides.json, with the entries it matched. */
  overrides: { kind: "same" | "different"; pair: OverridePair; matched: boolean; entries: EntryRef[] }[];
  /** Package ids linked by a source that no index carries any more (rule 6). */
  stalePackages: { entry: EntryRef; pkg: string }[];
  /** Listings nested under an entry that turned out to be the same app; the parent link was dropped. */
  selfParents: EntryRef[];
  /** Store links not used because the index names a different repository for that package than the entry does. */
  rejectedLinks: { entry: EntryRef; pkg: string; entryRepo: string; indexRepo: string }[];
  /** The index records an app's icon may come from: F-Droid's, then IzzyOnDroid's, where each names an icon. */
  iconSources: Map<string, IndexRecord[]>;
  /** How each app, by id, got its Droid Atlas category. */
  filing: Map<string, Resolution>;
  /** The GitHub repository each app's facts come from, under its current name; absent for apps without one. */
  githubRepos: Map<string, GithubRepo>;
}

interface Resolved {
  entry: SourceEntry;
  index: number;
  ref: EntryRef;
  linkedRepo: RepoRef | null;
  github: GithubRepo | null;
  githubMissing: boolean;
  canonical: RepoRef | null;
  forkOf: string | null;
  /** Live package ids the entry's store links state (rule 6 removes stale ones; rule 5 contradicted ones). */
  storePackages: string[];
  stalePackages: string[];
  indexPackage: string | null;
  /** How `indexPackage` was found; null when there is none. */
  indexMatch: "index-source-code" | "index-website" | "override" | null;
  /** Rule 9 and override candidates for this entry, applied or not. */
  indexCandidates: IndexMatch[];
  /** Store links the entry gives whose index names a different repository on the same forge. */
  rejected: { pkg: string; indexRepo: string }[];
}

/**
 * The repository the indexes name as a package's source, after GitHub renames.
 * Used to catch a list entry that links another app's store page.
 */
function indexRepoOf(pkg: string, input: IdentityInput): RepoRef | null {
  for (const index of [input.fdroid, input.izzy]) {
    const sourceCode = index.packages.get(pkg)?.sourceCode;
    const linked = sourceCode ? parseRepo(sourceCode, true) : null;
    if (!linked) continue;
    const result = linked.host === "github" && linked.slug ? input.github.get(linked.slug) : undefined;
    return canonicalRepo(linked, result && !("missing" in result) ? result : null);
  }
  return null;
}

/** True when two repositories on the same forge are different and neither is a fork of the other. */
function contradicts(entryRepo: RepoRef, entryForkOf: string | null, indexRepo: RepoRef, input: IdentityInput): boolean {
  if (entryRepo.host !== indexRepo.host || entryRepo.key === indexRepo.key) return false;
  if (entryForkOf && `github:${entryForkOf.toLowerCase()}` === indexRepo.key) return false;
  const indexGithub = indexRepo.host === "github" && indexRepo.slug ? input.github.get(indexRepo.slug) : undefined;
  const indexForkOf = indexGithub && !("missing" in indexGithub) ? indexGithub.forkOf : null;
  return !(indexForkOf && `github:${indexForkOf.toLowerCase()}` === entryRepo.key);
}

function trustedChannels(r: Resolved): SourceEntry["channels"] {
  return r.entry.channels.filter((c) => !r.rejected.some((x) => x.pkg === c.pkg));
}

function refOf(entry: SourceEntry): EntryRef {
  return { source: entry.source, file: entry.file, line: entry.line, name: entry.name, url: entry.url };
}

/** The repository an entry states: its explicit source-code link, else its main link when that is a repository. */
export function linkedRepo(entry: SourceEntry): RepoRef | null {
  return (entry.sourceCode ? parseRepo(entry.sourceCode, true) : null) ?? parseRepo(entry.url);
}

function canonicalRepo(linked: RepoRef | null, github: GithubRepo | null): RepoRef | null {
  if (!linked) return null;
  if (linked.host !== "github" || !github) return linked;
  return { host: "github", slug: github.fullName, url: `https://github.com/${github.fullName}`, key: `github:${github.fullName.toLowerCase()}` };
}

/** Package ids whose index entry declares one of these repositories as its source code, across both indexes. */
function indexPackagesFor(repos: (RepoRef | null)[], fdroid: IndexData, izzy: IndexData): Set<string> {
  const found = new Set<string>();
  for (const repo of repos) {
    if (!repo) continue;
    for (const key of new Set([...sourceCodeKeys(repo.url), repo.key])) {
      for (const index of [fdroid, izzy]) for (const pkg of index.bySourceCode.get(key) ?? []) found.add(pkg);
    }
  }
  return found;
}

/** The bare id a package collapses to when it is a suffix variant. */
function baseOf(pkg: string): string {
  return variantOf(pkg)?.base ?? pkg;
}

/** GitHub repositories to query: those entries link and those their store packages declare. */
export function githubSlugsFor(entries: SourceEntry[], fdroid: IndexData, izzy: IndexData): string[] {
  const slugs = new Set<string>();
  for (const entry of entries) {
    const repo = linkedRepo(entry);
    if (repo?.host === "github" && repo.slug) slugs.add(repo.slug);
    for (const channel of entry.channels) {
      for (const index of [fdroid, izzy]) {
        const sourceCode = index.packages.get(channel.pkg)?.sourceCode;
        const fromIndex = sourceCode ? parseRepo(sourceCode, true) : null;
        if (fromIndex?.host === "github" && fromIndex.slug) slugs.add(fromIndex.slug);
      }
    }
  }
  return [...slugs].sort();
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareEntries(a: SourceEntry, b: SourceEntry, categoryOrder: Map<string, number>): number {
  return (
    SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source) ||
    a.order - b.order ||
    (categoryOrder.get(a.category) ?? 0) - (categoryOrder.get(b.category) ?? 0) ||
    byText(a.file, b.file) ||
    a.line - b.line
  );
}

/**
 * Rule 6: a package id that neither index carries any more is not an
 * identifier. Play packages cannot be checked against an index and count as live.
 */
function isStale(channel: SourceEntry["channels"][number], input: IdentityInput): boolean {
  return channel.type !== "play" && !input.fdroid.packages.has(channel.pkg) && !input.izzy.packages.has(channel.pkg);
}

/**
 * Rule 5: a store link is the source's statement of identity. It is set aside
 * only when the index names, for that package, a repository on the same forge
 * that is unrelated to the entry's (not the same after renames, not a fork in
 * either direction) and that another entry lists.
 * Rule 7: index source-code matching never assigns a package to an entry of
 * a multi-package repository.
 */
function resolveEntries(input: IdentityInput): Resolved[] {
  const repos = input.entries.map((entry) => {
    const linked = linkedRepo(entry);
    const result = linked?.host === "github" && linked.slug ? input.github.get(linked.slug) : undefined;
    const github = result && !("missing" in result) ? result : null;
    return { linked, result, github, canonical: canonicalRepo(linked, github) };
  });
  const listedRepos = new Set(repos.map((r) => r.canonical?.key).filter((k): k is string => k !== undefined));
  const stores = input.entries.map((entry, index) => {
    const { github, canonical } = repos[index] ?? { github: null, canonical: null };
    const rejected: Resolved["rejected"] = [];
    const main = entry.channels.filter((c) => c.variant === null);
    const stalePackages = [...new Set(main.filter((c) => isStale(c, input)).map((c) => c.pkg))].filter(
      (pkg) => !main.some((c) => c.pkg === pkg && !isStale(c, input)),
    );
    const storePackages = [...new Set(main.map((c) => c.pkg))]
      .filter((pkg) => !stalePackages.includes(pkg))
      .filter((pkg) => {
        const indexRepo = canonical ? indexRepoOf(pkg, input) : null;
        if (!canonical || !indexRepo || !listedRepos.has(indexRepo.key)) return true;
        if (!contradicts(canonical, github?.forkOf ?? null, indexRepo, input)) return true;
        rejected.push({ pkg, indexRepo: indexRepo.key });
        return false;
      });
    return { rejected, stalePackages, storePackages };
  });
  const linkedApps = new Map<string, Set<string>>();
  input.entries.forEach((entry, i) => {
    const key = repos[i]?.canonical?.key;
    if (!key || entry.kind !== "app") return;
    const set = linkedApps.get(key) ?? new Set<string>();
    for (const pkg of stores[i]?.storePackages ?? []) set.add(baseOf(pkg));
    linkedApps.set(key, set);
  });
  const forced = packageOverrideTargets(input);
  const sites = indexSites(input);
  return input.entries.map((entry, index) => {
    const { linked, result, github, canonical } = repos[index] ?? { linked: null, result: undefined, github: null, canonical: null };
    const { rejected, stalePackages, storePackages } = stores[index] ?? { rejected: [], stalePackages: [], storePackages: [] };
    let indexPackage: string | null = null;
    let indexMatch: Resolved["indexMatch"] = null;
    const candidates: IndexMatch[] = [];
    if (entry.kind === "app" && !storePackages.length && canonical) {
      const found = [...indexPackagesFor([canonical, linked], input.fdroid, input.izzy)];
      const bases = new Set(found.map(baseOf));
      const apps = new Set([...bases, ...(linkedApps.get(canonical.key) ?? [])]);
      if (apps.size === 1) {
        if (found.length === 1) indexPackage = found[0] ?? null;
        else if (bases.size === 1) indexPackage = found.find((c) => bases.has(c)) ?? null;
      }
    }
    const override = forced.get(index);
    if (override) {
      const known = indexName(override.pkg, input) !== undefined;
      const applied = known && !storePackages.length && indexPackage === null && entry.kind === "app";
      const note = !known ? "no index carries this package" : entry.kind !== "app" ? "the entry is a guide or link" : applied ? null : "the entry already has a package";
      candidates.push({ entry: refOf(entry), pkg: override.pkg, indexName: indexName(override.pkg, input) ?? null, rule: "override", evidence: override.reason, applied, note });
      if (applied) {
        indexPackage = override.pkg;
        indexMatch = "override";
      }
    }
    if (entry.kind === "app" && !storePackages.length && indexPackage === null && !canonical) {
      const match = unlinkedMatch(entry, input, sites);
      candidates.push(...match.candidates);
      if (match.pkg) {
        indexPackage = match.pkg;
        indexMatch = match.rule;
      }
    } else if (indexPackage !== null && indexMatch === null) {
      indexMatch = "index-source-code";
    }
    return {
      entry,
      index,
      ref: refOf(entry),
      linkedRepo: linked,
      github,
      githubMissing: Boolean(result && "missing" in result),
      canonical,
      forkOf: github?.forkOf ?? null,
      storePackages,
      stalePackages,
      indexPackage,
      indexMatch,
      indexCandidates: candidates,
      rejected,
    };
  });
}

/** The index's name for a package, F-Droid's first; undefined when neither index carries it. */
function indexName(pkg: string, input: IdentityInput): string | null | undefined {
  const records = [input.fdroid.packages.get(pkg), input.izzy.packages.get(pkg)].filter((r): r is IndexRecord => r !== undefined);
  return records.length ? (records.find((r) => r.name)?.name ?? null) : undefined;
}

/** Entry index → its package override, for overrides that name exactly one entry (a link one source lists twice needs its category). */
function packageOverrideTargets(input: IdentityInput): Map<number, PackageOverride> {
  const targets = new Map<number, PackageOverride>();
  for (const { override, entries } of packageOverrideHits(input)) {
    const [only] = entries;
    if (entries.length === 1 && only !== undefined) targets.set(only, override);
  }
  return targets;
}

/** Each package override with the indexes of the entries it names. */
function packageOverrideHits(input: IdentityInput): { override: PackageOverride; entries: number[] }[] {
  return input.overrides.packages.map((override) => {
    const url = normalizeUrl(override.entry.url);
    const entries = input.entries
      .map((entry, i) => ({ entry, i }))
      .filter(({ entry }) => entry.source === override.entry.source && normalizeUrl(entry.url) === url && (override.entry.category === undefined || entry.category === override.entry.category))
      .map(({ i }) => i);
    return { override, entries };
  });
}

/** Normalized website → the package ids whose index entry states it, across both indexes. */
function indexSites(input: IdentityInput): Map<string, Set<string>> {
  const sites = new Map<string, Set<string>>();
  for (const index of [input.fdroid, input.izzy]) {
    for (const [pkg, record] of index.packages) {
      if (!record.webSite) continue;
      const key = normalizeUrl(record.webSite);
      sites.set(key, (sites.get(key) ?? new Set<string>()).add(pkg));
    }
  }
  return sites;
}

/** Lower-cased letters and digits of a name. */
function nameKeyOf(text: string): string {
  return text.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when two names are the same, or one is the other with words added ("Tool" and "Tool Pro" are not; "Tool" and "Tool for Android" are). */
function namesAgree(a: string, b: string | null): boolean {
  if (!b) return false;
  const [x, y] = [nameKeyOf(a), nameKeyOf(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.startsWith(short) && /^(app|android|foss|free|client|mobile|forandroid)+$/.test(long.slice(short.length));
}

/**
 * Rule 9: an app entry with no store link and no repository the parser knows
 * is matched to an index package only on what the index itself states, and
 * only when that names a single app:
 *  - source code: a package whose `sourceCode` is the entry's main link or
 *    source link (a repository on a forge `parseRepo` does not know);
 *  - website: a package whose `webSite` is the entry's main link, when no
 *    other app states that site, the site is not one that hosts many
 *    projects, and the two names agree.
 * Every candidate is returned, applied or not, so the report shows it.
 */
function unlinkedMatch(entry: SourceEntry, input: IdentityInput, sites: Map<string, Set<string>>): { pkg: string | null; rule: "index-source-code" | "index-website"; candidates: IndexMatch[] } {
  const ref = refOf(entry);
  const links = [...new Set([entry.url, entry.sourceCode].filter((u): u is string => typeof u === "string").map(normalizeUrl))];
  const bySource = new Set<string>();
  for (const link of links) for (const index of [input.fdroid, input.izzy]) for (const pkg of index.bySourceCode.get(link) ?? []) bySource.add(pkg);
  if (bySource.size) {
    const bases = new Set([...bySource].map(baseOf));
    const pkg = bases.size === 1 ? ([...bySource].find((p) => bases.has(p)) ?? [...bySource].sort()[0] ?? null) : null;
    const candidates = [...bySource].sort().map((p): IndexMatch => ({ entry: ref, pkg: p, indexName: indexName(p, input) ?? null, rule: "source-code", evidence: `source code ${links.find((l) => [input.fdroid, input.izzy].some((i) => i.bySourceCode.get(l)?.has(p))) ?? ""}`, applied: p === pkg, note: p === pkg ? null : bases.size > 1 ? `${bases.size} apps state this source` : "a variant of the matched package" }));
    return { pkg, rule: "index-source-code", candidates };
  }
  const site = normalizeUrl(entry.url);
  const claimants = [...(sites.get(site) ?? [])].sort();
  if (!claimants.length) return { pkg: null, rule: "index-website", candidates: [] };
  const bases = new Set(claimants.map(baseOf));
  let url: URL | null = null;
  try {
    url = new URL(entry.url);
  } catch {
    url = null;
  }
  const shared = url === null || sharedSite(url);
  const only = bases.size === 1 ? (claimants.find((p) => bases.has(p)) ?? claimants[0] ?? null) : null;
  const agrees = only !== null && namesAgree(entry.name, indexName(only, input) ?? null);
  const pkg = !shared && only !== null && agrees ? only : null;
  const candidates = claimants.map((p): IndexMatch => {
    const note = shared ? "a site that hosts many projects" : bases.size > 1 ? `${bases.size} apps state this website` : p !== only ? "a variant of the matched package" : agrees ? null : "the names differ";
    return { entry: ref, pkg: p, indexName: indexName(p, input) ?? null, rule: "website", evidence: `website ${site}`, applied: p === pkg, note };
  });
  return { pkg, rule: "index-website", candidates };
}

function packagesOf(r: Resolved): string[] {
  return r.indexPackage && !r.storePackages.includes(r.indexPackage) ? [...r.storePackages, r.indexPackage] : r.storePackages;
}

interface Grouping {
  groups: Resolved[][];
  merges: { root: number; a: number; b: number; identifier: string }[];
  multiPackageRepos: IdentityResult["multiPackageRepos"];
  forks: IdentityResult["forks"];
  overrides: IdentityResult["overrides"];
}

/**
 * Union-find whose unions can be vetoed: a `different` override keeps two
 * entries in separate apps whatever rule would join them.
 */
class Groups {
  private readonly parent: number[];
  private readonly members: Map<number, Set<number>>;
  private readonly apart: [Set<number>, Set<number>][];
  constructor(size: number, apart: [Set<number>, Set<number>][]) {
    this.apart = apart;
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.members = new Map(this.parent.map((i) => [i, new Set([i])]));
  }
  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root] ?? root;
    return root;
  }
  /** True when joining the groups of `a` and `b` would put a `different` pair together. */
  blocked(a: number, b: number): boolean {
    const left = this.members.get(this.find(a)) ?? new Set<number>();
    const right = this.members.get(this.find(b)) ?? new Set<number>();
    const meets = (x: Set<number>, y: Set<number>): boolean => [...x].some((i) => y.has(i));
    return this.apart.some(([x, y]) => (meets(left, x) && meets(right, y)) || (meets(left, y) && meets(right, x)));
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb || this.blocked(a, b)) return false;
    const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra];
    this.parent[drop] = keep;
    const kept = this.members.get(keep) ?? new Set<number>();
    for (const i of this.members.get(drop) ?? []) kept.add(i);
    this.members.delete(drop);
    return true;
  }
}

function matchOverride(resolved: Resolved[], ref: OverrideRef): number[] {
  const url = normalizeUrl(ref.url);
  return resolved.filter((r) => r.entry.source === ref.source && normalizeUrl(r.entry.url) === url).map((r) => r.index);
}

function group(resolved: Resolved[], input: IdentityInput): Grouping {
  const overrides: IdentityResult["overrides"] = [];
  const apart: [Set<number>, Set<number>][] = [];
  const refs = (indexes: number[]): EntryRef[] => indexes.map((i) => resolved[i]?.ref).filter((r): r is EntryRef => r !== undefined);
  for (const pair of input.overrides.different) {
    const a = matchOverride(resolved, pair.a);
    const b = matchOverride(resolved, pair.b);
    overrides.push({ kind: "different", pair, matched: a.length > 0 && b.length > 0, entries: refs([...a, ...b]) });
    if (a.length && b.length) apart.push([new Set(a), new Set(b)]);
  }
  const uf = new Groups(resolved.length, apart);
  const joins: { a: number; b: number; identifier: string }[] = [];
  const join = (a: number, b: number, identifier: string): void => {
    if (uf.union(a, b)) joins.push({ a, b, identifier });
  };

  for (const pair of input.overrides.same) {
    const members = [...matchOverride(resolved, pair.a), ...matchOverride(resolved, pair.b)];
    const matched = matchOverride(resolved, pair.a).length > 0 && matchOverride(resolved, pair.b).length > 0;
    overrides.push({ kind: "same", pair, matched, entries: refs(members) });
    if (!matched) continue;
    const [first, ...rest] = members;
    for (const other of rest) if (first !== undefined) join(first, other, `override:same (${pair.reason})`);
  }

  const apps = resolved.filter((r) => r.entry.kind === "app");
  const forks: IdentityResult["forks"] = apps
    .filter((r) => r.forkOf && r.canonical)
    .map((r) => ({ entry: r.ref, repo: r.canonical?.key ?? "", forkOf: r.forkOf ?? "", packages: packagesOf(r) }));

  const byPackage = new Map<string, number[]>();
  for (const r of apps) for (const pkg of packagesOf(r)) byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), r.index]);
  for (const [pkg, members] of [...byPackage].sort(([a], [b]) => byText(a, b))) {
    const [first, ...rest] = members;
    for (const other of rest) if (first !== undefined) join(first, other, `package:${pkg}`);
  }

  const byRepo = new Map<string, Resolved[]>();
  for (const r of apps) if (r.canonical) byRepo.set(r.canonical.key, [...(byRepo.get(r.canonical.key) ?? []), r]);
  const multiPackageRepos: IdentityResult["multiPackageRepos"] = [];
  for (const [key, members] of [...byRepo].sort(([a], [b]) => byText(a, b))) {
    const fromIndex = indexPackagesFor(members.flatMap((m) => [m.canonical, m.linkedRepo]), input.fdroid, input.izzy);
    const packages = new Set([...fromIndex, ...members.flatMap(packagesOf)]);
    const shipped = new Set([...packages].map(baseOf));
    if (shipped.size > 1) {
      multiPackageRepos.push({ repo: key, packages: [...packages].sort(), entries: members.map((m) => m.ref) });
      continue;
    }
    const [first, ...rest] = members;
    for (const other of rest) if (first) join(first.index, other.index, `repo:${key}`);
  }

  const byRoot = new Map<number, Resolved[]>();
  for (const r of resolved) byRoot.set(uf.find(r.index), [...(byRoot.get(uf.find(r.index)) ?? []), r]);
  return {
    groups: [...byRoot.values()],
    merges: joins.map((j) => ({ ...j, root: uf.find(j.a) })),
    multiPackageRepos,
    forks,
    overrides,
  };
}

function firstNonNull<T>(...candidates: (Sourced<T> | null)[]): Sourced<T> | null {
  return candidates.find((c) => c !== null) ?? null;
}

function sourced<T>(value: T | null | undefined, origin: Sourced<T>["origin"]): Sourced<T> | null {
  return value === null || value === undefined || value === "" ? null : { value, origin };
}

function githubFacts(repo: GithubRepo | null, linked: RepoRef | null): GithubFacts | null {
  if (!repo || !linked?.slug) return null;
  return {
    stars: repo.stars,
    pushedAt: repo.pushedAt,
    archived: repo.archived,
    movedTo: repo.fullName.toLowerCase() === linked.slug.toLowerCase() ? null : repo.fullName,
    forkOf: repo.forkOf,
    release: repo.release ? { tag: repo.release.tag, publishedAt: repo.release.publishedAt, hasApk: repo.release.hasApk } : null,
  };
}

function repoOf(ref: RepoRef): Repo {
  return { host: ref.host, url: ref.url, slug: ref.slug };
}

interface Built {
  app: App;
  members: Resolved[];
  statements: AppStatements;
  /** Long description from the app's first index, for that origin's details shards. */
  description: { origin: "fdroid" | "izzy"; text: string } | null;
  iconSources: IndexRecord[];
  githubRepo: GithubRepo | null;
  candidate: IdCandidate;
}

function orderPackages(members: Resolved[]): string[] {
  const seen: string[] = [];
  for (const r of members) {
    const ordered = [...trustedChannels(r)]
      .filter((c) => c.variant === null && !r.stalePackages.includes(c.pkg))
      .sort((a, b) => CHANNEL_ORDER.indexOf(a.type) - CHANNEL_ORDER.indexOf(b.type));
    for (const c of ordered) if (!seen.includes(c.pkg)) seen.push(c.pkg);
  }
  for (const r of members) if (r.indexPackage && !seen.includes(r.indexPackage)) seen.push(r.indexPackage);
  const bare = seen.filter((p) => !variantOf(p) || !seen.includes(baseOf(p)));
  return [...bare, ...seen.filter((p) => !bare.includes(p))];
}

function buildApp(members: Resolved[], input: IdentityInput, categoryOrder: Map<string, number>): Built {
  const sorted = [...members].sort((a, b) => compareEntries(a.entry, b.entry, categoryOrder));
  const first = sorted[0];
  if (!first) throw new Error("empty app group");
  const isResource = sorted.every((r) => r.entry.kind === "resource");

  const packages = orderPackages(sorted);
  const fdroidPkg = packages.find((p) => input.fdroid.packages.has(p));
  const izzyPkg = packages.find((p) => input.izzy.packages.has(p));
  const f = fdroidPkg ? (input.fdroid.packages.get(fdroidPkg) ?? null) : null;
  const z = izzyPkg ? (input.izzy.packages.get(izzyPkg) ?? null) : null;

  const indexRepos = new Set(packages.map((p) => indexRepoOf(p, input)?.key).filter((k): k is string => k !== undefined));
  const withRepo =
    sorted.find((r) => r.canonical && indexRepos.has(r.canonical.key)) ??
    sorted.find((r) => r.canonical && !r.forkOf) ??
    sorted.find((r) => r.canonical);
  let repoRef = withRepo?.canonical ?? null;
  let githubLinked = withRepo?.linkedRepo ?? null;
  let githubRepo = withRepo?.github ?? null;
  if (!repoRef && !isResource) {
    const fromIndex = f?.sourceCode ?? z?.sourceCode ?? null;
    githubLinked = fromIndex ? parseRepo(fromIndex, true) : null;
    const result = githubLinked?.host === "github" && githubLinked.slug ? input.github.get(githubLinked.slug) : undefined;
    githubRepo = result && !("missing" in result) ? result : null;
    repoRef = canonicalRepo(githubLinked, githubRepo);
  }
  const github = githubFacts(githubRepo, githubLinked);

  const main = packages[0];
  const channels: Channel[] = [];
  const labelFor = (pkg: string): string | null => {
    if (pkg === main) return null;
    const variant = variantOf(pkg);
    return variant && packages.includes(variant.base) ? variant.label : null;
  };
  const addChannel = (type: Channel["type"], pkg: string, variant: string | null): void => {
    if (channels.some((c) => c.type === type && c.pkg === pkg)) return;
    const listed = type === "fdroid" ? input.fdroid.packages.has(pkg) : type === "izzy" ? input.izzy.packages.has(pkg) : null;
    channels.push({ type, pkg, variant, listed });
  };
  for (const r of sorted) for (const c of trustedChannels(r)) if (c.variant === null) addChannel(c.type, c.pkg, labelFor(c.pkg));
  for (const pkg of packages) {
    if (input.fdroid.packages.has(pkg)) addChannel("fdroid", pkg, labelFor(pkg));
    if (input.izzy.packages.has(pkg)) addChannel("izzy", pkg, labelFor(pkg));
  }
  for (const r of sorted) for (const c of trustedChannels(r)) if (c.variant !== null) addChannel(c.type, c.pkg, c.variant);
  const rank = (c: Channel): number => (c.variant === null ? 0 : 1);
  channels.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (packages.indexOf(a.pkg) === -1 ? 999 : packages.indexOf(a.pkg)) - (packages.indexOf(b.pkg) === -1 ? 999 : packages.indexOf(b.pkg)) ||
      CHANNEL_ORDER.indexOf(a.type) - CHANNEL_ORDER.indexOf(b.type) ||
      byText(a.pkg, b.pkg),
  );

  const repoUrl = repoRef ? normalizeUrl(repoRef.url) : null;
  const isElsewhere = (url: string | null): url is string =>
    url !== null && normalizeUrl(url) !== repoUrl && !parseRepo(url) && !parseStoreLink(url);
  const listingSite = sorted.map((r) => r.entry.url).find(isElsewhere) ?? null;
  const website = [f?.webSite ?? null, z?.webSite ?? null, listingSite, httpUrl(githubRepo?.homepage)].find(isElsewhere) ?? null;

  const categoryNames = new Map(input.categories.map((c) => [c.id, c.name]));
  const categoryName = (id: string): string | undefined => categoryNames.get(id);
  const listings: Listing[] = sorted.map((r) => ({
    source: r.entry.source,
    category: r.entry.category,
    kind: r.entry.kind,
    order: r.entry.order,
    name: r.entry.name,
    url: r.entry.url,
    description: r.entry.description,
    tags: [...r.entry.tags],
    license: r.entry.license,
    added: r.entry.added,
    parent: null,
    extraLinks: r.entry.extraLinks.map((l) => ({ name: l.name, url: l.url })),
  }));

  const githubLicense = githubRepo?.license && !/^(NOASSERTION|OTHER)$/.test(githubRepo.license) ? githubRepo.license : null;
  const indexStatement = (record: IndexRecord | null): IndexStatement | null =>
    record ? { facts: record.facts, summary: record.summary, license: record.license, downloads: null } : null;
  const statements: AppStatements = {
    listings,
    fdroid: indexStatement(f),
    izzy: indexStatement(z),
    github: github && githubRepo ? { facts: github, description: githubRepo.description, license: githubLicense, downloads: githubFigure(githubRepo.release, input.github.fetchedAt) } : null,
    packages,
    repoSlug: repoRef?.slug ?? null,
    categoryName,
  };
  const summary = deriveSummary(statements);
  const index = deriveIndex(statements);
  const primaryIndex = index[0]?.origin === "fdroid" ? f : index[0]?.origin === "izzy" ? z : null;
  const description = primaryIndex?.description ? { origin: primaryIndex.origin, text: truncate(primaryIndex.description, DESCRIPTION_LIMIT) ?? "" } : null;

  const facetInput = {
    listings,
    channels,
    index,
    github,
    licenses: [sourced(f?.license, "fdroid"), sourced(z?.license, "izzy"), sourced(githubLicense, "github")].filter(
      (l): l is Sourced<string> => l !== null,
    ),
  };
  const evidence = computeEvidence(facetInput);

  const app: App = {
    id: "",
    name: deriveName(statements),
    category: "",
    region: "",
    listings,
    packages,
    repo: repoRef ? repoOf(repoRef) : null,
    website,
    channels,
    summary,
    icon: null,
    iconLarge: null,
    license: deriveLicense(statements),
    licenses: deriveLicenses(statements),
    index,
    github,
    downloads: deriveDownloads(statements),
    repoMissing: sorted.some((r) => r.githubMissing),
    facets: computeFacets(facetInput, evidence),
    evidence,
    search: "",
  };

  const keys = keysOf(app);
  const firstListing = listings[0] ?? { source: first.entry.source, name: first.entry.name };
  const candidate: IdCandidate = {
    keys,
    base: github?.forkOf ? baseId([], keys.repo, firstListing) : baseId(packages, keys.repo, firstListing),
    uniqueKey: `${first.entry.source} ${first.entry.category} ${normalizeUrl(first.entry.url)} ${first.entry.name}`,
  };
  return { app, members: sorted, statements, description, iconSources: [f, z].filter((r): r is IndexRecord => r !== null && r !== undefined && r.iconUrl !== null), githubRepo: github ? githubRepo : null, candidate };
}

/** Lower-cased name without punctuation and common suffixes, for spotting near-equal names. */
export function nameKey(name: string): string {
  return slug(name)
    .replace(/-(app|android|for-android|mobile|client)$/g, "")
    .replace(/-/g, "");
}

function nonMerges(built: Built[]): NonMergeRecord[] {
  const byKey = new Map<string, { app: string; ref: EntryRef; exact: string }[]>();
  for (const { app, members } of built) {
    for (const m of members) {
      const key = nameKey(m.entry.name);
      if (key) byKey.set(key, [...(byKey.get(key) ?? []), { app: app.id, ref: m.ref, exact: m.entry.name.trim().toLowerCase() }]);
    }
  }
  const records: NonMergeRecord[] = [];
  for (const [, items] of [...byKey].sort(([a], [b]) => byText(a, b))) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        if (!a || !b || a.app === b.app) continue;
        records.push({ a: { ...a.ref, app: a.app }, b: { ...b.ref, app: b.app }, similarity: a.exact === b.exact ? "equal" : "near" });
      }
    }
  }
  return records;
}

export function identify(input: IdentityInput): IdentityResult {
  const categoryOrder = new Map(input.categories.map((c) => [c.id, c.order]));
  const resolved = resolveEntries(input);
  const grouping = group(resolved, input);

  const built = grouping.groups.map((members) => buildApp(members, input, categoryOrder));
  const ids = assignIds(
    built.map((b) => b.candidate),
    input.previous,
  );
  built.forEach((b, i) => {
    b.app.id = ids.ids[i] ?? "";
  });
  const filing = fileApps(built, input);

  const appOfEntry = new Map<number, string>();
  for (const b of built) for (const m of b.members) appOfEntry.set(m.index, b.app.id);
  const offsets = new Map<SourceId, number>();
  input.entries.forEach((entry, i) => {
    if (!offsets.has(entry.source)) offsets.set(entry.source, i);
  });
  const selfParents: EntryRef[] = [];
  for (const b of built) {
    b.members.forEach((m, i) => {
      const listing = b.app.listings[i];
      if (!listing || m.entry.parent === null) return;
      const parentApp = appOfEntry.get((offsets.get(m.entry.source) ?? 0) + m.entry.parent) ?? null;
      if (parentApp === b.app.id) selfParents.push(m.ref);
      else listing.parent = parentApp;
    });
  }

  const merges: MergeRecord[] = grouping.merges.map((j) => {
    const members = built.find((b) => b.members.some((m) => m.index === j.a));
    const a = resolved[j.a];
    const b = resolved[j.b];
    return {
      app: members?.app.id ?? "",
      identifier: j.identifier,
      crossSource: a?.entry.source !== b?.entry.source,
      entries: [a?.ref, b?.ref].filter((r): r is EntryRef => r !== undefined),
    };
  });

  const verifications: IdentityResult["verifications"] = [];
  for (const r of resolved) {
    for (const pkg of r.storePackages) verifications.push({ entry: r.ref, pkg, via: "store-link" });
    if (r.indexPackage) verifications.push({ entry: r.ref, pkg: r.indexPackage, via: r.indexMatch ?? "index-source-code" });
  }

  const sortedBuilt = [...built].sort((a, b) => byText(a.app.id, b.app.id));
  const details: IdentityResult["details"] = { fdroid: {}, izzy: {} };
  const iconSources = new Map<string, IndexRecord[]>();
  const statements = new Map<string, AppStatements>();
  const githubRepos = new Map<string, GithubRepo>();
  for (const b of sortedBuilt) {
    if (b.githubRepo) githubRepos.set(b.app.id, b.githubRepo);
    if (b.description) details[b.description.origin][b.app.id] = b.description.text;
    if (b.iconSources.length) iconSources.set(b.app.id, b.iconSources);
    statements.set(b.app.id, b.statements);
  }

  return {
    apps: sortedBuilt.map((b) => b.app),
    statements,
    details,
    redirects: ids.redirects,
    ids,
    merges: merges.sort((a, b) => byText(a.app, b.app) || byText(a.identifier, b.identifier)),
    nonMerges: nonMerges(sortedBuilt),
    verifications,
    indexMatches: resolved.flatMap((r) => r.indexCandidates),
    packageOverrides: packageOverrideHits(input).map(({ override, entries }) => ({ override, entries: entries.map((i) => refOf(input.entries[i] as SourceEntry)) })),
    multiPackageRepos: grouping.multiPackageRepos,
    forks: grouping.forks,
    overrides: grouping.overrides,
    stalePackages: resolved.flatMap((r) => r.stalePackages.map((pkg) => ({ entry: r.ref, pkg }))),
    selfParents,
    rejectedLinks: resolved.flatMap((r) => r.rejected.map((x) => ({ entry: r.ref, pkg: x.pkg, entryRepo: r.canonical?.key ?? "", indexRepo: x.indexRepo }))),
    iconSources,
    githubRepos,
    filing,
  };
}

/**
 * Files each app under its one Droid Atlas category (`resolveCategory`), once
 * its id is known, and completes the fields that follow from it: the region
 * and the search text, which carries the category's name.
 */
function fileApps(built: readonly Built[], input: IdentityInput): Map<string, Resolution> {
  const mappings = mappingsOf(input.categories);
  const placements = input.placements ?? new Map<string, Placement>();
  const filing = new Map<string, Resolution>();
  for (const b of built) {
    const assignment = resolveCategory(b.app.id, b.app.listings.map((l) => l.category), mappings, placements);
    const category = categoryById(assignment.category);
    b.app.category = assignment.category;
    b.app.region = category?.region ?? "";
    b.app.search = deriveSearch(b.statements, b.app.summary, category ? categoryAnswers(category, input.categories) : []);
    filing.set(b.app.id, assignment.how);
  }
  return filing;
}
