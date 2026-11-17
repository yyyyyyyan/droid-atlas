/**
 * Icon images: the quality gates every downloaded original passes and the
 * two WebP files a shipped icon is made of (`ICON_PIXELS` in the schema).
 *
 * Originals are untrusted bytes. They are decoded only by sharp, with a pixel
 * cap; SVG is accepted only without scripts, entities, foreign objects or
 * references to anything outside the file.
 */
import sharp from "sharp";
import { ICON_PIXELS } from "../schema/catalog.ts";

/** Largest original downloaded or decoded. */
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_PIXELS = 4096 * 4096;
/** Smallest short side accepted from a source other than a repository index. */
export const MIN_SOURCE_PX = 96;
/** Largest relative difference between width and height accepted; within it the image is padded to a square. */
export const SQUARE_TOLERANCE = 0.05;
/** The large file is made only from originals at least this big; smaller ones would only be upscaled. */
export const LARGE_FROM_PX = Math.round(ICON_PIXELS.large * 0.75);

/** Byte budgets per file; quality steps down until a file fits. */
export const ICON_BUDGETS = { list: 16_000, large: 48_000 } as const;
export const QUALITY_STEPS = [82, 72, 62, 52, 42] as const;

export type ImageFormat = "png" | "webp" | "jpeg" | "gif" | "svg";

export type ImageCheck =
  | { ok: true; format: ImageFormat; width: number; height: number }
  | { ok: false; reason: string };

export interface GateOptions {
  /** Index icons skip the size gate: the repository chose them as the app's icon. */
  minPx: number;
  allowSvg: boolean;
  /** Largest relative difference between width and height; `SQUARE_TOLERANCE` unless the source chose the image as the app's icon. */
  squareTolerance?: number | undefined;
}

/** The format named by the file's first bytes, or null for anything else (ICO, AVIF, HTML error pages…). */
export function sniffFormat(bytes: Uint8Array): ImageFormat | null {
  const ascii = (start: number, end: number): string => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "gif";
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 2048)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || ((head.startsWith("<?xml") || head.startsWith("<!--")) && head.includes("<svg"))) return "svg";
  return null;
}

const UNSAFE_SVG: { what: string; pattern: RegExp }[] = [
  { what: "an entity or a document type with an internal subset", pattern: /<!entity|<!doctype[^>]*\[/i },
  { what: "a script or event handler", pattern: /<script|\bon[a-z]+\s*=/i },
  { what: "a foreign object", pattern: /<foreignobject/i },
  { what: "an embedded image", pattern: /<image\b/i },
  { what: "a reference outside the file", pattern: /href\s*=\s*["']\s*(?!#)|url\(\s*["']?\s*(?!#)/i },
];

/** Why an SVG cannot be rendered safely, or null when it can. */
export function unsafeSvg(text: string): string | null {
  for (const { what, pattern } of UNSAFE_SVG) if (pattern.test(text)) return `SVG contains ${what}`;
  return null;
}

/** Decodes the original and applies the gates: a known raster format or a safe SVG, a size, near-square, not blank. */
export async function checkImage(bytes: Uint8Array, options: GateOptions): Promise<ImageCheck> {
  if (bytes.length === 0) return { ok: false, reason: "empty file" };
  if (bytes.length > MAX_SOURCE_BYTES) return { ok: false, reason: `${bytes.length} bytes is too large` };
  const format = sniffFormat(bytes);
  if (!format) return { ok: false, reason: "not a PNG, WebP, JPEG, GIF or SVG image" };
  if (format === "svg") {
    if (!options.allowSvg) return { ok: false, reason: "SVG is not accepted from this source" };
    const unsafe = unsafeSvg(new TextDecoder().decode(bytes));
    if (unsafe) return { ok: false, reason: unsafe };
  }
  let width: number;
  let height: number;
  try {
    const decoded = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", density: format === "svg" ? 144 : undefined })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    width = decoded.info.width;
    height = decoded.info.height;
    if (blank(decoded.data, decoded.info.channels)) return { ok: false, reason: "the image is blank or a single color" };
  } catch (error) {
    return { ok: false, reason: `does not decode: ${error instanceof Error ? error.message.slice(0, 80) : String(error)}` };
  }
  const short = Math.min(width, height);
  if (format !== "svg" && short < options.minPx) return { ok: false, reason: `${width} × ${height} px is below ${options.minPx} px` };
  if (Math.abs(width - height) / Math.max(width, height) > (options.squareTolerance ?? SQUARE_TOLERANCE)) return { ok: false, reason: `${width} × ${height} px is not square` };
  return { ok: true, format, width, height };
}

/**
 * True when nothing is visible, or when the image is one flat color with no
 * shape: a single color is fine when transparency draws a shape with it (a
 * glyph icon), not when it fills the whole image.
 */
function blank(pixels: Buffer, channels: number): boolean {
  let first: number[] | null = null;
  let uniform = true;
  let minAlpha = 255;
  let maxAlpha = 0;
  for (let i = 0; i + channels <= pixels.length; i += channels) {
    const alpha = pixels[i + channels - 1] ?? 0;
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);
    if (alpha < 16 || !uniform) continue;
    const color = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
    if (!first) first = color;
    else if (color.some((c, k) => Math.abs(c - (first?.[k] ?? 0)) > 12)) uniform = false;
  }
  if (maxAlpha < 16) return true;
  return uniform && maxAlpha - minAlpha < 32;
}

export interface EncodedIcon {
  list: Buffer;
  /** Null when the original is too small for a separate large file. */
  large: Buffer | null;
  quality: { list: number; large: number | null };
}

/**
 * The two files of an icon: the original fitted into a transparent square
 * (padding, never cropping), at each size, as WebP without metadata. Each
 * file takes the highest quality step that fits its budget, or the smallest
 * result when none does.
 */
export async function encodeIcon(bytes: Uint8Array, check: Extract<ImageCheck, { ok: true }>): Promise<EncodedIcon> {
  const density = check.format === "svg" ? Math.max(72, Math.ceil((72 * ICON_PIXELS.large) / Math.max(1, Math.min(check.width, check.height)) * 2)) : undefined;
  const list = await encodeAt(bytes, ICON_PIXELS.list, ICON_BUDGETS.list, density);
  const large = check.format === "svg" || Math.min(check.width, check.height) >= LARGE_FROM_PX ? await encodeAt(bytes, ICON_PIXELS.large, ICON_BUDGETS.large, density) : null;
  return { list: list.webp, large: large?.webp ?? null, quality: { list: list.quality, large: large?.quality ?? null } };
}

async function encodeAt(bytes: Uint8Array, size: number, budget: number, density: number | undefined): Promise<{ webp: Buffer; quality: number }> {
  const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error", density, pages: 1 })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let smallest: { webp: Buffer; quality: number } | null = null;
  for (const quality of QUALITY_STEPS) {
    const webp = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .webp({ quality, alphaQuality: Math.min(90, quality + 8), effort: 6 })
      .toBuffer();
    if (webp.length <= budget) return { webp, quality };
    if (!smallest || webp.length < smallest.webp.length) smallest = { webp, quality };
  }
  if (!smallest) throw new Error("no quality step produced a file");
  return smallest;
}
