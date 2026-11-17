import { describe, expect, test } from "vitest";
import { fitLine, showAll, type Fits } from "./fit.ts";

/** A line laid out left to right from 0 with a gap of 6, as a flex row without wrapping would: a hidden item takes no room. */
function line(widths: readonly number[], boxRight: number, moreWidth: number | null = null) {
  const gap = 6;
  const items: (Fits & { width: number; left: number })[] = [];
  const layout = (): void => {
    let x = 0;
    for (const item of [...items, ...(more ? [more] : [])]) {
      if (item.hidden) continue;
      item.left = x;
      x += item.width + gap;
    }
  };
  const make = (width: number): Fits & { width: number; left: number } => ({
    hidden: false,
    width,
    left: 0,
    getBoundingClientRect() {
      layout();
      return { right: this.left + this.width, width: this.width };
    },
  });
  for (const width of widths) items.push(make(width));
  const more = moreWidth === null ? null : make(moreWidth);
  const box: Fits = { hidden: false, getBoundingClientRect: () => ({ right: boxRight, width: boxRight }) };
  return { box, items, more, gap };
}

describe("one line of chips", () => {
  test("everything that fits is shown, and the expander is not", () => {
    const { box, items, more, gap } = line([100, 100, 100], 400, 60);
    expect(fitLine(box, items, more, gap)).toBe(0);
    expect(items.map((item) => item.hidden)).toEqual([false, false, false]);
    expect(more?.hidden).toBe(true);
  });

  test("what crosses the edge is left out, with room kept for the expander", () => {
    const { box, items, more, gap } = line([100, 100, 100, 100, 100], 400, 60);
    expect(fitLine(box, items, more, gap)).toBe(2);
    expect(items.map((item) => item.hidden)).toEqual([false, false, false, true, true]);
    expect(more?.hidden).toBe(false);
    expect(more?.getBoundingClientRect().right).toBeLessThanOrEqual(400);
  });

  test("once one item is left out, every item after it is too, even a short one that would fit", () => {
    const { box, items, gap } = line([200, 200, 20], 400);
    expect(fitLine(box, items, null, gap)).toBe(2);
    expect(items.map((item) => item.hidden)).toEqual([false, true, true]);
  });

  test("measured again, a line that was cut is laid out from the start", () => {
    const { box, items, more, gap } = line([100, 100, 100, 100], 400, 60);
    fitLine(box, items, more, gap);
    showAll(items, more);
    expect(items.every((item) => !item.hidden)).toBe(true);
    expect(more?.hidden).toBe(true);
  });
});
