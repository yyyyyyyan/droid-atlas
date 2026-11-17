/**
 * Writes docs/TAXONOMY.md from a built catalog and the taxonomy's own files,
 * so the owner's review page always matches the data: one table per region,
 * the placements grouped by target with their reasons, and what was left in
 * remainders.
 *
 *   node pipeline/scripts/taxonomy-doc.ts [--data app/public/data] [--out docs/TAXONOMY.md]
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Catalog } from "../../schema/catalog.ts";
import { CATEGORIES, describeTaxonomy, loadPlacements, MAPPING, mappingsOf, REGIONS, resolveCategory, type CatchAll } from "../taxonomy.ts";
import { loadPrevious } from "../validate.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_NAMES: Record<string, string> = { "android-foss": "Android FOSS", "awesome-shizuku": "awesome-shizuku" };

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}

function upstreamName(catalog: Catalog, id: string): string {
  const category = catalog.sourceCategories.find((c) => c.id === id);
  if (!category) return id;
  const section = category.section && category.section !== "Apps" ? `${category.section} › ` : "";
  return `${SOURCE_NAMES[category.source] ?? category.source}: ${section}${category.name}`;
}

export function render(catalog: Catalog, placementsPath: string): string {
  const placements = loadPlacements(placementsPath);
  const mappings = mappingsOf(catalog.sourceCategories);
  const filing = new Map(catalog.apps.map((app) => [app.id, resolveCategory(app.id, app.listings.map((l) => l.category), mappings, placements).how]));
  const taxonomy = describeTaxonomy(catalog, filing, placements);
  const counts = new Map(taxonomy.categories.map((c) => [c.id, c]));
  const nameOf = new Map(CATEGORIES.map((c) => [c.id, c.name]));
  const appName = new Map(catalog.apps.map((a) => [a.id, a.name]));
  const catchAlls = Object.entries(MAPPING).filter((e): e is [string, CatchAll] => typeof e[1] !== "string");
  const placedCount = taxonomy.placements.filter((p) => appName.has(p.app)).length;
  const listings = (id: string): number => taxonomy.mapping.find((m) => m.sourceCategory === id)?.listings ?? 0;
  const filled = taxonomy.categories.filter((c) => !c.remainder && c.apps > 0);
  const fewest = Math.min(...filled.map((c) => c.apps));
  const smallest = filled.filter((c) => c.apps === fewest).map((c) => nameOf.get(c.id) ?? c.id);
  const out: string[] = [];

  out.push(`# Taxonomy

Droid Atlas files every app in one category of its own, inside one of thirteen
regions. The sources' categories are what the sources say; they stay on each
listing and are shown in the app sheet as the source's wording. This page is
generated from the build by \`pipeline/scripts/taxonomy-doc.ts\`; the table
itself is \`pipeline/taxonomy.ts\` and the placements are
\`pipeline/placements.json\`. Build of ${catalog.generatedAt.slice(0, 10)}: ${catalog.apps.length.toLocaleString("en-US")} entries,
${CATEGORIES.length} categories, ${catalog.sourceCategories.length} upstream categories, ${placedCount} placements.

## How an app is filed

1. **A placement wins.** \`pipeline/placements.json\` places single apps by id,
   each with a one-line reason read from what the sources say about it.
2. **Otherwise its first listing decides**, by source priority (Android FOSS,
   then awesome-shizuku) and position in the list, skipping a listing whose
   upstream category is a catch-all.
3. **An app whose every listing is in a catch-all** waits in the remainder of
   that catch-all's region and is listed in the build report as awaiting
   placement. ${taxonomy.awaiting.length === 1 ? "Today 1 app waits." : taxonomy.awaiting.length ? `Today ${taxonomy.awaiting.length} apps wait.` : "Today none waits: every such app is placed."}

Each app is in exactly one category and one region, so region and category
counts add up to the catalog. An upstream category missing from the table goes
to its source's fallback region's remainder, and the build report lists it. A placement whose app has left the catalog is
reported as stale. The build never fails on the taxonomy.

## Naming

Title case, US English. A category is named for the kind of app, in the
plural (Launchers, Firewalls), or for the subject when the apps are tools for
it (Finance, Weather, Backup). "&" joins at most two such names. Device
categories are named for the maker or the device. A remainder is "Other …".
No category repeats its region's name. The rule is in \`docs/COPY.md\`.

## Catch-alls

These upstream categories say too little about their apps to map them as a
whole. An app also listed in a category that maps is filed by that listing;
every other app in them was placed by hand.

${table(
  ["Upstream category", "Apps", "Waits in", "Why"],
  catchAlls.map(([id, c]) => [upstreamName(catalog, id), String(taxonomy.mapping.find((m) => m.sourceCategory === id)?.listings ?? 0), nameOf.get(CATEGORIES.find((x) => x.region === c.home && x.remainder)?.id ?? "") ?? c.home, c.why]),
)}

Judged and not catch-alls: awesome-shizuku's **Customization** (${listings("awesome-shizuku/customization") + listings("awesome-shizuku/closed-customization")} apps) is
broad but coherent, apps that change how the system looks and behaves; it maps
to System UI & Gestures, and only its launchers, its desktop modes, a
wallpaper, a Pixel toolkit and an Android Auto installer are placed
elsewhere. Android FOSS's **System** (${listings("android-foss/apps-system")})
and both lists' **Productivity** are catch-alls: one spans app managers,
network monitors, terminals and theming, the other is named for a whole
region. awesome-shizuku's **Archived apps** is a status, not a kind of app.

## Where some things are, and why

- **awesome-shizuku's Task manager is Monitors & Task Managers**, under
  System & Tweaks. Most of its apps are system monitors and the rest stop
  running processes.
- **Android TV and Android Auto are under Device-specific**, beside the
  makers and the handhelds, because a person with a TV box or a car looks
  there.
- **One kind of app, one category.** Apps that stop or freeze background
  apps are App Freezers, under Apps & Installers, wherever their sources
  file them; desktop modes are Desktop Modes, under Personalization; and
  frame-rate overlays are with Monitors & Task Managers.
- **Smart Home & Wearables is under Automation & Dev Tools.** Its apps
  control a home or a device from the phone: Home Assistant kiosks and wall
  panels, IP camera viewers, a Wear OS remote and Gadgetbridge. That is the
  automation region's business; Web & World holds apps about the world
  outside, such as maps, weather and transit.
- **Each app is in one category.** An app that both sources list appears
  once, so every count adds up to the catalog.
- **The smallest ${smallest.length === 1 ? "category holds" : "categories hold"} ${fewest === 1 ? "one app" : `${fewest} apps`}**: ${smallest.join(", ")}.
  A category is kept, however small, when it is a thing a person looks for by
  name.

## Categories by region
`);

  for (const region of REGIONS) {
    const inRegion = taxonomy.categories.filter((c) => c.region === region.id && (c.apps > 0 || !c.remainder));
    const members = catalog.apps.filter((a) => a.region === region.id);
    const links = members.length > 0 && members.every((a) => a.listings.every((l) => l.kind === "resource"));
    out.push(`### ${region.name}: ${members.length} ${links ? "links" : "apps"}\n`);
    out.push(
      table(
        ["Category", links ? "Links" : "Apps", "Takes in"],
        inRegion.map((c) => [
          `${c.name}${c.remainder ? " (remainder)" : ""}`,
          String(c.apps),
          [
            ...c.takesIn.map((id) => upstreamName(catalog, id)),
            ...(taxonomy.placements.some((p) => p.category === c.id && appName.has(p.app)) ? [`${taxonomy.placements.filter((p) => p.category === c.id && appName.has(p.app)).length} placed`] : []),
          ].join("; ") || "—",
        ]),
      ),
    );
    out.push("");
  }

  out.push(`## Placements

Grouped by the category they place into. A reason that names an upstream
category marks an app moved out of a category that maps elsewhere, because
nobody would look for it there; the rest come from catch-alls.
`);
  for (const category of CATEGORIES) {
    const here = taxonomy.placements.filter((p) => p.category === category.id && appName.has(p.app));
    if (!here.length) continue;
    out.push(`### ${category.name}\n`);
    out.push(here.map((p) => `- **${appName.get(p.app)}** (\`${p.app}\`): ${p.reason}`).join("\n"));
    out.push("");
  }

  out.push(`## Left in remainders

An app goes to a remainder when the sources do not plainly say where it
belongs. Each is placed there on purpose, with its reason above.
`);
  for (const category of CATEGORIES.filter((c) => c.remainder)) {
    const here = [
      ...taxonomy.placements.filter((p) => p.category === category.id && appName.has(p.app)).map((p) => appName.get(p.app) ?? p.app),
      ...taxonomy.awaiting.filter((a) => a.category === category.id).map((a) => `${a.name} (awaiting placement)`),
    ];
    const region = REGIONS.find((r) => r.id === category.region)?.name ?? category.region;
    const also = (counts.get(category.id)?.takesIn.length ?? 0) > 0 ? " It is also an ordinary category, which its upstream categories map into." : "";
    out.push(`- **${category.name}** (${region}): ${here.length ? here.join(", ") : "none today"}.${also}`);
  }
  out.push("");
  const remaindersEmpty = CATEGORIES.filter((c) => c.remainder && !counts.get(c.id)?.apps).length;
  out.push(`${remaindersEmpty} remainders are empty and are not shown in the app until something lands in them.\n`);
  return out.join("\n");
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      data: { type: "string", default: join(ROOT, "app", "public", "data") },
      out: { type: "string", default: join(ROOT, "docs", "TAXONOMY.md") },
      placements: { type: "string", default: join(ROOT, "pipeline", "placements.json") },
    },
  });
  const { catalog } = await loadPrevious(values.data);
  writeFileSync(values.out, render(catalog, values.placements));
}
