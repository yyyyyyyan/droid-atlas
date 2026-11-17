/**
 * Icon credits: one credit for every self-hosted icon, generated from the
 * build's `icons.json`: whose project it is, the kind of place the icon was
 * taken from, and the project's license as a source states it. It can be
 * searched by app or author and narrowed to where the icons came from.
 *
 * A credit wraps to as many lines as it needs, so the rows are not all one
 * height and the list is not windowed like the app lists, which count on
 * one. Every row is in the document, laid out and painted by the browser to
 * its own height, so a hard fling never uncovers a row that is not drawn.
 *
 * Making twelve hundred rows at once would hold the page for longer than a
 * keystroke may take. So a row is made once and then only hidden or shown:
 * the first screenful of what is asked for is made in the same pass as the
 * change, the rest a slice at a time while the page is idle, and a search
 * or a chip after that changes which rows are hidden and makes none. Hiding
 * is done on the rows in the document, not by drawing each row again, and
 * in the same way: the rows down to the first screenful of matches in the
 * pass of the keystroke, the rest in slices, since showing twelve hundred
 * rows at once is as much layout as making them.
 *
 * A row is known by its app: a fork may show its upstream's icon file.
 *
 * Coming back to the page returns to the row that was in view (`scroll.ts`):
 * the rows down to it are then made in the first pass, so nothing is added
 * above it afterwards.
 */

import { Fragment } from "preact";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";
import { ICON_SOURCE_GROUPS, iconOwner, iconSourceWords, licenseIds, licenseTextId, licenseTextPath } from "../catalog/credits.ts";
import { dataUrl, type IconRecord, type PartHeader } from "../catalog/load.ts";
import { compareText, fold, licenseName, plural } from "../lib/format.ts";
import { safeWebUrl } from "../links.ts";
import { PRODUCT_CONTACT, PRODUCT_ISSUES } from "../product.ts";
import { licenseRoute } from "../router/route.ts";
import { useServices } from "../services.ts";
import { useAvailable } from "../ui/available.ts";
import { ContactAddress } from "../ui/Contact.tsx";
import { keyboardOpen } from "../ui/keyboard.ts";
import { Icon } from "../ui/Icon.tsx";
import { PageHead } from "../ui/LevelHead.tsx";
import { RouteLink } from "../ui/Link.tsx";
import { memo } from "../ui/memo.ts";
import { plateClass, sampleGlyph, type Glyph } from "../ui/plate.ts";
import { registerAnchorSource, stickyTop, takeExpectedAnchor } from "../ui/scroll.ts";

/** Rows made in the same pass as a change: what a tall screen shows of the list, and a little more. */
export const FIRST_ROWS = 16;
/** Rows made in one slice of idle time. */
export const ROWS_PER_SLICE = 24;
/** Rows hidden or shown in one slice of idle time, after a search or a chip. */
export const SHOWN_PER_SLICE = 60;

const NO_RECORDS: IconRecord[] = [];

type Loaded = { state: "loading" } | { state: "failed" } | { state: "ready"; header: PartHeader | null; records: IconRecord[] };

/**
 * The records whose app or author contains every word of the query, by app
 * name; with `rules`, only those found under one of those rules.
 */
export function filterCredits(records: readonly IconRecord[], query: string, rules?: readonly string[]): IconRecord[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const matches = records.filter((record) => {
    if (rules && !rules.includes(record.rule)) return false;
    if (words.length === 0) return true;
    const text = fold(`${record.name} ${record.app} ${record.author}`);
    return words.every((word) => text.includes(word));
  });
  return matches.sort((a, b) => compareText(a.name, b.name) || compareText(a.app, b.app));
}

/**
 * The rows to make next, by their apps: those asked for first, in the
 * list's order, then the others, so what a search is waiting for never
 * queues behind rows it hides.
 *
 * @param sorted every record, in the list's order
 * @param made the apps of the rows that exist
 * @param wanted the apps of the rows shown now
 */
export function nextRows(sorted: readonly IconRecord[], made: ReadonlySet<string>, wanted: ReadonlySet<string>, count: number): string[] {
  const missing = sorted.filter((record) => !made.has(record.app));
  const first = missing.filter((record) => wanted.has(record.app));
  const rest = missing.filter((record) => !wanted.has(record.app));
  return [...first, ...rest].slice(0, count).map((record) => record.app);
}

/** Runs a task when the page has nothing more pressing to do, and soon in any case. Returns how to call it off. */
function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task, { timeout: 300 });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(task, 30);
  return () => clearTimeout(timer);
}

/** A credit's icon, shown once it has loaded, on the plate it needs (`ui/plate.ts`). */
function CreditIcon({ src }: { src: string | null }) {
  const [glyph, setGlyph] = useState<Glyph | undefined>(undefined);
  return (
    <span class={glyph === undefined ? "ico is-pending" : `ico has-img${plateClass(glyph)}`} style={{ "--ico": "40px" }}>
      {src && <img src={src} alt="" width={40} height={40} loading="lazy" decoding="async" onLoad={(event) => setGlyph(sampleGlyph(event.currentTarget))} />}
    </span>
  );
}

function CreditRowView({ record, dataRoot, texts }: { record: IconRecord; dataRoot: string; texts: ReadonlySet<string> }) {
  const image = dataUrl(dataRoot, record.file);
  const original = safeWebUrl(record.original?.url);
  const project = safeWebUrl(record.project);
  const licenses = licenseIds(record.license)
    .map((id) => ({ id, text: licenseTextId(id), url: dataRoot + (licenseTextPath(licenseTextId(id)) ?? "") }))
    .filter((item) => texts.has(item.url));
  return (
    <li class="credit-row" data-credit={record.app}>
      <CreditIcon src={image} />
      <div class="credit-row-body">
        <p class="credit-row-name" dir="auto">{record.name}</p>
        <p class="credit-row-meta" dir="auto">
          {iconOwner(record.author)} · {iconSourceWords(record.rule)} ·{" "}
          {(record.license === "not stated" ? "no license stated" : licenseName(record.license)).split(" ").map((word, index) => (
            <Fragment key={index}>{index > 0 && " "}<span class="credit-license">{word}</span></Fragment>
          ))}
        </p>
        <p class="credit-row-links">
          {original && <a href={original} target="_blank" rel="noopener">Original</a>}
          {project && <a href={project} target="_blank" rel="noopener">Project</a>}
          {licenses.map(({ id, text }) => <RouteLink key={id} route={licenseRoute(text)}>{licenses.length > 1 ? licenseName(id) : "License text"}</RouteLink>)}
        </p>
      </div>
    </li>
  );
}

const CreditRow = memo(CreditRowView);

export function IconCredits() {
  const { onDemand, build } = useServices();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [returningTo] = useState(takeExpectedAnchor);
  const listRef = useRef<HTMLOListElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  /* With the keyboard up the search and its chips go to the top of what is left of the screen, and the results fill the rest, as in Search. The field is the page's only one, so the keyboard means it is being typed in; and the keyboard is said to be gone only once a tap that took the focus has landed. */
  const typing = keyboardOpen.value;
  useEffect(() => {
    if (!typing || !barRef.current) return;
    window.scrollTo({ top: window.scrollY + barRef.current.getBoundingClientRect().top });
  }, [typing]);

  useEffect(() => {
    let current = true;
    setLoaded({ state: "loading" });
    onDemand.iconCredits().then(
      ({ header, records }) => {
        if (current) setLoaded({ state: "ready", header, records });
      },
      () => {
        if (current) setLoaded({ state: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [onDemand, attempt]);

  const records = loaded.state === "ready" ? loaded.records : NO_RECORDS;
  const groups = useMemo(
    () => ICON_SOURCE_GROUPS.map((item) => ({ ...item, count: records.filter((record) => item.rules.includes(record.rule)).length })).filter((item) => item.count > 0),
    [records],
  );
  const rules = groups.find((item) => item.id === group)?.rules;
  const shown = useMemo(() => filterCredits(records, query, rules), [records, query, rules]);
  const licenseUrls = useMemo(
    () => [...new Set(records.flatMap((record) => licenseIds(record.license)).map(licenseTextId))].map((id) => build.dataRoot + (licenseTextPath(id) ?? "")),
    [records, build.dataRoot],
  );
  const texts = useAvailable(licenseUrls);
  const narrowed = query.trim() !== "" || rules !== undefined;

  const sorted = useMemo(() => filterCredits(records, ""), [records]);
  const wanted = useMemo(() => new Set(shown.map((record) => record.app)), [shown]);
  const made = useRef({ of: records, apps: new Set<string>() });
  const [slices, nextSlice] = useReducer((count: number) => count + 1, 0);
  if (made.current.of !== records) {
    const upTo = returningTo === null ? -1 : sorted.findIndex((record) => record.app === returningTo);
    made.current = { of: records, apps: new Set(sorted.slice(0, upTo === -1 ? 0 : upTo + FIRST_ROWS).map((record) => record.app)) };
  }
  for (const record of shown.slice(0, FIRST_ROWS)) made.current.apps.add(record.app);
  const complete = sorted.every((record) => made.current.apps.has(record.app));

  useEffect(() => {
    if (complete) return undefined;
    return whenIdle(() => {
      for (const app of nextRows(sorted, made.current.apps, wanted, ROWS_PER_SLICE)) made.current.apps.add(app);
      nextSlice(0);
    });
  }, [complete, slices, sorted, wanted]);

  /*
   * Which rows show is set on the rows themselves: down to the first screenful
   * of matches before the frame that follows a keystroke or a slice is
   * painted, the rest in slices of idle time.
   */
  const [sorting, setSorting] = useState(false);
  useLayoutEffect(() => {
    const rows = [...(listRef.current?.children ?? [])].filter((row): row is HTMLElement => row instanceof HTMLElement);
    const apply = (row: HTMLElement): void => {
      const hide = !wanted.has(row.dataset.credit ?? "");
      if (row.hidden !== hide) row.hidden = hide;
    };
    let next = 0;
    for (let matches = 0; next < rows.length && matches < FIRST_ROWS; next += 1) {
      const row = rows[next];
      if (!row) break;
      apply(row);
      if (!row.hidden) matches += 1;
    }
    if (next >= rows.length) {
      setSorting(false);
      return undefined;
    }
    setSorting(true);
    let cancel = (): void => undefined;
    const slice = (): void => {
      const end = Math.min(rows.length, next + SHOWN_PER_SLICE);
      for (; next < end; next += 1) {
        const row = rows[next];
        if (row) apply(row);
      }
      if (next < rows.length) cancel = whenIdle(slice);
      else setSorting(false);
    };
    cancel = whenIdle(slice);
    return () => cancel();
  }, [wanted, slices, records]);

  useLayoutEffect(() => registerAnchorSource({
    first() {
      const top = stickyTop();
      for (const row of listRef.current?.children ?? []) {
        if (!(row instanceof HTMLElement) || row.hidden) continue;
        const box = row.getBoundingClientRect();
        if (box.bottom > top) return row.dataset.credit ? { key: row.dataset.credit, offset: Math.round(box.top) } : null;
      }
      return null;
    },
    locate(key) {
      const row = [...(listRef.current?.children ?? [])].find((item) => item instanceof HTMLElement && item.dataset.credit === key);
      return row ? row.getBoundingClientRect().top + window.scrollY : null;
    },
    sync() {
      /* Nothing follows the scroll position here: every row made is in the document. */
    },
  }), []);

  return (
    <div class="view view-page view-credits">
      <PageHead title="Icon credits" />
      <div class="page">
        <p class="page-lead">
          Each icon is its owners’ work.
          {loaded.state === "ready" && loaded.header?.changes ? ` ${loaded.header.changes}` : ""}
        </p>
        <p class="page-text">
          To have an icon removed,{" "}
          {PRODUCT_CONTACT ? <>write to <ContactAddress contact={PRODUCT_CONTACT} />.</> : <><a href={PRODUCT_ISSUES} target="_blank" rel="noopener">open an issue on the project’s GitHub</a>.</>}
        </p>
      </div>
      {loaded.state === "loading" && <p class="page-status" role="status">Loading…</p>}
      {loaded.state === "failed" && (
        <p class="page-status" role="alert">
          The credits did not load.{" "}
          <button type="button" class="link-btn" onClick={() => setAttempt(attempt + 1)}>Try again</button>
        </p>
      )}
      {loaded.state === "ready" && (
        <section aria-label="Icon credits" class={typing ? "is-typing" : undefined}>
          <div class="bar credits-bar" data-sticky-bar ref={barRef}>
            <form class="search-form" role="search" onSubmit={(event) => event.preventDefault()}>
              <label class="search-field" for="credits-search">
                <Icon name="search" size={20} />
                <input
                  id="credits-search"
                  type="search"
                  value={query}
                  placeholder="App or author…"
                  autocomplete="off"
                  autocapitalize="off"
                  spellcheck={false}
                  aria-label="Search the icon credits"
                  onInput={(event) => setQuery(event.currentTarget.value)}
                />
              </label>
              <span class="search-count" role="status">{narrowed ? `${shown.length.toLocaleString("en")} of ${records.length.toLocaleString("en")}` : plural(records.length, "icon")}</span>
            </form>
            {groups.length > 1 && (
              <div class="cats fade-x credits-groups" role="group" aria-label="Where the icons came from">
                <ul>
                  <li><button type="button" class="chip chip-plain" aria-pressed={rules === undefined} onClick={() => setGroup(null)}><span>All</span><span class="n">{records.length.toLocaleString("en")}</span></button></li>
                  {groups.map((item) => (
                    <li key={item.id}>
                      <button type="button" class="chip chip-plain" aria-pressed={group === item.id} onClick={() => setGroup(group === item.id ? null : item.id)}>
                        <span>{item.label}</span><span class="n">{item.count.toLocaleString("en")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <ol ref={listRef} class="rows credits" aria-label={`${plural(shown.length, "icon credit")}, by app name`} hidden={shown.length === 0} aria-busy={!complete || sorting}>
            {sorted.map((record) => (made.current.apps.has(record.app)
              ? <CreditRow key={record.app} record={record} dataRoot={build.dataRoot} texts={texts} />
              : null))}
          </ol>
          {shown.length === 0 && <p class="page-status">{records.length ? "No icon credit matches." : "This build ships no icons."}</p>}
        </section>
      )}
    </div>
  );
}
