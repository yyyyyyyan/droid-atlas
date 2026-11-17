/**
 * A modal sheet that rises from the bottom of a phone screen: the layer for
 * the app's details, the filters, the sort choices and the key to the marks.
 * From 1024 px the same dialogs are centered boxes, and nothing is dragged.
 *
 * Every sheet closes the same four ways: its close control, a tap on the
 * backdrop, the platform's close request (Android Back, Escape), and a drag or
 * fling downwards (`sheet-drag.ts`). All four end in `onClose`, so a sheet that
 * is a history entry leaves history the same way whichever was used.
 *
 * A sheet without a URL of its own asks the router for a history entry while
 * it is open (`Router.holdBack`), in the browsers that need one for Back to
 * close it. A sheet that is a history entry (`routed`) has one already.
 *
 * The part that scrolls is marked `data-sheet-scroll`; everything else in the
 * sheet is a place to drag it by.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { isWide, prefersReducedMotion, useServices } from "../services.ts";
import { attachSheetDrag, clearSheetDrag } from "./sheet-drag.ts";

/** A sheet with two heights rests at this share of the screen, or just short of all of it. Kept in step with `.bsheet.is-half` and `.is-full`. */
const HALF_SHARE = 0.64;
const FULL_GAP = 0;
const LEAVE_MS = 180;

let openModals = 0;

/**
 * Puts the sheet's scrolling part back at its top, which also ends a fling
 * still running in it. Done where the sheet is on screen: a closed dialog has
 * no box, and a scroll position set on it then is not kept.
 */
function scrollToTop(dialog: HTMLDialogElement): void {
  const scroller = dialog.querySelector<HTMLElement>("[data-sheet-scroll]");
  if (scroller) scroller.scrollTop = 0;
}

function lockPage(locked: boolean): void {
  openModals = Math.max(0, openModals + (locked ? 1 : -1));
  document.documentElement.classList.toggle("is-modal", openModals > 0);
}

interface Props {
  open: boolean;
  /** The reader asked for the sheet to close, by any of the four ways. The owner answers by turning `open` off. */
  onClose(): void;
  class: string;
  labelledBy?: string;
  label?: string;
  /** Runs right after the sheet is shown, for placing focus. */
  onShown?(dialog: HTMLDialogElement): void;
  /** Runs once the sheet has left the screen, for giving focus back. */
  onClosed?(): void;
  /** For a sheet with two heights: whether it is at the taller one. Omitted for a sheet with one height. */
  expanded?: boolean;
  onExpandedChange?(expanded: boolean): void;
  /** The sheet is itself a history entry, so Back already leaves it. */
  routed?: boolean;
  children?: ComponentChildren;
}

export function BottomSheet({ open, onClose, class: className, labelledBy, label, onShown, onClosed, expanded, onExpandedChange, routed = false, children }: Props) {
  const { router } = useServices();
  const ref = useRef<HTMLDialogElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [shown, setShown] = useState(false);
  /** Set when a drag has already carried the sheet off the screen, so closing it needs no animation. */
  const gone = useRef(false);
  /** True from `showModal` until the sheet has settled closed, however it was closed. */
  const visible = useRef(false);
  const live = useRef({ open, expanded, onClose, onClosed, onExpandedChange });
  live.current = { open, expanded, onClose, onClosed, onExpandedChange };
  /* While the sheet slides away its owner may already have stopped rendering its content; the last content stays until it is gone. */
  const kept = useRef(children);
  if (open) kept.current = children;

  const settleClosed = (): void => {
    const dialog = ref.current;
    if (dialog) {
      if (dialog.open) {
        scrollToTop(dialog);
        dialog.close();
      }
      clearSheetDrag(dialog);
    }
    gone.current = false;
    visible.current = false;
    setLeaving(false);
    setShown(false);
    live.current.onClosed?.();
  };

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    if (open) {
      gone.current = false;
      setLeaving(false);
      if (!dialog.open) {
        clearSheetDrag(dialog);
        dialog.showModal();
        scrollToTop(dialog);
        visible.current = true;
        setShown(true);
        onShown?.(dialog);
      }
      return undefined;
    }
    if (!visible.current) return undefined;
    /* Already off the screen (a drag carried it there, or the platform closed the dialog), or nothing to animate. */
    if (!dialog.open || gone.current || prefersReducedMotion.peek() || isWide.peek()) {
      settleClosed();
      return undefined;
    }
    setLeaving(true);
    const timer = setTimeout(settleClosed, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open || routed) return undefined;
    return router.holdBack(() => live.current.onClose());
  }, [open, routed, router]);

  useEffect(() => {
    if (!shown) return undefined;
    lockPage(true);
    return () => lockPage(false);
  }, [shown]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    return attachSheetDrag(dialog, {
      detents: () => (live.current.expanded === undefined
        ? [dialog.getBoundingClientRect().height]
        : [Math.round(window.innerHeight * HALF_SHARE), window.innerHeight - FULL_GAP]),
      scroller: () => dialog.querySelector<HTMLElement>("[data-sheet-scroll]"),
      onRest: (height) => live.current.onExpandedChange?.(height > window.innerHeight * HALF_SHARE + 1),
      onClose: () => {
        gone.current = true;
        live.current.onClose();
      },
      enabled: () => live.current.open && !isWide.peek(),
      reducedMotion: () => prefersReducedMotion.peek(),
    });
  }, []);

  const height = expanded === undefined ? "" : expanded ? " is-full" : " is-half";
  return (
    <dialog
      ref={ref}
      class={`bsheet ${className}${height}${leaving ? " is-leaving" : ""}`}
      aria-labelledby={labelledBy}
      aria-label={label}
      onClose={() => {
        /* The platform closed the dialog (Android Back, Escape) while its owner still thinks it is open; the owner follows. */
        if (live.current.open) live.current.onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open ? children : kept.current}
    </dialog>
  );
}

/** The bar a sheet is dragged by. Purely a mark: the whole header takes the drag, and the close control closes for anyone not dragging. */
export function SheetHandle() {
  return <span class="bsheet-handle" aria-hidden="true" />;
}
