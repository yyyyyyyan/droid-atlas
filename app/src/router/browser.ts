/** The router's environment in a real browser, and the catalog-aware answers it asks for. */

import type { Vocabulary } from "../catalog/filters.ts";
import { formerCategory } from "../catalog/former.ts";
import type { Model } from "../catalog/model.ts";
import type { LoadType, PlaceResolver, RouterEnv, ScrollMemo } from "./router.ts";
import { categoryRoute, placeOf, regionRoute, sheetOf, withParams, type Route } from "./route.ts";

/** How the router's questions about places are answered from the catalog. */
export function catalogPlaces(model: Model, vocabulary: Vocabulary): PlaceResolver {
  const regionOf = (route: Route): string | null => {
    const place = placeOf(route);
    if (place.kind === "category") return model.categoryById.get(place.id)?.category.region ?? null;
    if (place.kind === "region") return place.id;
    const appId = sheetOf(route);
    return appId ? model.resolve(appId)?.app.region ?? null : null;
  };
  return {
    normalize(route) {
      const place = placeOf(route);
      if (place.kind === "share") {
        const entry = model.resolve(place.id);
        if (!entry?.category) return route;
        return withParams(categoryRoute(entry.category.id), { app: entry.app.id });
      }
      const appId = sheetOf(route);
      const [head, a, b, more] = route.path;
      if (head === "cat" && a && more === undefined && (b !== undefined || !model.categoryById.has(a))) {
        const entry = appId ? model.resolve(appId) : null;
        if (entry?.category) return withParams(categoryRoute(entry.category.id), { app: entry.app.id });
        const { category, region } = formerCategory(model, b === undefined ? a : `${a}/${b}`);
        const target = category ? categoryRoute(category) : region ? regionRoute(region) : null;
        return target ? withParams({ path: target.path, params: route.params }, { app: null }) : route;
      }
      if (appId === null || model.byId.has(appId)) return route;
      const successor = model.resolve(appId);
      return successor ? withParams(route, { app: successor.app.id }) : route;
    },
    exists(route) {
      const appId = sheetOf(route);
      if (appId !== null && !model.byId.has(appId)) return false;
      const place = placeOf(route);
      if (place.kind === "region") return model.regionById.has(place.id);
      if (place.kind === "category") return model.categoryById.has(place.id);
      if (place.kind === "lens") return vocabulary.lenses.some((lens) => lens.key === place.id);
      return place.kind !== "unknown" && place.kind !== "share";
    },
    fallback(route) {
      const region = regionOf(route);
      return region && model.regionById.has(region) ? regionRoute(region) : null;
    },
  };
}

function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  /* `randomUUID` exists only on secure origins; a development page on a LAN address still needs ids. */
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function displayMode(): string {
  const standalone = ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"]
    .some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
  return standalone ? "standalone" : "browser";
}

function loadType(): LoadType {
  const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  return entry?.type ?? "navigate";
}

/**
 * Whether a layer without a URL needs a history entry for Back to close it.
 * Chromium hands Back to an open modal dialog's close watcher on every entry,
 * the first of a tab included. Firefox for Android does so only where it can
 * go back; on what it counts as a tab's first page it closes the tab without
 * asking the page, and it counts an entry the reader never touched as not
 * there. A browser without close watchers has nothing to hand Back to.
 */
function layerEntries(): boolean {
  const gecko = typeof CSS !== "undefined" && CSS.supports("-moz-appearance", "none");
  return gecko || typeof (globalThis as { CloseWatcher?: unknown }).CloseWatcher !== "function";
}

function safeStorage(read: () => Storage): Pick<Storage, "getItem" | "setItem"> {
  try {
    return read();
  } catch {
    return {
      getItem: () => null,
      setItem: () => {
        throw new Error("Storage is not available");
      },
    };
  }
}

export function browserEnv(places: PlaceResolver, capture: () => ScrollMemo | null, resume: boolean): RouterEnv {
  return {
    history: window.history,
    getHash: () => window.location.hash,
    session: safeStorage(() => window.sessionStorage),
    local: safeStorage(() => window.localStorage),
    now: () => Date.now(),
    newId: randomId,
    onPop: (listener) => window.addEventListener("popstate", listener),
    onHide: (listener) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") listener();
      });
      window.addEventListener("pagehide", listener);
    },
    onFirstGesture: (listener) => {
      const once = (): void => {
        window.removeEventListener("pointerdown", once, true);
        window.removeEventListener("keydown", once, true);
        listener();
      };
      window.addEventListener("pointerdown", once, true);
      window.addEventListener("keydown", once, true);
    },
    wasDiscarded: (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true,
    loadType: loadType(),
    displayMode: displayMode(),
    resume,
    places,
    capture,
    layerEntries: layerEntries(),
  };
}
