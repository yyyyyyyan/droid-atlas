/**
 * Composes an Android adaptive launcher icon from a repository's resources,
 * for apps whose repository ships the icon only as XML: an `<adaptive-icon>`
 * whose background and foreground are colors, VectorDrawables or bitmaps,
 * optionally inside an `<inset>` or a `<bitmap>`.
 *
 * Every layer is drawn on the 108 dp canvas Android uses and the result is
 * the 72 dp area a launcher shows, as a square PNG. Anything this does not
 * understand (theme attributes, color state lists, sweep gradients, trimmed
 * paths, tints other than a literal color, other drawable types) makes the whole icon unavailable rather
 * than drawn wrong. Input is untrusted: XML is parsed by a small reader that
 * knows no entities or external references, and the SVG handed to the
 * renderer is written from parsed numbers and checked path data only.
 */
import sharp from "sharp";
import { safeRepoPath, type TreeEntry } from "./icon-sources.ts";

/** Pixels per dp of the composed icon: the visible 72 dp become 288 px. */
const SCALE = 4;
const CANVAS = 108 * SCALE;
const VISIBLE = 72 * SCALE;
const MAX_XML = 1024 * 1024;

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code] ?? whole;
  });
}

/** A minimal XML reader for resource files: elements, attributes and text; no DTD, entities beyond the five built-in ones, or processing. */
export function parseXml(source: string): XmlNode | null {
  if (source.length > MAX_XML || /<!DOCTYPE|<!ENTITY/i.test(source)) return null;
  const text = source.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t: string) => t.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;")));
  const root: XmlNode = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: XmlNode[] = [root];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let last = 0;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    const between = text.slice(last, m.index);
    if (between.includes("<")) return null;
    const top = stack.at(-1);
    if (!top) return null;
    top.text += decodeEntities(between);
    last = tag.lastIndex;
    const [, closing, name = "", attrText = "", selfClosing] = m;
    if (closing) {
      if (stack.pop()?.name !== name || stack.length === 0) return null;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1] ?? ""] = decodeEntities(a[2] ?? a[3] ?? "");
    const node: XmlNode = { name, attrs, children: [], text: "" };
    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1 || text.slice(last).includes("<")) return null;
  return root.children.find(() => true) ?? null;
}

class Unsupported extends Error {}

/** Android's `#RGB`, `#ARGB`, `#RRGGBB` and `#AARRGGBB`, as RGBA bytes. */
export function androidColor(value: string): [number, number, number, number] | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim())?.[1];
  if (!hex || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
  const argb = full.length === 6 ? `ff${full}` : full;
  const n = (i: number): number => Number.parseInt(argb.slice(i, i + 2), 16);
  return [n(2), n(4), n(6), n(0)];
}

const SYSTEM_COLORS: Record<string, string> = { white: "#ffffffff", black: "#ff000000", transparent: "#00000000" };

/** What composing needs from the repository: the tree and a way to read a file in it. */
export interface Resources {
  tree: readonly TreeEntry[];
  module: string;
  read: (path: string) => Promise<Uint8Array | null>;
}

const TEXT = new TextDecoder("utf-8", { fatal: false });
const NUMBER_RE = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i;
const PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]{1,200000}$/;

function num(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const trimmed = value.trim().replace(/(dp|dip|px)$/, "");
  if (!NUMBER_RE.test(trimmed)) throw new Unsupported(`not a number: ${value.slice(0, 20)}`);
  return Number(trimmed);
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 10_000) / 10_000) : "0";
}

/** Finds a resource file in the module: `main` before other source sets, then the given qualifier preference. */
export function findResource(tree: readonly TreeEntry[], module: string, type: string, name: string): TreeEntry | null {
  if (!/^[A-Za-z0-9_]{1,80}$/.test(name) || !/^(drawable|mipmap|color)$/.test(type)) return null;
  const prefix = module ? `${module}/src/` : "src/";
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([A-Za-z0-9_]+)/res/${type}(-[A-Za-z0-9-]+)?/${name}\\.(xml|png|webp)$`);
  const density: Record<string, number> = { xxxhdpi: 6, xxhdpi: 5, xhdpi: 4, hdpi: 3, mdpi: 2, ldpi: 1, nodpi: 7, anydpi: 8 };
  const scored = tree
    .filter((e) => safeRepoPath(e.path))
    .map((e) => ({ e, m: re.exec(e.path) }))
    .filter((x): x is { e: TreeEntry; m: RegExpExecArray } => x.m !== null)
    .filter((x) => !/night|ldrtl|land|port|television|watch|car/.test(x.m[2] ?? ""))
    .map((x) => {
      const qualifiers = (x.m[2] ?? "").split("-").filter(Boolean);
      const dens = Math.max(0, ...qualifiers.map((q) => density[q] ?? 0));
      return { e: x.e, score: (x.m[1] === "main" ? 100 : 0) + dens * 2 + (x.m[3] === "xml" ? 1 : 0) };
    });
  return scored.sort((a, b) => b.score - a.score || (a.e.path < b.e.path ? -1 : 1))[0]?.e ?? null;
}

/** Composes the adaptive icon resource `<type>/<name>` of the module into a 288 px PNG, recording every file it read in `used`. */
export async function composeAdaptiveIcon(resources: Resources, type: "mipmap" | "drawable", name: string, used: Map<string, TreeEntry>): Promise<Buffer | null> {
  const composer = new Composer(resources, used);
  try {
    const entry = findResource(resources.tree, resources.module, type, name);
    if (!entry || !entry.path.endsWith(".xml")) return null;
    const root = await composer.xml(entry);
    if (root?.name !== "adaptive-icon") return null;
    const layers: Buffer[] = [];
    for (const part of ["background", "foreground"]) {
      const node = root.children.find((c) => c.name === part);
      if (!node) {
        if (part === "foreground") return null;
        continue;
      }
      const ref = node.attrs["android:drawable"];
      const layer = ref ? await composer.drawable(ref, CANVAS) : node.children[0] ? await composer.inline(node.children[0], CANVAS) : null;
      if (!layer) return null;
      layers.push(layer);
    }
    const [base, ...rest] = layers;
    if (!base) return null;
    const composed = await sharp(base).composite(rest.map((input) => ({ input }))).png().toBuffer();
    return sharp(composed).extract({ left: (CANVAS - VISIBLE) / 2, top: (CANVAS - VISIBLE) / 2, width: VISIBLE, height: VISIBLE }).png().toBuffer();
  } catch (error) {
    if (error instanceof Unsupported) return null;
    throw error;
  }
}

class Composer {
  private readonly colors = new Map<string, string>();
  private colorFilesRead = false;
  private readonly resources: Resources;
  private readonly used: Map<string, TreeEntry>;
  private depth = 0;

  constructor(resources: Resources, used: Map<string, TreeEntry>) {
    this.resources = resources;
    this.used = used;
  }

  async bytes(entry: TreeEntry): Promise<Uint8Array> {
    const bytes = await this.resources.read(entry.path);
    if (!bytes) throw new Unsupported(`missing ${entry.path}`);
    this.used.set(entry.path, entry);
    return bytes;
  }

  async xml(entry: TreeEntry): Promise<XmlNode | null> {
    return parseXml(TEXT.decode(await this.bytes(entry)));
  }

  /** `@color/x`, `@android:color/x` or a literal, as an Android color string. */
  async color(value: string): Promise<string> {
    const trimmed = value.trim();
    if (trimmed.startsWith("#")) {
      if (!androidColor(trimmed)) throw new Unsupported(`color ${trimmed}`);
      return trimmed;
    }
    const system = /^@android:color\/(\w+)$/.exec(trimmed)?.[1];
    if (system) {
      const known = SYSTEM_COLORS[system];
      if (!known) throw new Unsupported(`system color ${system}`);
      return known;
    }
    const name = /^@color\/([A-Za-z0-9_]{1,80})$/.exec(trimmed)?.[1];
    if (!name) throw new Unsupported(`color reference ${trimmed.slice(0, 40)}`);
    await this.readColors();
    const found = this.colors.get(name);
    if (!found) throw new Unsupported(`no color ${name}`);
    if (++this.depth > 8) throw new Unsupported("color references too deep");
    try {
      return await this.color(found);
    } finally {
      this.depth--;
    }
  }

  private async readColors(): Promise<void> {
    if (this.colorFilesRead) return;
    this.colorFilesRead = true;
    const prefix = this.resources.module ? `${this.resources.module}/src/` : "src/";
    const files = this.resources.tree
      .filter((e) => e.path.startsWith(prefix) && /\/res\/values\/[A-Za-z0-9_.-]+\.xml$/.test(e.path) && safeRepoPath(e.path))
      .sort((a, b) => Number(!/\/main\//.test(a.path)) - Number(!/\/main\//.test(b.path)) || Number(!/colou?r|launcher/i.test(a.path)) - Number(!/colou?r|launcher/i.test(b.path)) || (a.path < b.path ? -1 : 1))
      .slice(0, 6);
    for (const file of files) {
      const root = await this.xml(file);
      for (const node of root?.children ?? []) {
        const name = node.attrs["name"];
        if (name && !this.colors.has(name) && (node.name === "color" || (node.name === "item" && node.attrs["type"] === "color"))) this.colors.set(name, node.text.trim());
      }
    }
  }

  /** Draws `@drawable/x`, `@mipmap/x` or `@color/x` at `size` px. */
  async drawable(ref: string, size: number): Promise<Buffer> {
    if (/^(#|@color\/|@android:color\/)/.test(ref.trim())) return this.solid(await this.color(ref), size);
    const m = /^@(drawable|mipmap)\/([A-Za-z0-9_]{1,80})$/.exec(ref.trim());
    if (!m?.[1] || !m[2]) throw new Unsupported(`drawable ${ref.slice(0, 40)}`);
    const entry = findResource(this.resources.tree, this.resources.module, m[1], m[2]);
    if (!entry) throw new Unsupported(`no drawable ${m[2]}`);
    if (++this.depth > 8) throw new Unsupported("drawable references too deep");
    try {
      if (!entry.path.endsWith(".xml")) return await sharp(await this.bytes(entry), { limitInputPixels: 4096 * 4096 }).resize(size, size, { fit: "fill" }).png().toBuffer();
      const node = await this.xml(entry);
      if (!node) throw new Unsupported(`unreadable ${entry.path}`);
      return await this.inline(node, size);
    } finally {
      this.depth--;
    }
  }

  async solid(color: string, size: number): Promise<Buffer> {
    const [r, g, b, a] = androidColor(color) ?? [0, 0, 0, 0];
    return sharp({ create: { width: size, height: size, channels: 4, background: { r, g, b, alpha: a / 255 } } }).png().toBuffer();
  }

  async inline(node: XmlNode, size: number): Promise<Buffer> {
    if (node.name === "vector") return this.vector(node, size);
    if (node.name === "bitmap") {
      const src = node.attrs["android:src"];
      if (!src) throw new Unsupported("bitmap without src");
      return this.drawable(src, size);
    }
    if (node.name === "inset") {
      const inner = node.attrs["android:drawable"];
      const all = node.attrs["android:inset"];
      const side = (key: string): number => {
        const value = node.attrs[`android:inset${key}`] ?? all ?? "0";
        if (value.trim().endsWith("%")) return (num(value.trim().slice(0, -1), 0) / 100) * size;
        return num(value, 0) * (size / 108);
      };
      const [left, top, right, bottom] = ["Left", "Top", "Right", "Bottom"].map(side) as [number, number, number, number];
      const width = Math.round(size - left - right);
      const height = Math.round(size - top - bottom);
      if (width < 8 || height < 8) throw new Unsupported("inset leaves nothing");
      const content = inner ? await this.drawable(inner, Math.max(width, height)) : node.children[0] ? await this.inline(node.children[0], Math.max(width, height)) : null;
      if (!content) throw new Unsupported("inset without a drawable");
      const fitted = await sharp(content).resize(width, height, { fit: "fill" }).png().toBuffer();
      return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: fitted, left: Math.round(left), top: Math.round(top) }])
        .png()
        .toBuffer();
    }
    if (node.name === "shape") return this.shape(node, size);
    throw new Unsupported(`drawable type ${node.name}`);
  }

  /**
   * A `<shape>` that fills the layer: a rectangle with a `<solid>` color or a
   * linear `<gradient>` at a multiple of 45°. Corners, strokes and other
   * gradient types are refused rather than approximated.
   */
  async shape(node: XmlNode, size: number): Promise<Buffer> {
    const kind = node.attrs["android:shape"] ?? "rectangle";
    if (kind !== "rectangle") throw new Unsupported(`shape ${kind}`);
    const fills = node.children.filter((c) => c.name !== "size" && c.name !== "padding");
    const [fill] = fills;
    if (fills.length !== 1 || !fill) throw new Unsupported("shape without exactly one fill");
    if (fill.name === "solid") {
      const color = fill.attrs["android:color"];
      if (!color) throw new Unsupported("solid without a color");
      return this.solid(await this.color(color), size);
    }
    if (fill.name !== "gradient") throw new Unsupported(`shape element ${fill.name}`);
    const a = fill.attrs;
    if ((a["android:type"] ?? "linear") !== "linear") throw new Unsupported(`gradient type ${a["android:type"]}`);
    const angle = num(a["android:angle"], 0);
    if (!Number.isInteger(angle) || angle % 45 !== 0) throw new Unsupported(`gradient angle ${angle}`);
    const radians = (((angle % 360) + 360) % 360) * (Math.PI / 180);
    const dx = Math.cos(radians) / 2;
    const dy = -Math.sin(radians) / 2;
    const stops: string[] = [];
    for (const [offset, key] of [[0, "android:startColor"], [0.5, "android:centerColor"], [1, "android:endColor"]] as const) {
      const value = a[key];
      if (!value) continue;
      const [r, g, b, alpha] = androidColor(await this.color(value)) ?? [0, 0, 0, 0];
      stops.push(`<stop offset="${fmt(offset)}" stop-color="rgb(${r},${g},${b})" stop-opacity="${fmt(alpha / 255)}"/>`);
    }
    if (stops.length < 2) throw new Unsupported("gradient without two colors");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="s" x1="${fmt(0.5 - dx)}" y1="${fmt(0.5 - dy)}" x2="${fmt(0.5 + dx)}" y2="${fmt(0.5 + dy)}">${stops.join("")}</linearGradient></defs><rect width="${size}" height="${size}" fill="url(#s)"/></svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  async vector(node: XmlNode, size: number): Promise<Buffer> {
    if (node.attrs["android:autoMirrored"] !== undefined && node.attrs["android:autoMirrored"] !== "false") throw new Unsupported("android:autoMirrored");
    const tintMode = node.attrs["android:tintMode"] ?? "src_in";
    if (tintMode !== "src_in") throw new Unsupported(`tint mode ${tintMode}`);
    const tint = node.attrs["android:tint"] !== undefined ? androidColor(await this.color(node.attrs["android:tint"])) : null;
    const vw = num(node.attrs["android:viewportWidth"], NaN);
    const vh = num(node.attrs["android:viewportHeight"], NaN);
    if (!(vw > 0 && vh > 0)) throw new Unsupported("no viewport");
    const defs: string[] = [];
    const body = await this.children(node.children, defs);
    const alpha = num(node.attrs["android:alpha"], 1);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${fmt(vw)} ${fmt(vh)}" preserveAspectRatio="none"><defs>${defs.join("")}</defs><g opacity="${fmt(alpha)}">${body}</g></svg>`;
    const drawn = await sharp(Buffer.from(svg)).png().toBuffer();
    if (!tint) return drawn;
    // src_in: every drawn pixel takes the tint's color, keeping its own coverage.
    const [r, g, b, a] = tint;
    return sharp({ create: { width: size, height: size, channels: 4, background: { r, g, b, alpha: a / 255 } } })
      .composite([{ input: drawn, blend: "dest-in" }])
      .png()
      .toBuffer();
  }

  private ids = 0;

  private async children(nodes: XmlNode[], defs: string[]): Promise<string> {
    let out = "";
    for (const [i, child] of nodes.entries()) {
      if (child.name === "clip-path") {
        const d = child.attrs["android:pathData"] ?? "";
        if (!PATH_RE.test(d)) throw new Unsupported("clip path data");
        const id = `c${this.ids++}`;
        defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
        return `${out}<g clip-path="url(#${id})">${await this.children(nodes.slice(i + 1), defs)}</g>`;
      }
      if (child.name === "group") out += await this.group(child, defs);
      else if (child.name === "path") out += await this.path(child, defs);
      else throw new Unsupported(`vector element ${child.name}`);
    }
    return out;
  }

  private async group(node: XmlNode, defs: string[]): Promise<string> {
    const a = node.attrs;
    const px = num(a["android:pivotX"], 0);
    const py = num(a["android:pivotY"], 0);
    const transform = `translate(${fmt(num(a["android:translateX"], 0) + px)} ${fmt(num(a["android:translateY"], 0) + py)}) rotate(${fmt(num(a["android:rotation"], 0))}) scale(${fmt(num(a["android:scaleX"], 1))} ${fmt(num(a["android:scaleY"], 1))}) translate(${fmt(-px)} ${fmt(-py)})`;
    return `<g transform="${transform}">${await this.children(node.children, defs)}</g>`;
  }

  private async path(node: XmlNode, defs: string[]): Promise<string> {
    const a = node.attrs;
    for (const key of ["android:trimPathStart", "android:trimPathEnd", "android:trimPathOffset"]) {
      if (a[key] !== undefined && num(a[key], 0) !== (key === "android:trimPathEnd" ? 1 : 0)) throw new Unsupported(key);
    }
    const d = a["android:pathData"] ?? "";
    if (!PATH_RE.test(d)) throw new Unsupported("path data");
    const gradients = new Map<string, XmlNode>();
    for (const child of node.children) {
      if (child.name !== "aapt:attr") throw new Unsupported(`path child ${child.name}`);
      const gradient = child.children.find((g) => g.name === "gradient");
      if (child.attrs["name"] && gradient) gradients.set(child.attrs["name"], gradient);
    }
    const paint = async (key: string): Promise<string> => {
      const gradient = gradients.get(key);
      if (gradient) return this.gradient(gradient, defs);
      const value = a[key];
      if (value === undefined) return "none";
      const [r, g, b, alpha] = androidColor(await this.color(value)) ?? [0, 0, 0, 0];
      return `rgba(${r},${g},${b},${fmt(alpha / 255)})`;
    };
    const fill = await paint("android:fillColor");
    const stroke = await paint("android:strokeColor");
    const cap = a["android:strokeLineCap"] ?? "butt";
    const join = a["android:strokeLineJoin"] ?? "miter";
    if (!/^(butt|round|square)$/.test(cap) || !/^(miter|round|bevel)$/.test(join)) throw new Unsupported("stroke style");
    const rule = a["android:fillType"] === "evenOdd" ? "evenodd" : "nonzero";
    return `<path d="${d}" fill="${fill}" fill-opacity="${fmt(num(a["android:fillAlpha"], 1))}" fill-rule="${rule}" stroke="${stroke}" stroke-width="${fmt(num(a["android:strokeWidth"], 0))}" stroke-opacity="${fmt(num(a["android:strokeAlpha"], 1))}" stroke-linecap="${cap}" stroke-linejoin="${join}" stroke-miterlimit="${fmt(num(a["android:strokeMiterLimit"], 4))}"/>`;
  }

  private async gradient(node: XmlNode, defs: string[]): Promise<string> {
    const a = node.attrs;
    const id = `g${this.ids++}`;
    const stops: string[] = [];
    const stop = async (offset: number, color: string): Promise<void> => {
      const [r, g, b, alpha] = androidColor(await this.color(color)) ?? [0, 0, 0, 0];
      stops.push(`<stop offset="${fmt(offset)}" stop-color="rgb(${r},${g},${b})" stop-opacity="${fmt(alpha / 255)}"/>`);
    };
    const items = node.children.filter((c) => c.name === "item");
    if (items.length) {
      for (const item of items) await stop(num(item.attrs["android:offset"], 0), item.attrs["android:color"] ?? "#00000000");
    } else {
      if (a["android:startColor"]) await stop(0, a["android:startColor"]);
      if (a["android:centerColor"]) await stop(0.5, a["android:centerColor"]);
      if (a["android:endColor"]) await stop(1, a["android:endColor"]);
    }
    if (!stops.length) throw new Unsupported("gradient without colors");
    const type = a["android:type"] ?? "linear";
    if (type === "linear") {
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(num(a["android:startX"], 0))}" y1="${fmt(num(a["android:startY"], 0))}" x2="${fmt(num(a["android:endX"], 0))}" y2="${fmt(num(a["android:endY"], 0))}">${stops.join("")}</linearGradient>`);
    } else if (type === "radial") {
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(num(a["android:centerX"], 0))}" cy="${fmt(num(a["android:centerY"], 0))}" r="${fmt(num(a["android:gradientRadius"], 0))}">${stops.join("")}</radialGradient>`);
    } else {
      throw new Unsupported(`gradient type ${type}`);
    }
    return `url(#${id})`;
  }
}
