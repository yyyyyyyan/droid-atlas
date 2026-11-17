/**
 * Whether the person is using the keyboard or a pointer, from the last thing
 * they did. Focus that the app moves by itself (back to a row when a sheet
 * closes) shows its ring only for the keyboard: after a touch a ring left on
 * a row reads as a selection nobody made.
 */

let keyboard = false;

/** Starts following the person's input; returns the function that stops it. */
export function watchInput(target: Window = window): () => void {
  const onKey = (event: KeyboardEvent): void => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) keyboard = true;
  };
  const onPointer = (): void => {
    keyboard = false;
  };
  target.addEventListener("keydown", onKey, { capture: true, passive: true });
  target.addEventListener("pointerdown", onPointer, { capture: true, passive: true });
  return () => {
    target.removeEventListener("keydown", onKey, { capture: true });
    target.removeEventListener("pointerdown", onPointer, { capture: true });
  };
}

/** Options for `focus()` when the app moves focus on its own: never scrolling, and with a ring only for keyboard use. */
export function quietFocus(): FocusOptions {
  return { preventScroll: true, focusVisible: keyboard };
}
