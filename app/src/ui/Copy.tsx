/**
 * Copying a piece of text the reader will paste elsewhere: the copy itself,
 * with a fallback where the clipboard is refused, and the icon button that
 * does it and says whether it worked.
 */

import { useState } from "preact/hooks";
import { announce } from "../services.ts";
import { Icon } from "./Icon.tsx";
import { Tip } from "./Tip.tsx";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.className = "sr";
    area.readOnly = true;
    (document.querySelector("dialog[open]") ?? document.body).append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

interface Props {
  text: string;
  /** What is copied, as the button's name ("Copy …") and its announcement ("… copied"). */
  label: string;
  /** The words under a resting pointer before a copy. */
  tip?: string;
  class?: string;
}

export function CopyButton({ text, label, tip = "Copy", class: className }: Props) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async (): Promise<void> => {
    const ok = await copyText(text);
    setState(ok ? "copied" : "failed");
    announce(ok ? `${label} copied` : "Copying failed");
    setTimeout(() => setState("idle"), 1800);
  };
  return (
    <button type="button" class={className ? `icon-btn ${className}` : "icon-btn"} aria-label={`Copy ${label}`} onClick={() => void copy()}>
      <Icon name={state === "copied" ? "check" : state === "failed" ? "warn" : "copy"} size={20} />
      <Tip text={state === "copied" ? "Copied" : state === "failed" ? "Copying failed" : tip} at="end" />
    </button>
  );
}
