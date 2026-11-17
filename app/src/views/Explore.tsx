/**
 * Explore: the shape of the catalog. A first-visit line saying what this is,
 * the map of the regions of apps, the quick filters (facts the sources state,
 * each a way in) and under them the guides and further reading, and what
 * entered the catalogs most recently.
 *
 * In the wide layout the line saying what this is stands in the header, and
 * under the map the newest entries and the quick filters are two columns as
 * wide as the map together; on a phone they follow one another.
 */

import { useEffect, useMemo } from "preact/hooks";
import type { Entry } from "../catalog/model.ts";
import { formatDay, licenseName, parseTime, plural, timeAgo } from "../lib/format.ts";
import { safeWebUrl } from "../links.ts";
import { offlineStatus } from "../offline/client.ts";
import { PRODUCT_NAME } from "../product.ts";
import { aboutRoute, lensRoute, regionRoute, sheetOf } from "../router/route.ts";
import { useServices } from "../services.ts";
import { Icon, Mark } from "../ui/Icon.tsx";
import { LensGlyph } from "../ui/LevelHead.tsx";
import { RouteLink } from "../ui/Link.tsx";
import { Mosaic } from "../ui/Mosaic.tsx";
import { resultSet } from "../ui/results.ts";
import { Row } from "../ui/Row.tsx";

/** Six in one column; where the newest entries have room for two columns, eight, four in each. */
const NEWEST_SHOWN = 8;
const NO_FACTS: ReadonlySet<string> = new Set();

export function Explore() {
  const { model, vocabulary, navigation, settings } = useServices();
  const selectedId = sheetOf(navigation.value.route);

  const lenses = useMemo(
    () => vocabulary.lenses.map((lens) => ({ lens, count: model.entries.filter(lens.test).length })),
    [model, vocabulary],
  );
  const newest = useMemo(() => {
    const dated = model.entries.filter((entry) => entry.addedAt !== null && !entry.resource);
    dated.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0) || a.nameRank - b.nameRank);
    return dated.slice(0, NEWEST_SHOWN);
  }, [model]);
  const newCount = useMemo(() => model.entries.filter((entry) => entry.isNew).length, [model]);
  const newLens = vocabulary.byKey.get("new");

  useEffect(() => {
    const set = { ids: newest.map((entry) => entry.app.id), reveal: () => undefined };
    resultSet.value = set;
    return () => {
      if (resultSet.peek() === set) resultSet.value = null;
    };
  }, [newest]);

  const split = Math.ceil(lenses.length / 2);
  const generated = parseTime(model.catalog.generatedAt);
  const guides = useMemo(() => model.regions.filter((view) => view.entries.every((entry) => entry.resource)), [model]);
  const mapped = useMemo(() => model.regions.filter((view) => !guides.includes(view)), [model, guides]);
  const appCount = useMemo(() => model.entries.filter((entry) => !entry.resource).length, [model]);
  /* The check for a newer catalog at launch is the one sign the server was out of reach: the browser's own online flag stays true. */
  const offline = offlineStatus.value.lastCheck?.outcome.result === "offline";

  return (
    <div class="view view-home">
      <header class="home-head">
        <h1 class="wordmark"><Mark />{PRODUCT_NAME}</h1>
        <p class="home-tagline">Android apps from two curated catalogs. <RouteLink route={aboutRoute()}>How to use it</RouteLink></p>
        <p class="home-meta"><span>{plural(appCount, "app")}</span></p>
      </header>

      {!settings.value.value.introSeen && (
        <aside class="intro" aria-label={`What ${PRODUCT_NAME} is`}>
          <p>
            Android apps from two curated catalogs.
          </p>
          <div class="intro-actions">
            <RouteLink route={aboutRoute()} class="link-btn">How to use it</RouteLink>
            <button type="button" class="link-btn" onClick={() => settings.update((value) => ({ ...value, introSeen: true }))}>Got it</button>
          </div>
        </aside>
      )}

      <Mosaic regions={mapped} />

      <div class="home-below">
        {lenses.length > 0 && (
          <section class="home-section home-lenses" aria-labelledby="lenses-title">
            <h2 class="overline" id="lenses-title">Quick filters</h2>
            <div class="lenses fade-x">
              {[lenses.slice(0, split), lenses.slice(split)].map((group, row) => (
                <ul class="lens-row" key={row}>
                  {group.map(({ lens, count }) => (
                    <li key={lens.key}>
                      <RouteLink route={lensRoute(lens.key)} class="lens">
                        <span class="lens-glyph"><LensGlyph lens={lens} /></span>
                        <span class="lens-label">{lens.label}</span>
                        <span class="lens-count">{count}</span>
                      </RouteLink>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
            {guides.map((view) => (
              <RouteLink key={view.region.id} route={regionRoute(view.region.id)} class="guides-line">
                <span class="guides-name">{view.region.name}</span>
                <span class="lens-count">{view.entries.length}</span>
                <Icon name="next" size={18} />
              </RouteLink>
            ))}
          </section>
        )}

        {newest.length > 0 && (
          <section class="home-section home-new" aria-labelledby="new-title">
            <div class="section-head">
              <h2 class="overline" id="new-title">
                {newCount > 0 ? "New" : "Latest additions"}
                {newCount > 0 && <span> · {newCount} in 90 days</span>}
              </h2>
              {newCount > newest.length && newLens && <RouteLink route={lensRoute(newLens.key)} class="section-more">See all</RouteLink>}
            </div>
            <ol class="rows rows-static" aria-label="Most recently added entries">
              {newest.map((entry: Entry, index) => (
                <Row
                  key={entry.app.id}
                  entry={entry}
                  index={index}
                  total={newest.length}
                  density="comfortable"
                  mixed
                  hidden={NO_FACTS}
                  selected={entry.app.id === selectedId}
                  meta={entry.category?.name ?? "Uncategorized"}
                  when={timeAgo(entry.addedAt ?? model.now, model.now)}
                />
              ))}
            </ol>
          </section>
        )}
      </div>

      <footer class="colophon">
        <p>
          {model.catalog.sources.map((source, index) => {
            const url = safeWebUrl(source.url);
            return (
              <span key={source.id}>
                {index > 0 && " · "}
                {url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.name}</a> : source.name} ({licenseName(source.license)})
              </span>
            );
          })}
        </p>
        {offline ? (
          <p role="status">
            Offline · catalog of {generated !== null ? <RouteLink route={aboutRoute("health")} class="caption-link">{formatDay(generated)}</RouteLink> : "an earlier day"}
          </p>
        ) : (
          <p>
            <RouteLink route={aboutRoute("sources")}>Sources and licenses</RouteLink>
            {generated !== null && <> · <RouteLink route={aboutRoute("health")} class="caption-link">{formatDay(generated)}</RouteLink></>}
          </p>
        )}
      </footer>
    </div>
  );
}
