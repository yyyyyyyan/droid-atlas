/** The count a list shows in its bar. */

import type { Entry } from "../catalog/model.ts";
import { plural } from "../lib/format.ts";

/**
 * What a list says it holds. A list of apps counts apps ("12 of 1,281 apps"),
 * and the total of a mixed list counts apps and links apart; a filtered list
 * whose results include links counts entries, the only total that holds both
 * ("8 of 1,294").
 */
export function countLine(scope: readonly Entry[], results: readonly Entry[], filtered: boolean, noun: string, nounPlural: string): string {
  const links = (list: readonly Entry[]): number => list.filter((entry) => entry.resource).length;
  if (!filtered) {
    const shown = links(results);
    if (shown === 0 || shown === results.length) return plural(results.length, noun, nounPlural);
    return `${plural(results.length - shown, "app")} and ${plural(shown, "link")}`;
  }
  const found = results.length.toLocaleString("en");
  if (links(results) > 0) return `${found} of ${scope.length.toLocaleString("en")}`;
  return `${found} of ${plural(scope.length - links(scope), "app")}`;
}
