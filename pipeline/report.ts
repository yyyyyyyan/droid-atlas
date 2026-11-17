/**
 * The build report: `report.json` for machines and `report.md` for the
 * coordinator's review. Written whether or not validation passed. Unlike the
 * catalog it carries timings, so it is not byte-identical between runs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DOWNLOAD_MEANING, type Anomaly, type Catalog } from "../schema/catalog.ts";
import { figuresAgeDays, STALE_FIGURES_DAYS } from "./enrich/downloads.ts";
import type { EmitResult } from "./emit.ts";
import { ICON_RULES, ruleText, type IconReport } from "./icons.ts";
import type { EntryRef, IdentityResult } from "./identity.ts";
import type { LooseNote, SkippedSection } from "./sources/types.ts";
import { describeTaxonomy, type Placement, type Resolution, type TaxonomyDescription } from "./taxonomy.ts";
import type { ValidationResult } from "./validate.ts";
import { coverage } from "./validate.ts";

export interface SourceReport {
  id: string;
  lines: number;
  entries: number;
  resources: number;
  categories: number;
  anomalies: Anomaly[];
  skipped: SkippedSection[];
  notes: LooseNote[];
  unknownTokens: { token: string; count: number }[];
}

export interface BuildReport {
  generatedAt: string;
  offline: boolean;
  ok: boolean;
  previous: string | null;
  projectUrl: string;
  validation: ValidationResult;
  catalog: Catalog;
  emitted: EmitResult | null;
  sources: SourceReport[];
  identity: IdentityResult;
  taxonomy: TaxonomyDescription;
  icons: IconReport;
  licenses: { shipped: string[]; missing: string[]; list: string };
  github: { fetched: boolean; fetchedAt: string; unresolved: string[]; queried: number };
  indexes: { fdroid: { at: string; packages: number }; izzy: { at: string; packages: number } };
  timings: Record<string, number>;
}

function ref(r: EntryRef): string {
  return `${r.source} ${r.file}:${r.line} “${r.name}”`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function percent(part: number, whole: number): string {
  return `${whole ? Math.round((1000 * part) / whole) / 10 : 0}%`;
}

function table(head: string[], rows: string[][]): string {
  if (!rows.length) return "_None._\n";
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n") + "\n";
}

function counts(catalog: Catalog): string[][] {
  const apps = catalog.apps;
  const n = (test: (app: Catalog["apps"][number]) => boolean): string => String(apps.filter(test).length);
  return [
    ["Apps (records)", String(apps.length)],
    ["…of which only resources", n((a) => a.listings.every((l) => l.kind === "resource"))],
    ["…listed by both sources", n((a) => new Set(a.listings.map((l) => l.source)).size > 1)],
    ["With a verified package id", n((a) => a.packages.length > 0)],
    ["With index facts (F-Droid or IzzyOnDroid)", n((a) => a.index.length > 0)],
    ["With GitHub facts", n((a) => a.github !== null)],
    ["With a summary", n((a) => a.summary !== null)],
    ["With a self-hosted icon", n((a) => a.icon !== null)],
    ["Shizuku (declared or listed)", n((a) => a.facets.shizuku)],
    ["Shizuku declared in a manifest", n((a) => a.evidence.shizuku.some((o) => o === "fdroid" || o === "izzy"))],
    ["No internet permission", n((a) => a.facets.noInternet === true)],
    ["APK on GitHub releases", n((a) => a.facets.apkOnGithub === true)],
    ["On F-Droid / on IzzyOnDroid", `${n((a) => a.facets.onFdroid)} / ${n((a) => a.facets.onIzzy)}`],
    ["Open source / source-available / closed / unknown", ["open-source", "source-available", "closed-source", null].map((o) => n((a) => a.facets.openness === o)).join(" / ")],
    ["Paid or trial", n((a) => a.facets.paid)],
    ["Archived", n((a) => a.facets.archived === true)],
    ["Forks", n((a) => a.facets.fork)],
    ["Stale store link", n((a) => a.facets.staleLink)],
    ["Repository missing on GitHub", n((a) => a.repoMissing)],
    ["Redirects", String(Object.keys(catalog.redirects).length)],
  ];
}

export function renderMarkdown(report: BuildReport): string {
  const { catalog, identity, validation } = report;
  const out: string[] = [];
  out.push(`# Catalog build report\n`);
  out.push(`- Result: **${report.ok ? "passed, written" : "FAILED, nothing written"}**`);
  out.push(`- Generated: ${report.generatedAt}${report.offline ? " (offline, from cache)" : ""}`);
  out.push(`- Catalog hash: \`${catalog.hash}\``);
  out.push(`- Previous build: ${report.previous ?? "none (bootstrap)"}`);
  out.push(`- Project URL in the atlas header: ${report.projectUrl}${report.projectUrl.includes(".invalid") ? " (**placeholder: pass --project-url once decided**)" : ""}`);
  out.push(`- License texts shipped (${report.licenses.list}): ${report.licenses.shipped.join(", ")}${report.licenses.missing.length ? `; **missing: ${report.licenses.missing.join(", ")}**` : ""}`);
  out.push("");
  if (report.emitted) {
    const e = report.emitted;
    const startupRoles = new Set(["atlas", "source", "index", "github"]);
    const startup = e.manifest.files.filter((f) => startupRoles.has(f.role)).map((f) => [f.path, e.gzipBytes[f.path] ?? 0] as const);
    out.push(`Files loaded at start, gzip bytes (budget for the joined catalog: 450 kB): total ${startup.reduce((n, [, b]) => n + b, 0)}\n`);
    out.push(table(["File", "gzip bytes"], startup.map(([path, bytes]) => [path, String(bytes)])));
    out.push(`Details: ${e.manifest.detailsShards} shards per origin, largest ${Math.max(0, ...e.shardGzipBytes)} bytes gzip (budget 40 000).\n`);
  }

  out.push(`## Validation\n`);
  if (validation.failures.length) out.push(validation.failures.map((f) => `- ${f}`).join("\n") + "\n");
  const shown = validation.checks.filter((c) => !c.passed || !c.gate.startsWith("category:"));
  out.push(table(["Gate", "Value", "Against", "Result", "Detail"], shown.map((c) => [c.gate, String(c.value), String(c.against ?? ""), c.passed ? "pass" : c.accepted ? "accepted (baseline)" : "FAIL", c.detail])));
  if (validation.baselineUsed.length) {
    out.push(`Accepted-baseline entries used:\n`);
    out.push(validation.baselineUsed.map((b) => `- \`${b.gate}\` = ${b.value} (${b.date}): ${b.reason}`).join("\n") + "\n");
  }

  out.push(`## Sources\n`);
  out.push(
    table(
      ["Source", "Commit", "Lines", "Entries", "Resources", "Categories", "Anomalies", "Skipped sections"],
      report.sources.map((s) => {
        const info = catalog.sources.find((x) => x.id === s.id);
        return [s.id, info ? `${info.commit.slice(0, 10)} (${info.committedAt})` : "", String(s.lines), String(s.entries), String(s.resources), String(s.categories), String(s.anomalies.length), String(s.skipped.length)];
      }),
    ),
  );
  out.push(`Enrichment: F-Droid index ${report.indexes.fdroid.at} (${report.indexes.fdroid.packages} packages), IzzyOnDroid ${report.indexes.izzy.at} (${report.indexes.izzy.packages}), GitHub ${report.github.fetched ? "fetched" : "from cache"} ${report.github.fetchedAt} (${report.github.queried} repositories, ${report.github.unresolved.length} unresolved).\n`);

  out.push(`## Counts and coverage\n`);
  out.push(table(["", "Count"], counts(catalog)));
  out.push(table(["Coverage of installable apps", "%"], Object.entries(coverage(catalog)).map(([k, v]) => [k, String(v)])));

  out.push(`## Anomalies\n`);
  for (const s of report.sources) {
    out.push(`### ${s.id}\n`);
    out.push(table(["Line", "Kind", "Text"], s.anomalies.map((a) => [String(a.line), a.kind, a.text])));
    if (s.unknownTokens.length) out.push(`Unrecognized tokens: ${s.unknownTokens.map((t) => `\`${t.token}\` ×${t.count}`).join(", ")}\n`);
  }

  out.push(`## Skipped sections and loose notes\n`);
  out.push(table(["Source", "Where", "Heading", "Items", "Why"], report.sources.flatMap((s) => s.skipped.map((k) => [s.id, `${k.file}:${k.line}`, k.heading, String(k.items), k.reason]))));
  out.push(table(["Source", "Where", "Note", "Placement"], report.sources.flatMap((s) => s.notes.map((n) => [s.id, `${n.file}:${n.line}`, n.text.slice(0, 160), n.placement]))));

  out.push(`## Merges (${identity.merges.length})\n`);
  out.push(`Every join of two entries into one app, with the identifier that justified it. Cross-source merges first.\n`);
  const merges = [...identity.merges].sort((a, b) => Number(b.crossSource) - Number(a.crossSource));
  out.push(table(["App", "Identifier", "Cross-source", "Entries"], merges.map((m) => [m.app, m.identifier, m.crossSource ? "yes" : "no", m.entries.map(ref).join(" + ")])));

  out.push(`## Not merged: equal or near-equal names (${identity.nonMerges.length})\n`);
  out.push(`Pairs that look alike but share no verified package id or single-app repository.\n`);
  out.push(table(["Similarity", "A", "App A", "B", "App B"], identity.nonMerges.map((n) => [n.similarity, ref(n.a), n.a.app, ref(n.b), n.b.app])));

  out.push(`## Multi-package repositories (never merged on) (${identity.multiPackageRepos.length})\n`);
  out.push(table(["Repository", "Packages", "Entries"], identity.multiPackageRepos.map((m) => [m.repo, m.packages.join(", "), m.entries.map(ref).join(" + ")])));

  out.push(`## Entries that link a fork (${identity.forks.length})\n`);
  out.push(`Labeled as forks and never merged with the repository they were forked from, even when they share its package id.\n`);
  out.push(table(["Entry", "Repository", "Fork of", "Packages"], identity.forks.map((f) => [ref(f.entry), f.repo, f.forkOf, f.packages.join(", ")])));

  out.push(`## Store links not trusted (${identity.rejectedLinks.length})\n`);
  out.push(`The entry links a store page whose index names a different repository on the same forge (after renames, not a fork). The package does not identify the entry and its channel is not offered.\n`);
  out.push(table(["Entry", "Package", "Entry's repository", "Index's repository"], identity.rejectedLinks.map((r) => [ref(r.entry), r.pkg, r.entryRepo, r.indexRepo])));

  out.push(`## Identity overrides (${identity.overrides.length})\n`);
  out.push(`From pipeline/identity-overrides.json; each overrides every other rule. An override that matches no entry is stale and should be removed.\n`);
  out.push(
    table(
      ["Kind", "A", "B", "Reason", "Date", "Matched entries"],
      identity.overrides.map((o) => [o.kind, `${o.pair.a.source} ${o.pair.a.url}`, `${o.pair.b.source} ${o.pair.b.url}`, o.pair.reason, o.pair.date, o.matched ? o.entries.map(ref).join(" + ") : "**none (stale)**"]),
    ),
  );
  out.push(`### Package overrides (${identity.packageOverrides.length})\n`);
  out.push("An entry declared to be an index's package. One that names no entry, or more than one (add the category), is not applied.\n");
  out.push(
    table(
      ["Entry", "Package", "Reason", "Date", "Matched entries"],
      identity.packageOverrides.map(({ override: o, entries }) => [`${o.entry.source} ${o.entry.url}${o.entry.category ? ` (${o.entry.category})` : ""}`, o.pkg, o.reason, o.date, entries.length === 1 ? entries.map(ref).join("") : entries.length ? `**${entries.length} entries: not applied**` : "**none (stale)**"]),
    ),
  );

  const matches = identity.indexMatches;
  out.push(`## Index matches for entries without a store link (${matches.filter((m) => m.applied).length} applied, ${matches.filter((m) => !m.applied).length} set aside)\n`);
  out.push("Rule 9 and package overrides: what each index states that ties an entry with no store link and no known repository to one of its packages. Review every applied row; a set-aside row is a candidate an override could confirm.\n");
  out.push(
    table(
      ["Entry", "Package", "Index name", "Rule", "Evidence", "Applied"],
      matches.map((m) => [ref(m.entry), m.pkg, m.indexName ?? "", m.rule, m.evidence, m.applied ? "yes" : `no: ${m.note ?? ""}`]),
    ),
  );

  out.push(`## Package ids no index carries (${identity.stalePackages.length})\n`);
  out.push(`Linked by a source but in neither index: kept as a stale channel, not used as an identifier.\n`);
  out.push(table(["Entry", "Package"], identity.stalePackages.map((s) => [ref(s.entry), s.pkg])));

  if (identity.selfParents.length) {
    out.push(`## Nested entries that are the same app as their parent\n`);
    out.push(identity.selfParents.map((r) => `- ${ref(r)}`).join("\n") + "\n");
  }

  out.push(`## Ids\n`);
  out.push(`${identity.ids.created.length} new, ${identity.ids.retired.length} retired, ${identity.ids.matches.length} carried forward.\n`);
  if (identity.ids.retired.length) out.push(table(["Retired id", "Redirects to"], identity.ids.retired.map((id) => [id, catalog.redirects[id] ?? "null"])));

  out.push(...renderTaxonomy(catalog, report.taxonomy));

  out.push(`## Stale links\n`);
  const stale = catalog.apps.filter((a) => a.facets.staleLink || a.repoMissing);
  out.push(table(["App", "What"], stale.map((a) => [a.id, [...a.channels.filter((c) => c.listed === false).map((c) => `${c.type} ${c.pkg} not in index`), ...(a.repoMissing ? ["GitHub repository missing"] : [])].join("; ")])));

  const installableApps = catalog.apps.filter((a) => a.listings.some((l) => l.kind === "app"));
  out.push(`## Download statistics\n`);
  out.push("Each origin counts something different over its own period; figures from two origins are never added or compared. An app with no figure from an origin is one the origin publishes nothing for.\n");
  out.push(
    table(
      ["Origin", "Apps with a figure", "Of apps it could cover", "Period", "Newest figures", "Publisher", "What it counts"],
      (["fdroid", "izzy", "github"] as const).map((origin) => {
        const stats = installableApps.flatMap((a) => a.downloads.filter((d) => d.origin === origin));
        const eligible = installableApps.filter((a) => (origin === "github" ? a.github?.release?.hasApk === true : a.index.some((f) => f.origin === origin))).length;
        const froms = stats.map((d) => d.from).filter((d): d is string => d !== null).sort();
        const tos = stats.map((d) => d.to).filter((d): d is string => d !== null).sort();
        const source = catalog.enrichment.downloads.find((d) => d.origin === origin);
        return [
          origin,
          String(stats.length),
          `${eligible} (${percent(stats.length, eligible)})`,
          froms.length ? (froms[0] === froms.at(-1) && tos[0] === tos.at(-1) ? `${froms[0]} to ${tos[0]}` : `from ${froms[0]}–${froms.at(-1)} to ${tos[0]}–${tos.at(-1)}`) : "none",
          source?.newest ? `${source.newest}, ${figuresAgeDays(source, catalog.generatedAt)} days before this build` : source ? "running totals" : "none",
          source ? `${source.name}, retrieved ${source.retrieved.slice(0, 10)}` : "no figures this build",
          DOWNLOAD_MEANING[origin],
        ];
      }),
    ),
  );
  const staleFigures = catalog.enrichment.downloads.filter((source) => (figuresAgeDays(source, catalog.generatedAt) ?? 0) > STALE_FIGURES_DAYS);
  for (const source of staleFigures) {
    out.push(`**Stale:** ${source.name}'s newest figures end on ${source.newest}, ${figuresAgeDays(source, catalog.generatedAt)} days before this build (more than ${STALE_FIGURES_DAYS}). The publisher is reachable but has published nothing newer; the figures ship with their dates.\n`);
  }

  out.push(`## Icons\n`);
  const icons = report.icons;
  const installable = installableApps;
  const resources = catalog.apps.length - installable.length;
  const withIcon = installable.filter((a) => a.icon !== null).length;
  const resourcesWithIcon = catalog.apps.filter((a) => a.icon !== null).length - withIcon;
  out.push(`${icons.enabled ? "" : "Icons disabled for this build. "}${withIcon} of ${installable.length} apps have an icon (${percent(withIcon, installable.length)}), and ${resourcesWithIcon} of ${resources} guides and links. ${icons.kept.length} kept from the previous build because this run could not look them up; ${icons.denied.length} denied; ${icons.rejected.length} candidates refused by a gate; ${icons.failed.length} downloads failed.\n`);
  out.push(table(["Source rule", "Icons"], ICON_RULES.map((rule) => [`\`${rule}\`: ${ruleText(rule)}`, String(icons.byRule[rule])])));
  const d = icons.discovery;
  out.push(`Discovery: ${d.due} apps due (new ${d.byReason.new}, changed ${d.byReason.changed}, looked up under older rules ${d.byReason.rules}, misses past their back-off ${d.byReason.miss}, rotation ${d.byReason.rotation}); ${d.looked} looked up, ${d.deferred} left for a later run, ${d.errors.length} failed. Requests: ${d.requests.githubApi} to the GitHub API, ${d.requests.web} others${d.rateLimited.length ? `; rate-limited by ${d.rateLimited.join(", ")}` : ""}.\n`);
  if (icons.denied.length) out.push(table(["Denied app", "Reason"], icons.denied.map((x) => [x.app, x.reason])));
  if (icons.kept.length) out.push(table(["Kept from the previous build", "Rule"], icons.kept.map((x) => [x.app, x.rule])));
  out.push(`### Without an icon\n`);
  out.push(table(["App", "Name", "Why"], icons.missing.map((m) => [m.app, m.name, m.reason])));
  const reasons = new Map<string, number>();
  for (const r of icons.rejected) {
    const key = `${r.rule}: ${r.reason.replace(/\d+ × \d+ px/, "N × M px")}`;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  if (reasons.size) out.push(table(["Refused candidates", "Count"], [...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => [r, String(n)])));
  if (icons.failed.length) out.push(table(["App", "URL", "Error"], icons.failed.map((f) => [f.app, f.url, f.error])));
  if (d.errors.length) out.push(table(["App", "Lookup error"], d.errors.map((e) => [e.app, e.error])));
  if (icons.reduced.length) out.push(table(["App", "Size", "WebP quality"], icons.reduced.map((r) => [r.app, `${r.size} px`, String(r.quality)])));

  out.push(`## Timings\n`);
  out.push(table(["Stage", "ms"], Object.entries(report.timings).map(([k, v]) => [k, String(v)])));
  return out.join("\n");
}

export function regionCounts(catalog: Catalog): { id: string; name: string; apps: number; share: number }[] {
  return catalog.regions.map((region) => {
    const apps = catalog.apps.filter((a) => a.region === region.id).length;
    return { id: region.id, name: region.name, apps, share: Math.round((1000 * apps) / Math.max(1, catalog.apps.length)) / 10 };
  });
}

export function taxonomyReport(catalog: Catalog, filing: ReadonlyMap<string, Resolution>, placements: ReadonlyMap<string, Placement>): TaxonomyDescription {
  return describeTaxonomy(catalog, filing, placements);
}

/** The taxonomy sections of report.md: regions, the category table, the mapping, and what waits for a person. */
function renderTaxonomy(catalog: Catalog, taxonomy: TaxonomyDescription): string[] {
  const out: string[] = [];
  const nameOf = new Map(taxonomy.categories.map((c) => [c.id, c.name]));
  out.push(`## Regions\n`);
  out.push(`Apps by the region of their category. No region should hold more than about a sixth of the apps (${Math.round(catalog.apps.length / 6)}).\n`);
  out.push(table(["Region", "Apps", "Share"], regionCounts(catalog).map((r) => [`${r.name} (\`${r.id}\`)`, String(r.apps), `${r.share}%${r.apps > catalog.apps.length / 6 ? " **over a sixth**" : ""}`])));

  out.push(`## Categories (${taxonomy.categories.length})\n`);
  out.push(`Droid Atlas's own categories (\`pipeline/taxonomy.ts\`), each app in exactly one. A remainder holds its region's apps that nobody has placed.\n`);
  out.push(
    table(
      ["Region", "Category", "Apps", "Takes in"],
      taxonomy.categories.map((c) => [c.region, `${c.name} (\`${c.id}\`)${c.remainder ? " · remainder" : ""}`, String(c.apps), c.takesIn.join(", ")]),
    ),
  );

  out.push(`## Category mapping (${taxonomy.mapping.length})\n`);
  out.push(`Every upstream category: the category it maps into, or a catch-all whose apps are placed one by one.\n`);
  out.push(
    table(
      ["Upstream category", "Section", "Maps to", "Listings"],
      taxonomy.mapping.map((m) => [
        `${m.name} (\`${m.sourceCategory}\`)`,
        m.section ?? "",
        m.kind === "catch-all" ? `catch-all, waits in ${m.home}` : m.kind === "fallback" ? `**fallback** → ${nameOf.get(m.category ?? "") ?? m.category}` : (nameOf.get(m.category ?? "") ?? String(m.category)),
        String(m.listings),
      ]),
    ),
  );

  out.push(`## Unmapped upstream categories (${taxonomy.fallbacks.length})\n`);
  out.push(`Not in the table: their apps went to a remainder. Add each to \`MAPPING\`.\n`);
  out.push(table(["Upstream category", "Went to"], taxonomy.fallbacks.map((f) => [`${f.name} (\`${f.sourceCategory}\`)`, nameOf.get(f.category) ?? f.category])));

  out.push(`## Awaiting placement (${taxonomy.awaiting.length})\n`);
  out.push(`Apps whose every listing is in a catch-all and that \`pipeline/placements.json\` does not place.\n`);
  out.push(table(["App", "Waits in", "Upstream categories"], taxonomy.awaiting.map((a) => [`${cell(a.name)} (\`${a.app}\`)`, nameOf.get(a.category) ?? a.category, a.sourceCategories.join(", ")])));

  out.push(`## Stale placements (${taxonomy.stale.length})\n`);
  out.push(`Placements whose app is no longer in the catalog. Remove them from \`pipeline/placements.json\`.\n`);
  out.push(table(["App id", "Category"], taxonomy.stale.map((s) => [s.app, nameOf.get(s.category) ?? s.category])));

  out.push(`## Placements (${taxonomy.placements.length})\n`);
  out.push(
    table(
      ["App", "Category", "Reason"],
      taxonomy.placements.map((p) => [`${cell(p.name ?? "(gone)")} (\`${p.app}\`)`, nameOf.get(p.category) ?? p.category, cell(p.reason)]),
    ),
  );
  return out;
}

export function writeReport(outDir: string, report: BuildReport): void {
  mkdirSync(outDir, { recursive: true });
  const { catalog, identity, ...rest } = report;
  const json = {
    ...rest,
    catalog: {
      hash: catalog.hash,
      apps: catalog.apps.length,
      categories: catalog.categories.length,
      redirects: Object.keys(catalog.redirects).length,
      coverage: coverage(catalog),
      regions: regionCounts(catalog),
    },
    identity: {
      merges: identity.merges,
      nonMerges: identity.nonMerges,
      multiPackageRepos: identity.multiPackageRepos,
      forks: identity.forks,
      selfParents: identity.selfParents,
      rejectedLinks: identity.rejectedLinks,
      overrides: identity.overrides,
      stalePackages: identity.stalePackages,
      verifications: identity.verifications,
      indexMatches: identity.indexMatches,
      packageOverrides: identity.packageOverrides,
      ids: identity.ids,
    },
  };
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(join(outDir, "report.md"), renderMarkdown(report));
}
