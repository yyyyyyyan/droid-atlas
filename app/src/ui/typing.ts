/**
 * Whether a text field counts as "being typed in", for views that rearrange
 * themselves around it.
 *
 * Taking focus counts at once. Losing it does not: a tap on something below
 * the field blurs the field first and is delivered as a click afterwards, and
 * a layout that changed in between would hand the click to whatever moved
 * under the finger. So the end of typing is reported only after a short pause
 * and never while a pointer is still down.
 */

export const TYPING_RELEASE_MS = 160;

export interface TypingTracker {
  focus(): void;
  blur(): void;
  /** Tells the tracker a pointer went down (true) or was lifted or canceled (false). */
  pointer(down: boolean): void;
  dispose(): void;
}

export interface TypingTimers {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: TypingTimers = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createTypingTracker(onChange: (typing: boolean) => void, timers: TypingTimers = realTimers): TypingTracker {
  let typing = false;
  let pointerDown = false;
  let leaving = false;
  let timer: unknown = null;

  const cancel = (): void => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const schedule = (): void => {
    cancel();
    timer = timers.set(() => {
      timer = null;
      if (!leaving || pointerDown) return;
      leaving = false;
      typing = false;
      onChange(false);
    }, TYPING_RELEASE_MS);
  };

  return {
    focus() {
      leaving = false;
      cancel();
      if (typing) return;
      typing = true;
      onChange(true);
    },
    blur() {
      if (!typing) return;
      leaving = true;
      if (!pointerDown) schedule();
    },
    pointer(down) {
      pointerDown = down;
      if (!down && leaving) schedule();
    },
    dispose() {
      cancel();
      leaving = false;
    },
  };
}
