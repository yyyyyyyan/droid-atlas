/**
 * Scroll capture and restoration for the window, which is the app's one
 * scroller. A virtualized list registers itself as the anchor source: it can
 * say which row is first in view, and where a given row sits in the document.
 * Restoration always goes through the anchor when there is one, because a
 * pixel offset is wrong the moment anything above the list changes height.
 */

import type { ScrollMemo, ScrollPlan } from "../router/router.ts";

export interface AnchorSource {
  /** The first row below the sticky bar, and its distance from the top of the viewport. */
  first(): { key: string; offset: number } | null;
  /** Renders the window around a row if needed and returns the row's distance from the top of the document. */
  locate(key: string): number | null;
  /** Re-reads the scroll position after it was set programmatically. */
  sync(): void;
}

let source: AnchorSource | null = null;
let pendingAnchor: string | null = null;

export function registerAnchorSource(next: AnchorSource): () => void {
  source = next;
  return () => {
    if (source === next) source = null;
  };
}

export function captureScroll(): ScrollMemo {
  return { y: Math.round(window.scrollY), anchor: source?.first() ?? null };
}

/** Tells the list about to render which row to build its first window around. Read once by the list. */
export function expectAnchor(plan: ScrollPlan): void {
  pendingAnchor = plan.kind === "restore" ? plan.memo.anchor?.key ?? null : null;
}

export function takeExpectedAnchor(): string | null {
  const key = pendingAnchor;
  pendingAnchor = null;
  return key;
}

let settling = 0;

function restoredTop(memo: ScrollMemo): number {
  const rowTop = memo.anchor && source ? source.locate(memo.anchor.key) : null;
  return Math.max(0, memo.anchor && rowTop !== null ? rowTop - memo.anchor.offset : memo.y);
}

/**
 * Applies a navigation's scroll plan. Runs after the view has rendered, so the
 * document is already tall enough. A restored position is checked again over
 * the next frames, because parts of a view that render a moment later (a
 * measured toggle, a caption that waits for the map's layout, a late font)
 * move the anchor row, and on a view without rows the browser's own scroll
 * anchoring answers such a change by moving the page off the stored offset;
 * the check stops as soon as the user touches the page.
 */
export function applyScroll(plan: ScrollPlan): void {
  cancelAnimationFrame(settling);
  if (plan.kind === "keep") return;
  if (plan.kind === "top") {
    window.scrollTo(0, 0);
    source?.sync();
    return;
  }
  const { memo } = plan;
  window.scrollTo(0, restoredTop(memo));
  source?.sync();

  let frames = 4;
  const stop = (): void => {
    frames = 0;
  };
  const check = (): void => {
    if (frames <= 0) {
      for (const type of ["pointerdown", "wheel", "keydown", "touchstart"]) window.removeEventListener(type, stop, true);
      return;
    }
    frames -= 1;
    const top = restoredTop(memo);
    if (Math.abs(top - window.scrollY) > 1) {
      window.scrollTo(0, top);
      source?.sync();
    }
    settling = requestAnimationFrame(check);
  };
  for (const type of ["pointerdown", "wheel", "keydown", "touchstart"]) window.addEventListener(type, stop, { capture: true, passive: true });
  settling = requestAnimationFrame(check);
}

/** Height of whatever is stuck to the top of the viewport over the list. */
export function stickyTop(): number {
  const bar = document.querySelector<HTMLElement>("[data-sticky-bar]");
  return bar ? bar.getBoundingClientRect().bottom : 0;
}
