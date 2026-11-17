/**
 * When a gesture in progress can no longer end the ordinary way. A tap that
 * hands off to another app hides the page before its finger is lifted, and
 * the page may never see that finger's `pointerup` or `touchend`; anything
 * that tracks a pointer starts again from nothing when one of these arrives.
 *
 * - `hidden`: the page was hidden or is being left. Every gesture is over.
 * - `pointer`: the browser took one pointer away (`pointercancel`,
 *   `lostpointercapture`). The gesture on that pointer is over; the event
 *   says which.
 */

export type GestureLoss = { kind: "hidden" } | { kind: "pointer"; pointerId: number };

/** Calls `listener` whenever the page is hidden or a pointer is taken away. Returns how to stop. */
export function onGestureLost(listener: (loss: GestureLoss) => void): () => void {
  const visibility = (): void => {
    if (document.visibilityState === "hidden") listener({ kind: "hidden" });
  };
  const leaving = (): void => listener({ kind: "hidden" });
  const pointer = (event: PointerEvent): void => listener({ kind: "pointer", pointerId: event.pointerId });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", leaving, true);
  window.addEventListener("pointercancel", pointer, true);
  window.addEventListener("lostpointercapture", pointer, true);
  return () => {
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("pagehide", leaving, true);
    window.removeEventListener("pointercancel", pointer, true);
    window.removeEventListener("lostpointercapture", pointer, true);
  };
}
