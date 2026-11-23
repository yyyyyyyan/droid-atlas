/**
 * Invented packages for the package reader's tests: a binary XML encoder, a
 * zip writer and a fake server that answers byte-range requests. No real
 * app's file is used.
 */
import { crc32, deflateRawSync } from "node:zlib";

export const ANDROID_NS = "http://schemas.android.com/apk/res/android";

/** Framework attribute ids, as `android.R.attr` gives them. */
export const ANDROID_IDS: Readonly<Record<string, number>> = {
  label: 0x01010001,
  name: 0x01010003,
  permission: 0x01010006,
  exported: 0x01010010,
  mimeType: 0x01010026,
  scheme: 0x01010027,
  host: 0x01010028,
  versionCode: 0x0101021b,
  versionName: 0x0101021c,
};

export type FakeValue = string | boolean | number | { ref: number } | { other: number };

export interface FakeAttribute {
  name: string;
  /** In the android namespace with its framework id (the default), or plain. */
  plain?: boolean;
  value: FakeValue;
}

export interface FakeElement {
  name: string;
  attrs?: FakeAttribute[];
  children?: FakeElement[];
}

/** An element whose attribute keys name android attributes; a key starting with `@` names a plain one (`@package`). */
export function el(name: string, attrs: Record<string, FakeValue> = {}, children: FakeElement[] = []): FakeElement {
  return {
    name,
    attrs: Object.entries(attrs).map(([key, value]) =>
      key.startsWith("@") ? { name: key.slice(1), plain: true, value } : { name: key, value },
    ),
    children,
  };
}

export interface EncodeOptions {
  utf8?: boolean;
  /** Replaces every android attribute's name string with junk, leaving the resource map to identify them. */
  obfuscateNames?: boolean;
}

class Writer {
  readonly bytes: number[] = [];
  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }
  u16(value: number): void {
    this.u8(value);
    this.u8(value >>> 8);
  }
  u32(value: number): void {
    this.u16(value & 0xffff);
    this.u16(value >>> 16);
  }
  put(bytes: ArrayLike<number>): void {
    for (let i = 0; i < bytes.length; i++) this.u8(bytes[i] ?? 0);
  }
}

function walk(element: FakeElement, visit: (element: FakeElement) => void): void {
  visit(element);
  for (const child of element.children ?? []) walk(child, visit);
}

function stringPool(strings: string[], utf8: boolean): number[] {
  const data = new Writer();
  const offsets: number[] = [];
  for (const text of strings) {
    offsets.push(data.bytes.length);
    if (utf8) {
      const encoded = new TextEncoder().encode(text);
      const lengthBytes = (n: number): void => {
        if (n > 0x7f) {
          data.u8(0x80 | (n >> 8));
          data.u8(n & 0xff);
        } else data.u8(n);
      };
      lengthBytes(text.length);
      lengthBytes(encoded.length);
      data.put(encoded);
      data.u8(0);
    } else {
      if (text.length > 0x7fff) {
        data.u16(0x8000 | (text.length >>> 16));
        data.u16(text.length & 0xffff);
      } else data.u16(text.length);
      for (let i = 0; i < text.length; i++) data.u16(text.charCodeAt(i));
      data.u16(0);
    }
  }
  while (data.bytes.length % 4) data.u8(0);
  const header = 28;
  const out = new Writer();
  out.u16(0x0001);
  out.u16(header);
  out.u32(header + strings.length * 4 + data.bytes.length);
  out.u32(strings.length);
  out.u32(0);
  out.u32(utf8 ? 1 << 8 : 0);
  out.u32(header + strings.length * 4);
  out.u32(0);
  for (const offset of offsets) out.u32(offset);
  out.put(data.bytes);
  return out.bytes;
}

/** Encodes an element tree as Android binary XML, as aapt2 lays it out. */
export function encodeAxml(root: FakeElement, options: EncodeOptions = {}): Uint8Array {
  const androidNames: string[] = [];
  const others: string[] = [];
  walk(root, (element) => {
    others.push(element.name);
    for (const attr of element.attrs ?? []) {
      if (attr.plain) others.push(attr.name);
      else if (!androidNames.includes(attr.name)) androidNames.push(attr.name);
      if (typeof attr.value === "string") others.push(attr.value);
    }
  });
  const strings = [...androidNames.map((name) => (options.obfuscateNames ? `x${name.length}q` : name))];
  const indexOf = new Map<string, number>();
  androidNames.forEach((name, i) => indexOf.set(`attr:${name}`, i));
  const intern = (text: string): number => {
    const key = `s:${text}`;
    let index = indexOf.get(key);
    if (index === undefined) {
      index = strings.length;
      strings.push(text);
      indexOf.set(key, index);
    }
    return index;
  };
  const nsIndex = intern(ANDROID_NS);
  const prefixIndex = intern("android");
  for (const text of others) intern(text);

  const body = new Writer();
  body.put(stringPool(strings, options.utf8 ?? false));
  body.u16(0x0180);
  body.u16(8);
  body.u32(8 + androidNames.length * 4);
  for (const name of androidNames) body.u32(ANDROID_IDS[name] ?? 0x01019999);

  body.u16(0x0100);
  body.u16(16);
  body.u32(24);
  body.u32(1);
  body.u32(0xffffffff);
  body.u32(prefixIndex);
  body.u32(nsIndex);

  const element = (node: FakeElement): void => {
    const attrs = node.attrs ?? [];
    body.u16(0x0102);
    body.u16(16);
    body.u32(16 + 20 + attrs.length * 20);
    body.u32(1);
    body.u32(0xffffffff);
    body.u32(0xffffffff);
    body.u32(intern(node.name));
    body.u16(20);
    body.u16(20);
    body.u16(attrs.length);
    body.u16(0);
    body.u16(0);
    body.u16(0);
    for (const attr of attrs) {
      body.u32(attr.plain ? 0xffffffff : nsIndex);
      body.u32(attr.plain ? intern(attr.name) : (indexOf.get(`attr:${attr.name}`) as number));
      const value = attr.value;
      if (typeof value === "string") {
        const index = intern(value);
        body.u32(index);
        body.u16(8);
        body.u8(0);
        body.u8(0x03);
        body.u32(index);
      } else {
        body.u32(0xffffffff);
        body.u16(8);
        body.u8(0);
        if (typeof value === "boolean") {
          body.u8(0x12);
          body.u32(value ? 0xffffffff : 0);
        } else if (typeof value === "number") {
          body.u8(0x10);
          body.u32(value);
        } else if ("ref" in value) {
          body.u8(0x01);
          body.u32(value.ref);
        } else {
          body.u8(value.other);
          body.u32(0);
        }
      }
    }
    for (const child of node.children ?? []) element(child);
    body.u16(0x0103);
    body.u16(16);
    body.u32(24);
    body.u32(1);
    body.u32(0xffffffff);
    body.u32(0xffffffff);
    body.u32(intern(node.name));
  };
  element(root);

  body.u16(0x0101);
  body.u16(16);
  body.u32(24);
  body.u32(1);
  body.u32(0xffffffff);
  body.u32(prefixIndex);
  body.u32(nsIndex);

  const out = new Writer();
  out.u16(0x0003);
  out.u16(8);
  out.u32(8 + body.bytes.length);
  out.put(body.bytes);
  return Uint8Array.from(out.bytes);
}

export interface ZipFile {
  name: string;
  data: Uint8Array;
  method?: 0 | 8;
  /** Overrides written into the central directory record, for malformed archives. */
  central?: Partial<{ size: number; compressedSize: number; crc32: number; flags: number; method: number; offset: number }>;
  /** Extra bytes in the local header, as zipalign adds them. */
  localExtra?: number;
}

export interface ZipOptions {
  comment?: number;
  eocd?: Partial<{ count: number; directorySize: number; directoryOffset: number; disk: number }>;
}

/** Writes a zip archive. */
export function buildZip(files: ZipFile[], options: ZipOptions = {}): Uint8Array {
  const out = new Writer();
  const central = new Writer();
  for (const file of files) {
    const method = file.method ?? 8;
    const stored = method === 8 ? deflateRawSync(file.data) : file.data;
    const name = new TextEncoder().encode(file.name);
    const offset = out.bytes.length;
    const crc = crc32(file.data);
    const extra = file.localExtra ?? 0;
    out.u32(0x04034b50);
    out.u16(20);
    out.u16(0);
    out.u16(method);
    out.u32(0);
    out.u32(crc);
    out.u32(stored.length);
    out.u32(file.data.length);
    out.u16(name.length);
    out.u16(extra);
    out.put(name);
    out.put(new Uint8Array(extra));
    out.put(stored);
    const c = file.central ?? {};
    central.u32(0x02014b50);
    central.u16(20);
    central.u16(20);
    central.u16(c.flags ?? 0);
    central.u16(c.method ?? method);
    central.u32(0);
    central.u32(c.crc32 ?? crc);
    central.u32(c.compressedSize ?? stored.length);
    central.u32(c.size ?? file.data.length);
    central.u16(name.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(c.offset ?? offset);
    central.put(name);
  }
  const directoryOffset = out.bytes.length;
  out.put(central.bytes);
  const e = options.eocd ?? {};
  out.u32(0x06054b50);
  out.u16(e.disk ?? 0);
  out.u16(0);
  out.u16(e.count ?? files.length);
  out.u16(e.count ?? files.length);
  out.u32(e.directorySize ?? central.bytes.length);
  out.u32(e.directoryOffset ?? directoryOffset);
  out.u16(options.comment ?? 0);
  out.put(new Uint8Array(options.comment ?? 0));
  return Uint8Array.from(out.bytes);
}

export interface ServerOptions {
  /** Address → address it redirects to. */
  redirects?: Record<string, string>;
  /** Answer with the whole file and status 200, as a server without range support does. */
  ignoreRange?: boolean;
  /** Answer every range with this many bytes too many. */
  extraBytes?: number;
  /** Never answer, so only an abort ends the request. */
  hang?: boolean;
}

export interface FakeServer {
  fetch: typeof fetch;
  requests: { url: string; range: string | null }[];
}

/** A fetch that serves files by explicit byte range, as GitHub's file host does: no suffix ranges. */
export function rangeServer(files: Record<string, Uint8Array>, options: ServerOptions = {}): FakeServer {
  const requests: FakeServer["requests"] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const range = headers.get("range");
    requests.push({ url, range });
    if (options.hang) {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    }
    const target = options.redirects?.[url];
    if (target) return new Response(null, { status: 302, headers: { location: target } });
    const file = files[url];
    if (!file) return new Response("not found", { status: 404 });
    if (options.ignoreRange) return new Response(file, { status: 200 });
    const match = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
    if (!match) return new Response("Unsupported client range", { status: 501 });
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), file.length - 1);
    const body = file.slice(start, end + 1 + (options.extraBytes ?? 0));
    return new Response(body, { status: 206, headers: { "content-range": `bytes ${start}-${end}/${file.length}` } });
  }) as typeof fetch;
  return { fetch: fake, requests };
}
