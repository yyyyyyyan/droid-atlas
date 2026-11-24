/**
 * Routes as data. A route is a path plus query parameters, both carried in the
 * URL hash so the app runs from any static host and sub-path. Everything here
 * is pure: parsing, canonical serialization and the relations between routes
 * that the history rules are written in terms of.
 */

export interface Route {
  path: readonly string[];
  params: Readonly<Record<string, string>>;
}

export type Destination = "explore" | "search" | "saved" | "about";

/**
 * About itself (what the app is and how to use it) and the pages beneath it:
 * sources and licenses, icon credits, data health, the third-party notices,
 * and the text of one license.
 */
export type AboutPage = "home" | "sources" | "icons" | "health" | "notices";

export type Place =
  | { kind: "explore" }
  | { kind: "region"; id: string }
  | { kind: "category"; id: string }
  | { kind: "lens"; id: string }
  | { kind: "search" }
  | { kind: "saved" }
  | { kind: "settings" }
  | { kind: "about"; page: AboutPage }
  | { kind: "license"; id: string }
  | { kind: "share"; id: string }
  | { kind: "unknown" };

const PARAM_ORDER = ["q", "f", "sort", "app"];

export const EXPLORE: Route = { path: [], params: {} };

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** Keeps `:`, `/` and `,` readable in the hash; they are legal there and filter tokens use them. */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%3A/gi, ":").replace(/%2F/gi, "/").replace(/%2C/gi, ",");
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const cut = raw.indexOf("?");
  const pathPart = cut === -1 ? raw : raw.slice(0, cut);
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(cut === -1 ? "" : raw.slice(cut + 1))) {
    if (value !== "" && !(key in params)) params[key] = value;
  }
  return { path: pathPart.split("/").filter(Boolean).map(safeDecode), params };
}

/** Canonical form: fixed parameter order, empty values dropped. Two routes are the same place iff their hashes are equal. */
export function buildHash(route: Route): string {
  const keys = Object.keys(route.params)
    .filter((key) => route.params[key])
    .sort((a, b) => {
      const ia = PARAM_ORDER.indexOf(a);
      const ib = PARAM_ORDER.indexOf(b);
      return (ia === -1 ? PARAM_ORDER.length : ia) - (ib === -1 ? PARAM_ORDER.length : ib) || a.localeCompare(b);
    });
  const query = keys.map((key) => `${encodeURIComponent(key)}=${encodeValue(route.params[key] ?? "")}`).join("&");
  return `#/${route.path.map(encodeURIComponent).join("/")}${query ? `?${query}` : ""}`;
}

export function sameRoute(a: Route, b: Route): boolean {
  return buildHash(a) === buildHash(b);
}

export function placeOf(route: Route): Place {
  const [head, a, b, ...rest] = route.path;
  if (head === undefined) return { kind: "explore" };
  if (head === "region" && a && b === undefined) return { kind: "region", id: a };
  if (head === "cat" && a && b === undefined) return { kind: "category", id: a };
  if (head === "lens" && a && b === undefined) return { kind: "lens", id: a };
  if (head === "app" && a && b === undefined) return { kind: "share", id: a };
  if (head === "about" && b === undefined) {
    if (a === undefined) return { kind: "about", page: "home" };
    if (a === "sources" || a === "icons" || a === "health" || a === "notices") return { kind: "about", page: a };
  }
  if (head === "about" && a === "license" && b && rest.length === 0) return { kind: "license", id: b };
  if (a !== undefined) return { kind: "unknown" };
  if (head === "search" || head === "saved" || head === "settings") return { kind: head };
  return { kind: "unknown" };
}

/** The bottom-bar destination a place belongs to. Settings is reached from About and belongs to it. */
export function destinationOf(route: Route): Destination {
  const place = placeOf(route);
  if (place.kind === "search" || place.kind === "saved") return place.kind;
  if (place.kind === "settings" || place.kind === "about" || place.kind === "license") return "about";
  return "explore";
}

export function destinationRoot(destination: Destination): Route {
  return destination === "explore" ? EXPLORE : { path: [destination], params: {} };
}

/** Identifies the level (the view) regardless of query, filters and layers. */
export function levelKey(route: Route): string {
  return route.path.join("/");
}

/** The app whose sheet is open over the level, if any. The sheet is the only layer with a URL. */
export function sheetOf(route: Route): string | null {
  return route.params.app ?? null;
}

export function withParams(route: Route, patch: Record<string, string | null | undefined>): Route {
  const params: Record<string, string> = { ...route.params };
  for (const [key, value] of Object.entries(patch)) {
    if (value) params[key] = value;
    else delete params[key];
  }
  return { path: route.path, params };
}

/** The list a sheet lies over: the same route with the sheet closed. */
export function withoutSheet(route: Route): Route {
  return withParams(route, { app: null });
}

/** Explore, Search, Saved or About themselves, with no sheet open: the entries the bottom bar swaps between. */
export function isDestinationRoot(route: Route): boolean {
  const place = placeOf(route);
  const root = place.kind === "explore" || place.kind === "search" || place.kind === "saved" || (place.kind === "about" && place.page === "home");
  return root && sheetOf(route) === null;
}

/**
 * Where Back should lead from a place that was entered cold: the list beneath
 * a sheet, About beneath Settings and the pages under About, and Explore, the
 * start destination, beneath every other level. Nothing lies beneath Explore
 * itself.
 */
export function parentOf(route: Route): Route | null {
  if (sheetOf(route) !== null) return withoutSheet(route);
  if (route.path.length === 0) return null;
  const place = placeOf(route);
  if (place.kind === "settings" || place.kind === "license" || (place.kind === "about" && place.page !== "home")) return aboutRoute();
  return EXPLORE;
}

export function aboutRoute(page: AboutPage = "home"): Route {
  return { path: page === "home" ? ["about"] : ["about", page], params: {} };
}

export const SETTINGS: Route = { path: ["settings"], params: {} };

/** Sources and licenses, opened at the sources of facts, where what each one's download figures count is said. */
export const HOW_COUNTED: Route = { path: ["about", "sources"], params: { at: "facts" } };

/** The page that shows the full text of a license the site ships, by its SPDX identifier. */
export function licenseRoute(id: string): Route {
  return { path: ["about", "license", id], params: {} };
}

/** Search narrowed by one filter token: where a fact on an app leads, such as its license. */
export function filterRoute(token: string): Route {
  return { path: ["search"], params: { f: token } };
}

export function categoryRoute(categoryId: string): Route {
  return { path: ["cat", categoryId], params: {} };
}

export function regionRoute(regionId: string): Route {
  return { path: ["region", regionId], params: {} };
}

export function lensRoute(lensId: string): Route {
  return { path: ["lens", lensId], params: {} };
}
