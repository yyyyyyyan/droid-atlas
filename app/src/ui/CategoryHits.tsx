/**
 * The categories a search names, as ways to the categories themselves: one
 * row each above the apps, in its region's color, saying what it is and how
 * many entries it holds. A search for "Launchers" is as likely to want the
 * launchers as an app with the word in its name.
 */

import { useMemo } from "preact/hooks";
import { categoriesNamed, searchWords } from "../catalog/filters.ts";
import { plural } from "../lib/format.ts";
import { categoryRoute } from "../router/route.ts";
import { useServices } from "../services.ts";
import { nounsFor } from "./AppList.tsx";
import { Icon } from "./Icon.tsx";
import { RouteLink } from "./Link.tsx";
import { placeStyle } from "./place.ts";
import { Marked } from "./Row.tsx";

export function CategoryHits({ text }: { text: string }) {
  const { model } = useServices();
  const hits = useMemo(() => categoriesNamed(model, text), [model, text]);
  const words = useMemo(() => searchWords(text), [text]);
  if (hits.length === 0) return null;
  return (
    <nav class="cat-hits" aria-label="Categories this search names">
      <ul>
        {hits.map(({ view, by }) => {
          const { noun, nounPlural } = nounsFor(view.entries);
          return (
            <li key={view.category.id} class="place" style={placeStyle(view.category.region)}>
              <RouteLink route={categoryRoute(view.category.id)} class="cat-hit">
                <span class="cat-hit-name"><Marked text={view.category.name} words={words} /></span>
                <span class="cat-hit-sub">
                  Category in {model.regionById.get(view.category.region)?.region.name} · {plural(view.entries.length, noun, nounPlural)}
                  {by && <> · includes “{by}”</>}
                </span>
                <Icon name="next" size={20} />
              </RouteLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
