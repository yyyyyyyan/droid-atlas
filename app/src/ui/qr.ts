/** A QR code drawn as one SVG path, made in the page from lean-qr's smallest encoder. */
import { generate } from "lean-qr/nano";

/** The light margin a reader needs around the code, in modules. */
export const QUIET_ZONE = 4;

export interface QrDrawing {
  /** The width and height of the drawing in modules, margin included: the SVG's viewBox is `0 0 side side`. */
  side: number;
  /** One rectangle per run of dark modules in a row. */
  path: string;
}

export function qrDrawing(text: string): QrDrawing {
  const code = generate(text);
  const parts: string[] = [];
  for (let y = 0; y < code.size; y++) {
    let x = 0;
    while (x < code.size) {
      if (!code.get(x, y)) {
        x++;
        continue;
      }
      const start = x;
      while (x < code.size && code.get(x, y)) x++;
      parts.push(`M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${x - start}v1h-${x - start}z`);
    }
  }
  return { side: code.size + 2 * QUIET_ZONE, path: parts.join("") };
}
