/**
 * Search: the fast path to a known app and the instrument for narrowing.
 * One field over the whole catalog, results as you type with name matches
 * first, every filter combinable, and pins for the questions worth keeping.
 *
 * While a query is being typed on a phone, nothing stands between the field
 * and the results: the pins and the tools row are put away and come back when
 * the field is left. Leaving the field is not always possible without knowing
 * how (closing the keyboard with Back keeps the focus where it was), so the
 * field carries its own Filters button for as long as the row is away.
 */

import { signal } from "@preact/signals";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { describeQuery, isEmptyQuery, parseQuery, queryId, queryParams, runQuery, storedQueryName, type Query } from "../catalog/filters.ts";
import { announce, isWide, useServices } from "../services.ts";
import { addPin, removePin, type Pin } from "../state/pins.ts";
import { CategoryHits } from "../ui/CategoryHits.tsx";
import { AppList, openFilters, useListQuery } from "../ui/AppList.tsx";
import { ChipLine } from "../ui/ChipLine.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Tip } from "../ui/Tip.tsx";
import { resultSet } from "../ui/results.ts";
import { StoreNotice } from "../ui/StoreNotice.tsx";
import { keyboardOpen } from "../ui/keyboard.ts";
import { createTypingTracker } from "../ui/typing.ts";
import { onGestureLost } from "../ui/gesture-lost.ts";

/** Incremented to ask the search field to take focus: by the bottom bar, the "/" key, and arrival on the view. */
export const searchFocusRequest = signal(0);

export function focusSearch(): void {
  searchFocusRequest.value += 1;
}

/** The last request acted on. Arriving by Back, Forward or a reload makes no request, so the keyboard stays down. */
let handledFocusRequest = 0;

function pinQuery(pin: Pin): Record<string, string> {
  return { q: pin.q, f: pin.f, sort: pin.sort };
}

/** The number of results, shown inside the field while typing. A component of its own so a new count redraws only itself. */
function FoundCount() {
  const found = resultSet.value?.ids.length ?? null;
  return found === null ? null : <span class="search-count" aria-hidden="true">{found.toLocaleString("en")}</span>;
}

export function Search() {
  const { model, vocabulary, pins, navigation } = useServices();
  const { query, apply } = useListQuery();
  const inputRef = useRef<HTMLInputElement>(null);
  const request = searchFocusRequest.value;
  const [focused, setFocused] = useState(false);
  const tracker = useMemo(() => createTypingTracker(setFocused), []);

  useEffect(() => {
    const down = (): void => tracker.pointer(true);
    const up = (): void => tracker.pointer(false);
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    const stopTracking = onGestureLost(up);
    return () => {
      stopTracking();
      tracker.dispose();
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, [tracker]);

  useEffect(() => {
    if (request === handledFocusRequest) return;
    handledFocusRequest = request;
    if (navigation.peek().route.params.app) return;
    inputRef.current?.focus({ preventScroll: true });
  }, [request]);

  const stored = pins.value.value.items;
  const pinList = useMemo(
    () => stored.flatMap((pin) => {
      const name = storedQueryName(vocabulary, pinQuery(pin), pin.name);
      return name === null ? [] : [{ ...pin, name }];
    }),
    [stored, vocabulary],
  );
  const pinned = useMemo(() => {
    const id = queryId(query);
    return pinList.find((pin) => queryId(parseQuery(vocabulary, pinQuery(pin))) === id) ?? null;
  }, [pinList, query, vocabulary]);
  const pinCounts = useMemo(
    () => new Map(pinList.map((pin) => [pin.id, runQuery(vocabulary, model.entries, parseQuery(vocabulary, pinQuery(pin))).length])),
    [pinList, model, vocabulary],
  );

  const togglePin = (): void => {
    if (pinned) {
      removePin(pins, pinned.id);
      announce("Pin removed");
      return;
    }
    const params = queryParams(query);
    addPin(pins, { id: `pin-${Date.now().toString(36)}`, name: describeQuery(vocabulary, query), q: params.q ?? "", f: params.f ?? "", sort: params.sort ?? "" });
    announce("Query pinned");
  };

  const follow = (pin: Pin): void => {
    const next: Query = parseQuery(vocabulary, pinQuery(pin));
    apply(next);
    window.scrollTo(0, 0);
  };

  const focusFirstResult = (): void => {
    document.querySelector<HTMLElement>(".view-search .cat-hit, .view-search .rows .row-link")?.focus();
  };

  const idle = isEmptyQuery(query);
  /* The compact bar makes room for the keyboard, so it follows the keyboard: Back puts the keyboard away with the focus still in the field, and the full bar has to return then. */
  const typing = focused && keyboardOpen.value && query.text !== "" && !isWide.value;

  return (
    <div class="view view-list view-search place">
      <header class="search-head">
        <h1 class="sr">Search</h1>
        <form
          class="search-form"
          role="search"
          onSubmit={(event) => { event.preventDefault(); inputRef.current?.blur(); }}
          onFocusIn={() => tracker.focus()}
          onFocusOut={(event) => {
            const next = event.relatedTarget;
            if (!(next instanceof Node) || !event.currentTarget.contains(next)) tracker.blur();
          }}
        >
          <label class="search-field" for="search-input">
            <Icon name="search" size={20} />
            <input
              ref={inputRef}
              id="search-input"
              type="search"
              name="q"
              value={query.text}
              placeholder="Name, package, what it does…"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              enterkeyhint="search"
              aria-label="Search the catalog"
              aria-keyshortcuts="/"
              onInput={(event) => apply({ ...query, text: event.currentTarget.value }, { settle: true })}
              onKeyDown={(event) => {
                if (event.key !== "ArrowDown" || event.altKey || event.ctrlKey || event.metaKey) return;
                event.preventDefault();
                focusFirstResult();
              }}
            />
          </label>
          {typing && <FoundCount />}
          {typing && (
            <button type="button" class="icon-btn" aria-haspopup="dialog" onClick={openFilters}>
              <Icon name="filter" size={20} /><span class="sr">Filters</span><Tip text="Filters" at="end" />
            </button>
          )}
          {query.text && (
            <button type="button" class="icon-btn" aria-label="Clear search" onClick={() => { apply({ ...query, text: "" }); inputRef.current?.focus({ preventScroll: true }); }}>
              <Icon name="close" size={20} /><Tip text="Clear" at="end" />
            </button>
          )}
        </form>
      </header>

      {idle && <StoreNotice store={pins} what="pinned queries" fresh="the starter pins" />}
      {idle && pinList.length > 0 && (
        <section class="pins" aria-labelledby="pins-title">
          <h2 class="sr" id="pins-title">Pins</h2>
          <ChipLine as="plain" class="pins-line" listClass="pins-list" more={`All ${pinList.length}`}>
            {pinList.map((pin) => (
              <li key={pin.id}>
                <button type="button" class="pin" onClick={() => follow(pin)} disabled={(pinCounts.get(pin.id) ?? 0) === 0}>
                  <Icon name="pin" size={16} />
                  <span class="pin-name" dir="auto">{pin.name}</span>
                  <span class="pin-count">{pinCounts.get(pin.id) ?? 0}</span>
                </button>
              </li>
            ))}
          </ChipLine>
        </section>
      )}

      <AppList
        label="Search results"
        scope={model.entries}
        mixed
        quiet={typing}
        stripStart={!idle && (
          <button type="button" class={`tchip tchip-pin${pinned ? " is-on" : ""}`} aria-pressed={pinned !== null} onClick={togglePin}>
            <Icon name="pin" size={14} filled={pinned !== null} />{pinned ? "Pinned" : "Pin"}
          </button>
        )}
      >
        <CategoryHits text={query.text} />
      </AppList>
    </div>
  );
}
