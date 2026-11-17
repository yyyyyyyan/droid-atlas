/**
 * Color-as-place: one hue per region, all drawn from the same OKLCH lightness
 * and chroma steps defined in base.css. A region's tone is a hue and a chroma
 * scale; nothing else varies, which is what keeps thirteen colors one palette.
 *
 * Twelve hues cannot all sit far apart at one chroma, so neighbors on the hue
 * wheel alternate between full and softened chroma. The pairs that stay close
 * (the two greens, the two blues) differ in saturation as well as hue, and the
 * name is always on the tile: color supports the place, it never is the cue.
 *
 * Regions are the catalog's, so an id this table has never seen still gets a
 * tone: one of the wheel's steps, chosen from the id itself so the region
 * keeps its color from build to build.
 */

export interface Tone {
  /** OKLCH hue in degrees. */
  h: number;
  /** Scale applied to the palette's chroma steps; 1 is full strength. */
  cs: number;
}

export const NEUTRAL_TONE: Tone = { h: 85, cs: 0.14 };

export const REGION_TONES: Readonly<Record<string, Tone>> = {
  media: { h: 25, cs: 1 },
  games: { h: 58, cs: 1 },
  work: { h: 98, cs: 1 },
  files: { h: 128, cs: 0.72 },
  privacy: { h: 156, cs: 1 },
  automation: { h: 186, cs: 0.78 },
  world: { h: 214, cs: 1 },
  comms: { h: 244, cs: 0.8 },
  device: { h: 268, cs: 0.58 },
  system: { h: 292, cs: 1 },
  apps: { h: 320, cs: 0.8 },
  personal: { h: 350, cs: 1 },
  guides: NEUTRAL_TONE,
};

const WHEEL_STEPS = 12;

/** The tone of a region the table does not name: a step of the wheel derived from the id, at softened chroma. */
export function fallbackTone(regionId: string): Tone {
  let hash = 0;
  for (const char of regionId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { h: (hash % WHEEL_STEPS) * (360 / WHEEL_STEPS) + 12, cs: 0.66 };
}

export function toneOf(regionId: string | null | undefined): Tone {
  if (!regionId) return NEUTRAL_TONE;
  return Object.hasOwn(REGION_TONES, regionId) ? REGION_TONES[regionId] ?? NEUTRAL_TONE : fallbackTone(regionId);
}

/** Inline custom properties that tint a `.place` element with a region's tone. Null gives the neutral tone. */
export function placeStyle(regionId: string | null | undefined): Record<string, string> {
  const tone = toneOf(regionId);
  return { "--h": String(tone.h), "--cs": String(tone.cs) };
}
