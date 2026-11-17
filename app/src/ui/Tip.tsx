/**
 * What a control that is only an icon shows under a resting pointer and under
 * keyboard focus: its name, and the key that does the same where there is
 * one. It is decoration inside the control, shown and placed by
 * `styles/hover.css`; the control's accessible name stays its own label.
 */

interface Props {
  /** Said even where the control shows its name: a key alone in a box does not say what it is for. */
  text: string;
  keys?: string;
  /** Where it stands: centered under the control, or from its start or end edge, beside the rail, or under a row's bookmark. */
  at?: "start" | "end" | "side" | "row";
}

export function Tip({ text, keys, at }: Props) {
  return <span class={at ? `tip tip-${at}` : "tip"} aria-hidden="true">{text}{keys && <kbd>{keys}</kbd>}</span>;
}
