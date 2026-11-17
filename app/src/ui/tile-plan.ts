/**
 * Decides how a region tile sets its name and count, from its size alone, so
 * the map never has to measure its own text. Every tile is built the same
 * way: the name, at one of two sizes, over the count. The plan says whether
 * that fits, so the map can enlarge a tile instead of clipping it or turning
 * its text on its side.
 */

export interface TilePlan {
  /** True when the name and the count fit without clipping. */
  legible: boolean;
  /** Narrow tiles set their name in a more condensed width of the typeface. */
  narrow: boolean;
  padding: number;
  /** The size the name is set at: one of the two the map uses. */
  nameSize: number;
  numberSize: number;
  /** Category lines that fit under the count, where the layout shows them. */
  categories: number;
}

/** The two sizes a name is set at: the larger wherever it fits, the smaller elsewhere. Nothing in between, so the map reads as one piece. */
export const NAME_SIZES = { phone: [14.5, 11.5], wide: [19, 15] } as const;
const NAME_LEADING = 1.14;
const CATEGORY_LINE = 24;

/** Average advance of the display face per character, in em, at the two widths it is set in. */
const ADVANCE = { regular: 0.55, condensed: 0.49 };

/**
 * Where a name may break. On a phone, at spaces and after hyphens, as the
 * browser breaks it: the tiles are small and "Device-" over "specific" is
 * how such a word is set. On the wide map only between words, so a name
 * stands on one line or on lines of whole words, and a tile too narrow for
 * its longest word is one the map has to widen.
 */
function wordsOf(name: string, wide: boolean): string[] {
  return name.split(wide ? /\s+/ : /\s+|(?<=-)/).filter(Boolean);
}

/** A name as the wide map sets it: a word joiner after each hyphen keeps the browser from breaking there. */
export function unbrokenWords(name: string): string {
  return name.replaceAll("-", "-⁠");
}

/** The lines `words` wrap to at `size` in `width`, or null when a single word is wider than that. */
function linesAt(words: readonly string[], width: number, size: number, advance: number): number | null {
  const capacity = Math.floor(width / (size * advance));
  if (words.some((word) => word.length > capacity)) return null;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const needed = used === 0 ? word.length : used + 1 + word.length;
    if (needed <= capacity) used = needed;
    else {
      lines += 1;
      used = word.length;
    }
  }
  return lines;
}

function digitsWidth(count: number, size: number): number {
  return String(count).length * size * 0.52;
}

export function planTile(box: { w: number; h: number }, name: string, count: number, wide: boolean): TilePlan {
  const small = Math.min(box.w, box.h) < 84;
  const padding = small ? 8 : wide ? 16 : 12;
  const narrow = box.w < 132;
  const advance = narrow ? ADVANCE.condensed : ADVANCE.regular;
  const innerW = Math.max(1, box.w - 2 * padding);
  const innerH = Math.max(1, box.h - 2 * padding);
  const sizes = wide ? NAME_SIZES.wide : NAME_SIZES.phone;
  const numberSize = Math.round(Math.max(20, Math.min(54, Math.min(box.w, box.h) * 0.27)));
  const words = wordsOf(name, wide);
  const countFits = digitsWidth(count, numberSize) <= innerW;

  for (const nameSize of sizes) {
    const lines = linesAt(words, innerW, nameSize, advance);
    if (lines === null) continue;
    const height = lines * nameSize * NAME_LEADING + 5 + numberSize * 0.92;
    if (height > innerH || !countFits) continue;
    const lineRoom = Math.floor((innerH - height - 8) / CATEGORY_LINE);
    const categories = wide && !narrow && lineRoom >= 2 ? Math.min(6, lineRoom) : 0;
    return { legible: true, narrow, padding, nameSize, numberSize, categories };
  }
  return { legible: false, narrow, padding, nameSize: sizes[1], numberSize, categories: 0 };
}
