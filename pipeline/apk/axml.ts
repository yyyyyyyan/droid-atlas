/**
 * A reader for Android's binary XML, the form `AndroidManifest.xml` takes
 * inside a built package. It turns the bytes into a small element tree and
 * nothing more: no resource table, no resolution of references.
 *
 * The bytes are untrusted. Every offset is checked against the bounds of the
 * chunk that holds it, every count and length against `AxmlLimits`, and a
 * malformed structure is an `AxmlError`, never a guess. Chunks of a type the
 * tree does not need are skipped, as Android's own parser skips them.
 */

export interface AxmlLimits {
  maxBytes: number;
  maxStrings: number;
  /** Longer strings, in characters or in UTF-8 bytes, are kept as unreadable (`null`), not truncated. */
  maxStringLength: number;
  /**
   * Characters decoded over the whole document. Offsets may share or overlap
   * strings, so this, not the string count, bounds the work a pool can ask for.
   */
  maxDecodedChars: number;
  maxElements: number;
  maxAttributesPerElement: number;
  maxDepth: number;
}

export const AXML_LIMITS: Readonly<AxmlLimits> = {
  maxBytes: 4 * 1024 * 1024,
  maxStrings: 200_000,
  maxStringLength: 4096,
  maxDecodedChars: 2_000_000,
  maxElements: 50_000,
  maxAttributesPerElement: 256,
  maxDepth: 32,
};

/** A typed attribute value. `null` in `string` marks a string over the length limit. */
export type AxmlValue =
  | { type: "string"; value: string | null }
  | { type: "boolean"; value: boolean }
  | { type: "int"; value: number }
  | { type: "reference"; ref: number }
  | { type: "other"; dataType: number };

export interface AxmlAttribute {
  /** Namespace URI, or null for none. */
  ns: string | null;
  name: string | null;
  /** The framework resource id the name maps to, when the file's resource map covers it. */
  resourceId: number | null;
  value: AxmlValue;
}

export interface AxmlElement {
  name: string | null;
  attributes: AxmlAttribute[];
  children: AxmlElement[];
}

export class AxmlError extends Error {}

const RES_STRING_POOL = 0x0001;
const RES_XML = 0x0003;
const RES_XML_START_ELEMENT = 0x0102;
const RES_XML_END_ELEMENT = 0x0103;
const RES_XML_RESOURCE_MAP = 0x0180;

const UTF8_FLAG = 1 << 8;
const NO_INDEX = 0xffffffff;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

const CHUNK_HEADER = 8;
const NODE_HEADER = 16;
const ELEMENT_EXT = 20;
const ATTRIBUTE_SIZE = 20;

/** Bounds-checked little-endian reads over one byte range. */
class View {
  readonly #data: DataView;
  constructor(bytes: Uint8Array) {
    this.#data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get length(): number {
    return this.#data.byteLength;
  }
  u8(at: number): number {
    this.#need(at, 1);
    return this.#data.getUint8(at);
  }
  u16(at: number): number {
    this.#need(at, 2);
    return this.#data.getUint16(at, true);
  }
  u32(at: number): number {
    this.#need(at, 4);
    return this.#data.getUint32(at, true);
  }
  #need(at: number, size: number): void {
    if (!Number.isInteger(at) || at < 0 || at + size > this.#data.byteLength) throw new AxmlError(`read past the end at ${at}`);
  }
}

class StringPool {
  readonly #view: View;
  readonly #bytes: Uint8Array;
  readonly #offsets: number;
  readonly #end: number;
  readonly #stringsStart: number;
  readonly #utf8: boolean;
  readonly #maxLength: number;
  readonly #maxDecoded: number;
  #decoded = 0;
  /** Decoded strings by byte offset, so offsets that share a string decode it once. */
  readonly #cache = new Map<number, string | null>();
  readonly count: number;

  constructor(view: View, bytes: Uint8Array, start: number, headerSize: number, size: number, limits: AxmlLimits) {
    if (headerSize < 28) throw new AxmlError("string pool header too small");
    this.#view = view;
    this.#bytes = bytes;
    this.#offsets = start + headerSize;
    this.#end = start + size;
    this.count = view.u32(start + 8);
    const styleCount = view.u32(start + 12);
    const flags = view.u32(start + 16);
    this.#stringsStart = start + view.u32(start + 20);
    this.#utf8 = (flags & UTF8_FLAG) !== 0;
    this.#maxLength = limits.maxStringLength;
    this.#maxDecoded = limits.maxDecodedChars;
    if (this.count > limits.maxStrings || styleCount > limits.maxStrings) throw new AxmlError(`string pool holds ${this.count} strings`);
    if (start + headerSize + (this.count + styleCount) * 4 > this.#end) throw new AxmlError("string offsets run past the pool");
    if (this.count > 0 && (this.#stringsStart < start + headerSize || this.#stringsStart >= this.#end)) {
      throw new AxmlError("string data starts outside the pool");
    }
  }

  /** The string at `index`; null for a string over the length limit. Throws on a bad index or a malformed entry. */
  get(index: number): string | null {
    if (index >= this.count) throw new AxmlError(`string index ${index} outside a pool of ${this.count}`);
    const at = this.#stringsStart + this.#view.u32(this.#offsets + index * 4);
    const cached = this.#cache.get(at);
    if (cached !== undefined) return cached;
    const text = this.#utf8 ? this.#utf8At(at) : this.#utf16At(at);
    this.#cache.set(at, text);
    return text;
  }

  #spend(amount: number): void {
    this.#decoded += amount;
    if (this.#decoded > this.#maxDecoded) throw new AxmlError(`string pool decoded more than ${this.#maxDecoded} characters`);
  }

  #within(at: number, size: number): void {
    if (at < this.#stringsStart || at + size > this.#end) throw new AxmlError("string runs past the pool");
  }

  #utf8At(at: number): string | null {
    this.#within(at, 2);
    let position = at;
    const lengthByte = (): number => {
      this.#within(position, 1);
      let value = this.#view.u8(position++);
      if (value & 0x80) {
        this.#within(position, 1);
        value = ((value & 0x7f) << 8) | this.#view.u8(position++);
      }
      return value;
    };
    const characters = lengthByte();
    const byteLength = lengthByte();
    this.#within(position, byteLength);
    if (characters > this.#maxLength || byteLength > this.#maxLength) return null;
    this.#spend(byteLength);
    return new TextDecoder("utf-8").decode(this.#bytes.subarray(position, position + byteLength));
  }

  #utf16At(at: number): string | null {
    this.#within(at, 2);
    let position = at;
    let units = this.#view.u16(position);
    position += 2;
    if (units & 0x8000) {
      this.#within(position, 2);
      units = ((units & 0x7fff) << 16) | this.#view.u16(position);
      position += 2;
    }
    this.#within(position, units * 2);
    if (units > this.#maxLength) return null;
    this.#spend(units);
    const codes: number[] = [];
    for (let i = 0; i < units; i++) codes.push(this.#view.u16(position + i * 2));
    return String.fromCharCode(...codes);
  }
}

function attributeValue(view: View, at: number, rawValue: number, string: (index: number) => string | null): AxmlValue {
  const dataType = view.u8(at + 3);
  const data = view.u32(at + 4);
  switch (dataType) {
    case TYPE_STRING:
      return { type: "string", value: string(rawValue !== NO_INDEX ? rawValue : data) };
    case TYPE_INT_BOOLEAN:
      return { type: "boolean", value: data !== 0 };
    case TYPE_INT_DEC:
    case TYPE_INT_HEX:
      return { type: "int", value: data };
    case TYPE_REFERENCE:
      return { type: "reference", ref: data };
    default:
      return { type: "other", dataType };
  }
}

/** Parses a binary XML document into its root element. */
export function parseAxml(bytes: Uint8Array, limits: AxmlLimits = AXML_LIMITS): AxmlElement {
  if (bytes.byteLength > limits.maxBytes) throw new AxmlError(`document of ${bytes.byteLength} bytes`);
  const view = new View(bytes);
  if (view.length < CHUNK_HEADER || view.u16(0) !== RES_XML) throw new AxmlError("not a binary XML document");
  const headerSize = view.u16(2);
  const end = view.u32(4);
  if (headerSize < CHUNK_HEADER || end > view.length || end < headerSize) throw new AxmlError("bad document header");

  let pool: StringPool | null = null;
  let resourceMap: number[] = [];
  const stack: AxmlElement[] = [];
  let root: AxmlElement | null = null;
  let elements = 0;
  const string = (index: number): string | null => {
    if (index === NO_INDEX) return null;
    if (!pool) throw new AxmlError("string referenced before the string pool");
    return pool.get(index);
  };

  for (let at = headerSize; at < end; ) {
    if (at + CHUNK_HEADER > end) throw new AxmlError("truncated chunk header");
    const type = view.u16(at);
    const chunkHeader = view.u16(at + 2);
    const size = view.u32(at + 4);
    if (chunkHeader < CHUNK_HEADER || size < chunkHeader || at + size > end) throw new AxmlError(`bad chunk at ${at}`);
    const chunk = new View(bytes.subarray(at, at + size));
    switch (type) {
      case RES_STRING_POOL:
        if (pool) throw new AxmlError("second string pool");
        pool = new StringPool(view, bytes, at, chunkHeader, size, limits);
        break;
      case RES_XML_RESOURCE_MAP: {
        const count = Math.floor((size - chunkHeader) / 4);
        if (count > limits.maxStrings) throw new AxmlError(`resource map of ${count} ids`);
        resourceMap = Array.from({ length: count }, (_, i) => chunk.u32(chunkHeader + i * 4));
        break;
      }
      case RES_XML_START_ELEMENT: {
        if (chunkHeader < NODE_HEADER) throw new AxmlError("element header too small");
        if (++elements > limits.maxElements) throw new AxmlError(`more than ${limits.maxElements} elements`);
        if (stack.length >= limits.maxDepth) throw new AxmlError(`elements nested deeper than ${limits.maxDepth}`);
        if (!stack.length && root) throw new AxmlError("second root element");
        const ext = chunkHeader;
        if (ext + ELEMENT_EXT > size) throw new AxmlError("truncated element");
        const name = string(chunk.u32(ext + 4));
        const attributeStart = chunk.u16(ext + 8);
        const attributeSize = chunk.u16(ext + 10);
        const attributeCount = chunk.u16(ext + 12);
        if (attributeCount > limits.maxAttributesPerElement) throw new AxmlError(`element with ${attributeCount} attributes`);
        if (attributeCount && attributeSize < ATTRIBUTE_SIZE) throw new AxmlError("attribute record too small");
        if (ext + attributeStart + attributeCount * attributeSize > size) throw new AxmlError("attributes run past the element");
        const attributes: AxmlAttribute[] = [];
        for (let i = 0; i < attributeCount; i++) {
          const a = ext + attributeStart + i * attributeSize;
          const nameIndex = chunk.u32(a + 4);
          attributes.push({
            ns: string(chunk.u32(a)),
            name: string(nameIndex),
            resourceId: nameIndex < resourceMap.length ? (resourceMap[nameIndex] ?? null) : null,
            value: attributeValue(chunk, a + 12, chunk.u32(a + 8), string),
          });
        }
        const element: AxmlElement = { name, attributes, children: [] };
        const parent = stack.at(-1);
        if (parent) parent.children.push(element);
        else root = element;
        stack.push(element);
        break;
      }
      case RES_XML_END_ELEMENT:
        if (!stack.pop()) throw new AxmlError("end of an element that was not started");
        break;
      default:
        break;
    }
    at += size;
  }
  if (stack.length) throw new AxmlError("document ends inside an element");
  if (!root) throw new AxmlError("document has no element");
  return root;
}
