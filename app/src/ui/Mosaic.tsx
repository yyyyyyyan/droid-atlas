/**
 * The region map: a treemap of the catalog's regions, each tile a link sized
 * by how many entries the region holds. Every tile is built the same way: the
 * region's name, at one of two sizes, over its count. A wide
 * layout has room to add each region's largest categories, so its rows are
 * cut for tiles as square as the counts allow (`evenRows`) and its names
 * break only between words.
 *
 * The tiles are a list of links in size order, each with a full accessible
 * name that begins with the words the tile shows, so the name a reader sees
 * is the name a voice command can use; the color is place, never the only
 * cue.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { RegionView } from "../catalog/model.ts";
import { plural } from "../lib/format.ts";
import { evenRows, layoutTallEnough, squarify, tileBoxes, type Box } from "../lib/treemap.ts";
import { regionRoute } from "../router/route.ts";
import { isWide } from "../services.ts";
import { RouteLink } from "./Link.tsx";
import { placeStyle } from "./place.ts";
import { planTile, unbrokenWords } from "./tile-plan.ts";

const GAP = 3;
const OUTER_RADIUS = 26;
const INNER_RADIUS = 8;
const MIN_TILE_SIDE = 46;

/** Keeps a count on the line its name ends on, beside the last word. */
const WORD_JOINER = "\u2060";

/**
 * A category name in a tile is shown whole or not at all: it may take two
 * lines, and the categories that would need a third, would run past the
 * tile's foot, or whose last word and count are wider than the tile, are left
 * out with every one after them.
 */
function keepWholeNames(tile: HTMLElement, list: HTMLElement): void {
  const items = [...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
  for (const item of items) item.hidden = false;
  const line = Number.parseFloat(getComputedStyle(list).lineHeight) || 24;
  const foot = tile.getBoundingClientRect().bottom - (Number.parseFloat(getComputedStyle(tile).paddingBottom) || 0);
  let cut = false;
  for (const item of items) {
    const box = item.getBoundingClientRect();
    cut ||= box.height > line * 2 + 1 || box.bottom > foot + 0.5 || item.scrollWidth > item.clientWidth + 1;
    item.hidden = cut;
  }
}

function Tile({ view, box, wide }: { view: RegionView; box: Box; wide: boolean }) {
  const plan = planTile(box, view.region.name, view.entries.length, wide);
  const categories = view.categories.slice(0, plan.categories);
  const tileRef = useRef<HTMLLIElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const tile = tileRef.current;
    const list = listRef.current;
    if (!tile || !list) return undefined;
    let live = true;
    keepWholeNames(tile, list);
    void document.fonts?.ready.then(() => {
      if (live) keepWholeNames(tile, list);
    });
    return () => {
      live = false;
    };
  }, [box.w, box.h, categories.length]);
  const label = `${view.region.name}: ${plural(view.entries.length, "entry", "entries")} in ${plural(view.categories.length, "category", "categories")}`;
  return (
    <li
      ref={tileRef}
      class={`tile place${plan.narrow ? " is-narrow" : ""}`}
      style={{
        ...placeStyle(view.region.id),
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.w}px`,
        height: `${box.h}px`,
        borderRadius: box.radius,
        padding: `${plan.padding}px`,
        "--num": `${plan.numberSize}px`,
        "--name": `${plan.nameSize}px`,
      }}
    >
      <RouteLink route={regionRoute(view.region.id)} class="tile-link" aria-label={label}>
        <span class="tile-name">{wide ? unbrokenWords(view.region.name) : view.region.name}</span>{" "}
        <span class="tile-count">{view.entries.length}</span>
      </RouteLink>
      {categories.length > 0 && (
        <ul class="tile-cats" aria-hidden="true" ref={listRef}>
          {categories.map((category) => (
            <li key={category.category.id}>
              <span class="t">{category.category.name}</span>
              {WORD_JOINER}
              <span class="n">{category.entries.length}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Mosaic({ regions }: { regions: RegionView[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const wide = isWide.value;

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const read = (): void => {
      const { clientWidth: width, clientHeight: height } = element;
      setSize((previous) => (previous && previous.width === width && previous.height === height ? previous : { width, height }));
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (!size || !size.width || !size.height) return null;
    const items = regions.map((view) => ({ id: view.region.id, count: view.entries.length }));
    const byId = new Map(regions.map((view) => [view.region.id, view]));
    /* A tile is large enough when it can be tapped and can show its name over its count without clipping. */
    const fits = (rect: { id: string; w: number; h: number }): boolean => {
      const view = byId.get(rect.id);
      const box = { w: rect.w - GAP, h: rect.h - GAP };
      return Math.min(box.w, box.h) >= MIN_TILE_SIDE && (!view || planTile(box, view.region.name, view.entries.length, wide).legible);
    };
    const { rects, height } = layoutTallEnough(items, size.width, size.height, fits, wide ? evenRows : squarify);
    const boxes = tileBoxes(rects, size.width, height, { gap: GAP, outer: OUTER_RADIUS, inner: INNER_RADIUS });
    return { boxes, extra: height - size.height };
  }, [regions, size, wide]);

  return (
    <ul
      class="mosaic"
      ref={ref}
      aria-label="Regions of the catalog, sized by number of entries"
      style={layout?.extra ? { marginBottom: `${layout.extra}px` } : undefined}
    >
      {layout?.boxes.map((box) => {
        const view = regions.find((candidate) => candidate.region.id === box.id);
        return view ? <Tile key={box.id} view={view} box={box} wide={wide} /> : null;
      })}
    </ul>
  );
}
