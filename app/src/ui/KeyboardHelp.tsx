/**
 * The keyboard shortcuts, in a small dialog that `?` opens from anywhere, and
 * About's link where the device has a fine pointer. Nobody is taught them
 * before they ask.
 */

import { signal } from "@preact/signals";
import { BottomSheet, SheetHandle } from "./BottomSheet.tsx";
import { Icon } from "./Icon.tsx";
import { Tip } from "./Tip.tsx";

const shown = signal(false);

export function openKeyboardHelp(): void {
  shown.value = true;
}

/** True when `?` was pressed outside a text control and no dialog is open. */
export function asksForKeyboardHelp(event: KeyboardEvent): boolean {
  if (event.key !== "?" || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return false;
  const target = event.target as HTMLElement | null;
  return !target?.closest("input, textarea, select, [contenteditable]") && !document.querySelector("dialog[open]");
}

export function KeyboardHelp() {
  const close = (): void => {
    shown.value = false;
  };
  return (
    <BottomSheet open={shown.value} onClose={close} class="panel is-short" labelledBy="keys-title" onShown={(dialog) => dialog.querySelector<HTMLElement>("#keys-title")?.focus()}>
      <header class="bsheet-head">
        <SheetHandle />
        <h2 id="keys-title" class="bsheet-title" tabIndex={-1}>Keyboard</h2>
        <button type="button" class="icon-btn" aria-label="Close keyboard shortcuts" onClick={close}><Icon name="close" /><Tip text="Close" keys="Esc" at="end" /></button>
      </header>
      <div class="bsheet-body" data-sheet-scroll>
        <dl class="keys">
          <div><dt><kbd>/</kbd></dt><dd>Search</dd></div>
          <div><dt><kbd>↑</kbd><kbd>↓</kbd></dt><dd>Move through the list</dd></div>
          <div><dt><kbd>Enter</kbd></dt><dd>Open details</dd></div>
          <div><dt><kbd>←</kbd><kbd>→</kbd></dt><dd>Previous and next result</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Close details</dd></div>
        </dl>
      </div>
    </BottomSheet>
  );
}
