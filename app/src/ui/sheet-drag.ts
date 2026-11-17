/**
 * Dragging a bottom sheet with a finger: the sheet follows the touch, and
 * where it is let go decides whether it closes, springs back, or rests at
 * another of its heights.
 *
 * A sheet has one or two resting heights ("detents"). `visible` is how many
 * pixels of the sheet are on screen; at or above the lowest detent the sheet
 * changes height, below it the sheet slides down as a whole.
 *
 * Which gestures the sheet takes:
 * - one that starts outside the scrolling content (the handle, the header,
 *   the foot), or on a part of the content marked `data-sheet-grip` (the app
 *   sheet's own header, which scrolls with its content): always;
 * - one that starts in the content: while the sheet is below its tallest
 *   height, always; at its tallest height, only a downward one that begins
 *   with the content scrolled to its top. Every other gesture in the content
 *   is the content's own scroll and is left to the browser.
 *
 * A gesture the sheet takes is canceled for the browser from its first
 * movement, so it never becomes a scroll of anything else or a pull-to-refresh.
 *
 * A drag follows its own finger, by the touch's identifier, and not the count
 * of touches on the screen: a finger that tapped a link to another app may
 * still be counted when the page comes back, and must not make the next
 * gesture look like a second finger. When the page is hidden, or the browser
 * takes the pointer away, the gesture in progress is dropped
 * (`gesture-lost.ts`).
 */

import { onGestureLost } from "./gesture-lost.ts";

/** Movement, in px, before a touch counts as a drag in one direction. */
const SLOP = 6;
/** How far ahead, in ms, the release velocity is projected to choose where the sheet comes to rest. */
const PROJECT_MS = 200;
/** A sheet let go (or thrown) to below this share of its lowest height closes: a drag of a little over a quarter of it. */
const CLOSE_BELOW = 0.72;
/** The velocity is read from the samples of the last this-many ms, so one late, slow sample does not cancel a fling. */
const VELOCITY_WINDOW_MS = 100;
/** How far past its tallest height the sheet can be pulled, and how hard it resists. */
const OVERPULL_MAX = 28;
const OVERPULL_RESISTANCE = 0.25;
const SETTLE_MS = 220;

export type SheetRest = number | "close";

/**
 * Where a sheet comes to rest when it is let go.
 *
 * @param visible  px of the sheet on screen at release
 * @param velocity px per ms at release; positive is downward
 * @param detents  resting heights in px, ascending
 */
export function settleSheet(visible: number, velocity: number, detents: readonly number[]): SheetRest {
  const lowest = detents[0];
  if (lowest === undefined) return "close";
  const projected = visible - velocity * PROJECT_MS;
  if (projected < lowest * CLOSE_BELOW) return "close";
  let nearest = lowest;
  for (const detent of detents) {
    if (Math.abs(detent - projected) < Math.abs(nearest - projected)) nearest = detent;
  }
  return nearest;
}

/** The sheet's position while it is held: free between closed and its tallest height, resisting beyond that. */
export function heldPosition(start: number, movedDown: number, tallest: number): number {
  const wanted = start - movedDown;
  if (wanted <= tallest) return Math.max(0, wanted);
  return tallest + Math.min(OVERPULL_MAX, (wanted - tallest) * OVERPULL_RESISTANCE);
}

export interface Sample {
  y: number;
  t: number;
}

/** Downward velocity in px per ms over the most recent samples; zero when the finger rested before lifting. */
export function releaseVelocity(samples: readonly Sample[], now: number): number {
  const last = samples[samples.length - 1];
  if (!last || now - last.t > VELOCITY_WINDOW_MS) return 0;
  let first = last;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index];
    if (!sample || last.t - sample.t > VELOCITY_WINDOW_MS) break;
    first = sample;
  }
  const elapsed = last.t - first.t;
  return elapsed > 0 ? (last.y - first.y) / elapsed : 0;
}

export interface SheetDragOptions {
  /** The sheet's resting heights in px, ascending, measured when a drag starts. */
  detents(): number[];
  /** The scrolling content inside the sheet, if it has any. */
  scroller(): HTMLElement | null;
  /** Called when the sheet has come to rest at a height other than the one it started from. */
  onRest(height: number): void;
  /** Called when the sheet has slid off the screen. It stays there until the owner closes it. */
  onClose(): void;
  /** False turns dragging off without detaching (the wide layout, where the sheet is not at the bottom). */
  enabled(): boolean;
  reducedMotion(): boolean;
}

interface Drag {
  startY: number;
  startX: number;
  startVisible: number;
  detents: number[];
  inContent: boolean;
  taken: boolean;
  samples: Sample[];
  /** The mouse or pen that drags, or null for a finger. */
  pointerId: number | null;
  /** The finger that drags, or null for a mouse or pen. */
  touchId: number | null;
}

function styleFor(sheet: HTMLElement, visible: number, detents: readonly number[]): void {
  const lowest = detents[0] ?? visible;
  if (detents.length > 1) sheet.style.height = `${Math.max(visible, lowest)}px`;
  const below = Math.max(0, lowest - visible);
  sheet.style.transform = below > 0 ? `translateY(${below}px)` : "";
  sheet.style.setProperty("--sheet-scrim", String(Math.max(0, Math.min(1, visible / lowest))));
}

/** Removes everything a drag wrote on the sheet, so its own styles decide again. */
export function clearSheetDrag(sheet: HTMLElement): void {
  sheet.classList.remove("is-dragging", "is-settling");
  sheet.style.removeProperty("height");
  sheet.style.removeProperty("transform");
  sheet.style.removeProperty("--sheet-scrim");
}

/**
 * Makes `sheet` draggable. Returns a function that removes the listeners.
 *
 * Touch input is handled through touch events, because only a `touchmove`
 * can be canceled before the browser turns the movement into a scroll. A
 * mouse or pen drags from outside the content through pointer events.
 */
export function attachSheetDrag(sheet: HTMLElement, options: SheetDragOptions): () => void {
  let drag: Drag | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** What the settle under way does when it is over, so a page hidden mid-settle can finish it at once. */
  let settled: (() => void) | null = null;
  let swallowClick = false;

  const begin = (x: number, y: number, target: EventTarget | null, pointerId: number | null, touchId: number | null): void => {
    if (!options.enabled() || !(target instanceof Element) || target.closest("textarea, input, select")) return;
    if (settleTimer !== null) return;
    const scroller = options.scroller();
    drag = {
      startX: x,
      startY: y,
      startVisible: sheet.getBoundingClientRect().height,
      detents: options.detents(),
      inContent: scroller !== null && scroller.contains(target) && target.closest("[data-sheet-grip]") === null,
      taken: false,
      samples: [{ y, t: performance.now() }],
      pointerId,
      touchId,
    };
  };

  /** Decides, at the first clear movement, whether this gesture is the sheet's. Returns false when it is not. */
  const claim = (state: Drag, dx: number, dy: number): boolean => {
    if (Math.abs(dx) > Math.abs(dy)) return false;
    if (!state.inContent) return true;
    const tallest = state.detents[state.detents.length - 1] ?? state.startVisible;
    if (state.startVisible < tallest - 1) return true;
    return dy > 0 && (options.scroller()?.scrollTop ?? 0) <= 0;
  };

  const move = (x: number, y: number, event: Event): void => {
    const state = drag;
    if (!state) return;
    const dx = x - state.startX;
    const dy = y - state.startY;
    if (!state.taken) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (!claim(state, dx, dy)) {
        drag = null;
        return;
      }
      state.taken = true;
      /* The slop is not part of the drag: the sheet starts moving from where the finger is now, without a jump. */
      state.startY = y;
      sheet.classList.add("is-dragging");
    }
    if (event.cancelable) event.preventDefault();
    const now = performance.now();
    state.samples.push({ y, t: now });
    if (state.samples.length > 12) state.samples.shift();
    const tallest = state.detents[state.detents.length - 1] ?? state.startVisible;
    styleFor(sheet, heldPosition(state.startVisible, y - state.startY, tallest), state.detents);
  };

  const finish = (): void => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
    settled = null;
  };

  const end = (): void => {
    const state = drag;
    drag = null;
    if (!state?.taken) return;
    swallowClick = state.pointerId !== null;
    const last = state.samples[state.samples.length - 1];
    const tallest = state.detents[state.detents.length - 1] ?? state.startVisible;
    const visible = heldPosition(state.startVisible, (last?.y ?? state.startY) - state.startY, tallest);
    const rest = settleSheet(visible, releaseVelocity(state.samples, performance.now()), state.detents);
    const instant = options.reducedMotion();

    sheet.classList.remove("is-dragging");
    const done = (): void => {
      finish();
      if (rest === "close") {
        options.onClose();
        return;
      }
      if (Math.abs(rest - state.startVisible) > 1) options.onRest(rest);
      clearSheetDrag(sheet);
    };
    if (instant) {
      if (rest === "close") sheet.style.transform = "translateY(100%)";
      done();
      return;
    }
    sheet.classList.add("is-settling");
    if (rest === "close") {
      sheet.style.transform = "translateY(100%)";
      sheet.style.setProperty("--sheet-scrim", "0");
    } else {
      styleFor(sheet, rest, state.detents);
    }
    settled = done;
    settleTimer = setTimeout(done, SETTLE_MS);
  };

  /* A gesture that cannot end the ordinary way is dropped; a page that is hidden also lands a settle that was under way, since its timer may not run until the page is back. */
  const stopTracking = onGestureLost((loss) => {
    if (loss.kind === "hidden") {
      drag = null;
      swallowClick = false;
      settled?.();
      return;
    }
    if (drag && (drag.pointerId === loss.pointerId || !drag.taken)) drag = null;
  });

  const own = (list: TouchList, id: number | null): Touch | null => {
    for (const touch of list) if (touch.identifier === id) return touch;
    return null;
  };
  const onTouchStart = (event: TouchEvent): void => {
    /* A second finger on a drag in progress lets go of the drag; a finger the page lost track of does not count. */
    if (drag && drag.touchId !== null && own(event.touches, drag.touchId)) {
      drag = null;
      return;
    }
    const touch = event.changedTouches[0];
    if (!touch) return;
    begin(touch.clientX, touch.clientY, event.target, null, touch.identifier);
  };
  const onTouchMove = (event: TouchEvent): void => {
    const touch = drag ? own(event.changedTouches, drag.touchId) : null;
    if (!touch) return;
    move(touch.clientX, touch.clientY, event);
  };
  const onTouchEnd = (event: TouchEvent): void => {
    if (drag && own(event.changedTouches, drag.touchId)) end();
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    const scroller = options.scroller();
    if (scroller && event.target instanceof Node && scroller.contains(event.target)) return;
    begin(event.clientX, event.clientY, event.target, event.pointerId, null);
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasTaken = drag.taken;
    move(event.clientX, event.clientY, event);
    if (!wasTaken && drag?.taken) sheet.setPointerCapture(event.pointerId);
  };
  const onPointerUp = (event: PointerEvent): void => {
    if (drag?.pointerId === event.pointerId) end();
  };
  const onClick = (event: MouseEvent): void => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  sheet.addEventListener("touchstart", onTouchStart, { passive: true });
  sheet.addEventListener("touchmove", onTouchMove, { passive: false });
  sheet.addEventListener("touchend", onTouchEnd);
  sheet.addEventListener("touchcancel", onTouchEnd);
  sheet.addEventListener("pointerdown", onPointerDown);
  sheet.addEventListener("pointermove", onPointerMove);
  sheet.addEventListener("pointerup", onPointerUp);
  sheet.addEventListener("pointercancel", onPointerUp);
  sheet.addEventListener("click", onClick, true);

  return () => {
    stopTracking();
    finish();
    drag = null;
    sheet.removeEventListener("touchstart", onTouchStart);
    sheet.removeEventListener("touchmove", onTouchMove);
    sheet.removeEventListener("touchend", onTouchEnd);
    sheet.removeEventListener("touchcancel", onTouchEnd);
    sheet.removeEventListener("pointerdown", onPointerDown);
    sheet.removeEventListener("pointermove", onPointerMove);
    sheet.removeEventListener("pointerup", onPointerUp);
    sheet.removeEventListener("pointercancel", onPointerUp);
    sheet.removeEventListener("click", onClick, true);
  };
}
