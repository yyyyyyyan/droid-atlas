/**
 * A long description as the sheet shows it. The indexes publish plain text
 * whose authors write paragraphs, and lists as lines that begin with `*` or
 * `-`; this turns that text into paragraphs and lists, leaves out an opening
 * line that only repeats the summary shown right above it, and sets a
 * paragraph its author wrapped by hand at a fixed column as one paragraph.
 *
 * Nothing is interpreted beyond that: the text is never treated as markup,
 * and the words are shown as they were written.
 */

import { fold } from "../lib/format.ts";

export type DescriptionBlock = { kind: "text"; text: string } | { kind: "list"; items: string[] };

const BULLET = /^\s*[*\-•–]\s+(\S.*)$/;

/** The line lengths of text wrapped by hand: every line but the last is about a column wide. */
const WRAPPED = { min: 56, max: 100 };

/** A paragraph whose every line but the last is a full column is joined into one line; lines an author kept short on purpose stay apart. */
function unwrap(text: string): string {
  const lines = text.split("\n");
  const full = lines.slice(0, -1);
  return full.length > 0 && full.every((line) => line.length >= WRAPPED.min && line.length <= WRAPPED.max) ? lines.join(" ") : text;
}

/** Whether two lines say the same thing once case, diacritics, spacing and closing punctuation are set aside. */
function sameLine(a: string, b: string): boolean {
  const plain = (text: string): string => fold(text).replace(/[\s.!…]+$/u, "");
  return plain(a) !== "" && plain(a) === plain(b);
}

/**
 * @param summary the summary shown above the description, when there is one; a first line equal to it is dropped
 */
export function descriptionBlocks(text: string, summary: string | null): DescriptionBlock[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && !(lines[0] ?? "").trim()) lines.shift();
  if (summary && sameLine(lines[0] ?? "", summary)) lines.shift();

  const blocks: DescriptionBlock[] = [];
  /* A blank line ends a paragraph or a list; the next line starts a new block. */
  let open = false;
  for (const line of lines) {
    if (!line.trim()) {
      open = false;
      continue;
    }
    const last = open ? blocks.at(-1) : undefined;
    const item = BULLET.exec(line)?.[1];
    if (item !== undefined) {
      if (last?.kind === "list") last.items.push(item.trim());
      else blocks.push({ kind: "list", items: [item.trim()] });
    } else if (last?.kind === "list" && /^\s/.test(line)) {
      last.items[last.items.length - 1] += ` ${line.trim()}`;
    } else if (last?.kind === "text") {
      last.text += `\n${line.trim()}`;
    } else {
      blocks.push({ kind: "text", text: line.trim() });
    }
    open = true;
  }
  for (const block of blocks) {
    if (block.kind === "text") block.text = unwrap(block.text);
  }
  return blocks;
}

/** How much there is to read, in characters and lines: what decides whether the sheet shows it all at once. */
export function descriptionSize(blocks: readonly DescriptionBlock[]): { characters: number; lines: number } {
  let characters = 0;
  let lines = 0;
  for (const block of blocks) {
    const parts = block.kind === "list" ? block.items : block.text.split("\n");
    lines += parts.length;
    characters += parts.reduce((sum, part) => sum + part.length, 0);
  }
  return { characters, lines };
}
