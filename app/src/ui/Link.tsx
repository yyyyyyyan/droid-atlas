/**
 * In-app links. Each renders a real `<a href>` (so it can be focused, copied
 * and opened in a new tab) and hands a plain click to the router, which is the
 * only thing that decides between push and replace.
 */

import type { ComponentChildren } from "preact";
import { buildHash, withParams, type Route } from "../router/route.ts";
import { useServices } from "../services.ts";

/** A primary-button click with no modifier: the only kind the router takes over. */
export function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.defaultPrevented;
}

interface LinkAttributes {
  class?: string;
  title?: string;
  "aria-label"?: string;
  "aria-current"?: "page" | "true";
  onContextMenu?: (event: MouseEvent) => void;
  children?: ComponentChildren;
}

interface RouteLinkProps extends LinkAttributes {
  route: Route;
  /** "replace" for a sibling of the current view, which takes its place instead of stacking on it. */
  mode?: "push" | "replace";
}

export function RouteLink({ route, mode = "push", children, ...attributes }: RouteLinkProps) {
  const { router } = useServices();
  const onClick = (event: MouseEvent): void => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    if (mode === "replace") router.replace(route);
    else router.push(route);
  };
  return <a {...attributes} href={buildHash(route)} onClick={onClick}>{children}</a>;
}

interface AppLinkProps extends LinkAttributes {
  appId: string;
}

/** Opens an app's sheet over the list on screen, or changes the app shown when a sheet is already open. */
export function AppLink({ appId, children, ...attributes }: AppLinkProps) {
  const { router, navigation } = useServices();
  const onClick = (event: MouseEvent): void => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    router.openApp(appId);
  };
  return <a {...attributes} href={buildHash(withParams(navigation.value.route, { app: appId }))} onClick={onClick}>{children}</a>;
}
