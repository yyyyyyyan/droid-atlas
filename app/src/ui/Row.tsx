/**
 * One entry in a list: a link that opens its sheet, and one control beside it.
 *
 * An app's row, in either density, leads with its name on a line of its own.
 * - comfortable: the name (with the value the list is sorted by, when it is
 *   sorted by a measure), the summary, and a last line with the category in
 *   a mixed list and the worded facts that fit beside it. The name is whole:
 *   one that does not fit a line takes a second, and the summary then has
 *   one line instead of two. Every row has these three parts in this order,
 *   at every width;
 * - compact: the name, and one line that starts with two or three worded
 *   labels and goes on into the summary.
 * Beside it is the save button.
 *
 * A resource is a link, not an app, and is one: a link glyph, its title, the
 * address it leads to, its description when a source gives one. A tap opens
 * the page. Beside it is the save button, as on every row.
 */

import { useMemo } from "preact/hooks";
import { COMPACT_EXTRA, compactTags, measureWidth, META_FLOOR, metaWidth, nameWidth, rowChips, rowLine, rowMeasure, summaryShown, type Chip, type Measure } from "../catalog/facts.ts";
import { markMatches, matchReason, type MatchReason, type SortId } from "../catalog/filters.ts";
import type { Entry } from "../catalog/model.ts";
import { rowFallback } from "../catalog/statements.ts";
import { placeOf } from "../router/route.ts";
import { hostOf, readableUrl, resourceLink } from "../links.ts";
import type { Density } from "../state/settings.ts";
import { announce, isWide, listWidth, useServices } from "../services.ts";
import { AppIcon } from "./AppIcon.tsx";
import { Icon } from "./Icon.tsx";
import { AppLink } from "./Link.tsx";
import { memo } from "./memo.ts";
import { placeStyle } from "./place.ts";
import { Tip } from "./Tip.tsx";
import { offerUndo } from "./UndoBar.tsx";

export const ROW_HEIGHTS = { comfortable: 88, compact: 52 } as const;

export function rowHeight(density: Density): number {
  return ROW_HEIGHTS[density];
}

function FactChip({ chip }: { chip: Chip }) {
  return <span class={`fchip fchip-${chip.tone}`} title={chip.title}>{chip.text}</span>;
}

/** The value the list is sorted by, on the row it belongs to. What it is a count of, the sort button and the list's name say once. */
function MeasureTag({ measure }: { measure: Measure }) {
  const glyph = measure.kind === "stars" ? "star" : measure.kind === "downloads" ? "store" : null;
  return (
    <span class={`row-measure is-${measure.kind}`} title={measure.label}>
      {glyph && <Icon name={glyph} size={13} filled={glyph === "star"} />}
      {measure.text}
      {measure.since && <span class="row-since"><span aria-hidden="true">· </span><span class="sr">, since </span>{measure.since}</span>}
    </span>
  );
}

/**
 * @param undoable on a row: a removal that takes the row or a note with it offers to put it back
 */
export function SaveButton({ entry, class: className, worded = false, undoable = false }: { entry: Entry; class: string; worded?: boolean; undoable?: boolean }) {
  const { saved, navigation } = useServices();
  const on = saved.view.value.ids.has(entry.app.id);
  const toggle = (): void => {
    const at = Date.now();
    const hadNote = saved.view.peek().notes.has(entry.app.id);
    const now = saved.toggle(entry, at);
    announce(now ? `${entry.app.name} saved on this device` : `${entry.app.name} removed from saved`);
    if (now) void globalThis.navigator?.storage?.persist?.().catch(() => false);
    else if (undoable && (hadNote || placeOf(navigation.peek().route).kind === "saved")) {
      offerUndo(hadNote ? `Removed ${entry.app.name} and its note` : `Removed ${entry.app.name}`, `${entry.app.name} is saved again`, () => saved.restore(at));
    }
  };
  return (
    <button
      type="button"
      class={className}
      aria-pressed={on}
      aria-label={on ? `Remove ${entry.app.name} from saved` : `Save ${entry.app.name}`}
      onClick={toggle}
    >
      <Icon name="bookmark" size={20} filled={on} />
      {worded ? <span aria-hidden="true">{on ? "Saved" : "Save"}</span> : <Tip text={on ? "Saved" : "Save"} at="row" />}
    </button>
  );
}

interface RowProps {
  entry: Entry;
  index: number;
  total: number;
  density: Density;
  /** A list that mixes categories shows each row's category in its region's color. */
  mixed: boolean;
  /** Chips the page, an active filter or the whole list already states. */
  hidden: ReadonlySet<string>;
  selected: boolean;
  /** The sort the list is in; a row shows its value when the sort is a measure. */
  sort?: SortId;
  /** Replaces the category name on a mixed row's last line. */
  meta?: string;
  /** Follows the category on the last line, after a separator, when there is room for all of it (Explore says when each new entry arrived). */
  when?: string;
  /** Where a search matched, when the name and summary do not show it. */
  /** The text searched for, when a row should say where it matched if it does not show the words itself. */
  search?: string;
  /** The words of the search in force; the row marks them in its name and summary. */
  words?: readonly string[];
}

/** A text with the words of the search marked in it. */
/** A word of a search with no letter or digit in it (the "&" of "Cloud & Sync") finds nothing worth showing, so it is not marked. */
const WORDY = /[\p{L}\p{N}]/u;

export function Marked({ text, words }: { text: string; words: readonly string[] | undefined }) {
  const marking = words?.filter((word) => WORDY.test(word));
  if (!marking || marking.length === 0) return <>{text}</>;
  return <>{markMatches(text, marking).map((part, index) => (part.hit ? <mark key={index}>{part.text}</mark> : part.text))}</>;
}

function ResourceRow({ entry, index, total, density, mixed, selected, meta, words }: RowProps) {
  const { app } = entry;
  const compact = density === "compact";
  const link = resourceLink(app);
  const address = link ? readableUrl(link.href) : null;
  const host = link ? hostOf(link.href) : null;
  const description = entry.listings.find((listing) => listing.description)?.description ?? app.summary?.value ?? null;
  const place = meta ?? (mixed && entry.category ? entry.category.name : null);
  const body = (
    <>
      <AppIcon entry={entry} size={compact ? 32 : 48} />
      <span class="row-body">
        <span class="row-top"><span class="row-name" dir="auto"><Marked text={app.name} words={words} /></span></span>
        {address && <span class="row-url"><span class="row-url-text" dir="ltr">{address}</span><Icon name="external" size={13} /></span>}
        {!compact && description && <span class="row-sum" dir="auto"><Marked text={description} words={words} /></span>}
        {!compact && place && <span class="row-foot"><span class="row-meta"><span class="dot" /><span class="row-meta-text">{place}</span></span></span>}
      </span>
    </>
  );
  return (
    <li
      class={`row place is-resource${compact ? " is-compact" : ""}`}
      style={placeStyle(app.region)}
      data-row={app.id}
      aria-posinset={index + 1}
      aria-setsize={total}
    >
      {link
        ? (
          <a class="row-link" href={link.href} target="_blank" rel="noopener" title={`Opens ${host ?? "the page"} in a new tab`}>
            {body}
            <span class="sr">, opens in a new tab</span>
          </a>
        )
        : <AppLink appId={app.id} class="row-link" aria-current={selected ? "true" : undefined}>{body}</AppLink>}
      <SaveButton entry={entry} class="row-save" undoable />
    </li>
  );
}

/**
 * A row opens a sheet inside the app, so the menu a browser offers for a link
 * under a long press ("Download link", "Open in browser") has nothing to act
 * on. It stays for a mouse, where opening an entry in another tab is useful.
 */
function keepTouchMenuAway(event: MouseEvent): void {
  if ("pointerType" in event && event.pointerType === "touch") event.preventDefault();
}

/** Where a search matched, with the matching text marked. */
function MatchLine({ match, words }: { match: MatchReason; words: readonly string[] | undefined }) {
  return (
    <span class="row-match" dir="auto">
      <span class="row-match-where">{match.where}: </span><Marked text={match.before + match.hit + match.after} words={words} />
    </span>
  );
}

function AppRow({ entry, index, total, density, mixed, hidden, selected, sort, meta, when, search, words }: RowProps) {
  const { model } = useServices();
  const { app } = entry;
  const compact = density === "compact";
  const summary = app.summary?.value ?? rowFallback(entry);
  const place = meta ?? (mixed && entry.category ? entry.category.name : null);
  const line = rowLine(listWidth.value, isWide.value);
  const chips = compact ? compactTags(model, entry, hidden, 3, line + COMPACT_EXTRA) : rowChips(model, entry, hidden, line - (place ? metaWidth(place) : 0), line - (place ? META_FLOOR : 0));
  const measure = sort ? rowMeasure(model, entry, sort) : null;
  const longName = !compact && nameWidth(app.name) > line - (measure ? measureWidth(measure) : 0);
  /* Between the name and the last line a comfortable row has two lines, or one under a name that takes two. Where a search matched takes one, when the summary in all of them would not show the words, and the summary gets what is left. */
  const between = longName ? 1 : 2;
  const matchLine = useMemo(
    () => (search && !compact
      ? matchReason(entry, search, model, summaryShown(app.summary?.value ?? "", line, between), mixed && !meta)
      : null),
    [model, entry, search, compact, line, between, mixed, meta],
  );
  const summaryLines = compact ? 1 : between - (matchLine ? 1 : 0);
  const summaryText = summary && summaryLines > 0
    ? <span class={app.summary ? "row-sum" : "row-sum is-address"} dir="auto"><Marked text={summary} words={app.summary ? words : undefined} /></span>
    : null;
  return (
    <li
      class={`row place${compact ? " is-compact" : ""}${longName ? " has-long-name" : ""}${!compact && summaryLines === 1 ? " has-short-sum" : ""}`}
      style={placeStyle(app.region)}
      data-row={app.id}
      aria-posinset={index + 1}
      aria-setsize={total}
    >
      <AppLink appId={app.id} class="row-link" aria-current={selected ? "true" : undefined} onContextMenu={keepTouchMenuAway}>
        <AppIcon entry={entry} size={compact ? 32 : 48} />
        <span class="row-body">
          <span class="row-top">
            <span class="row-name" dir="auto"><Marked text={app.name} words={words} /></span>
            {measure && <MeasureTag measure={measure} />}
          </span>
          {compact
            ? (
              <span class="row-line">
                {chips.map((chip) => <FactChip key={chip.key} chip={chip} />)}
                {summaryText}
              </span>
            )
            : summaryText}
          {matchLine && <MatchLine match={matchLine} words={words} />}
          {!compact && (place || chips.length > 0) && (
            <span class="row-foot">
              {place && (
                <span class="row-meta">
                  <span class="dot" />
                  {when
                    ? <span class="row-meta-text has-when"><span class="row-meta-name">{place}</span><span class="row-meta-when"> · {when}</span></span>
                    : <span class="row-meta-text"><Marked text={place} words={meta ? undefined : words} /></span>}
                </span>
              )}
              {chips.length > 0 && <span class="row-chips">{chips.map((chip) => <FactChip key={chip.key} chip={chip} />)}</span>}
            </span>
          )}
        </span>
      </AppLink>
      <SaveButton entry={entry} class="row-save" undoable />
    </li>
  );
}

function RowView(props: RowProps) {
  return props.entry.resource ? <ResourceRow {...props} /> : <AppRow {...props} />;
}

export const Row = memo(RowView);
