import { describe, expect, test } from "vitest";
import { SAMPLE_SIDE, glyphOf, plateClass } from "./plate.ts";

/** A sample whose first `drawn` pixels are `rgba` and the rest transparent, or `background` when given. */
function sample(rgba: [number, number, number, number], drawn: number, background: [number, number, number, number] = [0, 0, 0, 0]): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SAMPLE_SIDE * SAMPLE_SIDE * 4);
  for (let index = 0; index < SAMPLE_SIDE * SAMPLE_SIDE; index += 1) pixels.set(index < drawn ? rgba : background, index * 4);
  return pixels;
}

const HALF = (SAMPLE_SIDE * SAMPLE_SIDE) / 2;

describe("the plate an icon stands on", () => {
  test("a white glyph on transparency is one the light plate would lose", () => {
    expect(glyphOf(sample([255, 255, 255, 255], HALF))).toBe("light");
    expect(plateClass("light")).toBe(" on-dark-plate");
  });

  test("a black glyph on transparency is one the dark plate would lose", () => {
    expect(glyphOf(sample([10, 10, 10, 255], HALF))).toBe("dark");
    expect(plateClass("dark")).toBe(" on-light-plate");
  });

  test("an icon that covers its plate, or keeps its shape on both, stands on the theme's", () => {
    expect(glyphOf(sample([255, 255, 255, 255], SAMPLE_SIDE * SAMPLE_SIDE))).toBeNull();
    expect(glyphOf(sample([220, 60, 40, 255], HALF))).toBeNull();
    expect(glyphOf(sample([255, 255, 255, 255], HALF, [30, 90, 200, 255]))).toBeNull();
    expect(plateClass(null)).toBe("");
  });

  test("a glyph mostly white with a little color keeps its contrast on neither plate only when the color is small", () => {
    const pixels = sample([255, 255, 255, 255], HALF);
    for (let index = 0; index < 8; index += 1) pixels.set([30, 30, 200, 255], index * 4);
    expect(glyphOf(pixels)).toBe("light");
    for (let index = 0; index < HALF / 4; index += 1) pixels.set([30, 30, 200, 255], index * 4);
    expect(glyphOf(pixels)).toBeNull();
  });

  test("an empty or fully transparent sample decides nothing", () => {
    expect(glyphOf(new Uint8ClampedArray(0))).toBeNull();
    expect(glyphOf(sample([0, 0, 0, 0], 0))).toBeNull();
  });
});
