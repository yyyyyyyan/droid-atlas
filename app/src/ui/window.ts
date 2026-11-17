/**
 * The arithmetic of a windowed list: which rows to render for a given scroll
 * position and speed. Pure, so it can be tested without a browser.
 *
 * A fling scrolls on the compositor, ahead of anything the page's own code
 * can do, so the rows have to be there before the scroll arrives: the list
 * keeps several screens of rows on each side at rest, and as many more in the
 * direction of travel as the scroll covers in `LOOKAHEAD_MS` at its present
 * speed.
 */

/** Rows beyond the screen in the first window of a list, before its place on the page is known. */
export const OVERSCAN = 6;

/** Rows kept beyond the screen in the first render after the items changed; the rest follow a moment later. */
export const QUICK_OVERSCAN = 1;

/** Screens of rows kept ready on each side of the viewport, whatever the list is doing. */
export const REST_SCREENS = 3;

/** A moving list keeps ready the rows it will reach within this long at its present speed. */
export const LOOKAHEAD_MS = 700;

/** The most screens of rows kept ready in the direction of travel, however fast the scroll. */
export const MAX_AHEAD_SCREENS = 16;

/** The fastest scroll the list plans for, in px per ms. Flings thrown one on another go faster; they are still flings, and count at this speed in their direction. */
export const TOP_SPEED = 40;

/** Faster than any fling, in px per ms: a jump made by the page itself (restoring a position), which says nothing about where the list goes next. */
export const JUMP_SPEED = 200;

export interface WindowRange {
  start: number;
  end: number;
}

function rowsBetween(from: number, to: number, rowHeight: number, count: number): WindowRange {
  const start = Math.max(0, Math.min(count, Math.floor(from / rowHeight)));
  const end = Math.max(start, Math.min(count, Math.ceil(to / rowHeight)));
  return { start, end };
}

/** The rows to render when the list's top edge is `listTop` px below the top of a viewport `viewportHeight` px tall. */
export function windowFor(listTop: number, viewportHeight: number, rowHeight: number, count: number, overscan = OVERSCAN): WindowRange {
  return rowsBetween(-listTop - overscan * rowHeight, viewportHeight - listTop + overscan * rowHeight, rowHeight, count);
}

/**
 * The rows to keep ready for a list that is scrolling.
 *
 * @param velocity px per ms; positive while the page scrolls down (later rows arrive), negative while it scrolls up
 * @param share the part of the full allowance to cover: 1 for the window to render, less for the window that must already be there
 */
export function travelWindow(listTop: number, viewportHeight: number, rowHeight: number, count: number, velocity = 0, share = 1): WindowRange {
  const rest = REST_SCREENS * viewportHeight;
  const reach = Math.min(MAX_AHEAD_SCREENS * viewportHeight, rest + Math.abs(velocity) * LOOKAHEAD_MS);
  const before = (velocity < 0 ? reach : rest) * share;
  const after = (velocity > 0 ? reach : rest) * share;
  return rowsBetween(-listTop - before, viewportHeight - listTop + after, rowHeight, count);
}

/**
 * Whether the rendered rows still leave a scrolling list room: at least half
 * of what `travelWindow` would keep on each side. While they do, nothing is
 * rendered, so a scroll costs a few comparisons per frame and rows arrive in
 * batches, well before they are needed.
 */
export function coversTravel(range: WindowRange, listTop: number, viewportHeight: number, rowHeight: number, count: number, velocity = 0): boolean {
  const needed = travelWindow(listTop, viewportHeight, rowHeight, count, velocity, 0.5);
  return range.start <= needed.start && range.end >= needed.end;
}

/**
 * The speed of a scroll from two positions, in px per ms, at most
 * `TOP_SPEED` either way. A step faster than any finger can throw a page,
 * and the first step after a pause, count as no speed at all.
 */
export function scrollVelocity(distance: number, elapsed: number): number {
  if (elapsed <= 0 || elapsed > 150) return 0;
  const velocity = distance / elapsed;
  if (Math.abs(velocity) > JUMP_SPEED) return 0;
  return Math.max(-TOP_SPEED, Math.min(TOP_SPEED, velocity));
}

/** The window to render before any layout is known: around an expected row, else the top of the list. */
export function initialWindow(index: number, viewportHeight: number, rowHeight: number, count: number, overscan = OVERSCAN): WindowRange {
  const visible = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, Math.min(count, index - overscan - 2));
  return { start, end: Math.min(count, Math.max(index, 0) + visible + overscan) };
}

export function sameWindow(a: WindowRange, b: WindowRange): boolean {
  return a.start === b.start && a.end === b.end;
}
