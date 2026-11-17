/**
 * Where a category of the builds before Droid Atlas had its own categories
 * leads now. Those builds addressed a category by its source's id
 * (`android-foss/apps-synchronisation`), or, for same-named categories of
 * one region shown as one, by `<region>/<name as a slug>`
 * (`work/productivity`). A link, a reloaded window or a pin may still carry
 * either. A category of Droid Atlas's own that was renamed got a new id with
 * its new name, and is addressed by the old one in the same places.
 */

import { fold } from "../lib/format.ts";
import type { Model } from "./model.ts";

function slug(name: string): string {
  return fold(name.replace(/\s*(…|\.{3})\s*$/, "")).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Ids of Droid Atlas's own categories retired by a rename, each with the id that replaced it. */
export const RENAMED_CATEGORIES: Readonly<Record<string, string>> = {
  "music-tools": "music-making",
  "audio-tools": "sound-volume",
  "ebook-pdf-readers": "ebook-document-readers",
  "pdf-document-tools": "scanners-pdf-tools",
  "movies-tv": "movie-tv-trackers",
  "video-front-ends": "video-streaming-clients",
  "interface-tweaks": "system-ui-gestures",
};

/**
 * Where a former category id leads. A renamed category leads to the category
 * that replaced it while that holds an app, otherwise to its region. A
 * source's category leads to the category every source category behind the
 * id maps into, when there is one and it holds an app; otherwise to the
 * region the former category was in, for a catch-all or for categories that
 * went different ways.
 */
export function formerCategory(model: Model, id: string): { category?: string; region?: string } {
  const renamed = Object.hasOwn(RENAMED_CATEGORIES, id) ? RENAMED_CATEGORIES[id] : undefined;
  if (renamed !== undefined) {
    if (model.categoryById.has(renamed)) return { category: renamed };
    const region = model.catalog.categories.find((category) => category.id === renamed)?.region;
    return region !== undefined && model.regionById.has(region) ? { region } : {};
  }
  const [head = "", tail = ""] = id.split("/");
  const own = model.sourceCategoryById.get(id);
  const sources = own ? [own] : model.catalog.sourceCategories.filter((source) => slug(source.name) === tail);
  const [category, ...others] = new Set(sources.map((source) => source.category));
  if (category && others.length === 0 && model.categoryById.has(category)) return { category };
  const region = own?.region ?? head;
  return model.regionById.has(region) ? { region } : {};
}
