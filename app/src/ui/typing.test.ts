import { describe, expect, test } from "vitest";
import { createTypingTracker, TYPING_RELEASE_MS, type TypingTimers } from "./typing.ts";

/** Timers that run only when told to, so the order of blur, pointer and click can be spelled out. */
function manualTimers(): TypingTimers & { run(): void; pending(): number } {
  let queue: { id: number; callback: () => void; ms: number }[] = [];
  let next = 1;
  return {
    set(callback, ms) {
      queue.push({ id: next, callback, ms });
      return next++;
    },
    clear(handle) {
      queue = queue.filter((item) => item.id !== handle);
    },
    run() {
      const due = queue;
      queue = [];
      for (const item of due) item.callback();
    },
    pending: () => queue.length,
  };
}

function tracked() {
  const changes: boolean[] = [];
  const timers = manualTimers();
  const tracker = createTypingTracker((typing) => changes.push(typing), timers);
  return { changes, timers, tracker };
}

describe("typing tracker", () => {
  test("focus reports typing at once", () => {
    const { changes, tracker } = tracked();
    tracker.focus();
    expect(changes).toEqual([true]);
  });

  test("blur is reported only after the release pause", () => {
    const { changes, timers, tracker } = tracked();
    tracker.focus();
    tracker.blur();
    expect(changes).toEqual([true]);
    expect(timers.pending()).toBe(1);
    timers.run();
    expect(changes).toEqual([true, false]);
  });

  test("a mouse press on a result keeps the layout until the button is released", () => {
    const { changes, timers, tracker } = tracked();
    tracker.focus();
    tracker.pointer(true);
    tracker.blur();
    expect(timers.pending()).toBe(0);
    tracker.pointer(false);
    expect(changes).toEqual([true]);
    timers.run();
    expect(changes).toEqual([true, false]);
  });

  test("a pointer that goes down again during the pause holds the layout", () => {
    const { changes, timers, tracker } = tracked();
    tracker.focus();
    tracker.blur();
    tracker.pointer(true);
    timers.run();
    expect(changes).toEqual([true]);
    tracker.pointer(false);
    timers.run();
    expect(changes).toEqual([true, false]);
  });

  test("taking focus back during the pause cancels the change", () => {
    const { changes, timers, tracker } = tracked();
    tracker.focus();
    tracker.blur();
    tracker.focus();
    timers.run();
    expect(changes).toEqual([true]);
  });

  test("the pause is long enough to outlast the click that follows a blur", () => {
    expect(TYPING_RELEASE_MS).toBeGreaterThanOrEqual(100);
  });
});
