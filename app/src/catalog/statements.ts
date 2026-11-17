/**
 * What the app says when it has nothing to show. It says little: a missing
 * summary or description is simply absent, and what no index states about an
 * app is two rows of its details that read "Unknown" (`factsFor`). What is
 * left is what stands in place of an entry's links, and what a row shows
 * in place of a summary.
 *
 * "Unknown" is never worded as "no".
 */

import { readableUrl } from "../links.ts";
import type { Entry } from "./model.ts";

/** What stands where the sheet's main button would be, for an entry with no link that works. */
export const NO_LINK = "No working link";

/** What a page shown inside another page's frame says in place of its links, which it does not offer there. */
export function framedNote(product: string): string {
  return `Open ${product} in its own tab to use links.`;
}

export function rowFallback(entry: Entry): string | null {
  const { app } = entry;
  if (app.repo?.slug) return app.repo.slug;
  const address = app.repo?.url ?? app.website ?? entry.listings[0]?.url ?? null;
  return (address ? readableUrl(address) : null) ?? app.packages[0] ?? null;
}
