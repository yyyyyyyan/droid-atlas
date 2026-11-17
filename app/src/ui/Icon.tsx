/**
 * A small stroke-icon set drawn by us. Sources and stores are named in words.
 * A project's own mark stands in for its name in one case only: where its
 * license allows a redrawing, it is redrawn here in one color and in this
 * set's stroke. F-Droid's license does (`fdroid` below). Shizuku's does not
 * (its repository forbids using the icon for anything but Shizuku itself),
 * and neither does IzzyOnDroid's (it must be used unaltered): those two are a
 * drop, which is what "shizuku" means, and drawn letters.
 */

function circle(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
}

const ICONS = {
  explore: [circle(12, 12, 9), "M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"],
  search: [circle(11, 11, 6.5), "M20 20l-4.3-4.3"],
  bookmark: ["M7.5 4h9a1.5 1.5 0 0 1 1.5 1.5V20l-6-4.2L6 20V5.5A1.5 1.5 0 0 1 7.5 4z"],
  close: ["M6 6l12 12M18 6L6 18"],
  back: ["M20 12H5M11 5.5L4.5 12l6.5 6.5"],
  prev: ["M15 6l-6 6 6 6"],
  next: ["M9 6l6 6-6 6"],
  down: ["M6 9.5l6 6 6-6"],
  up: ["M6 14.5l6-6 6 6"],
  settings: ["M4 7.5h9M19 7.5h1M4 16.5h1M11 16.5h9", circle(16, 7.5, 2.5), circle(8, 16.5, 2.5)],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  copy: ["M10.5 9h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5v-8A1.5 1.5 0 0 1 10.5 9z", "M5 15V6a2 2 0 0 1 2-2h8"],
  share: [circle(17.5, 5.5, 2.5), circle(6.5, 12, 2.5), circle(17.5, 18.5, 2.5), "M8.7 10.8l6.6-4M8.7 13.2l6.6 4"],
  store: ["M12 4v10.5M7.5 10.5L12 15l4.5-4.5M5 19.5h14"],
  import: ["M8 4h8a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z", "M12 8.5v7M8.5 12h7"],
  source: ["M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5"],
  web: [circle(12, 12, 9), "M3 12h18", "M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3z"],
  warn: ["M12 4.5l8.5 15h-17z", "M12 10.5v4M12 17.2v.3"],
  offline: ["M4.5 4.5l15 15", "M9 16.2a4.6 4.6 0 0 1 4.6-.9", "M5.6 12.6a9.4 9.4 0 0 1 3.1-2M12.5 9.6a9.4 9.4 0 0 1 5.9 3", "M12 19.6v.2"],
  drop: ["M12 3.5c3.2 3.7 5.5 6.7 5.5 10a5.5 5.5 0 0 1-11 0c0-3.3 2.3-6.3 5.5-10z", "M9.2 13.8a2.8 2.8 0 0 0 2.5 2.5"],
  /* The prompt of a root shell. */
  root: ["M10 4.5L8 19.5M16 4.5l-2 15", "M5 9.5h15M4 14.5h15"],
  /*
   * Redrawn from the F-Droid logo of 2015 (fdroid-logo-2015/fdroid-logo.svg in
   * https://gitlab.com/fdroid/artwork), Copyright 2012 William Theaker, 2013
   * Robert Martinez, 2015 Andrew Nayenko, used under GPL-3.0-or-later.
   * Changed on 2026-11-16: redrawn by hand in one color as a stroke icon; the
   * head and the body are outlines, the eyes are dots, and of the copyleft
   * sign in the body only its inner letter is kept.
   */
  fdroid: ["M4.5 2l2 3M19.5 2l-2 3", "M5.5 5h13a2 2 0 0 1 2 2v12.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z", "M3.5 10.5h17", "M8.5 7.75v.01M15.5 7.75v.01", "M10.3 14.2a2.5 2.5 0 1 1 0 3.6"],
  izzy: ["M7.5 3.5h9a4 4 0 0 1 4 4v9a4 4 0 0 1-4 4h-9a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4z", "M8.3 7.5v9", "M11.5 11h4.7l-4.7 5.5h4.7"],
  box: ["M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z", "M4.8 7.9L12 12l7.2-4.1M12 12v8.3"],
  shield: ["M12 3.5l7 2.8v5.4c0 4.2-2.8 7.2-7 8.8-4.2-1.6-7-4.6-7-8.8V6.3z", "M9 12l2.2 2.2 3.9-4.1"],
  updated: ["M19.5 12A7.5 7.5 0 1 1 17.2 6.6l2.3 1.9", "M19.5 4v4.5H15"],
  added: ["M6 5.5h12a1.5 1.5 0 0 1 1.5 1.5v11.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 6 5.5z", "M8.5 3.5v3.5M15.5 3.5v3.5", "M12 10.5v6M9 13.5h6"],
  sort: ["M7 5v14M3.5 15.5L7 19l3.5-3.5M14 7h7M14 12h5M14 17h3"],
  filter: ["M4 7h16M7 12h10M10 17h4"],
  pin: ["M9 4h6l-1 6 3 3H7l3-3z", "M12 13v7"],
  rows: ["M4 6h16M4 12h16M4 18h16"],
  dense: ["M4 5h16M4 9.7h16M4 14.3h16M4 19h16"],
  key: ["M4 6h4M4 12h4M4 18h4", "M11 6h9M11 12h9M11 18h9"],
  external: ["M9 7h8v8M17 7L7 17"],
  link: ["M10.6 13.4a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1.1 1.1", "M13.4 10.6a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1.1-1.1"],
  star: ["M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"],
  info: [circle(12, 12, 9), "M12 11v5.5M12 7.6v.3"],
  phone: ["M8.5 3h7A1.5 1.5 0 0 1 17 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19.5v-15A1.5 1.5 0 0 1 8.5 3z", "M11 18h2"],
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 24, filled = false }: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg class={filled ? "icon is-filled" : "icon"} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      {ICONS[name].map((d) => <path d={d} />)}
    </svg>
  );
}

/** The app's own mark: three tiles of a map. */
/**
 * The app's mark, the drawing of `icons/d1-mark-*.svg`, with its fills from
 * the theme in CSS. Beside it, for a screen of one device pixel per CSS
 * pixel, the drawing fitted to the pixel grid at 18 px (the mark of
 * `icons/d1-favicon-24-bare-dark.svg`): CSS shows the one that suits.
 */
export function Mark() {
  return (
    <span class="mark" aria-hidden="true">
      <svg class="mark-full" viewBox="136 104 256 304" focusable="false">
        <path class="k1" d="M170 104L240 104A152 152 0 0 1 243.72 104.05A8 8 0 0 1 250.92 109A386.07 386.07 0 0 1 279.35 233.53A8 8 0 0 1 271.36 242L144 242A8 8 0 0 1 136 234L136 138A34 34 0 0 1 170 104Z" />
        <path class="k3" d="M136 374L136 278A8 8 0 0 1 144 270L271.36 270A8 8 0 0 1 279.35 278.47A386.07 386.07 0 0 1 250.92 403A8 8 0 0 1 243.72 407.95A152 152 0 0 1 240 408L170 408A34 34 0 0 1 136 374Z" />
        <path class="k2" d="M289.14 112.16A152 152 0 0 1 390.22 232.78A8 8 0 0 1 382.31 242L315.43 242A8 8 0 0 1 307.44 234.42A414.07 414.07 0 0 0 284.07 117.29A4 4 0 0 1 289.14 112.16Z" />
        <path class="k2" d="M284.07 394.71A414.07 414.07 0 0 0 307.44 277.58A8 8 0 0 1 315.43 270L382.31 270A8 8 0 0 1 390.22 279.22A152 152 0 0 1 289.14 399.84A4 4 0 0 1 284.07 394.71Z" />
      </svg>
      <svg class="mark-fitted" viewBox="5 3 15 18" focusable="false">
        <path class="k1" d="M7 3L11 3A9 9 0 0 1 14 3.51L14 11L5 11L5 5A2 2 0 0 1 7 3Z" />
        <path class="k3" d="M5 19L5 13L14 13L14 20.49A9 9 0 0 1 11 21L7 21A2 2 0 0 1 5 19Z" />
        <path class="k2" d="M16 4.52A9 9 0 0 1 19.94 11L16 11L16 4.52Z" />
        <path class="k2" d="M16 19.48L16 13L19.94 13A9 9 0 0 1 16 19.48Z" />
      </svg>
    </span>
  );
}
