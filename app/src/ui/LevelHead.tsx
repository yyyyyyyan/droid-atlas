/** Headers shared by the levels below Explore, and the glyph that stands for a lens. */

import type { ComponentChildren } from "preact";
import type { FilterDef } from "../catalog/filters.ts";
import { useServices } from "../services.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Tip } from "./Tip.tsx";

const LENS_ICONS: Record<string, IconName> = {
  shizuku: "drop",
  root: "root",
  "no-internet": "offline",
  fdroid: "fdroid",
  izzy: "izzy",
  apk: "box",
  clean: "shield",
  new: "added",
  fresh: "updated",
};

export function LensGlyph({ lens, size = 20 }: { lens: FilterDef; size?: number }) {
  const icon = LENS_ICONS[lens.key];
  return icon ? <Icon name={icon} size={size} /> : null;
}

export function BackButton() {
  const { router } = useServices();
  return (
    <button type="button" class="icon-btn" aria-label="Back" onClick={() => router.up()}>
      <Icon name="back" /><Tip text="Back" at="start" />
    </button>
  );
}

interface Props {
  /** The way up, where the place has one worth naming. */
  overline?: ComponentChildren;
  title: ComponentChildren;
  children?: ComponentChildren;
}

/**
 * A level's header in its region's color: back control, what kind of place
 * this is, its name, and a line about it. It is kept to the height of a few
 * lines of text because everything above the first row of a list costs rows.
 */
export function PlaceHead({ overline, title, children }: Props) {
  return (
    <header class="place-head">
      <BackButton />
      <div class="head-main">
        {overline && <p class="overline">{overline}</p>}
        <h1 dir="auto">{title}</h1>
      </div>
      {children}
    </header>
  );
}

/** The header of a page that is not a place in the catalog: Settings, About and the pages beneath them. */
export function PageHead({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <header class="plain-head">
      <BackButton />
      <h1>{title}</h1>
      {children}
    </header>
  );
}
