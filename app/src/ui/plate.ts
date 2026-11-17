/**
 * Which plate an icon stands on. Every icon has a quiet plate behind it, a
 * shade off the page in each theme, so a partly transparent icon keeps its
 * shape. An icon drawn in white on transparency all but vanishes on the light
 * plate, and one drawn in black on the dark plate; such an icon stands on the
 * other plate, in both themes.
 *
 * Decided from the image itself, once it has loaded and before it is shown,
 * from a small sample of its pixels, and remembered per file. Sampling
 * decodes the image a second time, under a millisecond on a desktop and
 * several on a phone, so it has a budget per frame: an icon that arrives
 * when the frame's budget is spent, as many do in a fast fling, stands on
 * the theme's plate and is sampled the next time it is shown.
 */

/** Relative luminance of the two plates (`--ico-plate-dark`, `--ico-plate-light` in base.css). */
export const PLATE_LUMINANCE = { dark: 0.0119, light: 0.897 } as const;

/** Side of the square the image is drawn into to be sampled. */
export const SAMPLE_SIDE = 16;

export type Glyph = "light" | "dark" | null;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Share of an icon's drawn mass that stands under 1.5:1 against a plate of luminance `plate`, the pixel composited over it. */
function lostShare(pixels: Uint8ClampedArray, plate: number, plateRgb: readonly [number, number, number]): number {
  let mass = 0;
  let lost = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = (pixels[index + 3] ?? 0) / 255;
    if (alpha < 0.125) continue;
    const shown = [0, 1, 2].map((offset) => (pixels[index + offset] ?? 0) * alpha + (plateRgb[offset] ?? 0) * (1 - alpha));
    const luminance = 0.2126 * channel(shown[0] ?? 0) + 0.7152 * channel(shown[1] ?? 0) + 0.0722 * channel(shown[2] ?? 0);
    mass += alpha;
    if (contrast(luminance, plate) < 1.5) lost += alpha;
  }
  return mass === 0 ? 0 : lost / mass;
}

const PLATE_RGB = { dark: [29, 28, 26], light: [244, 243, 240] } as const;

/**
 * "light" for an icon that would all but vanish on the light plate, "dark"
 * for one that would on the dark plate, null for every other: an icon that
 * covers its plate, or that keeps its shape on both.
 *
 * @param pixels RGBA, as `getImageData` gives them
 */
export function glyphOf(pixels: Uint8ClampedArray): Glyph {
  const count = pixels.length / 4;
  if (count === 0) return null;
  let clear = 0;
  for (let index = 3; index < pixels.length; index += 4) if ((pixels[index] ?? 0) < 128) clear += 1;
  if (clear / count < 0.1) return null;
  if (lostShare(pixels, PLATE_LUMINANCE.light, PLATE_RGB.light) >= 0.9) return "light";
  if (lostShare(pixels, PLATE_LUMINANCE.dark, PLATE_RGB.dark) >= 0.9) return "dark";
  return null;
}

/** Milliseconds of sampling allowed in one frame. */
export const FRAME_BUDGET_MS = 2;

const known = new Map<string, Glyph>();
let canvas: HTMLCanvasElement | null = null;
let spent = 0;
let resetting = false;

/** Counts sampling time against the frame it falls in. */
function charge(ms: number): void {
  spent += ms;
  if (resetting) return;
  resetting = true;
  requestAnimationFrame(() => {
    spent = 0;
    resetting = false;
  });
}

/**
 * Samples a loaded image and remembers the answer for its file. An image the
 * page cannot read stands on the theme's plate, and so does one that arrives
 * when the frame's budget is spent, without an answer being remembered.
 */
export function sampleGlyph(image: HTMLImageElement): Glyph {
  const src = image.currentSrc || image.src;
  const remembered = known.get(src);
  if (remembered !== undefined) return remembered;
  if (spent >= FRAME_BUDGET_MS) return null;
  const start = performance.now();
  let glyph: Glyph = null;
  try {
    canvas ??= document.createElement("canvas");
    canvas.width = SAMPLE_SIDE;
    canvas.height = SAMPLE_SIDE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      context.clearRect(0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
      context.drawImage(image, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
      glyph = glyphOf(context.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data);
    }
  } catch {
    glyph = null;
  }
  charge(performance.now() - start);
  known.set(src, glyph);
  return glyph;
}

/** The class that puts an icon on the plate it needs. */
export function plateClass(glyph: Glyph): string {
  return glyph === "light" ? " on-dark-plate" : glyph === "dark" ? " on-light-plate" : "";
}
