/**
 * The list of results on screen, shared so the app sheet can step to the
 * previous and next result and say "7 of 43" without knowing which view the
 * list belongs to.
 */

import { signal } from "@preact/signals";

export interface ResultSet {
  ids: readonly string[];
  /** Scrolls the list just enough to show a result, so it is in view when the sheet closes. */
  reveal(id: string): void;
}

export const resultSet = signal<ResultSet | null>(null);

export interface Position {
  index: number;
  total: number;
  previous: string | null;
  next: string | null;
}

export function positionOf(results: ResultSet | null, appId: string): Position | null {
  if (!results) return null;
  const index = results.ids.indexOf(appId);
  if (index === -1) return null;
  return {
    index,
    total: results.ids.length,
    previous: results.ids[index - 1] ?? null,
    next: results.ids[index + 1] ?? null,
  };
}
