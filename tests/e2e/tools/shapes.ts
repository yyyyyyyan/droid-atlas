/**
 * Prints the places and entries the journeys would pick from the catalog
 * under test (lib/pick.ts), so a failure can be reproduced by hand.
 *
 *   node tools/shapes.ts
 */

import { biggestLens, build, commonNameWord, featuredApp, level, regionsBySize, SYNTHETIC } from "../lib/pick.ts";

const L = level();
console.log(JSON.stringify({
  synthetic: SYNTHETIC,
  apps: build.apps.length,
  regions: regionsBySize(),
  level: { region: L.regionId, category: L.category.id, sibling: L.sibling?.id ?? null },
  lens: biggestLens(),
  word: commonNameWord(),
  featured: featuredApp().id,
}, null, 1));
