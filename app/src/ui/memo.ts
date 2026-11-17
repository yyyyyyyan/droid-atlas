/**
 * Skips re-rendering a component whose props are the same values as last
 * time. A list re-renders whenever the route changes (opening the sheet,
 * stepping to the next result), and rows whose props did not change have
 * nothing new to draw. Signals read inside the component still update it.
 */

import { h, type Component, type FunctionComponent, type VNode } from "preact";

export function shallowEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}

export function memo<P extends object>(component: FunctionComponent<P>): FunctionComponent<P> {
  function Memoized(this: Component<P>, props: P): VNode {
    this.shouldComponentUpdate = (next: Readonly<P>) => !shallowEqual(this.props, next);
    return h(component as FunctionComponent<object>, props);
  }
  Memoized.displayName = `memo(${component.displayName ?? component.name})`;
  return Memoized as unknown as FunctionComponent<P>;
}
