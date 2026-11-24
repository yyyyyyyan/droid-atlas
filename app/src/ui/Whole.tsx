/**
 * Where text may break across lines. A product or source name ("F-Droid"
 * breaks at its hyphen otherwise) and a figure with its unit are never
 * broken inside themselves, though a line may still break between two of
 * them; an id or an address breaks only between its parts.
 */

import { Fragment } from "preact";

export function Whole({ children }: { children: string }) {
  return <span class="whole">{children}</span>;
}

/** The names this app's own sentences mention that a line must not break inside: at a hyphen, or between their words. */
export const PRODUCT_NAMES = ["Android FOSS", "awesome-shizuku", "F-Droid", "Google Play", "IzzyOnDroid", "Obtainium", "GitHub"] as const;

const NAME_PATTERN = new RegExp(`(${PRODUCT_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);

/** A sentence of the app's own, with every product name in it kept whole. */
export function Prose({ children }: { children: string }) {
  return <>{children.split(NAME_PATTERN).map((part, index) => (index % 2 === 1 ? <Whole key={index}>{part}</Whole> : part))}</>;
}

/** Names joined with commas, each kept whole: "Android FOSS, F-Droid". */
export function Names({ names }: { names: readonly string[] }) {
  return (
    <>
      {names.map((name, index) => (
        <Fragment key={name}>
          {index > 0 && ", "}
          <Whole>{name}</Whole>
        </Fragment>
      ))}
    </>
  );
}

/** An id or an address with a place to break after each dot, slash, dash and underscore, so a long one wraps between its parts and never strands a letter. */
export function Breakable({ text }: { text: string }) {
  const parts = text.split(/(?<=[./_-])/);
  return <>{parts.map((part, index) => (index === 0 ? part : <><wbr />{part}</>))}</>;
}
