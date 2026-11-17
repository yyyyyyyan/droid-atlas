/**
 * A short bar at the foot of the page after something was removed, with the
 * way to put it back. It goes away by itself after a few seconds, and stays
 * while it has the focus or the pointer.
 */

import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { announce } from "../services.ts";

interface Offer {
  text: string;
  /** What "Undo" was done, said to assistive technology. */
  done: string;
  undo(): void;
}

const SHOWN_MS = 7000;

const offer = signal<Offer | null>(null);

/** Offers to undo the removal just made. A newer offer replaces an older one. */
export function offerUndo(text: string, done: string, undo: () => void): void {
  offer.value = { text, done, undo };
}

export function UndoBar() {
  const current = offer.value;
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!current || held) return undefined;
    const timer = setTimeout(() => {
      if (offer.peek() === current) offer.value = null;
    }, SHOWN_MS);
    return () => clearTimeout(timer);
  }, [current, held]);

  if (!current) return null;
  const undo = (): void => {
    current.undo();
    offer.value = null;
    setHeld(false);
    announce(current.done);
  };
  return (
    <div
      class="undo-bar"
      role="status"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)}
      onFocusOut={() => setHeld(false)}
    >
      <span class="undo-text" dir="auto">{current.text}</span>
      <button type="button" class="undo-btn" onClick={undo}>Undo</button>
    </div>
  );
}
