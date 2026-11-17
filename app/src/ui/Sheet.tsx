/**
 * The app sheet's frame. The sheet has a URL (`?app=<id>`), so it is a history
 * entry: Back closes it, and so does everything else that closes it. On a
 * phone it is a bottom sheet at half or full height; from 1024 px it is a
 * panel beside the list.
 *
 * Its pinned parts are the top strip (result stepping, the handle, the close
 * control) and the foot (Save and the primary action). Everything else
 * scrolls. The height is not history and not stored: it resets with each
 * opening.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Entry } from "../catalog/model.ts";
import { NO_LINK } from "../catalog/statements.ts";
import { primaryAction } from "../links.ts";
import { sheetOf } from "../router/route.ts";
import type { Router } from "../router/router.ts";
import { isWide, useServices } from "../services.ts";
import { BottomSheet } from "./BottomSheet.tsx";
import { Icon } from "./Icon.tsx";
import { quietFocus } from "./modality.ts";
import { placeStyle } from "./place.ts";
import { positionOf, resultSet } from "./results.ts";
import { SaveButton } from "./Row.tsx";
import { Tip } from "./Tip.tsx";
import { ActionLink, SheetContent, actionGlyph, primaryParts } from "./SheetContent.tsx";

/**
 * Returns focus to the list when the sheet goes away: to the row of the app it
 * last showed, or to the page itself when that row is no longer rendered, so
 * focus is never left on nothing.
 */
function focusRow(appId: string | null): void {
  const row = appId ? document.querySelector<HTMLElement>(`[data-row="${CSS.escape(appId)}"] .row-link`) : null;
  (row ?? document.getElementById("main"))?.focus(quietFocus());
}

/** ← and → step to the previous and next result from anywhere in the sheet except a text control. */
function stepOnKey(event: KeyboardEvent, appId: string, router: Router): void {
  const target = event.target as HTMLElement;
  if (event.altKey || event.ctrlKey || event.metaKey || target.closest("input, select, textarea")) return;
  const position = positionOf(resultSet.peek(), appId);
  const step = event.key === "ArrowLeft" ? position?.previous : event.key === "ArrowRight" ? position?.next : null;
  if (!step) return;
  event.preventDefault();
  router.openApp(step);
  resultSet.peek()?.reveal(step);
}

/** Previous and next result, with the position between them. Stepping replaces the sheet's entry; it never adds one. */
function Stepper({ appId }: { appId: string }) {
  const { router } = useServices();
  const position = positionOf(resultSet.value, appId);
  if (!position || position.total < 2) return <span class="stepper" />;
  const step = (target: string | null): void => {
    if (!target) return;
    router.openApp(target);
    resultSet.peek()?.reveal(target);
  };
  return (
    <div class="stepper" role="group" aria-label="Results">
      {/* `aria-disabled`, not `disabled`: a button that disables itself while focused drops keyboard focus at the last result. */}
      <button type="button" class="icon-btn" aria-label="Previous result" aria-keyshortcuts="ArrowLeft" aria-disabled={!position.previous} onClick={() => step(position.previous)}>
        <Icon name="prev" /><Tip text="Previous" keys="←" at="side" />
      </button>
      <p class="stepper-pos" role="status">{position.index + 1} of {position.total}</p>
      <button type="button" class="icon-btn" aria-label="Next result" aria-keyshortcuts="ArrowRight" aria-disabled={!position.next} onClick={() => step(position.next)}>
        <Icon name="next" /><Tip text="Next" keys="→" at="side" />
      </button>
    </div>
  );
}

function Foot({ entry }: { entry: Entry }) {
  const { platform, framed } = useServices();
  const primary = primaryAction(entry.app, platform, framed);
  const label = primary ? primaryParts(primary) : null;
  return (
    <footer class="sheet-foot">
      <SaveButton entry={entry} class="btn save-btn" worded />
      {primary && label
        ? (
          <ActionLink action={primary} class={`btn btn-primary${primary.stale ? " is-stale" : ""}`}>
            <Icon name={actionGlyph(primary)} size={20} />
            <span class="btn-text">
              <span class="btn-main"><span class="btn-verb">{label.verb} </span><span class="btn-what">{label.what}</span></span>
              {primary.stale && <span class="btn-sub">Gone</span>}
            </span>
          </ActionLink>
        )
        : <p class="muted foot-none">{NO_LINK}</p>}
    </footer>
  );
}

function Missing({ appId }: { appId: string }) {
  return (
    <section class="sheet-section">
      <h2 id="sheet-title" tabIndex={-1} class="status-title">Not in the catalog</h2>
      <p class="muted" dir="auto">
        No app has the id “{appId}”.
      </p>
    </section>
  );
}

interface FrameProps {
  appId: string;
  /** Present on a phone, where the sheet has two heights: whether it is at the taller one, and the control that switches. */
  expanded?: boolean;
  onToggleHeight?(): void;
  onClose(): void;
}

function Frame({ appId, expanded, onToggleHeight, onClose }: FrameProps) {
  const { model, router } = useServices();
  const entry = model.resolve(appId);
  const bodyRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [appId]);

  return (
    <div class="sheet-frame place" style={placeStyle(entry?.app.region)} onKeyDown={(event) => stepOnKey(event, appId, router)}>
      <div class="sheet-top">
        <Stepper appId={appId} />
        {onToggleHeight && (
          <button
            type="button"
            class="sheet-grab"
            aria-expanded={expanded}
            aria-label={expanded ? "Shrink details to half height" : "Expand details to full height"}
            onClick={onToggleHeight}
          >
            <span class="bsheet-handle" />
          </button>
        )}
        <button type="button" class="icon-btn sheet-close" aria-label="Close details" aria-keyshortcuts="Escape" onClick={onClose}><Icon name="close" /><Tip text="Close" keys="Esc" at="end" /></button>
      </div>
      <div class="sheet-body" key={appId} ref={bodyRef} tabIndex={-1} data-sheet-scroll>
        {entry ? <SheetContent entry={entry} /> : <Missing appId={appId} />}
      </div>
      {entry && <Foot entry={entry} />}
    </div>
  );
}

function PhoneSheet({ appId }: { appId: string | null }) {
  const { router, navigation } = useServices();
  const [expanded, setExpanded] = useState(false);
  const lastShown = useRef<string | null>(appId);
  const wasOpen = useRef(false);
  if (appId) lastShown.current = appId;

  /* Each opening starts at half height; stepping to another result keeps the height. */
  useEffect(() => {
    if (appId !== null && !wasOpen.current) setExpanded(false);
    wasOpen.current = appId !== null;
  }, [appId]);

  /* Every way of closing is the same navigation: Back when the list lies beneath, otherwise the list takes the entry's place. */
  const close = (): void => {
    if (sheetOf(navigation.peek().route) !== null) router.closeSheet();
  };

  return (
    <BottomSheet
      open={appId !== null}
      routed
      class="sheet"
      labelledBy="sheet-title"
      expanded={expanded}
      onExpandedChange={setExpanded}
      onShown={(dialog) => dialog.querySelector<HTMLElement>("#sheet-title")?.focus({ preventScroll: true })}
      onClose={close}
      onClosed={() => focusRow(lastShown.current)}
    >
      {appId !== null && <Frame appId={appId} expanded={expanded} onToggleHeight={() => setExpanded(!expanded)} onClose={close} />}
    </BottomSheet>
  );
}

/** The part of `CloseWatcher` used here; the DOM typings this project compiles against do not include it. */
interface CloseWatcherLike {
  onclose: (() => void) | null;
  destroy(): void;
}

function PanelSheet({ appId }: { appId: string }) {
  const { router } = useServices();
  const frameRef = useRef<HTMLElement | null>(null);
  const previous = useRef<string | null>(null);

  /*
   * The panel is not a dialog, so nothing closes it on the platform's close
   * request (Android Back, Escape) unless it asks: a CloseWatcher, where the
   * browser has one, makes Back close a panel that was on screen at a cold
   * start, before any gesture has given it a history entry to go back to.
   * Escape is also handled as a key for browsers without CloseWatcher; the
   * two may both fire, and only the first closes.
   */
  useEffect(() => {
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      router.closeSheet();
    };
    const Watcher = (globalThis as { CloseWatcher?: new () => CloseWatcherLike }).CloseWatcher;
    let watcher: CloseWatcherLike | null = null;
    try {
      watcher = Watcher ? new Watcher() : null;
    } catch {
      /* A browser may refuse a watcher it considers one too many; the key handler below still closes the panel. */
    }
    if (watcher) watcher.onclose = close;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      watcher?.destroy();
      focusRow(previous.current);
    };
  }, []);
  /*
   * Opening the panel, or choosing another row while it is open, moves focus
   * to the panel itself, which is named after the app: the stepping keys work
   * at once and the first Tab reaches the panel's first control, where focus
   * on the name would have left the stepper and the close control behind it.
   * Stepping from inside the panel leaves focus on the control that stepped.
   */
  useEffect(() => {
    previous.current = appId;
    const panel = frameRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
  }, [appId]);

  return (
    <aside
      class="sheet is-panel"
      aria-labelledby="sheet-title"
      tabIndex={-1}
      ref={(element) => { frameRef.current = element; }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget) stepOnKey(event, appId, router);
      }}
    >
      <Frame appId={appId} onClose={() => router.closeSheet()} />
    </aside>
  );
}

export function Sheet() {
  const { navigation } = useServices();
  const appId = sheetOf(navigation.value.route);
  if (isWide.value) return appId ? <PanelSheet appId={appId} /> : null;
  return <PhoneSheet appId={appId} />;
}
