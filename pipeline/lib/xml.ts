/**
 * A small, strict reader for text XML: elements, attributes, text, comments,
 * CDATA and processing instructions. Enough for Android's resource and
 * manifest files, and nothing more: a document type declaration, an entity
 * other than the five predefined ones and a character reference, an
 * unclosed or mismatched element, or a document past its bounds is refused.
 * Nothing in the input is ever resolved against anything outside it.
 */

export interface XmlElement {
  name: string;
  attributes: Map<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

export interface XmlLimits {
  /** Characters in the whole document. */
  characters: number;
  /** Elements in the whole document. */
  elements: number;
  depth: number;
  attributesPerElement: number;
}

export const DEFAULT_XML_LIMITS: XmlLimits = { characters: 8_000_000, elements: 200_000, depth: 32, attributesPerElement: 64 };

export class XmlError extends Error {
  constructor(message: string, at: number) {
    super(`${message} at character ${at}`);
    this.name = "XmlError";
  }
}

const NAME = /[A-Za-z_][A-Za-z0-9_.:-]*/y;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(text: string, at: number): string {
  return text.replace(/&([^;&\s]{0,12});|&/g, (whole, entity: string | undefined) => {
    if (entity === undefined) throw new XmlError("a bare ampersand", at);
    if (Object.hasOwn(PREDEFINED, entity)) return PREDEFINED[entity] ?? "";
    const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/.exec(entity);
    if (!numeric) throw new XmlError(`an unknown entity ${whole}`, at);
    const code = numeric[1] !== undefined ? Number.parseInt(numeric[1], 16) : Number(numeric[2]);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new XmlError(`a character reference to ${code}`, at);
    return String.fromCodePoint(code);
  });
}

/** Parses a whole document and returns its root element. */
export function parseXml(text: string, limits: XmlLimits = DEFAULT_XML_LIMITS): XmlElement {
  if (text.length > limits.characters) throw new XmlError(`a document longer than ${limits.characters} characters`, 0);
  let position = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let elements = 0;
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  const skipSpace = (): void => {
    while (position < text.length && /\s/.test(text.charAt(position))) position++;
  };
  const until = (end: string, what: string): string => {
    const found = text.indexOf(end, position);
    if (found === -1) throw new XmlError(`an unclosed ${what}`, position);
    const inner = text.slice(position, found);
    position = found + end.length;
    return inner;
  };
  const name = (): string => {
    NAME.lastIndex = position;
    const match = NAME.exec(text);
    if (!match) throw new XmlError("a missing name", position);
    position = NAME.lastIndex;
    return match[0];
  };
  const addText = (value: string, at: number): void => {
    const current = stack.at(-1);
    if (current) current.children.push(value);
    else if (value.trim() !== "") throw new XmlError("text outside the root element", at);
  };

  while (position < text.length) {
    const at = position;
    if (text.startsWith("<!--", position)) {
      position += 4;
      until("-->", "comment");
    } else if (text.startsWith("<![CDATA[", position)) {
      position += 9;
      addText(until("]]>", "CDATA section"), at);
    } else if (text.startsWith("<?", position)) {
      position += 2;
      until("?>", "processing instruction");
    } else if (text.startsWith("<!", position)) {
      throw new XmlError("a document type declaration", at);
    } else if (text.startsWith("</", position)) {
      position += 2;
      const closing = name();
      skipSpace();
      if (text.charAt(position) !== ">") throw new XmlError(`a malformed end tag </${closing}`, at);
      position++;
      const open = stack.pop();
      if (!open || open.name !== closing) throw new XmlError(`</${closing}> closing ${open ? `<${open.name}>` : "nothing"}`, at);
    } else if (text.charAt(position) === "<") {
      position++;
      if (root && stack.length === 0) throw new XmlError("a second root element", at);
      const element: XmlElement = { name: name(), attributes: new Map(), children: [] };
      if (++elements > limits.elements) throw new XmlError(`more than ${limits.elements} elements`, at);
      for (;;) {
        const before = position;
        skipSpace();
        if (text.startsWith("/>", position) || text.charAt(position) === ">") break;
        if (position === before) throw new XmlError(`a malformed start tag <${element.name}`, at);
        const attribute = name();
        skipSpace();
        if (text.charAt(position) !== "=") throw new XmlError(`attribute ${attribute} without a value`, position);
        position++;
        skipSpace();
        const quote = text.charAt(position);
        if (quote !== '"' && quote !== "'") throw new XmlError(`attribute ${attribute} without quotes`, position);
        position++;
        const raw = until(quote, `attribute ${attribute}`);
        if (raw.includes("<")) throw new XmlError(`"<" in attribute ${attribute}`, position);
        if (element.attributes.has(attribute)) throw new XmlError(`attribute ${attribute} given twice`, position);
        element.attributes.set(attribute, decode(raw, position));
        if (element.attributes.size > limits.attributesPerElement) throw new XmlError(`more than ${limits.attributesPerElement} attributes`, at);
      }
      const parent = stack.at(-1);
      if (parent) parent.children.push(element);
      else root = element;
      if (text.startsWith("/>", position)) {
        position += 2;
      } else {
        position++;
        stack.push(element);
        if (stack.length > limits.depth) throw new XmlError(`elements nested deeper than ${limits.depth}`, at);
      }
    } else {
      const next = text.indexOf("<", position);
      const end = next === -1 ? text.length : next;
      const raw = text.slice(position, end);
      position = end;
      addText(decode(raw, at), at);
    }
  }
  if (stack.length > 0) throw new XmlError(`an unclosed element <${stack.at(-1)?.name ?? ""}>`, position);
  if (!root) throw new XmlError("no root element", position);
  return root;
}

/** The element children of an element, in document order. */
export function childElements(element: XmlElement): XmlElement[] {
  return element.children.filter((child): child is XmlElement => typeof child !== "string");
}

/** All text inside an element, nested elements included, in document order. */
export function textContent(element: XmlElement): string {
  return element.children.map((child) => (typeof child === "string" ? child : textContent(child))).join("");
}
