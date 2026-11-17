/**
 * Contrast of the palette, computed from the stylesheet itself: every text
 * color on every surface it is set on, for every region tone (the thirteen
 * named ones, the neutral one and each fallback step), in both themes, must
 * reach WCAG AA for normal text (4.5:1).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { fallbackTone, NEUTRAL_TONE, REGION_TONES, toneOf, type Tone } from "../ui/place.ts";

const css = readFileSync(fileURLToPath(new URL("./base.css", import.meta.url)), "utf8");

function block(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`No block for ${selector}`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tokens.set(match[1] ?? "", (match[2] ?? "").trim());
  return tokens;
}

const THEMES = {
  dark: { root: block(":root"), place: block(".place") },
  light: { root: new Map([...block(":root"), ...block(':root[data-theme="light"]')]), place: block(':root[data-theme="light"] .place') },
};

type Rgb = [number, number, number];

function number(expression: string): number {
  const product = /^calc\(([\d.]+)\s*\*\s*([\d.]+)\)$/.exec(expression);
  return product ? Number(product[1]) * Number(product[2]) : Number(expression);
}

/** Linear-light sRGB of a CSS color, clipped to the gamut as a display would show it. */
function linearRgb(value: string, tone: Tone): Rgb {
  if (value === "#000") return [0, 0, 0];
  const resolved = value.replace(/var\(--cs\)/g, String(tone.cs)).replace(/var\(--h\)/g, String(tone.h));
  const match = /^oklch\((\S+)\s+(calc\([^)]*\)|\S+)\s+(\S+)\)$/.exec(resolved);
  if (!match) throw new Error(`Cannot read color ${value}`);
  const lightness = number(match[1] ?? "");
  const chroma = number(match[2] ?? "");
  const hue = (number(match[3] ?? "") * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clip = (channel: number): number => Math.min(1, Math.max(0, channel));
  return [
    clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(theme: keyof typeof THEMES, foreground: string, background: string, tone: Tone): number {
  const tokens = new Map([...THEMES[theme].root, ...THEMES[theme].place]);
  const color = (name: string): Rgb => {
    const value = tokens.get(name);
    if (!value) throw new Error(`No token ${name}`);
    return linearRgb(value, tone);
  };
  const [lighter, darker] = [luminance(color(foreground)), luminance(color(background))].sort((x, y) => y - x) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Text color, then the surface it is set on, as the stylesheets use them. */
const NEUTRAL_PAIRS: [string, string][] = [
  ["--text", "--bg"], ["--text", "--surface"], ["--text", "--surface-2"], ["--text", "--surface-3"],
  ["--text-2", "--bg"], ["--text-2", "--surface"], ["--text-2", "--surface-2"], ["--text-2", "--surface-3"],
  ["--text-3", "--bg"], ["--text-3", "--surface"], ["--text-3", "--surface-2"],
  ["--good", "--good-bg"], ["--good", "--surface"],
  ["--caution", "--caution-bg"], ["--caution", "--bg"], ["--caution", "--surface"], ["--caution", "--surface-2"],
  ["--caution-on", "--caution"],
  ["--bg", "--text"],
];

const PLACE_PAIRS: [string, string][] = [
  ["--p-on", "--p-container"], ["--p-on-2", "--p-container"], ["--p-accent", "--p-container"],
  ["--p-on", "--p-container-hi"], ["--p-on-2", "--p-container-hi"],
  ["--p-on-accent", "--p-accent"],
  ["--p-text", "--p-dim"], ["--p-text", "--bg"], ["--p-text", "--surface"], ["--p-text", "--surface-2"],
  ["--p-accent", "--bg"], ["--p-accent", "--surface"], ["--p-accent", "--surface-2"],
  ["--text", "--p-dim"], ["--text-2", "--p-dim"], ["--text-3", "--p-dim"], ["--caution", "--p-dim"],
];

const TONES: [string, Tone][] = [
  ...Object.entries(REGION_TONES),
  ["(neutral)", NEUTRAL_TONE],
  ...Array.from({ length: 40 }, (_, index): [string, Tone] => [`(fallback ${index})`, fallbackTone(`region-${index}`)]),
];

describe.each(["dark", "light"] as const)("%s theme", (theme) => {
  test.each(NEUTRAL_PAIRS)("%s on %s reaches 4.5:1", (foreground, background) => {
    expect(contrast(theme, foreground, background, NEUTRAL_TONE)).toBeGreaterThanOrEqual(4.5);
  });

  test.each(PLACE_PAIRS)("%s on %s reaches 4.5:1 for every region tone", (foreground, background) => {
    const failures = TONES
      .map(([name, tone]) => ({ name, ratio: contrast(theme, foreground, background, tone) }))
      .filter((result) => result.ratio < 4.5)
      .map((result) => `${result.name} ${result.ratio.toFixed(2)}`);
    expect(failures).toEqual([]);
  });
});

describe("region tones", () => {
  const REGIONS = ["system", "apps", "files", "automation", "device", "privacy", "personal", "comms", "media", "work", "world", "games", "guides"];

  test("each of the thirteen regions has a tone of its own", () => {
    const tones = REGIONS.map((id) => toneOf(id));
    expect(REGIONS.filter((id) => !Object.hasOwn(REGION_TONES, id))).toEqual([]);
    expect(new Set(tones.map((tone) => `${tone.h}/${tone.cs}`)).size).toBe(REGIONS.length);
  });

  test("no two colored regions sit closer than 24 degrees without also differing in strength", () => {
    const colored = REGIONS.filter((id) => id !== "guides").map((id) => ({ id, ...toneOf(id) }));
    for (const a of colored) {
      for (const b of colored) {
        if (a.id >= b.id) continue;
        const apart = Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h));
        expect(apart, `${a.id} and ${b.id}`).toBeGreaterThanOrEqual(24);
        if (apart < 32) expect(Math.abs(a.cs - b.cs), `${a.id} and ${b.id}`).toBeGreaterThan(0.19);
      }
    }
  });

  test("an unknown region gets a stable tone, and no region at all gets the neutral one", () => {
    expect(toneOf("a-region-added-later")).toEqual(toneOf("a-region-added-later"));
    expect(toneOf("a-region-added-later").cs).toBeGreaterThan(0.5);
    expect(toneOf(null)).toEqual(NEUTRAL_TONE);
    expect(toneOf("constructor")).toEqual(fallbackTone("constructor"));
  });
});
