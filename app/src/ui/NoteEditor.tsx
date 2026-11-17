/**
 * The reader's own note on a saved app, edited in the app sheet. It exists
 * only for saved apps, is stored with the saved list on this device, and
 * travels in an export. Typing is saved a moment after it stops and whenever
 * the field is left, so there is no button to forget.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import type { Entry } from "../catalog/model.ts";
import { useServices } from "../services.ts";
import { NOTE_MAX_LENGTH } from "../state/saved.ts";

const SAVE_AFTER_MS = 700;
/** The remaining count is shown only when it starts to matter. */
const COUNT_FROM = NOTE_MAX_LENGTH - 60;

export function NoteEditor({ entry }: { entry: Entry }) {
  const { saved } = useServices();
  const view = saved.view.value;
  const isSaved = view.ids.has(entry.app.id);
  const stored = view.notes.get(entry.app.id) ?? "";
  const [text, setText] = useState(stored);
  const [editing, setEditing] = useState(false);
  const pending = useRef<{ entry: Entry; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const edit = pending.current;
    pending.current = null;
    if (edit) saved.setNote(edit.entry, edit.text, Date.now());
  };

  /* Another app, or a note changed in another window: show what is stored, unless this field is being typed in. */
  useEffect(() => {
    if (!editing) setText(stored);
  }, [entry.app.id, stored, editing]);

  useEffect(() => flush, [entry.app.id]);

  if (!isSaved) return null;

  const id = "sheet-note";
  return (
    <section class="sheet-section note-edit" aria-labelledby="sheet-note-title">
      <h3 class="overline" id="sheet-note-title"><label for={id}>Note</label></h3>
      <textarea
        id={id}
        class="note-field"
        rows={2}
        maxLength={NOTE_MAX_LENGTH}
        value={text}
        placeholder="Add a note"
        dir="auto"
        aria-describedby="sheet-note-hint"
        onFocus={(event) => {
          setEditing(true);
          /* The keyboard takes half the screen a moment after the focus; the field is brought back into view once it has. */
          const field = event.currentTarget;
          setTimeout(() => {
            if (document.activeElement === field) field.scrollIntoView({ block: "nearest" });
          }, 350);
        }}
        onInput={(event) => {
          const next = event.currentTarget.value;
          setText(next);
          pending.current = { entry, text: next };
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(flush, SAVE_AFTER_MS);
        }}
        onBlur={() => {
          flush();
          setEditing(false);
        }}
      />
      <p class="credit" id="sheet-note-hint">
        {text.length >= COUNT_FROM && <span class="note-count">{NOTE_MAX_LENGTH - text.length} characters left</span>}
      </p>
    </section>
  );
}
