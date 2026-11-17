/**
 * A row of chips one line high: the categories of a region, the siblings of a
 * category, the regions of a quick filter, Search's pins. On a phone it scrolls
 * sideways with every chip in it, and when they do not all fit a first chip
 * lays the row out over as many lines as it needs. In the wide layout the
 * chips that do not fit are left out and a last chip lays the row out. That
 * chip then reads "Fewer" and stays where it was clicked. Every arrival starts
 * with the row collapsed.
 */

import { toChildArray, type ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { isWide } from "../services.ts";
import { fitLine, showAll } from "./fit.ts";

interface Props {
  /** A nav for ways to other pages; a group for chips that narrow this one; plain where a heading already names the row. */
  as?: "nav" | "group" | "plain";
  label?: string;
  /** The row's own class, in place of the category strip's. */
  class?: string;
  listClass?: string;
  /** What the expanding chip says while the row is collapsed. */
  more: string;
  /** The chips, each in its own `li`. */
  children: ComponentChildren;
}

export function ChipLine({ as = "nav", label, class: rowClass = "cats", listClass, more, children }: Props) {
  const wide = isWide.value;
  const [open, setOpen] = useState(false);
  /* How many chips the collapsed wide line shows: opened, "Fewer" stands after them, where "All" was. */
  const [fits, setFits] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const moreRef = useRef<HTMLLIElement>(null);

  useLayoutEffect(() => {
    const list = listRef.current;
    const expander = moreRef.current;
    if (!list || !expander) return undefined;
    let live = true;
    const lay = (): void => {
      if (!live) return;
      const items = [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== expander);
      if (open) {
        showAll(items, null);
        expander.hidden = false;
      } else if (!wide) {
        showAll(items, expander);
        const row = list.parentElement;
        expander.hidden = list.scrollWidth <= list.clientWidth + 1 && (!row || row.scrollWidth <= row.clientWidth + 1);
      } else {
        const shown = items.length - fitLine(list, items, expander, Number.parseFloat(getComputedStyle(list).columnGap) || 0);
        if (shown !== fits) setFits(shown);
      }
    };
    lay();
    void document.fonts?.ready.then(lay);
    if (typeof ResizeObserver === "undefined") return () => { live = false; };
    const observer = new ResizeObserver(lay);
    observer.observe(list);
    return () => {
      live = false;
      observer.disconnect();
    };
  });

  const chips = toChildArray(children);
  const at = !wide ? 0 : open ? fits : chips.length;
  const list = (
    <ul ref={listRef} class={listClass}>
      {chips.slice(0, at)}
      <li key="more" ref={moreRef} class="cats-more">
        <button type="button" class="chip chip-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Fewer" : more}</button>
      </li>
      {chips.slice(at)}
    </ul>
  );
  const className = `${rowClass}${wide ? " is-line" : " fade-x"}${open ? " is-open" : ""}`;
  if (as === "nav") return <nav class={className} aria-label={label}>{list}</nav>;
  if (as === "group") return <div class={className} role="group" aria-label={label}>{list}</div>;
  return <div class={className}>{list}</div>;
}
