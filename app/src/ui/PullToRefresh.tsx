/**
 * Pull to refresh, as the app's own gesture: with the page at its very top,
 * a finger dragging down brings a disc out of the top edge, and letting go
 * past the threshold looks for a newer catalog, as "Check for a newer
 * catalog" on Data health does. The browser's own pull to reload stays off
 * (`overscroll-behavior` in base.css): reloading would only show the catalog
 * already on the device.
 *
 * What a person then sees, in one line above the bottom bar, where the app
 * says things for a moment (the disc only turns at the top edge):
 * - nothing newer: "Up to date · catalog of <date>";
 * - the site out of reach: "Offline · catalog of <date>", said as calmly;
 * - a newer catalog: the page loads again on it, at the same place, and
 *   says "New catalog · <date>" on arrival.
 *
 * Touch only, and only where the pointer is coarse. Never with a sheet or a
 * dialog open, never from the bar at the bottom or from something that
 * scrolls by itself, and a sideways swipe stays with what it is on
 * (`pull.ts` decides). The listeners are passive: nothing here can hold a
 * scroll back.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { formatDay, parseTime } from "../lib/format.ts";
import { checkNow, offlineStatus } from "../offline/client.ts";
import { useServices } from "../services.ts";
import { IDLE, PULL_THRESHOLD, indicatorOffset, nextPull, pullResult, type PullEvent, type PullState } from "./pull.ts";
import { describeCheck } from "./UpdateStatus.tsx";

const ARRIVED_FLAG = "droid-atlas:v1:pulled";
/** The least time "Checking…" stays up, so a quick answer does not flash by. */
const MIN_CHECK_MS = 500;
const RESULT_MS = 2400;
const SETTLE_MS = 220;
/** The arc at its longest, in hundredths of the circle. */
const ARC_FULL = 78;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True where a touch may begin a pull: the page at its top, nothing modal open, and the touch on nothing that takes a vertical drag itself. */
function mayBegin(target: EventTarget | null): boolean {
  if (window.scrollY > 0 || document.documentElement.classList.contains("is-modal") || document.querySelector("dialog[open]")) return false;
  for (let node = target instanceof Element ? target : null; node && node !== document.body; node = node.parentElement) {
    if (node.matches(".nav, .sheet, .undo-bar")) return false;
    if (node.scrollHeight > node.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return false;
  }
  return true;
}

export function PullToRefresh() {
  const { build, model } = useServices();
  const ref = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState("");
  const built = parseTime(model.catalog.generatedAt);
  const date = built !== null ? formatDay(built) : "an earlier day";

  useEffect(() => {
    const element = ref.current;
    if (!element || !window.matchMedia("(pointer: coarse)").matches) return undefined;
    const arc = element.querySelector<SVGElement>(".pull-arc");
    const root = document.documentElement;
    let state: PullState = IDLE;
    let live = true;

    const show = (phase: string): void => {
      element.dataset.phase = phase;
      if (phase !== "pulling") {
        element.style.removeProperty("--pull");
        arc?.style.removeProperty("rotate");
        if (phase !== "settling") arc?.style.setProperty("stroke-dasharray", `${ARC_FULL} 100`);
      }
    };
    const say = async (text: string): Promise<void> => {
      show("said");
      setLabel(text);
      await wait(RESULT_MS);
      if (!live) return;
      show("leaving");
      await wait(SETTLE_MS);
      if (!live) return;
      setLabel("");
      show("idle");
    };
    const refresh = async (): Promise<void> => {
      setLabel("Checking…");
      const before = offlineStatus.peek().lastCheck;
      const started = Date.now();
      await checkNow(build.dataRoot);
      const check = offlineStatus.peek().lastCheck;
      const outcome = check && check !== before ? check.outcome : null;
      await wait(Math.max(0, MIN_CHECK_MS - (Date.now() - started)));
      if (!live) return;
      const result = pullResult(outcome, build.version.hash);
      if (result === "show") {
        try {
          if (outcome) sessionStorage.setItem(ARRIVED_FLAG, "1");
        } catch {
          /* Without the flag the newer catalog arrives unannounced. */
        }
        window.location.reload();
        return;
      }
      const words = outcome && result === "other" ? describeCheck(outcome) : "";
      await say(result === "current" ? `Up to date · catalog of ${date}` : result === "offline" ? `Offline · catalog of ${date}` : words.charAt(0).toUpperCase() + words.slice(1));
      state = nextPull(state, { type: "rest" });
    };
    const apply = (event: PullEvent): void => {
      const before = state;
      state = nextPull(state, event);
      if (state === before) return;
      if (state.phase === "pulling") {
        const offset = indicatorOffset(state.distance);
        const progress = Math.min(1, offset / PULL_THRESHOLD);
        element.style.setProperty("--pull", `${offset}px`);
        arc?.style.setProperty("stroke-dasharray", `${progress * ARC_FULL} 100`);
        arc?.style.setProperty("rotate", `${(offset / PULL_THRESHOLD) * 270 - 90}deg`);
        show("pulling");
      } else if (state.phase === "refreshing") {
        show("refreshing");
        void refresh();
      } else if (state.phase === "settling") {
        show("settling");
        setTimeout(() => {
          if (!live) return;
          show("idle");
          apply({ type: "rest" });
        }, SETTLE_MS);
      }
    };

    const onStart = (event: TouchEvent): void => {
      const touch = event.changedTouches[0];
      if (touch) apply({ type: "start", id: touch.identifier, x: touch.clientX, y: touch.clientY, touches: event.touches.length, eligible: mayBegin(event.target) });
    };
    const onMove = (event: TouchEvent): void => {
      if (state.phase !== "watching" && state.phase !== "pulling") return;
      for (const touch of Array.from(event.changedTouches)) apply({ type: "move", id: touch.identifier, x: touch.clientX, y: touch.clientY, atTop: window.scrollY <= 0 });
    };
    const onEnd = (event: TouchEvent): void => {
      for (const touch of Array.from(event.changedTouches)) apply({ type: "end", id: touch.identifier });
    };
    const onLost = (): void => apply({ type: "cancel" });
    const onHidden = (): void => {
      if (document.visibilityState === "hidden") onLost();
    };
    const atTop = (): void => {
      root.classList.toggle("is-at-top", window.scrollY <= 0);
    };

    atTop();
    const passive = { passive: true } as const;
    document.addEventListener("touchstart", onStart, passive);
    document.addEventListener("touchmove", onMove, passive);
    document.addEventListener("touchend", onEnd, passive);
    document.addEventListener("touchcancel", onLost, passive);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("scroll", atTop, passive);

    try {
      if (sessionStorage.getItem(ARRIVED_FLAG)) {
        sessionStorage.removeItem(ARRIVED_FLAG);
        void say(`New catalog · ${date}`);
      }
    } catch {
      /* No session storage: the newer catalog arrives unannounced. */
    }

    return () => {
      live = false;
      root.classList.remove("is-at-top");
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onLost);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("scroll", atTop);
    };
  }, []);

  return (
    <div class="pull" data-phase="idle" ref={ref}>
      <svg class="pull-arc" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="8" pathLength="100" /></svg>
      <span class="pull-label" role="status">{label}</span>
    </div>
  );
}
