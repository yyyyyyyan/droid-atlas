/**
 * Everything a view needs from outside itself, made once at boot and handed
 * down through context: the catalog model, the router and the stores.
 */

import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { signal, type ReadonlySignal } from "@preact/signals";
import type { Vocabulary } from "./catalog/filters.ts";
import type { LoadedCatalog, OnDemand } from "./catalog/load.ts";
import type { Model } from "./catalog/model.ts";
import type { Platform } from "./links.ts";
import type { Navigation, Router } from "./router/router.ts";
import type { PinsData } from "./state/pins.ts";
import type { Saved } from "./state/saved.ts";
import type { Settings } from "./state/settings.ts";
import type { Store } from "./state/storage.ts";
import type { LastVisit } from "./state/visit.ts";

export interface Services {
  model: Model;
  vocabulary: Vocabulary;
  /** The loaded build with its manifest: licenses, attributions and hashes of every published file. */
  build: LoadedCatalog;
  onDemand: OnDemand;
  router: Router;
  navigation: ReadonlySignal<Navigation>;
  saved: Saved;
  /** The date Saved was last opened, which its release marks are measured from. */
  visit: LastVisit;
  pins: Store<PinsData>;
  settings: Store<Settings>;
  /** Android or not: what an outbound link's note says, and whether Obtainium can be the primary action. */
  platform: Platform;
  /** True when the page is shown inside a frame, where no outbound action is offered. */
  framed: boolean;
}

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error("Services are not provided");
  return services;
}

/** Text for the polite live region; set it to have assistive technology announce a result. */
export const announcement = signal("");

export function announce(message: string): void {
  announcement.value = "";
  queueMicrotask(() => {
    announcement.value = message;
  });
}

function mediaSignal(query: string): ReadonlySignal<boolean> {
  const media = globalThis.matchMedia?.(query);
  const state = signal(media?.matches ?? false);
  media?.addEventListener("change", () => {
    state.value = media.matches;
  });
  return state;
}

/** How wide the list on screen is, in px. Rows fit their names and badges to it before they are laid out. */
export const listWidth = signal(globalThis.innerWidth ?? 384);

/** The wide layout: navigation rail, and the app detail as a panel beside the list. */
export const isWide = mediaSignal("(min-width: 1024px)");
export const prefersReducedMotion = mediaSignal("(prefers-reduced-motion: reduce)");
