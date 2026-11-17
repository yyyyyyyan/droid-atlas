/**
 * The levels inside Explore: a region, one of its categories, and a lens.
 * Each is a colored header, a way sideways (categories or regions), and the
 * shared app list. A region or category that holds only resources (guides and
 * further reading) is a list of links instead, with none of the app tools.
 */

import { useMemo } from "preact/hooks";
import { toggleFilter, type FilterDef } from "../catalog/filters.ts";
import { categoryNotes, type CategoryView, type Entry, type RegionView } from "../catalog/model.ts";
import type { SourceId } from "../catalog/schema.ts";
import { plural } from "../lib/format.ts";
import { categoryRoute, regionRoute } from "../router/route.ts";
import { useServices } from "../services.ts";
import { AppList, nounsFor, useListQuery } from "../ui/AppList.tsx";
import { ChipLine } from "../ui/ChipLine.tsx";
import { ResourceList } from "../ui/ResourceList.tsx";
import { LensGlyph, PlaceHead } from "../ui/LevelHead.tsx";
import { RouteLink } from "../ui/Link.tsx";
import { placeStyle } from "../ui/place.ts";

function onlyResources(entries: readonly { resource: boolean }[]): boolean {
  return entries.length > 0 && entries.every((entry) => entry.resource);
}

/** The names of the catalogs the entries come from, in source priority. */
function sourceNames(entries: readonly Entry[], names: (id: SourceId) => string): string[] {
  const ids = new Set(entries.flatMap((entry) => [...entry.sources]));
  return (["android-foss", "awesome-shizuku", "droid-atlas"] as const).filter((id) => ids.has(id)).map(names);
}

/** Category chips, largest first and the remainder last: the way down from a region. */
function CategoryChips({ view }: { view: RegionView }) {
  return (
    <ChipLine label={`Categories in ${view.region.name}`} more={`All ${view.categories.length}`}>
      {view.categories.map((category) => (
        <li key={category.category.id}>
          <RouteLink route={categoryRoute(category.category.id)} class="chip">
            <span class="chip-name">{category.category.name}</span><span class="n">{category.entries.length}</span>
          </RouteLink>
        </li>
      ))}
    </ChipLine>
  );
}

export function RegionLevel({ view }: { view: RegionView }) {
  const { model } = useServices();
  const implied = useMemo(() => [`r:${view.region.id}`], [view]);
  const nouns = nounsFor(view.entries);
  const inOrder = useMemo(() => model.categories.filter((category) => category.category.region === view.region.id), [model, view]);
  const head = (
    <PlaceHead title={view.region.name}>
      <p class="head-sub">
        {onlyResources(view.entries)
          ? [plural(view.entries.length, nouns.noun, nouns.nounPlural), ...sourceNames(view.entries, (id) => model.sourceById.get(id)?.name ?? id)].join(" · ")
          : plural(view.categories.length, "category", "categories")}
      </p>
    </PlaceHead>
  );
  if (onlyResources(view.entries)) {
    return (
      <div class="view view-list view-reading place has-region" style={placeStyle(view.region.id)}>
        {head}
        <ResourceList groups={inOrder} label={`Links in ${view.region.name}`} />
      </div>
    );
  }
  return (
    <div class="view view-list place has-region" style={placeStyle(view.region.id)}>
      {head}
      <CategoryChips view={view} />
      <AppList
        label={`Entries in ${view.region.name}`}
        scope={view.entries}
        implied={implied}
        hiddenGroups={["region"]}
        mixed={view.categories.length > 1}
        {...nouns}
      />
    </div>
  );
}

export function CategoryLevel({ view }: { view: CategoryView }) {
  const { model } = useServices();
  const { category } = view;
  const region = model.regionById.get(category.region);
  const implied = useMemo(() => [`c:${category.id}`], [category.id]);
  const entries = view.entries;
  const nouns = nounsFor(entries);
  const siblings = region?.categories ?? [];
  const notes = useMemo(() => categoryNotes(model, view), [model, view]);
  const catalogs = sourceNames(entries, (id) => model.sourceById.get(id)?.name ?? id);
  const currentFirst = useMemo(
    () => [...siblings.filter((sibling) => sibling.category.id === category.id), ...siblings.filter((sibling) => sibling.category.id !== category.id)],
    [siblings, category.id],
  );

  return (
    <div class={`view view-list${onlyResources(entries) ? " view-reading" : ""} place has-region`} style={placeStyle(category.region)}>
      <PlaceHead
        overline={region ? <RouteLink route={regionRoute(region.region.id)}>{region.region.name}</RouteLink> : undefined}
        title={category.name}
      >
        <p class="head-sub">{catalogs.join(" · ")}</p>
        {notes.map((note) => (
          <blockquote key={note.text} class="head-note" dir="auto">
            {note.text}
            <footer>Note from {model.sourceById.get(note.source)?.name ?? note.source} on {note.on.map((name) => `“${name}”`).join(", ")}</footer>
          </blockquote>
        ))}
      </PlaceHead>
      {siblings.length > 1 && (
        <ChipLine label={`Other categories in ${region?.region.name ?? "this region"}`} more={`All ${siblings.length}`}>
          {currentFirst.map((sibling) => (
            <li key={sibling.category.id}>
              <RouteLink
                route={categoryRoute(sibling.category.id)}
                mode="replace"
                class="chip"
                aria-current={sibling.category.id === category.id ? "page" : undefined}
              >
                <span class="chip-name">{sibling.category.name}</span><span class="n">{sibling.entries.length}</span>
              </RouteLink>
            </li>
          ))}
        </ChipLine>
      )}
      {onlyResources(entries)
        ? <ResourceList groups={[view]} label={`Links in ${category.name}`} />
        : (
          <AppList
            label={`Entries in ${category.name}`}
            scope={entries}
            implied={implied}
            hiddenGroups={catalogs.length > 1 ? ["region", "category"] : ["region", "category", "source"]}
            {...nouns}
          />
        )}
    </div>
  );
}

/** Region chips on a lens page. They are the query's region filters, so they combine with everything else and live in the URL. */
function RegionNarrowing({ lens, total }: { lens: FilterDef; total: number }) {
  const { model, vocabulary } = useServices();
  const implied = useMemo(() => [lens.key], [lens.key]);
  const { query, apply } = useListQuery(implied);
  const perRegion = useMemo(
    () => model.regions
      .map((view) => ({ view, count: view.entries.filter(lens.test).length }))
      .filter((item) => item.count > 0),
    [model, lens],
  );
  const active = query.filters.filter((key) => key.startsWith("r:"));
  if (perRegion.length < 2) return null;
  const chosenFirst = [...perRegion.filter((item) => active.includes(`r:${item.view.region.id}`)), ...perRegion.filter((item) => !active.includes(`r:${item.view.region.id}`))];
  return (
    <ChipLine as="group" label="Narrow to regions" more="More regions">
      <li>
        <button type="button" class="chip" aria-pressed={active.length === 0} onClick={() => apply({ ...query, filters: query.filters.filter((key) => !key.startsWith("r:")) })}>
          <span>All regions</span><span class="n">{total}</span>
        </button>
      </li>
      {chosenFirst.map(({ view, count }) => {
        const key = `r:${view.region.id}`;
        return (
          <li key={key} class="place" style={placeStyle(view.region.id)}>
            <button type="button" class="chip" aria-pressed={active.includes(key)} onClick={() => apply(toggleFilter(vocabulary, query, key))}>
              <span class="dot" /><span class="chip-name">{view.region.name}</span><span class="n">{count}</span>
            </button>
          </li>
        );
      })}
    </ChipLine>
  );
}

export function LensLevel({ lens }: { lens: FilterDef }) {
  const { model } = useServices();
  const entries = useMemo(() => model.entries.filter(lens.test), [model, lens]);
  const implied = useMemo(() => [lens.key], [lens.key]);
  return (
    <div class="view view-list place">
      <PlaceHead title={<><span class="head-glyph"><LensGlyph lens={lens} size={22} /></span>{lens.label}</>} />
      <RegionNarrowing lens={lens} total={entries.length} />
      <AppList label={`Apps: ${lens.label}`} scope={entries} within={model.entries} implied={implied} hiddenGroups={["region"]} mixed {...nounsFor(entries)} />
    </div>
  );
}
