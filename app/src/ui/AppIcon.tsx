/**
 * What stands at the head of an entry.
 *
 * - An app with a self-hosted icon shows it, in a box of fixed size so
 *   nothing moves when it arrives. Everywhere the list-size file comes first:
 *   it is the one stored for every icon a list has shown. A row never asks
 *   for the large file. The sheet loads it beside the list file, only where
 *   the screen has more pixels for the icon than the list file, and puts it
 *   in place only once it has loaded; if it fails or never arrives, nothing
 *   on screen changes. Large files are fetched only for a sheet that shows
 *   one, never ahead, and one still on its way is dropped when the sheet
 *   closes or moves to another app.
 * - An app without an icon, or whose icon fails to load, shows a placeholder
 *   made for the purpose: its initials on a tile in its region's color.
 * - A resource (a guide, a site) is a link, and shows a link glyph in a
 *   circle, so the two kinds are told apart by shape before anything is read.
 *
 * Nothing is fetched from a third party.
 */

import { useEffect, useState } from "preact/hooks";
import { dataUrl } from "../catalog/load.ts";
import type { Entry } from "../catalog/model.ts";
import { monogram } from "../lib/format.ts";
import { useServices } from "../services.ts";
import { Icon } from "./Icon.tsx";
import { wantsLargeIcon } from "./icon-size.ts";
import { plateClass, sampleGlyph, type Glyph } from "./plate.ts";

/** Up to this size an icon is decoded with the frame that shows it, so in a list that is moving fast it arrives with its row and not a frame later. */
const ROW_ICON = 48;

/** Degrees by which a placeholder's hue leaves its region's, from the name: enough that neighbors differ, little enough that the place still shows. */
function tilt(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return ((hash % 7) - 3) * 10;
}

export function AppIcon({ entry, size }: { entry: Entry; size: number }) {
  const { build } = useServices();
  const [state, setState] = useState<"pending" | "loaded" | "failed">("pending");
  /* Decided in the same update that shows the icon, so its plate never changes once it is on screen. */
  const [glyph, setGlyph] = useState<Glyph>(null);
  const style = { "--ico": `${size}px` };
  const { icon, iconLarge } = entry.app;
  const src = !entry.resource && icon ? dataUrl(build.dataRoot, icon) : null;
  const large = !entry.resource && iconLarge ? dataUrl(build.dataRoot, iconLarge) : null;
  const upgrade = size > ROW_ICON && large !== null && large !== src && wantsLargeIcon(size, globalThis.devicePixelRatio || 1);
  const [largeReady, setLargeReady] = useState(false);
  useEffect(() => {
    setLargeReady(false);
    if (!upgrade || !large) return undefined;
    let current = true;
    const probe = new Image();
    probe.src = large;
    probe.decode().then(() => {
      if (!current) return;
      setLargeReady(true);
      setState((now) => (now === "failed" ? "pending" : now));
    }, () => undefined);
    return () => {
      current = false;
      probe.src = "";
    };
  }, [upgrade, large]);

  if (entry.resource) {
    return <span class="ico is-link" style={style} aria-hidden="true"><Icon name="link" size={Math.round(size * 0.5)} /></span>;
  }
  if (!src || state === "failed") {
    return <span class="ico is-mono" style={{ ...style, "--tilt": String(tilt(entry.app.name)) }}><span class="mono" aria-hidden="true">{monogram(entry.app.name)}</span></span>;
  }
  return (
    <span class={state === "loaded" ? `ico has-img${plateClass(glyph)}` : "ico is-pending"} style={style}>
      <img
        src={upgrade && largeReady && large ? large : src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding={size <= ROW_ICON ? "sync" : "async"}
        onLoad={(event) => {
          /* The plate is decided once, on the first file shown, so it does not change when the large file takes its place. */
          if (state !== "loaded") setGlyph(sampleGlyph(event.currentTarget));
          setState("loaded");
        }}
        onError={() => {
          if (!(upgrade && largeReady)) setState("failed");
        }}
      />
    </span>
  );
}
