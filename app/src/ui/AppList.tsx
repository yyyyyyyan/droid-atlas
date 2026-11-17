/**
 * The app list every level below Explore is made of: a sticky bar and the
 * virtualized rows. The bar is one row of tools (filters, sort) that runs on
 * into quick filters. On a phone, while something narrows the list, a second
 * row holds the result count and the active filters; in the wide layout they
 * share the one line, the active filters first, then as many quick filters
 * as fit, and the count at its end. A list narrowed by an anti-feature
 * filter opens with one line saying whose statement that is and how many
 * apps are left out for want of one.
 *
 * The query lives in the URL (`q`, `f`, `sort`) and is changed by replacing
 * the current history entry, so it never adds a Back step and comes back with
 * the entry it belongs to. The filters and the sort choices are bottom
 * sheets, not history entries.
 */

import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { sharedChipKeys, sortNote } from "../catalog/facts.ts";
import {
  GROUPS,
  antiFeatureNote,
  countOptions,
  downloadSortOrigin,
  effectiveSort,
  isEmptyQuery,
  parseQuery,
  queryParams,
  runQuery,
  searchWords,
  sortDef,
  toggleFilter,
  type FilterDef,
  type GroupId,
  type Query,
  type SortDef,
  type SortId,
  type Vocabulary,
} from "../catalog/filters.ts";
import type { Entry } from "../catalog/model.ts";
import { plural } from "../lib/format.ts";
import { sheetOf, withParams } from "../router/route.ts";
import { isWide, listWidth, useServices } from "../services.ts";
import type { Density } from "../state/settings.ts";
import { BottomSheet, SheetHandle } from "./BottomSheet.tsx";
import { fitLine, showAll } from "./fit.ts";
import { Icon } from "./Icon.tsx";
import { countLine } from "./count.ts";
import { resultSet } from "./results.ts";
import { Row, rowHeight } from "./Row.tsx";
import { Tip } from "./Tip.tsx";
import { VirtualList, revealRow } from "./VirtualList.tsx";

/** Groups whose tokens are facts about an entry, offered as chips in a fixed order. */
const FACT_GROUPS: GroupId[] = ["access", "terms", "get", "health", "time"];
const COLLAPSED_OPTIONS = 14;
/** What a list's entries are called: apps, links, or entries when it holds both. */
export function nounsFor(entries: readonly { resource: boolean }[]): { noun: string; nounPlural: string } {
  if (entries.length > 0 && entries.every((entry) => entry.resource)) return { noun: "link", nounPlural: "links" };
  return entries.some((entry) => entry.resource) ? { noun: "entry", nounPlural: "entries" } : { noun: "app", nounPlural: "apps" };
}

/** Anti-features shown before the rest are asked for: the most common ones. */
const COLLAPSED_ANTI_FEATURES = 4;
const MAX_SUGGESTIONS = 8;
/** Below this many results, suggesting further filters is noise. */
const SUGGEST_FROM = 8;

interface Props {
  /** The entries this page is about, in the order its default sort gives. */
  scope: readonly Entry[];
  /** Set when `scope` arrives in an order that is a sort choice of its own. */
  natural?: SortId;
  /** Filter tokens the page itself stands for; they are neither offered nor shown as chips. */
  implied?: readonly string[];
  /** The list `scope` was cut from by the page's own filter, so the list can say what that filter left out. */
  within?: readonly Entry[];
  /** Filter groups that would only restate the page. */
  hiddenGroups?: readonly GroupId[];
  mixed?: boolean;
  noun?: string;
  nounPlural?: string;
  label: string;
  /** Extra controls at the front of the active filters (the pin toggle on Search). */
  stripStart?: ComponentChildren;
  /**
   * Set while a query is being typed on a phone: the tools row is put away so
   * the results are the first thing under the field. Active filters stay.
   */
  quiet?: boolean;
  /** Replaces the category on a row's last line where it returns text (the reader's note on a saved app). */
  metaOf?(entry: Entry): string | undefined;
  /** Shown instead of the rows when the scope itself is empty. */
  whenEmpty?: ComponentChildren;
  /** Shown between the bar and the rows; scrolls away with them. */
  children?: ComponentChildren;
}

/** Incremented to ask the list on screen to open its filter panel, by a control that lives outside the list's own bar. */
const filterPanelRequest = signal(0);

export function openFilters(): void {
  filterPanelRequest.value += 1;
}

export function useListQuery(implied: readonly string[] = []): { query: Query; apply(next: Query, options?: { settle?: boolean }): void } {
  const { router, navigation, vocabulary } = useServices();
  const route = navigation.value.route;
  const impliedKey = implied.join(",");
  const query = useMemo(
    () => parseQuery(vocabulary, route.params, implied),
    [vocabulary, route.params.q, route.params.f, route.params.sort, impliedKey],
  );
  const apply = (next: Query, options: { settle?: boolean } = {}): void => {
    router.replace(withParams(navigation.peek().route, queryParams(next)), options);
  };
  return { query, apply };
}

/** True when at least one entry of the list has the value a measure sort orders by, so the sort would do something here. */
function sortApplies(sort: SortId, scope: readonly Entry[]): boolean {
  const origin = downloadSortOrigin(sort);
  if (origin) return scope.some((entry) => entry.downloads[origin] !== undefined);
  if (sort === "stars") return scope.some((entry) => entry.stars !== null);
  if (sort === "release") return scope.some((entry) => entry.releasedAt !== null);
  if (sort === "added") return scope.some((entry) => entry.addedAt !== null);
  return true;
}

export function AppList({
  scope, natural, implied = [], within, hiddenGroups = [], mixed = false, noun = "entry", nounPlural = "entries", label, stripStart, quiet = false, metaOf, whenEmpty, children,
}: Props) {
  const { navigation, vocabulary, settings, model } = useServices();
  const route = navigation.value.route;
  const { query, apply } = useListQuery(implied);
  const density = settings.value.value.density;
  const height = rowHeight(density);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const wide = isWide.value;
  const panelRequest = filterPanelRequest.value;
  const handledPanelRequest = useRef(panelRequest);

  useEffect(() => {
    if (handledPanelRequest.current === panelRequest) return;
    handledPanelRequest.current = panelRequest;
    setPanelOpen(true);
  }, [panelRequest]);

  /* The control that opened a sheet may be gone when it closes (the search field's own Filters button exists only while typing); focus then goes to the bar's. */
  const focusBar = (selector: string): void => {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const stranded = !active || active === document.body || active.closest("dialog:not([open])") !== null;
      if (stranded) sectionRef.current?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
    });
  };

  const results = useMemo(() => runQuery(vocabulary, scope, query, { natural }), [vocabulary, scope, query, natural]);
  const sort = effectiveSort(query, { natural });
  const filtered = !isEmptyQuery(query);
  const words = useMemo(() => searchWords(query.text), [query.text]);
  const selectedId = sheetOf(route);

  /* What every row would repeat: the page's own fact, the filters in force, and any plain fact the whole list shares. */
  const shared = useMemo(() => sharedChipKeys(model, scope), [model, scope]);
  const hiddenChips = useMemo(() => new Set([...implied, ...query.filters, ...shared]), [implied.join(","), query.filters, shared]);

  useEffect(() => {
    const ids = results.map((entry) => entry.app.id);
    const set = {
      ids,
      reveal(id: string) {
        const list = sectionRef.current?.querySelector<HTMLElement>("ol.rows") ?? null;
        revealRow(list, ids.indexOf(id), height, isWide.peek() ? 16 : window.innerHeight * 0.66);
      },
    };
    resultSet.value = set;
    return () => {
      if (resultSet.peek() === set) resultSet.value = null;
    };
  }, [results, height]);

  /* A changed query starts its results at the top of the list, keeping the bar in place. */
  const queryKey = `${query.text}|${query.filters.join(",")}|${sort}`;
  const lastQueryKey = useRef(queryKey);
  useLayoutEffect(() => {
    if (lastQueryKey.current === queryKey) return;
    lastQueryKey.current = queryKey;
    const section = sectionRef.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top;
    if (top < 0) window.scrollBy(0, top);
  }, [queryKey]);

  const offered = vocabulary.defs.filter((def) => !implied.includes(def.key) && !hiddenGroups.includes(def.group));
  const quickKeys = offered.filter((def) => (FACT_GROUPS.includes(def.group) || def.key === "clean") && !def.antiFeature);
  const suggestionCounts = useMemo(
    () => countOptions(vocabulary, scope, query, quickKeys.map((def) => def.key)),
    [vocabulary, scope, query, implied.join(",")],
  );
  const suggestions = results.length < SUGGEST_FROM ? [] : quickKeys.filter((def) => {
    if (query.filters.includes(def.key)) return false;
    const count = suggestionCounts.get(def.key) ?? 0;
    return count > 0 && count < results.length;
  }).slice(0, MAX_SUGGESTIONS);

  /** Arrow keys, Home and End move between rows; the list scrolls and renders the target row before it takes focus. */
  const onRowKey = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-row]");
    if (!row) return;
    const index = results.findIndex((entry) => entry.app.id === row.dataset.row);
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: results.length - 1 };
    const next = moves[event.key];
    const goal = next === undefined ? undefined : results[next];
    if (index === -1 || next === undefined || next === index || !goal) return;
    event.preventDefault();
    const part = target.classList.contains("row-save") ? ".row-save" : ".row-link";
    const list = sectionRef.current?.querySelector<HTMLElement>("ol.rows") ?? null;
    revealRow(list, next, height, isWide.peek() ? 16 : 72);
    let tries = 6;
    const focus = (): void => {
      const element = list?.querySelector<HTMLElement>(`[data-row="${CSS.escape(goal.app.id)}"] ${part}`);
      if (element) element.focus({ preventScroll: true });
      else if ((tries -= 1) > 0) requestAnimationFrame(focus);
    };
    focus();
  };

  const sortChoices = useMemo(() => {
    const ids: SortId[] = [];
    if (query.text.trim()) ids.push("match");
    if (natural) ids.push(natural);
    for (const id of vocabulary.sorts.keys()) {
      if (id !== "match" && id !== "saved" && sortApplies(id, scope)) ids.push(id);
    }
    if (!ids.includes(sort)) ids.push(sort);
    return ids.filter((id, index, all) => all.indexOf(id) === index).map((id) => sortDef(vocabulary, id));
  }, [vocabulary, scope, natural, query.text.trim() !== "", sort]);

  const chooseSort = (chosen: SortId): void => {
    const fallback = effectiveSort({ ...query, sort: null }, { natural });
    apply({ ...query, sort: chosen === fallback ? null : chosen });
  };

  const many = nounPlural;
  const countText = useMemo(() => countLine(scope, results, filtered, noun, many), [scope, results, filtered, noun, many]);
  const activeDefs = query.filters.map((key) => vocabulary.byKey.get(key)).filter((def): def is FilterDef => def !== undefined);
  const current = sortDef(vocabulary, sort);
  const note = useMemo(() => sortNote(model, results, sort), [model, results, sort]);
  const statedBy = useMemo(
    () => antiFeatureNote(model, vocabulary, within ?? scope, query, implied),
    [model, vocabulary, within, scope, query, implied.join(",")],
  );

  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof ResizeObserver === "undefined") return undefined;
    const read = (): void => {
      const width = Math.round(section.getBoundingClientRect().width);
      if (width > 0) listWidth.value = width;
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(section);
    return () => observer.disconnect();
  }, [scope.length === 0]);

  useLayoutEffect(() => {
    const box = fitRef.current;
    if (!box) return undefined;
    let live = true;
    const lay = (): void => {
      if (!live) return;
      const chips = [...box.querySelectorAll<HTMLElement>("[data-fit]")];
      if (wide) fitLine(box, chips);
      else showAll(chips);
    };
    lay();
    void document.fonts?.ready.then(lay);
    if (typeof ResizeObserver === "undefined") return () => { live = false; };
    const observer = new ResizeObserver(lay);
    observer.observe(box);
    return () => {
      live = false;
      observer.disconnect();
    };
  });

  if (scope.length === 0 && whenEmpty) return <section class="list" aria-label={label}>{whenEmpty}</section>;

  /* One count, in whichever row is on screen: on a phone beside the tools while nothing narrows the list and at the head of the active filters once something does; in the wide layout at the end of the one line. */
  const count = (
    <p class={`bar-count${filtered ? "" : " is-total"}`} role="status">{countText}</p>
  );

  /* The search field shows and clears the text; these chips hold the pin and the filters that narrow the results. */
  const showActive = filtered && (!quiet || activeDefs.length > 0);
  const activeChips = (
    <>
      {!quiet && stripStart}
      {activeDefs.map((def) => (
        <button key={def.key} type="button" class="tchip is-on" onClick={() => apply(toggleFilter(vocabulary, query, def.key))}>
          <span class="tchip-text">{def.short}</span><span class="sr">, remove filter</span><Icon name="close" size={14} />
        </button>
      ))}
    </>
  );

  const tools = (
    <div class={`bar-row${wide ? "" : " fade-x"}`} role="group" aria-label="Filters and sorting">
      {!wide && !filtered && count}
      <button type="button" class={`bar-pill bar-filter${query.filters.length ? " is-set" : ""}`} aria-haspopup="dialog" onClick={() => setPanelOpen(true)}>
        <Icon name="filter" size={18} />
        <span>Filters</span>
        {query.filters.length > 0 && <span class="bar-badge" aria-label={`${query.filters.length} active`}>{query.filters.length}</span>}
      </button>
      <button
        type="button"
        class={`bar-pill bar-sort${query.sort && query.sort !== "match" ? " is-set" : ""}`}
        aria-haspopup="dialog"
        aria-label={`Sort: ${current.short}`}
        onClick={() => setSortOpen(true)}
      >
        <Icon name="sort" size={18} />
        <span class="bar-sort-label">{current.short}</span>
      </button>
      {(suggestions.length > 0 || (wide && showActive)) && (
        <div class="bar-fit" ref={fitRef}>
          <span class="bar-div" aria-hidden="true" />
          {wide && showActive && (
            <div class="bar-active" role="group" aria-label="Active filters">{activeChips}</div>
          )}
          {suggestions.length > 0 && (
            <div class="bar-suggest" role="group" aria-label="Quick filters">
              {suggestions.map((def) => (
                <button key={def.key} type="button" class="tchip" aria-pressed="false" data-fit onClick={() => apply(toggleFilter(vocabulary, query, def.key))}>
                  <span class="tchip-text">{def.short}</span>{" "}<span class="tchip-n">{suggestionCounts.get(def.key)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {wide && count}
    </div>
  );

  const active = !wide && showActive && (
    <div class="strip">
      {count}
      <div class="strip-chips fade-x" role="group" aria-label="Active filters">{activeChips}</div>
    </div>
  );

  return (
    <section class="list" aria-label={label} ref={sectionRef}>
      <div class="bar" data-sticky-bar>
        {!quiet && tools}
        {active}
        {quiet && !showActive && <div class="sr">{count}</div>}
      </div>
      {children}
      {statedBy && <p class="list-note">{statedBy}</p>}
      {note && results.length > 0 && (
        <p class="sort-note">{note}</p>
      )}
      {results.length > 0 ? (
        <div class="rows-keys" onKeyDown={onRowKey}>
          <VirtualList
            class="rows"
            label={`${/[a-z]/i.test(countText) ? countText : `${countText} ${many}`}, sorted by ${current.label.toLowerCase()}`}
            items={results}
            rowHeight={height}
            keyOf={(entry) => entry.app.id}
            renderRow={(entry, index) => (
              <Row
                key={entry.app.id}
                entry={entry}
                index={index}
                total={results.length}
                density={density}
                mixed={mixed}
                hidden={hiddenChips}
                selected={entry.app.id === selectedId}
                sort={current.measure ? sort : undefined}
                meta={metaOf?.(entry)}
                search={query.text.trim() || undefined}
                words={words}
              />
            )}
          />
        </div>
      ) : (
        <NoResults query={query} onClearText={() => apply({ ...query, text: "" })} onClearFilters={() => apply({ ...query, filters: [] })} />
      )}
      <FilterPanel
        open={panelOpen}
        onClose={() => { setPanelOpen(false); focusBar(".bar-filter"); }}
        scope={scope}
        query={query}
        offered={offered}
        resultCount={results.length}
        noun={noun}
        nounPlural={many}
        onChange={apply}
      />
      <SortSheet
        open={sortOpen}
        onClose={() => { setSortOpen(false); focusBar(".bar-sort"); }}
        choices={sortChoices}
        sort={sort}
        onSort={(chosen) => { chooseSort(chosen); setSortOpen(false); focusBar(".bar-sort"); }}
        density={density}
        onDensity={(next) => settings.update((value) => ({ ...value, density: next }))}
      />
    </section>
  );
}

function NoResults({ query, onClearText, onClearFilters }: { query: Query; onClearText(): void; onClearFilters(): void }) {
  const text = query.text.trim();
  const hasFilters = query.filters.length > 0;
  return (
    <div class="status">
      <div class="status-inner">
        <p class="status-title">{text ? `Nothing matches “${text}”${hasFilters ? " with these filters" : ""}` : "No matches"}</p>
        <div class="status-actions">
          {hasFilters && <button type="button" class="btn" onClick={onClearFilters}>Clear filters</button>}
          {text && <button type="button" class="btn" onClick={onClearText}>Clear search</button>}
        </div>
      </div>
    </div>
  );
}

interface SortSheetProps {
  open: boolean;
  onClose(): void;
  choices: readonly SortDef[];
  sort: SortId;
  onSort(sort: SortId): void;
  density: Density;
  onDensity(density: Density): void;
}

/** The ways to order the list, and the choice of row density. */
function SortSheet({ open, onClose, choices, sort, onSort, density, onDensity }: SortSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} class="panel is-short" labelledBy="sort-title" onShown={(dialog) => dialog.querySelector<HTMLElement>("#sort-title")?.focus()}>
      <header class="bsheet-head">
        <SheetHandle />
        <h2 id="sort-title" class="bsheet-title" tabIndex={-1}>Sort and view</h2>
        <button type="button" class="icon-btn" aria-label="Close sorting" onClick={onClose}><Icon name="close" /><Tip text="Close" keys="Esc" at="end" /></button>
      </header>
      <div class="bsheet-body" data-sheet-scroll>
        <div class="opts" role="radiogroup" aria-label="Sort by">
          {choices.map((choice) => (
            <button key={choice.id} type="button" class="opt" role="radio" aria-checked={choice.id === sort} onClick={() => onSort(choice.id)}>
                <span class="opt-mark" aria-hidden="true" />
                <span class="opt-text"><span class="opt-label">{choice.label}</span></span>
            </button>
          ))}
        </div>
        <h3 class="overline opts-title" id="sort-rows">Rows</h3>
        <div class="seg-row" role="radiogroup" aria-labelledby="sort-rows">
          {(["comfortable", "compact"] as const).map((option) => (
            <button key={option} type="button" class="seg-btn" role="radio" aria-checked={density === option} onClick={() => onDensity(option)}>
              {option === "comfortable" ? "Comfortable" : "Compact"}
            </button>
          ))}
        </div>
      </div>
    </BottomSheet>
  );
}

interface PanelProps {
  open: boolean;
  onClose(): void;
  scope: readonly Entry[];
  query: Query;
  /** The tokens this list offers: everything the vocabulary has except what the page itself stands for. */
  offered: readonly FilterDef[];
  resultCount: number;
  noun: string;
  nounPlural: string;
  onChange(next: Query): void;
}

function OptionChip({ def, vocabulary, query, counts, label, describedBy, onChange }: {
  def: FilterDef;
  vocabulary: Vocabulary;
  query: Query;
  counts: ReadonlyMap<string, number>;
  label?: string;
  describedBy?: string;
  onChange(next: Query): void;
}) {
  const on = query.filters.includes(def.key);
  const count = counts.get(def.key) ?? 0;
  return (
    <button
      type="button"
      class="chip chip-plain"
      aria-pressed={on}
      aria-describedby={describedBy}
      disabled={!on && count === 0}
      onClick={() => onChange(toggleFilter(vocabulary, query, def.key))}
    >
      <span>{label ?? def.panel ?? def.label}</span><span class="n">{count.toLocaleString("en")}</span>
    </button>
  );
}

/** The anti-features, one by one: what each means in the index's own words, and the two ways to filter by it. */
function AntiFeatureOptions({ defs, vocabulary, query, counts, onChange }: {
  defs: readonly FilterDef[];
  vocabulary: Vocabulary;
  query: Query;
  counts: ReadonlyMap<string, number>;
  onChange(next: Query): void;
}) {
  const [all, setAll] = useState(false);
  const general = defs.filter((def) => !def.antiFeature);
  const withDefs = defs.filter((def) => def.antiFeature?.polarity === "with");
  const chosen = (id: string): boolean => query.filters.some((key) => vocabulary.byKey.get(key)?.antiFeature?.id === id);
  const shown = all ? withDefs : withDefs.filter((def, index) => index < COLLAPSED_ANTI_FEATURES || chosen(def.antiFeature?.id ?? ""));
  return (
    <>
      {general.length > 0 && (
        <div class="panel-options">
          {general.map((def) => <OptionChip key={def.key} def={def} vocabulary={vocabulary} query={query} counts={counts} onChange={onChange} />)}
        </div>
      )}
      {withDefs.length > 0 && (
        <>
          <ul class="af-list">
            {shown.map((def) => {
              const id = def.antiFeature?.id ?? "";
              const without = vocabulary.byKey.get(`no:${id}`);
              return (
                <li key={id} class="af">
                  <div role="group" aria-labelledby={`af-${id}`}>
                    <p class="af-name" id={`af-${id}`}>{def.label}</p>
                    <div class="af-choices">
                      <OptionChip def={def} label="With" describedBy={`af-${id}`} vocabulary={vocabulary} query={query} counts={counts} onChange={onChange} />
                      {without && <OptionChip def={without} label="Without" describedBy={`af-${id}`} vocabulary={vocabulary} query={query} counts={counts} onChange={onChange} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {shown.length < withDefs.length && (
            <button type="button" class="chip chip-more" onClick={() => setAll(true)}>All {withDefs.length}</button>
          )}
        </>
      )}
    </>
  );
}

function FilterPanel({ open, onClose, scope, query, offered, resultCount, noun, nounPlural, onChange }: PanelProps) {
  const { vocabulary } = useServices();
  const [expanded, setExpanded] = useState<ReadonlySet<GroupId>>(new Set());
  const counts = useMemo(
    () => (open ? countOptions(vocabulary, scope, query, offered.map((def) => def.key)) : new Map<string, number>()),
    [open, vocabulary, scope, query],
  );

  return (
    <BottomSheet open={open} onClose={onClose} class="panel" labelledBy="filter-title" onShown={(dialog) => dialog.querySelector<HTMLElement>("#filter-title")?.focus()}>
      <header class="bsheet-head">
        <SheetHandle />
        <h2 id="filter-title" class="bsheet-title" tabIndex={-1}>Filters</h2>
        <button type="button" class="link-btn" disabled={query.filters.length === 0} onClick={() => onChange({ ...query, filters: [] })}>Clear all</button>
        <button type="button" class="icon-btn" aria-label="Close filters" onClick={onClose}><Icon name="close" /><Tip text="Close" keys="Esc" at="end" /></button>
      </header>
      <div class="bsheet-body" data-sheet-scroll>
        {open && GROUPS.map((group) => {
          const isFact = FACT_GROUPS.includes(group.id);
          const all = offered.filter((def) => def.group === group.id && (isFact || group.id === "anti" || query.filters.includes(def.key) || (counts.get(def.key) ?? 0) > 0));
          if (!all.length) return null;
          const heading = (
            <>
              <h3 id={`filter-group-${group.id}`} class="overline">{group.label}</h3>
              {group.hint && <p class="panel-hint">{group.hint}</p>}
            </>
          );
          if (group.id === "anti") {
            return (
              <section class="panel-group" key={group.id} aria-labelledby={`filter-group-${group.id}`}>
                {heading}
                <AntiFeatureOptions defs={all} vocabulary={vocabulary} query={query} counts={counts} onChange={onChange} />
              </section>
            );
          }
          const ordered = isFact ? all : [...all].sort((a, b) => Number(query.filters.includes(b.key)) - Number(query.filters.includes(a.key)) || (counts.get(b.key) ?? 0) - (counts.get(a.key) ?? 0));
          const collapsed = !isFact && ordered.length > COLLAPSED_OPTIONS && !expanded.has(group.id);
          const shown = collapsed ? ordered.slice(0, COLLAPSED_OPTIONS) : ordered;
          return (
            <section class="panel-group" key={group.id} aria-labelledby={`filter-group-${group.id}`}>
              {heading}
              <div class="panel-options">
                {shown.map((def) => <OptionChip key={def.key} def={def} vocabulary={vocabulary} query={query} counts={counts} onChange={onChange} />)}
                {collapsed && (
                  <button type="button" class="chip chip-more" onClick={() => setExpanded(new Set([...expanded, group.id]))}>
                    All {ordered.length}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <footer class="bsheet-foot">
        <button type="button" class="btn btn-strong" onClick={onClose}>
          {resultCount === 0 ? `No ${nounPlural} match` : `Show ${plural(resultCount, noun, nounPlural)}`}
        </button>
      </footer>
    </BottomSheet>
  );
}
