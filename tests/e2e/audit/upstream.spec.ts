/**
 * M2: does the pipeline carry the upstream lists exactly? Each list snapshot
 * the build ships is read with audit/upstream.ts (not the pipeline's parser),
 * and every entry is held against its listing in the source part: name, link,
 * category, tags, description, license, nesting, and the store links behind
 * channels. A nested entry keeps a link to the app above it, unless both are
 * one app: the build then reports the entry, and this reading has to agree.
 * A seeded sample of 40 per catalog is listed in the results for the audit;
 * the same checks are then run on every entry.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loadBuild, sample, type Listing } from "../lib/catalog.ts";
import { SEED } from "./audit-config.ts";
import { normaliseUrl, readUpstream, type UpstreamEntry } from "./upstream.ts";

const build = loadBuild();
const upstream = readUpstream(build);
const reportPath = join(build.dataRoot, "report.json");
const report = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8")) as {
    sources: { id: string; entries: number; categories: number }[];
    identity?: {
      rejectedLinks: { entry: { source: string; line: number }; pkg: string }[];
      selfParents?: { source: string; file: string; line: number }[];
    };
  }
  : null;
/** Store links identity rule 5 deliberately does not offer (ARCHITECTURE.md § Identity), as "source:line:package". */
const REJECTED = new Set((report?.identity?.rejectedLinks ?? []).map((r) => `${r.entry.source}:${r.entry.line}:${r.pkg}`));
/** Nested entries the build reports as the same app as the entry above them, as "source:file:line". A listing is never its own parent, so the build drops that link. */
const SELF_PARENTS = new Set((report?.identity?.selfParents ?? []).map((r) => `${r.source}:${r.file}:${r.line}`));

/** The entry each nested entry sits under: the last one before it, in its file and category, that is not nested. */
function entriesAbove(entries: UpstreamEntry[]): Map<UpstreamEntry, UpstreamEntry> {
  const above = new Map<UpstreamEntry, UpstreamEntry>();
  let top: UpstreamEntry | null = null;
  for (const entry of entries) {
    if (!entry.nested) top = entry;
    else if (top && top.file === entry.file && top.section === entry.section && top.category === entry.category) above.set(entry, top);
  }
  return above;
}
const ABOVE = new Map([...entriesAbove(upstream.androidFoss), ...entriesAbove(upstream.awesomeShizuku)]);

function partOf(source: string) {
  const part = build.sources.find((s) => s.info.id === source);
  if (!part) throw new Error(`no source part for ${source}`);
  return part;
}

/** The listing an upstream entry became: same source, same name, same link (relative links made absolute), same category. */
function listingFor(entry: UpstreamEntry): (Listing & { app: string }) | string {
  const part = partOf(entry.source);
  const sameLink = (listing: Listing): boolean => /^https?:/i.test(entry.url)
    ? normaliseUrl(listing.url) === normaliseUrl(entry.url)
    : normaliseUrl(listing.url).endsWith(`/${entry.url.replace(/^\.?\//, "")}`);
  const candidates = part.listings.filter((listing) => listing.name === entry.name && sameLink(listing));
  const inCategory = candidates.filter((listing) => {
    const category = build.sourceCategories.get(listing.category);
    return category?.name === entry.category && (category.section ?? null) === entry.section;
  });
  if (inCategory.length === 1 && inCategory[0]) return inCategory[0];
  if (candidates.length === 0) return `no listing named “${entry.name}” with link ${entry.url}`;
  return `${candidates.length} listings named “${entry.name}” with that link, ${inCategory.length} in category “${entry.section ?? ""} › ${entry.category}” (found: ${candidates.map((c) => c.category).join(", ")})`;
}

function storePackage(url: string | null): string | null {
  if (!url) return null;
  return /f-droid\.org\/(?:[a-z-]+\/)?packages\/([^/?#]+)/.exec(url)?.[1]
    ?? /apt\.izzysoft\.de\/(?:fdroid\/index\/apk|packages)\/([^/?#]+)/.exec(url)?.[1]
    ?? null;
}

/** Every difference between one upstream entry and what the build made of it, as "field: upstream ≠ build". */
function differences(entry: UpstreamEntry): string[] {
  const listing = listingFor(entry);
  const where = `${entry.source} ${entry.file}:${entry.line} “${entry.name}”`;
  if (typeof listing === "string") return [`${where}: ${listing}`];
  const out: string[] = [];
  const sortedTags = (tags: string[]): string => [...new Set(tags)].sort().join(",");
  if (sortedTags(listing.tags) !== sortedTags(entry.tags)) out.push(`${where}: tags ${sortedTags(entry.tags) || "(none)"} ≠ ${sortedTags(listing.tags) || "(none)"}`);
  if (entry.source === "awesome-shizuku") {
    if ((listing.description ?? null) !== entry.description) out.push(`${where}: description “${entry.description}” ≠ “${listing.description}”`);
    if ((listing.license ?? null) !== entry.license) out.push(`${where}: license “${entry.license}” ≠ “${listing.license}”`);
  } else if (listing.description !== null) {
    out.push(`${where}: Android FOSS has no descriptions, the build has “${listing.description}”`);
  }
  const above = ABOVE.get(entry);
  const aboveListing = above ? listingFor(above) : null;
  const sameApp = aboveListing !== null && typeof aboveListing !== "string" && aboveListing.app === listing.app;
  const reported = SELF_PARENTS.has(`${entry.source}:${entry.file}:${entry.line}`);
  if (reported !== (entry.nested && sameApp)) out.push(`${where}: the report ${reported ? "lists" : "does not list"} it as the same app as the entry above it, and it ${sameApp ? "is" : "is not"}`);
  const linked = entry.nested && !(reported && sameApp);
  if (linked !== (listing.parent !== null)) out.push(`${where}: nested ${entry.nested} but parent ${listing.parent}`);
  const app = build.byId.get(listing.app);
  if (!app) {
    out.push(`${where}: listing names app ${listing.app}, which the atlas does not have`);
    return out;
  }
  for (const [type, link] of [["fdroid", entry.fdroid], ["izzy", entry.izzy]] as const) {
    const pkg = storePackage(link);
    if (!pkg || REJECTED.has(`${entry.source}:${entry.line}:${pkg}`)) continue;
    const offered = app.atlas.channels.some((channel) => channel.type === type && channel.pkg === pkg)
      || app.atlas.channels.some((channel) => channel.pkg === pkg);
    if (!offered) out.push(`${where}: links ${type} package ${pkg}, app ${app.id} has channels ${app.atlas.channels.map((c) => `${c.type}:${c.pkg}`).join(" ") || "(none)"}`);
  }
  return out;
}

for (const [source, entries] of [["android-foss", upstream.androidFoss], ["awesome-shizuku", upstream.awesomeShizuku]] as const) {
  test.describe(source, () => {
    test("entry count: snapshot = source part = build report", () => {
      expect(entries.length).toBeGreaterThan(0);
      const part = partOf(source);
      expect(part.listings.length, "listings in the part").toBe(entries.length);
      expect(part.info.entries, "SourceInfo.entries").toBe(entries.length);
      const reported = report?.sources.find((s) => s.id === source);
      if (reported) expect(reported.entries, "report.json sources[].entries").toBe(entries.length);
    });

    test("entries per category: snapshot = source part, and the category count matches the report", () => {
      const part = partOf(source);
      const mine = new Map<string, number>();
      for (const entry of entries) mine.set(`${entry.section ?? ""} › ${entry.category}`, (mine.get(`${entry.section ?? ""} › ${entry.category}`) ?? 0) + 1);
      const theirs = new Map<string, number>();
      for (const listing of part.listings) {
        const category = build.sourceCategories.get(listing.category);
        const key = `${category?.section ?? ""} › ${category?.name ?? listing.category}`;
        theirs.set(key, (theirs.get(key) ?? 0) + 1);
      }
      const keys = [...new Set([...mine.keys(), ...theirs.keys()])].sort();
      const diff = keys.filter((key) => mine.get(key) !== theirs.get(key)).map((key) => `${key}: snapshot ${mine.get(key) ?? 0}, build ${theirs.get(key) ?? 0}`);
      expect(diff).toEqual([]);
      const reported = report?.sources.find((s) => s.id === source);
      if (reported) expect(reported.categories, "report.json sources[].categories").toBe(mine.size);
      test.info().annotations.push({ type: "categories", description: `${mine.size} categories, ${entries.length} entries` });
    });

    test(`40 entries sampled with seed ${SEED} are carried exactly`, () => {
      const picked = sample(entries, 40, SEED);
      test.info().annotations.push({ type: "sample", description: picked.map((e) => `${e.file}:${e.line} ${e.name}`).join("; ") });
      expect(picked.flatMap(differences)).toEqual([]);
    });

    test("every entry is carried exactly", () => {
      expect(entries.flatMap(differences)).toEqual([]);
    });
  });
}
