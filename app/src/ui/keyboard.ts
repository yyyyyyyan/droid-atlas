/**
 * Whether the on-screen keyboard is up, as far as a page can tell: a text
 * field has focus and the viewport is clearly shorter than it has been at this
 * width. The bottom bar is put away while that holds, because it would
 * otherwise sit on top of the keyboard and take a row of results.
 *
 * Focus alone is not enough: closing the keyboard with Back leaves the focus
 * in the field, and the bar has to come back then.
 *
 * The keyboard is taken to be up at once and to have gone only through the
 * typing tracker: after its pause, and never while a pointer is down. A tap
 * below the field moves the focus out between the finger's press and its
 * release; a layout that changed then would hand the release to whatever
 * moved under the finger, and no link would be clicked.
 */

import { signal } from "@preact/signals";
import { onGestureLost } from "./gesture-lost.ts";
import { createTypingTracker } from "./typing.ts";

/** True while the on-screen keyboard is up. Views that make room for the keyboard follow this, not focus. */
export const keyboardOpen = signal(false);

/** A keyboard takes far more than this; a browser's collapsing address bar takes less. */
const KEYBOARD_MIN_PX = 140;

export function keyboardUp(typing: boolean, height: number, tallest: number): boolean {
  return typing && tallest - height > KEYBOARD_MIN_PX;
}

function isTextField(element: Element | null): boolean {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "color", "file", "radio", "range", "reset", "submit"].includes(element.type);
}

/**
 * Keeps `has-keyboard` on the root element and `keyboardOpen` in step with the
 * keyboard. Returns a function that stops watching.
 */
export function watchKeyboard(root: HTMLElement = document.documentElement): () => void {
  const viewport = window.visualViewport;
  const height = (): number => Math.min(window.innerHeight, viewport?.height ?? window.innerHeight);
  let width = window.innerWidth;
  let tallest = height();
  const tracker = createTypingTracker((up) => {
    keyboardOpen.value = up;
    root.classList.toggle("has-keyboard", up);
  });
  const update = (): void => {
    /* A new width is a rotation or a resized window: what "full height" means starts again. */
    if (window.innerWidth !== width) {
      width = window.innerWidth;
      tallest = height();
    }
    tallest = Math.max(tallest, height());
    if (keyboardUp(isTextField(document.activeElement), height(), tallest)) tracker.focus();
    else tracker.blur();
  };
  const down = (): void => tracker.pointer(true);
  const lifted = (): void => tracker.pointer(false);
  window.addEventListener("resize", update);
  viewport?.addEventListener("resize", update);
  document.addEventListener("focusin", update);
  document.addEventListener("focusout", update);
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", lifted, true);
  const stopLosses = onGestureLost(lifted);
  return () => {
    stopLosses();
    tracker.dispose();
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", lifted, true);
    window.removeEventListener("resize", update);
    viewport?.removeEventListener("resize", update);
    document.removeEventListener("focusin", update);
    document.removeEventListener("focusout", update);
    root.classList.remove("has-keyboard");
    keyboardOpen.value = false;
  };
}
