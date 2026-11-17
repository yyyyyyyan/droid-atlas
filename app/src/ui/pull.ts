/**
 * Pull to refresh: the gesture's arithmetic and its states, with no DOM in
 * them. `PullToRefresh.tsx` feeds it touches and draws what it says.
 *
 * The feel is Android's own (`SwipeRefreshLayout`): the indicator travels
 * half as far as the finger, a release refreshes once the indicator has
 * come 64 px, and past that it follows more and more reluctantly up to twice
 * that distance.
 */

import type { UpdateResult } from "../offline/store.ts";

/**
 * What a finished look for a newer catalog means for the page that asked.
 * "show": the device now holds a catalog other than the one on screen, or
 * has no store to look in, so loading the page again is what shows the
 * newest. A check that stored the very catalog on screen (a first visit
 * stores what it was just served) found nothing new.
 *
 * @param outcome null where this browser keeps no offline copy to compare with
 * @param shown the hash of the catalog on screen
 */
export function pullResult(outcome: UpdateResult | null, shown: string): "show" | "current" | "offline" | "other" {
  if (!outcome) return "show";
  if (outcome.result === "current" || outcome.result === "updated") return outcome.version.hash === shown ? "current" : "show";
  return outcome.result === "offline" ? "offline" : "other";
}

/** How far the indicator has to come down for a release to refresh, in CSS px. */
export const PULL_THRESHOLD = 64;
/** The indicator moves this fraction of the finger's distance. */
export const DRAG_RATE = 0.5;
/** How far a touch has to travel before it is taken for a pull, or given up as something else. */
export const TOUCH_SLOP = 10;

/** How far down the indicator is for a finger that has moved `distance` px down since the pull began. */
export function indicatorOffset(distance: number): number {
  const dragged = Math.max(0, distance) * DRAG_RATE;
  const within = Math.min(dragged, PULL_THRESHOLD);
  const past = Math.min(Math.max(0, dragged - PULL_THRESHOLD), PULL_THRESHOLD * 2) / PULL_THRESHOLD;
  const tension = (past / 4 - (past / 4) ** 2) * 2;
  return within + PULL_THRESHOLD * tension * 2;
}

/** Whether a release at this finger distance refreshes. */
export function isArmed(distance: number): boolean {
  return distance * DRAG_RATE >= PULL_THRESHOLD;
}

export type PullState =
  | { phase: "idle" }
  /** A touch that began where a pull may begin, and has not yet said what it is. */
  | { phase: "watching"; id: number; x: number; y: number }
  | { phase: "pulling"; id: number; from: number; distance: number }
  /** Released past the threshold: the check is running. */
  | { phase: "refreshing" }
  /** Released short of it, or interrupted: the indicator goes back and nothing else happens. */
  | { phase: "settling" };

export type PullEvent =
  /** `eligible`: the page is at its very top, nothing modal is open, and the touch is not on something that takes a drag itself. */
  | { type: "start"; id: number; x: number; y: number; touches: number; eligible: boolean }
  | { type: "move"; id: number; x: number; y: number; atTop: boolean }
  | { type: "end"; id: number }
  /** The touch was taken away, a second finger came down, or the page was hidden. */
  | { type: "cancel" }
  /** The indicator has gone back, or the check has finished and its result has been shown. */
  | { type: "rest" };

export const IDLE: PullState = { phase: "idle" };

/**
 * The next state. A touch becomes a pull only when it starts eligible, with
 * one finger, and its first movement past the slop is more down than
 * sideways; anything else leaves the touch to the page. While the check
 * runs, and while the indicator goes back, touches are not watched.
 */
export function nextPull(state: PullState, event: PullEvent): PullState {
  if (event.type === "rest") return state.phase === "refreshing" || state.phase === "settling" ? IDLE : state;
  if (state.phase === "refreshing" || state.phase === "settling") return state;
  if (event.type === "cancel") return state.phase === "pulling" ? { phase: "settling" } : IDLE;

  if (event.type === "start") {
    if (state.phase === "pulling") return { phase: "settling" };
    return event.eligible && event.touches === 1 ? { phase: "watching", id: event.id, x: event.x, y: event.y } : IDLE;
  }
  if (state.phase === "idle" || event.id !== state.id) return state;

  if (event.type === "end") {
    if (state.phase === "watching") return IDLE;
    return isArmed(state.distance) ? { phase: "refreshing" } : { phase: "settling" };
  }

  if (state.phase === "watching") {
    const dx = event.x - state.x;
    const dy = event.y - state.y;
    if (!event.atTop) return IDLE;
    if (Math.abs(dx) < TOUCH_SLOP && Math.abs(dy) < TOUCH_SLOP) return state;
    if (dy <= 0 || Math.abs(dx) >= dy) return IDLE;
    return { phase: "pulling", id: state.id, from: event.y, distance: 0 };
  }
  return { ...state, distance: Math.max(0, event.y - state.from) };
}
