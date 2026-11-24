/**
 * What the app says about an entry, and who it says it on behalf of.
 *
 * Five presentations of the same facts:
 * - `rowChips`       the worded chips on a comfortable row, and whether they fit
 *                    beside the category name (`rowLine`, `metaWidth`);
 * - `compactTags`    the two or three worded labels a compact row has room for;
 * - `rowMeasure`     the value a row shows while its list is sorted by it;
 * - `statisticsFor`  the sheet's figures: stars, releases, activity, downloads;
 * - `factsFor`       the sheet's table, where every line names its sources.
 *
 * A fact appears only when a source states it. An absent chip, mark or line
 * means "not stated", never "no". Figures from different sources are shown
 * side by side and never added together or ranked against each other.
 */

import { androidVersion, compactNumber, fileSize, formatDate, formatDateRange, parseTime, plural, shortDate, timeAgo } from "../lib/format.ts";
import { isBareLicense, licenseTerms, ownerLabel, repositoryOwner } from "./fact-tokens.ts";
import { antiFeatureMeaning, antiFeatureName, downloadSortOrigin, type SortId } from "./filters.ts";
import { originName, type Entry, type Model } from "./model.ts";
import { type DownloadOrigin, type DownloadStat, type IndexFacts, type Openness, type Origin, type Pricing, type Sourced } from "./schema.ts";

export type Tone = "neutral" | "good" | "caution" | "alert" | "place";

export interface Chip {
  key: string;
  text: string;
  tone: Tone;
  /** What the label stands for, where its own words do not say: a term few know, or what a count holds. */
  title?: string;
  /** A shorter wording for a row too narrow for `text`. */
  brief?: string;
}

/** Anti-feature names short enough for a chip. A key that is not here is shown by the index's own name. */
const ANTI_FEATURE_SHORT: Record<string, string> = {
  Ads: "Ads",
  Tracking: "Tracking",
  NonFreeNet: "Non-free network",
  NonFreeAdd: "Non-free add-ons",
  NonFreeDep: "Non-free dependency",
  NonFreeAssets: "Non-free assets",
  NonFreeComp: "Non-free components",
  TetheredNet: "Tethered network",
  NoSourceSince: "Source withdrawn",
  SourceArchived: "Source archived",
  UpstreamNonFree: "Upstream non-free",
  KnownVuln: "Known vulnerability",
  DisabledAlgorithm: "Weak signature",
};

const OPENNESS_LABEL: Record<Openness, string> = {
  "open-source": "Open source",
  "source-available": "Source-available",
  "closed-source": "Closed source",
};

const PRICING_LABEL: Record<Pricing, string> = {
  free: "Free",
  paid: "Paid",
  iap: "In-app purchases",
  trial: "Free trial",
};

/** An anti-feature's name: the defining index's, in sentence case; the bare key when the catalog does not define it. */
export function antiFeatureLabel(model: Model, id: string): string {
  const feature = model.antiFeatures.get(id);
  return feature ? antiFeatureName(feature) : id;
}

function antiFeatureShort(model: Model, id: string): string {
  return ANTI_FEATURE_SHORT[id] ?? antiFeatureLabel(model, id);
}

/** How a paid app is paid for, in the most specific wording a source gives. */
export function pricingLabel(entry: Entry): string {
  const stated = new Set(entry.app.evidence.pricing.map((statement) => statement.value));
  for (const pricing of ["paid", "iap", "trial"] as const) {
    if (stated.has(pricing)) return PRICING_LABEL[pricing];
  }
  return "Paid";
}

/** Closed source and running with the access of the ADB shell or of root: the combination a reader must not miss. */
export function isClosedWithPrivilege(entry: Entry): boolean {
  const { facets } = entry.app;
  return facets.openness === "closed-source" && (facets.shizuku || facets.root);
}

/**
 * What the sheet says, in a sentence, about a closed-source app with
 * privileged access. Null for every other entry.
 */
export function privilegeWarning(entry: Entry): string | null {
  if (!isClosedWithPrivilege(entry)) return null;
  const { facets } = entry.app;
  if (facets.shizuku && facets.root) return "Closed source, with root and Shizuku access.";
  return facets.root ? "Closed source, with root access." : "Closed source, with ADB-level access through Shizuku.";
}

/**
 * The labels an entry carries wherever it appears: not open source, costs
 * money, archived, or works with privileged access.
 */
export function termChips(entry: Entry): Chip[] {
  const { facets } = entry.app;
  const chips: Chip[] = [];
  if (facets.openness === "closed-source") {
    const privileged = isClosedWithPrivilege(entry);
    chips.push({ key: "closed", text: "Closed source", tone: privileged ? "alert" : "caution" });
  }
  if (facets.openness === "source-available") chips.push({ key: "source-available", text: "Source-available", tone: "caution", title: "The source can be read, but the license is not an open-source one" });
  if (facets.paid) {
    const text = pricingLabel(entry);
    chips.push({ key: "paid", text: text === "In-app purchases" ? "In-app buys" : text, tone: "caution" });
  }
  if (facets.root) chips.push({ key: "root", text: "Root", tone: "caution" });
  if (facets.archived === true) chips.push({ key: "archived", text: "Archived", tone: "caution" });
  if (facets.shizuku) chips.push({ key: "shizuku", text: "Shizuku", tone: "neutral" });
  return chips;
}

/** An entry's latest release in full, with who states it: "Latest release Nov 18, 2026, in F-Droid". */
function releaseLabel(model: Model, at: number, from: Origin | null): string {
  const origin = from ? originName(model, from) : null;
  return `Latest release ${formatDate(at)}${origin ? `, ${origin === "GitHub" ? "on" : "in"} ${origin}` : ""}`;
}

/**
 * The marks a saved app carries on Saved, named on its row before any other
 * chip. "Archived" for as long as a source states the project is archived.
 * The day of its latest release when that release is later than both `since`,
 * the build time of the catalog Saved was last opened with, and `savedAt`;
 * with no `since` (the first visit, or a browser that keeps no data) there is
 * no release mark.
 *
 * Releases are compared as the instants the catalog gives. An index that
 * states only the day gives that day's first moment, so such a release is
 * marked only when the whole day is later than `since`. The catalog does not
 * say which dates are day-only, so one published later on the day of the
 * visit's catalog is never marked.
 */
export function savedMarks(model: Model, entry: Entry, savedAt: number, since: number | null): Chip[] {
  const marks = termChips(entry).filter((chip) => chip.key === "archived");
  const released = entry.releasedAt;
  if (since !== null && released !== null && released > since && released > savedAt) {
    marks.push({ key: "released", text: `Released ${shortDate(released, model.now)}`, tone: "neutral", title: releaseLabel(model, released, entry.releaseOrigin) });
  }
  return marks;
}

function optionalChips(model: Model, entry: Entry): Chip[] {
  const { facets } = entry.app;
  const chips: Chip[] = [];
  if (entry.antiFeatures.length) {
    const [first, ...rest] = entry.antiFeatures;
    chips.push({
      key: "anti",
      text: rest.length ? `${antiFeatureShort(model, first ?? "")} +${rest.length}` : antiFeatureShort(model, first ?? ""),
      brief: rest.length ? `Anti-features ${entry.antiFeatures.length}` : "Anti-feature",
      tone: "caution",
      title: `Anti-features: ${entry.antiFeatures.map((id) => antiFeatureLabel(model, id)).join("; ")}`,
    });
  }
  if (facets.staleLink) chips.push({ key: "stale", text: "Stale link", tone: "caution", title: "A catalog links a listing that no longer exists" });
  if (facets.noInternet === true) chips.push({ key: "no-internet", text: "No internet", tone: "good" });
  if (facets.fork) chips.push({ key: "fork", text: "Fork", tone: "neutral" });
  return chips;
}

/** Every chip an entry could show on a row, most important first: cautions, then what it works with, then the rest. */
export function allChips(model: Model, entry: Entry): Chip[] {
  const chips = [...termChips(entry), ...optionalChips(model, entry)];
  const weight = (chip: Chip): number => (chip.tone === "alert" ? 0 : chip.tone === "caution" ? 1 : 2);
  return chips.sort((a, b) => weight(a) - weight(b));
}

/**
 * The chips whose fact every entry of a list shares, when the fact is plain
 * information rather than a caution: on such a list the chip would repeat on
 * every row and say nothing ("Shizuku" in a catalog of Shizuku apps).
 */
export function sharedChipKeys(model: Model, scope: readonly Entry[]): Set<string> {
  const shared = new Set<string>();
  if (scope.length < 2) return shared;
  const [first, ...rest] = scope;
  if (!first) return shared;
  for (const chip of allChips(model, first)) {
    if (chip.tone !== "neutral" && chip.tone !== "good") continue;
    if (rest.every((entry) => allChips(model, entry).some((other) => other.key === chip.key))) shared.add(chip.key);
  }
  return shared;
}

/** How wide a line of a comfortable row is in a list 384 px wide, and what a chip and a letter cost of it, in px. Erring wide. */
const LINE_WIDTH = 258;
/** What a row spends beside its text: the gutter, the icon, the gaps and the save button; a little more in the wide layout. */
const ROW_CHROME = { narrow: 126, wide: 134 } as const;
const CHIP_PADDING = 17;
const CHIP_LETTER = 6.3;
const CHIP_GAP = 4;
const META_LETTER = 6.9;
const META_LEAD = 24;

function chipWidth(chip: Chip): number {
  return CHIP_PADDING + chip.text.length * CHIP_LETTER;
}

/** The width a line of text has in a comfortable row of a list this wide. */
export function rowLine(listWidth: number, wide = false): number {
  return Math.max(120, listWidth - ROW_CHROME[wide ? "wide" : "narrow"]);
}

/** Roughly what the category's name, or whatever stands in its place, takes of a row's last line, with the gap after it. */
export function metaWidth(text: string): number {
  return META_LEAD + text.length * META_LETTER;
}

/**
 * Roughly how wide a name is set in a row's type, in px, erring wide: the
 * row lets a name that does not fit one line take a second one, and has to
 * know before it is laid out, because every row has the same height.
 */
export function nameWidth(name: string): number {
  let width = 0;
  for (const char of name) {
    if ((char.codePointAt(0) ?? 0) > 0x2e7f) width += 16.5;
    else if (/[mwMW@%—]/.test(char)) width += 14;
    else if (/[A-Z0-9&#?]/.test(char)) width += 10.8;
    else if (/[iljI.,:;'!| ]/.test(char)) width += 4.6;
    else if (/[tfr()\-]/.test(char)) width += 6.6;
    else width += 9.3;
  }
  return width;
}

/** Roughly how wide a text is set in a row's summary type, in px. */
function summaryWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) > 0x2e7f) width += 13.5;
    else if (/[W@]/.test(char)) width += 13;
    else if (/[mwMNOQGHUCD%]/.test(char)) width += 10.5;
    else if (/[ !"'.,:;`|iIjl[\]]/.test(char)) width += 3.4;
    else if (/[()/\\\-_frst{}1]/.test(char)) width += 5.4;
    else if (/[A-Z0-9&#?]/.test(char)) width += 8.3;
    else width += 7.5;
  }
  return width;
}

const ELLIPSIS_WIDTH = 9;

/**
 * Roughly how many characters of a summary a row shows when it gives the
 * summary this many lines of this width: all of them when it fits, and
 * otherwise what stands before the ellipsis that cuts it off.
 */
export function summaryShown(text: string, line: number, lines: number): number {
  const words = text.split(" ");
  let row = 1;
  let used = 0;
  let shown = 0;
  for (const [index, word] of words.entries()) {
    const width = summaryWidth(word);
    const lead = used > 0 ? summaryWidth(" ") : 0;
    if (used + lead + width <= line) {
      used += lead + width;
    } else if (row < lines) {
      row += 1;
      used = width;
    } else {
      /* The last line is cut inside this word, with room kept for the ellipsis. */
      let room = line - ELLIPSIS_WIDTH - used - lead;
      let letters = 0;
      for (const char of word) {
        room -= summaryWidth(char);
        if (room < 0) break;
        letters += char.length;
      }
      return shown + letters;
    }
    shown += word.length + (index < words.length - 1 ? 1 : 0);
  }
  return text.length;
}

/** Roughly what the value a list is sorted by takes of the name's line, with the gap before it. */
export function measureWidth(measure: Measure): number {
  return 26 + measure.text.length * 7.2 + (measure.since ? 12 + measure.since.length * 6.6 : 0);
}

/**
 * Chips for a comfortable row: as many as fit in `room`, what its last line
 * has left beside the category's name, in order of importance. A plain fact
 * that does not fit is left out, so the category's name stays whole.
 *
 * A caution is never left out. The first one may take more than `room`, up
 * to `most`, and the category's name gives way to it; where its words are
 * too long even for that, it is said shorter (`brief`). Any caution that
 * still does not fit is counted: in a last chip ("+1") where that fits, else
 * in the chip before it ("Closed source +2"), or, where none can be named,
 * in a chip that says how many there are. A row therefore never looks
 * cleaner than the entry is, and no chip is cut at the row's edge.
 *
 * Marks a page pins (`pinned`) come first, by name, whatever room they take;
 * the other chips share what is left, and none of them repeats a pinned one.
 *
 * @param hidden chip keys the page, an active filter or the whole list already states; a caution is shown regardless
 * @param most the width one chip may take when it is the first caution: the line less what the category's name must keep
 */
export function rowChips(model: Model, entry: Entry, hidden: ReadonlySet<string>, room: number = LINE_WIDTH, most: number = Math.max(room, 0), pinned: readonly Chip[] = []): Chip[] {
  if (pinned.length === 0) return fitChips(allChips(model, entry), hidden, room, most);
  const keys = new Set(pinned.map((chip) => chip.key));
  const taken = chipsWidth(pinned) + CHIP_GAP;
  return [...pinned, ...fitChips(allChips(model, entry).filter((chip) => !keys.has(chip.key)), hidden, room - taken, most - taken)];
}

/** What chips take of a line set side by side. */
function chipsWidth(chips: readonly Chip[]): number {
  return chips.reduce((sum, chip, index) => sum + chipWidth(chip) + (index > 0 ? CHIP_GAP : 0), 0);
}

function fitChips(chips: readonly Chip[], hidden: ReadonlySet<string>, room: number, most: number): Chip[] {
  const kept: Chip[] = [];
  const left: Chip[] = [];
  let free = room;
  for (const chip of chips) {
    const gap = kept.length > 0 ? CHIP_GAP : 0;
    const caution = chip.tone === "alert" || chip.tone === "caution";
    if (hidden.has(chip.key) && !caution) continue;
    const first = caution && kept.length === 0 && left.length === 0;
    const shown = chipWidth(chip) + gap <= free || (first && chipWidth(chip) <= most)
      ? chip
      : first && chip.brief && chipWidth({ ...chip, text: chip.brief }) <= most ? { ...chip, text: chip.brief } : null;
    if (!shown) {
      if (caution) left.push(chip);
      continue;
    }
    if (left.length > 0 && !caution) continue;
    kept.push(shown);
    free -= chipWidth(shown) + gap;
  }
  if (left.length === 0) return kept;
  const also = `Also: ${left.map((chip) => chip.text).join(", ")}`;
  const last = kept.at(-1);
  const counted = last ? /^(.+) \+(\d+)$/.exec(last.text) : null;
  const more: Chip = { key: "more", text: `+${left.length}`, tone: "caution", title: also };
  const allowed = Math.max(room, most);
  const taken = chipsWidth(kept);
  /* A chip that already ends in a count takes the ones left out into it: two counts side by side read as a mistake. */
  if (last && counted) kept[kept.length - 1] = { ...last, text: `${counted[1]} +${Number(counted[2]) + left.length}`, title: [last.title, also].filter(Boolean).join(". ") };
  else if (last && taken + CHIP_GAP + chipWidth(more) <= allowed) kept.push(more);
  else if (last && taken - chipWidth(last) + chipWidth({ ...last, text: `${last.text} ${more.text}` }) <= allowed) kept[kept.length - 1] = { ...last, text: `${last.text} ${more.text}`, title: [last.title, also].filter(Boolean).join(". ") };
  else {
    const cautions = [...kept.filter((chip) => chip.tone === "alert" || chip.tone === "caution"), ...left];
    return [{ key: "more", text: cautions.length === 1 ? "1 caution" : `${cautions.length} cautions`, tone: "caution", title: cautions.map((chip) => chip.text).join(", ") }];
  }
  return kept;
}

/** The least of a row's last line the category's name keeps when a caution needs the room, in px. */
export const META_FLOOR = 72;

/**
 * The period a download figure covers, as the source states it. A running
 * total has a start and no window: it is said as "since" its first day,
 * whatever day it was last read.
 */
export function downloadPeriod(stat: DownloadStat, runningTotal = false): string {
  const from = parseTime(stat.from);
  const to = parseTime(stat.to);
  if (runningTotal && from !== null) return `since ${formatDate(from)}`;
  if (from !== null && to !== null) return formatDateRange(from, to);
  if (to !== null) return `up to ${formatDate(to)}`;
  if (from !== null) return `since ${formatDate(from)}`;
  return "running total";
}

const STORE_TAGS: { key: string; text: string; title: string; test(entry: Entry): boolean }[] = [
  { key: "fdroid", text: "F-Droid", title: "On F-Droid", test: (entry) => entry.app.facets.onFdroid },
  { key: "izzy", text: "IzzyOnDroid", title: "On IzzyOnDroid", test: (entry) => entry.app.facets.onIzzy },
];

/**
 * The labels a compact row shows, most important first and at most `limit`:
 * cautions, then what the app works with, then where to get it. Nothing is
 * shown for what no source states.
 *
 * Marks a page pins (`pinned`) come first and count towards `limit`, but are
 * never left out.
 *
 * @param room the width of the row's line; labels that would run past it are left out, the first never
 */
export function compactTags(model: Model, entry: Entry, hidden: ReadonlySet<string>, limit = 3, room = Number.POSITIVE_INFINITY, pinned: readonly Chip[] = []): Chip[] {
  const stores: Chip[] = STORE_TAGS.filter((tag) => tag.test(entry)).map((tag) => ({ key: tag.key, text: tag.text, tone: "neutral" }));
  const isCaution = (chip: Chip): boolean => chip.tone === "alert" || chip.tone === "caution";
  const keys = new Set(pinned.map((chip) => chip.key));
  const wanted = [...allChips(model, entry), ...stores]
    .filter((chip) => !keys.has(chip.key) && (isCaution(chip) || !hidden.has(chip.key)))
    .slice(0, Math.max(0, limit - pinned.length));
  const kept: Chip[] = [...pinned];
  let free = room - pinned.reduce((sum, chip, index) => sum + chipWidth(chip) + (index > 0 ? COMPACT_GAP : 0), 0);
  for (const chip of wanted) {
    const width = chipWidth(chip) + (kept.length > 0 ? COMPACT_GAP : 0);
    if (width > free && kept.length > 0) break;
    kept.push(chip);
    free -= width;
  }
  return kept;
}

const COMPACT_GAP = 5;
/** A compact row's icon and gap are smaller than a comfortable row's, so its line is this much longer, in px. */
export const COMPACT_EXTRA = 18;

export interface Measure {
  kind: "stars" | "release" | "added" | "downloads";
  /** What the row shows. */
  text: string;
  /** For a figure that is a running total: the day it has been counted from, in short. */
  since?: string;
  /** The same in full, with who states it, for the title and for assistive technology. */
  label: string;
}

/**
 * The value a row shows while its list is sorted by a measure: the figure the
 * order was made from, so the order can be read off the rows. Null for a sort
 * that is not a measure and for an entry no source gives the value for.
 */
export function rowMeasure(model: Model, entry: Entry, sort: SortId): Measure | null {
  if (sort === "stars") {
    if (entry.stars === null) return null;
    return { kind: "stars", text: compactNumber(entry.stars), label: `${entry.stars.toLocaleString("en")} GitHub stars` };
  }
  if (sort === "release") {
    if (entry.releasedAt === null) return null;
    return { kind: "release", text: timeAgo(entry.releasedAt, model.now), label: releaseLabel(model, entry.releasedAt, entry.releaseOrigin) };
  }
  if (sort === "added") {
    if (entry.addedAt === null) return null;
    return { kind: "added", text: timeAgo(entry.addedAt, model.now), label: `Added to the catalogs on ${formatDate(entry.addedAt)}` };
  }
  const origin = downloadSortOrigin(sort);
  const stat = origin ? entry.downloads[origin] : undefined;
  if (!origin || !stat) return null;
  const from = parseTime(stat.from);
  return {
    kind: "downloads",
    text: compactNumber(stat.count),
    ...(runningTotals(model, origin) && from !== null ? { since: shortDate(from, model.now) } : {}),
    label: `${stat.count.toLocaleString("en")} downloads from ${originName(model, origin)}, ${downloadPeriod(stat, runningTotals(model, origin))}`,
  };
}

/** Whether an origin's figures are running totals, each counted from a day of its own, rather than one period for every app. */
function runningTotals(model: Model, origin: DownloadOrigin): boolean {
  const source = model.downloadSources.find((candidate) => candidate.origin === origin);
  return source !== undefined && source.newest === null;
}

/**
 * What a list sorted by one origin's downloads says above its rows: the
 * period its figures cover, or the span from the earliest start to the
 * latest end when they do not all cover the same one. GitHub's figures are
 * running totals, each from the day beside it on its row, and the line says
 * what that day is. The sort button beside it names the origin. Null for
 * any other sort, and for a list no entry of which has a figure from that
 * origin.
 */
export function sortNote(model: Model, scope: readonly Entry[], sort: SortId): string | null {
  const origin = downloadSortOrigin(sort);
  if (!origin) return null;
  if (runningTotals(model, origin)) {
    return origin === "github" && scope.some((entry) => entry.downloads.github) ? "Since each app’s latest release" : null;
  }
  const periods = new Set<string>();
  const starts: number[] = [];
  const ends: number[] = [];
  for (const entry of scope) {
    const stat = entry.downloads[origin];
    if (!stat) continue;
    periods.add(downloadPeriod(stat));
    const from = parseTime(stat.from);
    const to = parseTime(stat.to);
    if (from !== null) starts.push(from);
    if (to !== null) ends.push(to);
  }
  const [only] = periods;
  if (periods.size === 1 && only) return only;
  return starts.length > 0 && ends.length > 0 ? formatDateRange(Math.min(...starts), Math.max(...ends)) : null;
}

export interface ReleaseStat {
  origin: Origin;
  source: string;
  /** The version or tag as the source writes it. */
  version: string | null;
  at: number | null;
  /** Something the source adds about the release (whether GitHub's carries an APK). */
  note: string | null;
}

export interface DownloadFigure {
  origin: DownloadOrigin;
  source: string;
  count: number;
  period: string;
}

/** The sheet's figures. Each names its source; nothing here is a sum or a rank across sources. */
export interface Statistics {
  stars: { count: number; source: string } | null;
  releases: ReleaseStat[];
  activity: { at: number; what: string; source: string } | null;
  downloads: DownloadFigure[];
}

export function statisticsFor(model: Model, entry: Entry): Statistics {
  const { app } = entry;
  const releases: ReleaseStat[] = [];
  for (const index of app.index) {
    const at = parseTime(index.updatedAt);
    if (index.version === null && at === null) continue;
    releases.push({ origin: index.origin, source: originName(model, index.origin), version: index.version, at, note: null });
  }
  if (app.github?.release) {
    const { tag, publishedAt, hasApk } = app.github.release;
    releases.push({ origin: "github", source: "GitHub", version: tag, at: parseTime(publishedAt), note: hasApk ? "APK attached" : "no APK attached" });
  }
  const pushed = parseTime(app.github?.pushedAt);
  return {
    stars: app.github ? { count: app.github.stars, source: "GitHub" } : null,
    releases,
    activity: pushed !== null ? { at: pushed, what: "Last commit", source: "GitHub" } : null,
    downloads: app.downloads.map((stat) => ({
      origin: stat.origin,
      source: originName(model, stat.origin),
      count: stat.count,
      period: downloadPeriod(stat, runningTotals(model, stat.origin)),
    })),
  };
}

export function hasStatistics(statistics: Statistics): boolean {
  return statistics.stars !== null || statistics.releases.length > 0 || statistics.activity !== null || statistics.downloads.length > 0;
}

export interface FactLine {
  value: string;
  tone: Tone;
  /** A sentence of explanation in the source's own words, where it gives one. */
  detail: string | null;
  /** What the source says about this entry in particular, shown quoted: an index's reason for an anti-feature. */
  quote: string | null;
  /** Display names of everyone who states this. Empty for "Unknown", which nobody states, and for a repository's owner in a catalog built before its source was recorded. */
  sources: string[];
  /** The lists of entries the line leads to, when it leads to any. */
  links?: FactLink[];
}

/** A list of entries a fact leads to: its filter token, what the list is called, and how many entries it holds. */
export interface FactLink {
  key: string;
  label: string;
  count: number;
  /** Whether every entry in the list is an app, rather than a guide or link. */
  apps: boolean;
}

/** What a link to a list is called: the words it shows and the size of the list, as in "GPL-3.0, 642 apps". */
export function factLinkName(link: FactLink, words: string = link.label): string {
  return `${words}, ${plural(link.count, link.apps ? "app" : "entry", link.apps ? "apps" : "entries")}`;
}

/**
 * The link a line's value itself is: its one link, when the value is that
 * list's name in any letters ("MIT", "fossifyorg on GitHub"). Null when the
 * value is a source's own wording that the list's name does not repeat
 * ("GPL-3.0-or-later", which leads to "GPL-3.0"): the value then stands as
 * text, credited as stated, beside the links.
 */
export function valueLink(line: Pick<FactLine, "value" | "links">): FactLink | null {
  const [only, ...rest] = line.links ?? [];
  return only && rest.length === 0 && only.label.toLowerCase() === line.value.trim().toLowerCase() ? only : null;
}

/**
 * One row of the sheet's details: a label and every distinct thing the
 * sources say under it. Where sources disagree the row has a line for each
 * answer, so a disagreement is one row that says so, never two rows.
 */
export interface Fact {
  key: string;
  label: string;
  lines: FactLine[];
}

function names(model: Model, origins: readonly Origin[]): string[] {
  return [...new Set(origins.map((origin) => originName(model, origin)))];
}

/** Adds a statement under a label. Sources that say the same thing share a line, so two indexes agreeing show once with both named. */
function state(facts: Fact[], key: string, label: string, tone: Tone, value: string, sources: string[], detail: string | null = null, quote: string | null = null): void {
  let fact = facts.find((other) => other.key === key);
  if (!fact) {
    fact = { key, label, lines: [] };
    facts.push(fact);
  }
  const same = fact.lines.find((line) => line.value === value && line.detail === detail && line.quote === quote);
  if (same) same.sources = [...new Set([...same.sources, ...sources])];
  else fact.lines.push({ value, tone, detail, quote, sources });
}

function indexFacts(model: Model, indexes: readonly IndexFacts[], facts: Fact[]): void {
  const each = (add: (index: IndexFacts, source: string[]) => void): void => {
    for (const index of indexes) add(index, [originName(model, index.origin)]);
  };
  each((index, source) => {
    if (index.minSdk) state(facts, "android", "Requires", "neutral", androidVersion(index.minSdk), source);
  });
  each((index, source) => {
    if (index.sizeBytes) state(facts, "size", "APK size", "neutral", fileSize(index.sizeBytes), source);
  });
  each((index, source) => state(facts, "permissions", "Permissions", "neutral", String(index.permissionCount), source));
  each((index, source) => {
    if (index.author) state(facts, "author", "Author", "neutral", index.author, source);
  });
  each((index, source) => {
    /* A catalog built before reasons were kept has none. */
    const reasons: Partial<Record<string, string>> = index.antiFeatureReasons ?? {};
    for (const id of index.antiFeatures) {
      const feature = model.antiFeatures.get(id);
      const reason = Object.hasOwn(reasons, id) ? reasons[id] : undefined;
      state(facts, `anti-${id}`, "Anti-feature", "caution", antiFeatureLabel(model, id), source, feature ? antiFeatureMeaning(feature, index.origin) : null, reason ?? null);
    }
  });
}

/** The list a token leads to; null for a token whose list the catalog does not hold. */
function factLink(model: Model, key: string): FactLink | null {
  const facts = model.facts();
  const group = facts.owners.get(key) ?? facts.licenses.get(key);
  return group ? { key, label: group.label, count: group.entries.length, apps: group.entries.every((entry) => !entry.resource) } : null;
}

/** The lists a stated license leads to: one for each license it names that the catalog holds. */
export function licenseLinks(model: Model, value: string): FactLink[] {
  return licenseTerms(value).flatMap((term) => factLink(model, term.key) ?? []);
}

/** Adds a line that leads to lists. A line with the same words as one already there only adds its sources to it, and leads nowhere new. */
function stateLinked(model: Model, facts: Fact[], key: string, label: string, value: string, sources: string[], keys: readonly string[]): boolean {
  const before = facts.find((fact) => fact.key === key)?.lines.length ?? 0;
  state(facts, key, label, "neutral", value, sources);
  const lines = facts.find((fact) => fact.key === key)?.lines ?? [];
  const line = lines.at(-1);
  if (lines.length === before || !line) return false;
  const links = keys.flatMap((token) => factLink(model, token) ?? []);
  if (links.length > 0) line.links = links;
  return true;
}

/**
 * Who states an app's repository, and so its owner: GitHub, when it answered
 * for the repository (its address follows the renames GitHub reports); else
 * whoever the build recorded as giving it (`Evidence.repository`). A catalog
 * built before that was recorded names nobody.
 */
function repositoryOrigins(app: Entry["app"]): Origin[] {
  if (app.repo?.host === "github" && app.github) return ["github"];
  const recorded: readonly Origin[] | undefined = app.evidence.repository;
  return recorded ? [...recorded] : [];
}

/**
 * One line per license statement, in the sources' words and credited to
 * them; sources that use the same words share a line. A statement without a
 * version qualifier adds no line when another source states the same
 * licenses with one: GitHub's "GPL-3.0" says nothing beside an index's
 * "GPL-3.0-only". "GPL-3.0-only" and "GPL-3.0-or-later" are two statements
 * and two lines. Each license leads to its list once, from the first line
 * that names it.
 */
function licenseFacts(model: Model, statements: readonly Sourced<string>[], facts: Fact[]): void {
  const licensesOf = (value: string): string => licenseTerms(value).map((term) => term.key).sort().join(" ");
  const qualified = new Set(statements.filter((statement) => !isBareLicense(statement.value)).map((statement) => licensesOf(statement.value)));
  const linked = new Set<string>();
  for (const statement of statements) {
    const keys = licenseTerms(statement.value).map((term) => term.key);
    if (keys.length > 0 && isBareLicense(statement.value) && qualified.has(licensesOf(statement.value))) continue;
    const fresh = keys.filter((key) => !linked.has(key));
    if (stateLinked(model, facts, "license", "License", statement.value, names(model, [statement.origin]), fresh)) {
      for (const key of fresh) linked.add(key);
    }
  }
}

/** A stretch of the sentence that names other entries of the same repository owner: words, or an entry, shown as a link to it. */
export type OthersPart = { text: string } | { entry: Entry };

const OTHERS_NAMED = 3;

/**
 * "Also A, B, C and 12 more": up to three of the other entries whose
 * repository has the same owner, by name, and how many more there are.
 * Empty when there are none.
 */
export function ownerOthers(model: Model, entry: Entry): OthersPart[] {
  const others = model.facts().ownerOf(entry)?.entries.filter((other) => other !== entry) ?? [];
  if (others.length === 0) return [];
  const named = others.slice(0, OTHERS_NAMED);
  const more = others.length - named.length;
  const parts: OthersPart[] = [{ text: "Also " }];
  named.forEach((other, at) => {
    parts.push({ entry: other });
    if (at < named.length - 1) parts.push({ text: at === named.length - 2 && more === 0 ? " and " : ", " });
  });
  if (more > 0) parts.push({ text: ` and ${more.toLocaleString("en")} more` });
  return parts;
}

/** The sheet's details. Every line that states something names who states it. Versions, dates and counts are in `statisticsFor`. */
export function factsFor(model: Model, entry: Entry): Fact[] {
  const { app } = entry;
  const facts: Fact[] = [];

  for (const value of ["closed-source", "source-available", "open-source"] as const) {
    const origins = app.evidence.openness.filter((statement) => statement.value === value).map((statement) => statement.origin);
    if (origins.length) state(facts, "code", "Code", value === "open-source" ? "neutral" : "caution", OPENNESS_LABEL[value], names(model, origins));
  }
  for (const value of ["paid", "iap", "trial", "free"] as const) {
    const origins = app.evidence.pricing.filter((statement) => statement.value === value).map((statement) => statement.origin);
    if (origins.length) state(facts, "price", "Price", value === "free" ? "neutral" : "caution", PRICING_LABEL[value], names(model, origins));
  }
  licenseFacts(model, app.licenses, facts);

  const declared = app.evidence.shizuku.filter((origin) => origin === "fdroid" || origin === "izzy");
  const listed = app.evidence.shizuku.filter((origin) => origin !== "fdroid" && origin !== "izzy");
  if (declared.length) state(facts, "shizuku", "Shizuku", "place", "Requests the permission", names(model, declared));
  if (listed.length) state(facts, "shizuku", "Shizuku", "place", "Listed", names(model, listed));
  if (app.evidence.root.length) state(facts, "root", "Root", "caution", "Uses root access", names(model, app.evidence.root));
  if (app.facets.noInternet === true && app.evidence.noInternet.length) {
    state(facts, "no-internet", "Network", "good", "No internet permission", names(model, app.evidence.noInternet));
  }

  indexFacts(model, app.index, facts);

  if (app.github?.movedTo) state(facts, "moved", "Repository", "neutral", `Moved to ${app.github.movedTo}`, ["GitHub"]);
  if (app.github?.forkOf) state(facts, "fork", "Fork", "neutral", `Forked from ${app.github.forkOf}`, ["GitHub"]);
  const owner = repositoryOwner(app);
  const group = model.facts().ownerOf(entry);
  if (owner && group && group.entries.length > 1) {
    stateLinked(model, facts, "owner", "Repository owner", ownerLabel(owner), names(model, repositoryOrigins(app)), [group.key]);
  }
  if (app.evidence.archived.length) state(facts, "archived", "Status", "caution", "Archived", names(model, app.evidence.archived));
  if (app.repoMissing) state(facts, "repo-missing", "Repository", "caution", "No longer exists", ["GitHub"]);
  for (const channel of app.channels) {
    if (channel.listed !== false || channel.type === "play") continue;
    const name = originName(model, channel.type);
    state(facts, `stale-${channel.type}`, "Listing", "caution", `No longer in ${name}`, [name]);
  }
  /* No index carries the app, so nobody states these two. "Unknown" is said where a reader would otherwise take silence for "none". */
  if (!entry.resource && app.index.length === 0) {
    state(facts, "permissions", "Permissions", "neutral", "Unknown", []);
    state(facts, "anti-unknown", "Anti-features", "neutral", "Unknown", []);
  }
  return facts;
}

/**
 * The source most lines of the details share, as it is printed: the heading
 * names it once, and only a line that someone else states names its own.
 * Null when no line has a source.
 */
export function detailsSource(facts: readonly Fact[]): string | null {
  const counts = new Map<string, number>();
  for (const fact of facts) {
    for (const line of fact.lines) {
      if (line.sources.length > 0) counts.set(line.sources.join(", "), (counts.get(line.sources.join(", ")) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  for (const [sources, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = sources;
  }
  return best;
}
