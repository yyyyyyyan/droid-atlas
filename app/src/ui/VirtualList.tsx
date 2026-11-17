/**
 * A windowed list of fixed-height rows that scrolls with the page. Only the
 * rows near the viewport exist in the DOM; the list element keeps the full
 * height, and each row says its position in the whole set, so the scrollbar
 * and assistive technology see the real list.
 *
 * The first window is built around a known row when one is expected (returning
 * to a list), so the rows are there before the page is scrolled to them.
 *
 * When the items themselves change (a keystroke, a filter), the list first
 * renders little more than the rows on screen, in the same pass as the change,
 * and adds the rows kept ready for scrolling a moment later. That keeps a
 * query update inside one frame.
 *
 * A fling moves the page on the compositor, ahead of this code, so rows are
 * kept ready well beyond the screen (window.ts): screens of them on each
 * side, and more in the direction of travel the faster the page moves. The
 * window is placed inside the scroll event itself, from the position and
 * speed that event reports, and is left alone while it still has room, so a
 * scroll renders rows in batches long before they come into view.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useReducer, useRef } from "preact/hooks";
import { registerAnchorSource, stickyTop, takeExpectedAnchor } from "./scroll.ts";
import { coversTravel, initialWindow, QUICK_OVERSCAN, sameWindow, scrollVelocity, travelWindow, windowFor, type WindowRange } from "./window.ts";

/** How long after the items changed the rows beyond the screen are added. */
const FILL_DELAY_MS = 140;

interface Props<T> {
  items: readonly T[];
  rowHeight: number;
  keyOf(item: T): string;
  renderRow(item: T, index: number): ComponentChildren;
  label: string;
  class?: string;
}

export function VirtualList<T>({ items, rowHeight, keyOf, renderRow, label, class: className }: Props<T>) {
  const listRef = useRef<HTMLOListElement>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const latest = useRef({ items, rowHeight, keyOf });
  const range = useRef<WindowRange | null>(null);
  /** Distance of the list's top edge from the top of the viewport at the last measurement. */
  const top = useRef<number | null>(null);
  const quick = useRef(true);
  /** Px per ms of the scroll under way; zero at rest. */
  const velocity = useRef(0);

  if (range.current === null) {
    const expected = takeExpectedAnchor();
    const index = expected === null ? 0 : Math.max(0, items.findIndex((item) => keyOf(item) === expected));
    range.current = initialWindow(index, window.innerHeight, rowHeight, items.length);
  } else if (latest.current.items !== items && top.current !== null) {
    quick.current = true;
    range.current = windowFor(top.current, window.innerHeight, rowHeight, items.length, QUICK_OVERSCAN);
  }
  latest.current = { items, rowHeight, keyOf };

  const measure = (): void => {
    const list = listRef.current;
    if (!list) return;
    const { items: current, rowHeight: height } = latest.current;
    top.current = list.getBoundingClientRect().top;
    const viewport = window.innerHeight;
    if (!quick.current && range.current && coversTravel(range.current, top.current, viewport, height, current.length, velocity.current)) return;
    const next = quick.current
      ? windowFor(top.current, viewport, height, current.length, QUICK_OVERSCAN)
      : travelWindow(top.current, viewport, height, current.length, velocity.current);
    if (range.current && sameWindow(range.current, next)) return;
    range.current = next;
    rerender(0);
  };

  useEffect(() => {
    let lastY = window.scrollY;
    let lastTime = 0;
    const onScroll = (event: Event): void => {
      const y = window.scrollY;
      velocity.current = scrollVelocity(y - lastY, event.timeStamp - lastTime);
      lastY = y;
      lastTime = event.timeStamp;
      quick.current = false;
      measure();
    };
    const atRest = (): void => {
      velocity.current = 0;
      quick.current = false;
      measure();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scrollend", atRest, { passive: true });
    window.addEventListener("resize", atRest, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("scrollend", atRest);
      window.removeEventListener("resize", atRest);
    };
  }, []);

  useLayoutEffect(measure, [items, rowHeight]);

  useEffect(() => {
    if (!quick.current) return undefined;
    const timer = setTimeout(() => {
      quick.current = false;
      velocity.current = 0;
      measure();
    }, FILL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [items]);

  useLayoutEffect(() => registerAnchorSource({
    first() {
      const list = listRef.current;
      const { items: current, rowHeight: height, keyOf: key } = latest.current;
      if (!list || !current.length) return null;
      const listTop = list.getBoundingClientRect().top;
      const index = Math.max(0, Math.min(current.length - 1, Math.floor((stickyTop() - listTop) / height)));
      const item = current[index];
      return item === undefined ? null : { key: key(item), offset: Math.round(listTop + index * height) };
    },
    locate(key) {
      const list = listRef.current;
      const { items: current, rowHeight: height, keyOf: keyFor } = latest.current;
      const index = current.findIndex((item) => keyFor(item) === key);
      if (!list || index === -1) return null;
      return list.getBoundingClientRect().top + window.scrollY + index * height;
    },
    sync() {
      quick.current = false;
      velocity.current = 0;
      measure();
    },
  }), []);

  const start = Math.min(range.current.start, items.length);
  const end = Math.min(range.current.end, items.length);
  const rows: ComponentChildren[] = [];
  for (let index = start; index < end; index += 1) {
    const item = items[index];
    if (item !== undefined) rows.push(renderRow(item, index));
  }

  return (
    <ol
      ref={listRef}
      class={className}
      aria-label={label}
      style={{ height: `${items.length * rowHeight}px`, paddingTop: `${start * rowHeight}px` }}
    >
      {rows}
    </ol>
  );
}

/**
 * Scrolls just enough to bring a row of the list on screen, between the sticky
 * bar and `bottomInset` px from the bottom. Does nothing when the row is
 * already there.
 */
export function revealRow(list: HTMLElement | null, index: number, rowHeight: number, bottomInset: number): void {
  if (!list || index < 0) return;
  const top = list.getBoundingClientRect().top + index * rowHeight;
  const upper = stickyTop();
  const lower = window.innerHeight - bottomInset;
  if (top < upper) window.scrollBy(0, top - upper - 8);
  else if (top + rowHeight > lower) window.scrollBy(0, top + rowHeight - lower + 8);
}
