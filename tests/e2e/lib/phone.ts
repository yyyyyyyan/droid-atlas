/**
 * The phone the product is judged on, as closely as desktop Chromium can stand
 * in for it: a 384×688 CSS px tab at a device pixel ratio of 3.75, with touch.
 *
 * Gestures are real touch input, dispatched through the DevTools protocol's
 * `Input.dispatchTouchEvent`, so the browser itself decides what a movement
 * is (a scroll, a pointercancel, a click) exactly as it does for a finger.
 * Nothing here synthesizes DOM events.
 */

import type { BrowserContextOptions, CDPSession, Page } from "@playwright/test";

export const PHONE_VIEWPORT = { width: 384, height: 688 } as const;
export const PHONE_PIXEL_RATIO = 3.75;

export const PHONE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";

export const PHONE_CONTEXT: BrowserContextOptions = {
  viewport: { ...PHONE_VIEWPORT },
  deviceScaleFactor: PHONE_PIXEL_RATIO,
  isMobile: true,
  hasTouch: true,
  userAgent: PHONE_USER_AGENT,
};

export interface Point {
  x: number;
  y: number;
}

export interface DragOptions {
  /** How long the finger takes from start to end, in milliseconds. */
  duration?: number;
  /** How long the finger rests at the end before lifting. A fling lifts at once. */
  hold?: number;
  steps?: number;
}

const sessions = new WeakMap<Page, Promise<CDPSession>>();

function session(page: Page): Promise<CDPSession> {
  let pending = sessions.get(page);
  if (!pending) {
    pending = page.context().newCDPSession(page);
    sessions.set(page, pending);
  }
  return pending;
}

/** `at` is the event's own time in seconds since the epoch; without it the browser stamps the event when it arrives. */
async function dispatch(page: Page, type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", point: Point | null, at?: number): Promise<void> {
  const cdp = await session(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: point ? [{ x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100, radiusX: 4, radiusY: 4, force: 0.5, id: 1 }] : [],
    ...(at === undefined ? {} : { timestamp: at }),
  });
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A finger put down and lifted in place. */
export async function tap(page: Page, point: Point): Promise<void> {
  await dispatch(page, "touchStart", point);
  await pause(40);
  await dispatch(page, "touchEnd", null);
}

/**
 * A finger put down at `from`, moved to `to` and lifted. With the default
 * `hold` of zero the finger is still moving when it lifts, which is a fling;
 * a `hold` lets the movement come to rest first, which is a drag.
 */
export async function drag(page: Page, from: Point, to: Point, options: DragOptions = {}): Promise<void> {
  const { duration = 240, hold = 0, steps = Math.max(4, Math.round(duration / 16)) } = options;
  await dispatch(page, "touchStart", from);
  for (let step = 1; step <= steps; step += 1) {
    await pause(duration / steps);
    const t = step / steps;
    await dispatch(page, "touchMove", { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  if (hold > 0) {
    await pause(hold);
    await dispatch(page, "touchMove", to);
  }
  await dispatch(page, "touchEnd", null);
}

/**
 * A quick flick from `from` to `to`: the finger covers the distance in two
 * movements and lifts at once. Each dispatch through the protocol takes tens
 * of milliseconds on a busy machine, so a gesture of many small steps is
 * never fast; this is the shape that reaches the page as a fling.
 *
 * With `duration` the events carry their own times, so the browser sees the
 * finger cover the distance in that many milliseconds however long the
 * dispatches take: the way to throw a page as hard as a thumb does.
 */
export async function fling(page: Page, from: Point, to: Point, options: { duration?: number } = {}): Promise<void> {
  const began = Date.now() / 1000;
  const at = (share: number): number | undefined => (options.duration === undefined ? undefined : began + (options.duration * share) / 1000);
  await dispatch(page, "touchStart", from, at(0));
  await dispatch(page, "touchMove", { x: from.x + (to.x - from.x) * 0.45, y: from.y + (to.y - from.y) * 0.45 }, at(0.45));
  await dispatch(page, "touchMove", to, at(1));
  await dispatch(page, "touchEnd", null, at(1.02));
}

/** Puts a finger down and moves it, leaving it on the glass: for looking at what is on screen mid-gesture. End with `release`. */
export async function dragAndHold(page: Page, from: Point, to: Point, options: DragOptions = {}): Promise<void> {
  const { duration = 240, steps = Math.max(4, Math.round(duration / 16)) } = options;
  await dispatch(page, "touchStart", from);
  for (let step = 1; step <= steps; step += 1) {
    await pause(duration / steps);
    const t = step / steps;
    await dispatch(page, "touchMove", { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
}

export async function release(page: Page): Promise<void> {
  await dispatch(page, "touchEnd", null);
}

/** The center of the first element matching `selector`, in CSS px of the viewport. */
export async function centerOf(page: Page, selector: string): Promise<Point> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`nothing on screen matches ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
