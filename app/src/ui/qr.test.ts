import { generate } from "lean-qr/nano";
import { describe, expect, test } from "vitest";
import { QUIET_ZONE, qrDrawing } from "./qr.ts";

const PAGE = "https://example.org/droid-atlas/#/app/org.fossify.gallery";

/** The dark cells the path paints, read back from its rectangles. */
function painted(path: string): Set<string> {
  const cells = new Set<string>();
  for (const [, x, y, width] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    for (let dx = 0; dx < Number(width); dx++) cells.add(`${Number(x) + dx},${y}`);
  }
  return cells;
}

describe("the QR code of a page", () => {
  test("paints exactly the code's dark modules, inside a margin of four", () => {
    const code = generate(PAGE);
    const drawing = qrDrawing(PAGE);
    expect(drawing.side).toBe(code.size + 2 * QUIET_ZONE);
    const expected = new Set<string>();
    for (let y = 0; y < code.size; y++) {
      for (let x = 0; x < code.size; x++) if (code.get(x, y)) expected.add(`${x + QUIET_ZONE},${y + QUIET_ZONE}`);
    }
    expect(painted(drawing.path)).toEqual(expected);
  });

  test("is made only of rectangles one module tall", () => {
    expect(qrDrawing(PAGE).path.replace(/M\d+ \d+h(\d+)v1h-\1z/g, "")).toBe("");
  });

  test("has its three finder squares in the corners", () => {
    const cells = painted(qrDrawing(PAGE).path);
    const size = qrDrawing(PAGE).side - 2 * QUIET_ZONE;
    const corners: [number, number][] = [[0, 0], [size - 7, 0], [0, size - 7]];
    for (const [cx, cy] of corners) {
      for (let i = 0; i < 7; i++) {
        const ring: [number, number][] = [[cx + i, cy], [cx + i, cy + 6], [cx, cy + i], [cx + 6, cy + i]];
        for (const [x, y] of ring) {
          expect(cells.has(`${x + QUIET_ZONE},${y + QUIET_ZONE}`), `${x},${y}`).toBe(true);
        }
      }
    }
  });

  test("grows with the address and stays the same for the same address", () => {
    const short = qrDrawing("https://example.org/#/app/a");
    const long = qrDrawing(`https://example.org/#/app/${"a".repeat(200)}`);
    expect(long.side).toBeGreaterThan(short.side);
    expect(qrDrawing(PAGE)).toEqual(qrDrawing(PAGE));
  });
});
