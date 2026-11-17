/**
 * One line of chips in the wide layout: what does not fit is left out rather
 * than wrapped onto further lines, because every line above a list's first row
 * costs a row of the list.
 */

/** The part of an element this needs: where its right edge is, and whether it is shown. */
export interface Fits {
  hidden: HTMLElement["hidden"];
  getBoundingClientRect(): { right: number; width: number };
}

/**
 * Leaves out, from the first item that crosses the box's right edge onwards,
 * every item of a single unwrapped line. `more`, when given, is shown only
 * when something is left out, and room is kept for it at the end of the line.
 * Returns how many items were left out.
 */
export function fitLine(box: Fits, items: readonly Fits[], more: Fits | null = null, gap = 0): number {
  for (const item of items) item.hidden = false;
  if (more) more.hidden = true;
  const right = box.getBoundingClientRect().right;
  const crosses = (item: Fits, limit: number): boolean => item.getBoundingClientRect().right > limit + 0.5;
  if (!items.some((item) => crosses(item, right))) return 0;
  let limit = right;
  if (more) {
    more.hidden = false;
    limit -= more.getBoundingClientRect().width + gap;
  }
  let left = 0;
  for (const item of items) {
    if (left > 0 || crosses(item, limit)) {
      item.hidden = true;
      left += 1;
    }
  }
  return left;
}

/** Shows every item and hides `more`: the line as a phone, or an expanded strip, has it. */
export function showAll(items: readonly Fits[], more: Fits | null = null): void {
  for (const item of items) item.hidden = false;
  if (more) more.hidden = true;
}
