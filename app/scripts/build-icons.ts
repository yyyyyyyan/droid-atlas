/**
 * Generates every icon file from the drawings in `icons/`:
 *
 *   node scripts/build-icons.ts
 *
 * The drawings are finished work and are placed as they are, never scaled or
 * redrawn here:
 *
 * - `d1-icon.svg`: the mark on a rounded black plate, 512 units square. The
 *   "any" icons and the apple-touch icon, which that platform rounds itself
 *   and backs with black.
 * - `d1-maskable.svg`: the same drawing on a full-bleed plate, already inside
 *   the maskable safe circle. The maskable icons.
 * - `d1-monochrome.svg`: the four pieces in white on transparency, with real
 *   gaps between them. The monochrome icons, of which a launcher reads only
 *   the alpha channel.
 * - `d1-favicon-16.svg` and `d1-favicon-24.svg`: drawings fitted to the pixel
 *   grid at 16 and 24 px, for an icon drawn at 16 to 23 and 24 to 31 px.
 * - `d1-mark-dark.svg` and `d1-mark-light.svg`: the mark alone, for the
 *   app's header; `ui/Icon.tsx` carries the same paths inline.
 *
 * `favicon.svg` holds the 16, 24 and full drawings in one file and shows the
 * one that fits the size it is drawn at, by media queries on its own width.
 *
 * The output is committed (`public/icons/`, `public/favicon.svg`), so building
 * the app needs neither this script nor `sharp`. Run it after changing a drawing.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("..", import.meta.url));
const SIZE = 512;

function drawing(name: string): string {
  return readFileSync(`${root}icons/${name}`, "utf8").trim();
}

/** The elements inside a drawing's outer `<svg>`. */
function inner(svg: string): string {
  const body = /^<svg[^>]*>([\s\S]*)<\/svg>$/.exec(svg)?.[1];
  if (body === undefined) throw new Error("not a single <svg> element");
  return body;
}

/** The full drawing from 32 px up, the 24 px fitting from 24, the 16 px fitting below. */
export function faviconSvg(full: string, fitted24: string, fitted16: string): string {
  const style = "<style>.f16,.f24{display:none}"
    + "@media (max-width:23.98px){.f16{display:inline}.full{display:none}}"
    + "@media (min-width:24px) and (max-width:31.98px){.f24{display:inline}.full{display:none}}</style>";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">${style}`
    + `<g class="full">${inner(full)}</g>`
    + `<svg class="f24" viewBox="0 0 24 24" width="${SIZE}" height="${SIZE}">${inner(fitted24)}</svg>`
    + `<svg class="f16" viewBox="0 0 16 16" width="${SIZE}" height="${SIZE}">${inner(fitted16)}</svg>`
    + "</svg>\n";
}

const icon = drawing("d1-icon.svg");
const maskable = drawing("d1-maskable.svg");
const monochrome = drawing("d1-monochrome.svg");

const variants: { file: string; size: number; markup: string }[] = [
  { file: "icon-192.png", size: 192, markup: icon },
  { file: "icon-512.png", size: 512, markup: icon },
  { file: "maskable-192.png", size: 192, markup: maskable },
  { file: "maskable-512.png", size: 512, markup: maskable },
  { file: "monochrome-192.png", size: 192, markup: monochrome },
  { file: "monochrome-512.png", size: 512, markup: monochrome },
  { file: "apple-touch-icon.png", size: 180, markup: icon },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(`${root}public/icons`, { recursive: true });
  for (const { file, size, markup } of variants) {
    const png = await sharp(Buffer.from(markup), { density: (72 * size) / SIZE * 4 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
    writeFileSync(`${root}public/icons/${file}`, png);
    console.log(`${file}  ${size}×${size}  ${png.length} bytes`);
  }
  writeFileSync(`${root}public/favicon.svg`, faviconSvg(icon, drawing("d1-favicon-24.svg"), drawing("d1-favicon-16.svg")));
  console.log("favicon.svg");
}
