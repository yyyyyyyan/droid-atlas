/**
 * Preferences: theme, list density, whether a launch resumes the last place,
 * and whether the first-visit introduction has been put away. `public/theme.js` applies theme and density before the first paint
 * from the same stored value; this module keeps them applied afterwards.
 *
 * A preference added later is simply absent from values stored before it
 * existed, and `parseSettings` gives it its default.
 */

import { effect } from "@preact/signals";
import { THEME_COLORS } from "../product.ts";
import { createStore, isRecord, type StorageBackend, type Store } from "./storage.ts";

export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";

export interface Settings {
  v: 1;
  theme: Theme;
  density: Density;
  /** Reopen the last place on a launch with no address. */
  resume: boolean;
  /** The introduction on Explore has been dismissed. */
  introSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = { v: 1, theme: "system", density: "comfortable", resume: true, introSeen: false };

/** The preferences that are choices rather than history, and so travel in an export. */
export const PORTABLE_SETTINGS = ["theme", "density", "resume"] as const;
export type PortableSetting = (typeof PORTABLE_SETTINGS)[number];

export function parseSettings(raw: unknown): Settings | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  return {
    v: 1,
    theme: raw.theme === "light" || raw.theme === "dark" ? raw.theme : "system",
    density: raw.density === "compact" ? "compact" : "comfortable",
    resume: raw.resume !== false,
    introSeen: raw.introSeen === true,
  };
}

export function createSettingsStore(backend?: StorageBackend | null): Store<Settings> {
  const options = { key: "settings", version: 1, parse: parseSettings, initial: (): Settings => ({ ...DEFAULT_SETTINGS }) };
  return backend === undefined ? createStore(options) : createStore(options, backend);
}

/** Keeps the document's theme and density attributes in step with the settings and the system's color scheme. */
export function applySettings(store: Store<Settings>): void {
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = (): void => {
    const { theme, density } = store.value.value;
    const dark = theme === "system" ? systemDark.matches : theme === "dark";
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.density = density;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? THEME_COLORS.dark : THEME_COLORS.light);
    /* The browser draws its own surfaces around the page (scrollbars, and on a phone the bars at the screen's edges) for the scheme the page declares. */
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", dark ? "dark" : "light");
  };
  effect(apply);
  systemDark.addEventListener("change", apply);
}
