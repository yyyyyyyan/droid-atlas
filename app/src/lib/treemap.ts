/**
 * Squarified treemap (Bruls, Huizing, van Wijk) for the region map.
 * `layoutMosaic` keeps tile areas proportional to their counts and enlarges a
 * tile only when it would otherwise be too small to tap or to hold its label,
 * reporting which. The rows are cut one at a time (`squarify`) on a phone,
 * and all at once (`evenRows`) on the wide map, whose tiles also list
 * categories and so cannot be slivers.
 */

/** A tile is never drawn at more than this many times its true share. */
const MAX_ENLARGEMENT = 10;

export interface Rect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Box extends Rect {
  /** Corner radii as a CSS `border-radius` value: large on the map's own corners, small on the seams. */
  radius: string;
}

function worstRatio(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const s2 = side * side;
  return Math.max((s2 * Math.max(...areas)) / (sum * sum), (sum * sum) / (s2 * Math.min(...areas)));
}

export function squarify(items: { id: string; weight: number }[], width: number, height: number): Rect[] {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0 || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  let rest = items.map((item) => ({ id: item.id, area: item.weight * scale }));
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  const rects: Rect[] = [];
  while (rest.length) {
    const side = Math.min(w, h);
    let take = 1;
    while (
      take < rest.length
      && worstRatio(rest.slice(0, take + 1).map((r) => r.area), side) <= worstRatio(rest.slice(0, take).map((r) => r.area), side)
    ) take += 1;
    const row = rest.slice(0, take);
    rest = rest.slice(take);
    const thickness = row.reduce((sum, r) => sum + r.area, 0) / side;
    let offset = 0;
    for (const r of row) {
      const length = r.area / thickness;
      rects.push(w >= h
        ? { id: r.id, x, y: y + offset, w: thickness, h: length }
        : { id: r.id, x: x + offset, y, w: length, h: thickness });
      offset += length;
    }
    if (w >= h) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
  }
  return rects;
}

/**
 * The rows of `squarify` chosen exactly instead of one at a time: of every
 * way to cut the items, in their order, into rows, the one whose least
 * square tile is the most square. A greedy row is as square as it can be
 * when it is cut, and what is left of the map falls to the last tiles, which
 * can come out three times as long as they are wide: too narrow for a name
 * on one line, or too low for anything under it. Areas follow the weights
 * exactly, as there; an item of no weight has no tile.
 */
export function evenRows(all: { id: string; weight: number }[], width: number, height: number): Rect[] {
  const items = all.filter((item) => item.weight > 0);
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0 || width <= 0 || height <= 0) return [];
  const areas = items.map((item) => (item.weight * width * height) / total);
  let best = Infinity;
  let rows: number[] = [];
  /* Each row runs along the shorter side of what is left; a cut already worse than the best whole map found is not followed further. */
  const search = (from: number, w: number, h: number, worst: number, takes: number[]): void => {
    if (from === areas.length) {
      best = worst;
      rows = [...takes];
      return;
    }
    const side = Math.min(w, h);
    let sum = 0;
    for (let take = 1; from + take <= areas.length; take += 1) {
      sum += areas[from + take - 1] ?? 0;
      const thickness = sum / side;
      let ratio = worst;
      for (let index = from; index < from + take; index += 1) {
        const length = (areas[index] ?? 0) / thickness;
        ratio = Math.max(ratio, thickness / length, length / thickness);
      }
      if (ratio >= best) continue;
      takes.push(take);
      search(from + take, w >= h ? w - thickness : w, w >= h ? h : h - thickness, ratio, takes);
      takes.pop();
    }
  };
  search(0, width, height, 1, []);

  const rects: Rect[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let from = 0;
  for (const take of rows) {
    const row = areas.slice(from, from + take);
    const thickness = row.reduce((sum, area) => sum + area, 0) / Math.min(w, h);
    let offset = 0;
    row.forEach((area, index) => {
      const id = items[from + index]?.id ?? "";
      const length = area / thickness;
      rects.push(w >= h ? { id, x, y: y + offset, w: thickness, h: length } : { id, x: x + offset, y, w: length, h: thickness });
      offset += length;
    });
    if (w >= h) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
    from += take;
  }
  return rects;
}

/** How a map's rows are cut: `squarify` or `evenRows`. */
export type Rows = typeof squarify;

export function tileBoxes(rects: Rect[], width: number, height: number, style: { gap: number; outer: number; inner: number }): Box[] {
  const { gap, outer, inner } = style;
  return rects.map((rect) => {
    const atLeft = rect.x < 0.5;
    const atTop = rect.y < 0.5;
    const atRight = rect.x + rect.w > width - 0.5;
    const atBottom = rect.y + rect.h > height - 0.5;
    const radius = (corner: boolean): string => `${corner ? outer : inner}px`;
    return {
      id: rect.id,
      x: rect.x + (atLeft ? 0 : gap / 2),
      y: rect.y + (atTop ? 0 : gap / 2),
      w: rect.w - (atLeft ? 0 : gap / 2) - (atRight ? 0 : gap / 2),
      h: rect.h - (atTop ? 0 : gap / 2) - (atBottom ? 0 : gap / 2),
      radius: [radius(atLeft && atTop), radius(atRight && atTop), radius(atRight && atBottom), radius(atLeft && atBottom)].join(" "),
    };
  });
}

/**
 * Lays out `items` (largest first) in a `width` × `height` box. A tile that
 * `fits` rejects is given a larger share and the map is laid out again, until
 * every tile fits or the passes run out. Returns the rectangles and the ids of
 * the tiles that were drawn larger than their share. `fits` may also be a
 * number, the least a tile may measure on either side. `rows` cuts the map.
 */
export function layoutMosaic(
  items: { id: string; count: number }[],
  width: number,
  height: number,
  fits: number | ((rect: Rect) => boolean),
  rows: Rows = squarify,
): { rects: Rect[]; enlarged: string[] } {
  const accept = typeof fits === "number" ? (rect: Rect): boolean => Math.min(rect.w, rect.h) >= fits : fits;
  const ordered = [...items].sort((a, b) => b.count - a.count);
  const weights = new Map(ordered.map((item) => [item.id, item.count]));
  const layout = (): Rect[] => rows(ordered.map((item) => ({ id: item.id, weight: weights.get(item.id) ?? 0 })), width, height);
  let rects = layout();
  /*
   * One tile is enlarged per pass, the smallest that does not fit, and the
   * map is laid out again: each enlargement reshapes the others, so a tile
   * that fitted before may need its turn later. A tile that has reached the
   * limit is left as it is, which is what keeps the map from drifting away
   * from the counts it is there to show.
   */
  const atLimit = new Set<string>();
  for (let pass = 0; pass < 120; pass += 1) {
    const failing = rects.filter((rect) => !atLimit.has(rect.id) && !accept(rect));
    if (!failing.length) break;
    const smallest = failing.reduce((a, b) => ((weights.get(a.id) ?? 0) <= (weights.get(b.id) ?? 0) ? a : b));
    const original = ordered.find((item) => item.id === smallest.id)?.count ?? 0;
    const grown = (weights.get(smallest.id) ?? 0) * 1.12;
    if (grown > original * MAX_ENLARGEMENT) atLimit.add(smallest.id);
    else weights.set(smallest.id, grown);
    rects = layout();
  }
  return { rects, enlarged: ordered.filter((item) => weights.get(item.id) !== item.count).map((item) => item.id) };
}

/** How much taller than its box the map may grow so that every tile can be read. */
export const MAX_GROWTH = 1.5;
const GROWTH_STEP = 8;

/**
 * `layoutMosaic` in a box that is as tall as it has to be: when a tile still
 * fails `fits` with every tile at its limit, the map is laid out again a
 * little taller, up to `MAX_GROWTH` times `height`. A short screen then gets
 * a map that runs a little further down instead of a tile whose name or count
 * is cut. Returns the height used.
 */
export function layoutTallEnough(
  items: { id: string; count: number }[],
  width: number,
  height: number,
  fits: (rect: Rect) => boolean,
  rows: Rows = squarify,
): { rects: Rect[]; height: number } {
  let used = height;
  let rects = layoutMosaic(items, width, used, fits, rows).rects;
  while (!rects.every(fits) && used + GROWTH_STEP <= height * MAX_GROWTH) {
    used += GROWTH_STEP;
    rects = layoutMosaic(items, width, used, fits, rows).rects;
  }
  return { rects, height: used };
}
