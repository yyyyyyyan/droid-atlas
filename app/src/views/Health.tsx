/**
 * Data health: what the catalog on this device is, how fresh, what each
 * source contributed, what could not be read, what points at something that
 * is gone, and what the catalog's changes meant for the apps saved here.
 * It states what is known and says so where something is not. The site's
 * own version stands in a section of its own, apart from the catalog's.
 */

import { Fragment } from "preact";
import { catalogHealth, STALE_AFTER_DAYS } from "../catalog/health.ts";
import { originName, type Entry } from "../catalog/model.ts";
import { formatDate, formatDateTime, formatDay, parseTime, plural } from "../lib/format.ts";
import { safeWebUrl } from "../links.ts";
import { offlineStatus } from "../offline/client.ts";
import { aboutRoute, categoryRoute, withParams, type Route } from "../router/route.ts";
import { useServices } from "../services.ts";
import { Icon } from "../ui/Icon.tsx";
import { CopyButton } from "../ui/Copy.tsx";
import { SiteCommit } from "../ui/SiteCommit.tsx";
import { UpdateStatus } from "../ui/UpdateStatus.tsx";
import { SITE_VERSION } from "../version.ts";
import { PageHead } from "../ui/LevelHead.tsx";
import { RouteLink } from "../ui/Link.tsx";

const SHOWN_INLINE = 6;
const NBSP = "\u00a0";

function searchRoute(filter: string): Route {
  return { path: ["search"], params: { f: filter } };
}

/** The list an entry lives in, with its sheet open: where a name on this page leads. */
function entryRoute(entry: Entry): Route | null {
  return entry.category ? withParams(categoryRoute(entry.category.id), { app: entry.app.id }) : null;
}

function EntryNames({ entries }: { entries: readonly Entry[] }) {
  const shown = entries.slice(0, SHOWN_INLINE);
  return (
    <span class="health-names">
      {shown.map((entry, index) => {
        const route = entryRoute(entry);
        return (
          <Fragment key={entry.app.id}>
            <span>{route ? <RouteLink route={route}>{entry.app.name}</RouteLink> : entry.app.name}{index < shown.length - 1 && ","}</span>
            {index < shown.length - 1 && " "}
          </Fragment>
        );
      })}
      {entries.length > shown.length && ` and ${entries.length - shown.length} more`}
    </span>
  );
}

function Finding({ count, one, many, filter, entries }: {
  count: number;
  one: string;
  many: string;
  filter: string | null;
  entries: readonly Entry[];
}) {
  return (
    <div class="health-item">
      <p class="health-figure">{count.toLocaleString("en")}</p>
      <div class="health-body">
        <p class="health-title">{count === 1 ? one : many}</p>
        {count > 0 && <p class="settings-note"><EntryNames entries={entries} /></p>}
        {count > 0 && filter && <RouteLink route={searchRoute(filter)} class="health-more">See all</RouteLink>}
      </div>
    </div>
  );
}

export function DataHealth() {
  const { model, build, saved, vocabulary } = useServices();
  const health = catalogHealth(model, build, Date.now());
  const { moved, missing } = saved.view.value;
  const has = (key: string): string | null => (vocabulary.def(key) ? key : null);
  const checked = offlineStatus.value.lastCheck?.outcome.result === "current";
  const { fdroidIndexAt, izzyIndexAt, githubFetchedAt } = model.catalog.enrichment;
  const times: [string, number | null][] = [
    ["F-Droid index", parseTime(fdroidIndexAt)],
    ["IzzyOnDroid index", parseTime(izzyIndexAt)],
    ["GitHub facts fetched", parseTime(githubFetchedAt)],
  ];

  return (
    <div class="view view-page">
      <PageHead title="Data health" />
      <div class="page">
        <section aria-labelledby="health-catalog">
          <h2 class="overline" id="health-catalog">This catalog</h2>
          {health.stale && (
            <div class="notice" role="status">
              <Icon name="warn" size={20} />
              <p>This catalog is more than {STALE_AFTER_DAYS} days old. {checked ? "The site has nothing newer." : "Check for a newer one."}</p>
            </div>
          )}
          <dl class="credit-facts">
            <div><dt>Built</dt><dd>{health.generatedAt !== null ? formatDateTime(health.generatedAt) : "Not stated"}</dd></div>
            <div><dt>Entries</dt><dd>{plural(health.apps, "app")}{health.resources > 0 ? ` and ${plural(health.resources, "guide or link", "guides and links")}` : ""}, {health.withIcon.toLocaleString("en")} with an icon</dd></div>
            <div><dt>Catalog build</dt><dd class="fact-copy"><code class="hash" title={health.hash}>{health.hash.slice(0, 16)}</code><CopyButton text={health.hash.slice(0, 16)} label="catalog build" /></dd></div>
            <div><dt>Data format</dt><dd>{health.schema}</dd></div>
            <div>
              <dt>Integrity</dt>
              <dd>
                {health.verified ? "Verified (SHA-256)" : "Not verified (needs HTTPS)"}
              </dd>
            </div>
          </dl>
          <UpdateStatus />
        </section>

        <section aria-labelledby="health-site">
          <h2 class="overline" id="health-site">This site</h2>
          <dl class="credit-facts">
            <div><dt>Site build</dt>{SITE_VERSION.commit !== null
              ? <dd class="fact-copy"><span><SiteCommit site={SITE_VERSION} join=" of " /></span><CopyButton text={SITE_VERSION.commit} label="site build" /></dd>
              : <dd>Not stated by this build</dd>}</div>
          </dl>
        </section>

        <section aria-labelledby="health-sources">
          <h2 class="overline" id="health-sources">Sources</h2>
          <ul class="health-sources">
            {health.sources.map(({ info, listed, anomalies }) => {
              const url = safeWebUrl(info.url);
              const committed = parseTime(info.committedAt);
              return (
                <li key={info.id}>
                  <h3 dir="auto">{url ? <a href={url} target="_blank" rel="noopener noreferrer">{info.name}</a> : info.name}</h3>
                  <dl class="credit-facts">
                    <div><dt>Commit</dt><dd><code>{info.commit.slice(0, 10)}</code>{committed !== null && <> of {formatDay(committed)}</>}</dd></div>
                    <div>
                      <dt>Entries</dt>
                      <dd>{info.entries.toLocaleString("en")}{listed !== info.entries && <> in {listed.toLocaleString("en")} apps and links</>}</dd>
                    </div>
                    <div><dt>Unread lines</dt><dd>{anomalies.length.toLocaleString("en")}</dd></div>
                  </dl>
                </li>
              );
            })}
          </ul>
          <dl class="credit-facts">
            {times.map(([label, time]) => <div key={label}><dt>{label}</dt><dd>{time !== null ? formatDateTime(time) : "Not stated by this build"}</dd></div>)}
          </dl>
          <RouteLink route={aboutRoute("sources")} class="health-more">Sources and licenses</RouteLink>
        </section>

        {health.downloads.length > 0 && (
          <section aria-labelledby="health-downloads">
            <h2 class="overline" id="health-downloads">Download figures</h2>
            <ul class="health-sources">
              {health.downloads.map(({ source, apps, newest, ageDays, behind, retrieved }) => {
                const url = safeWebUrl(source.url);
                const origin = originName(model, source.origin);
                return (
                  <li key={source.origin}>
                    <h3 dir="auto">{origin}</h3>
                    <dl class="credit-facts">
                      <div><dt>Published by</dt><dd>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.name}</a> : source.name}</dd></div>
                      <div><dt>Apps with a figure</dt><dd>{apps.toLocaleString("en")}</dd></div>
                      <div>
                        <dt>Newest figures</dt>
                        <dd>
                          {newest !== null
                            ? `${formatDate(newest)}, ${ageDays === 0 ? "today" : `${plural(ageDays ?? 0, "day")} ago`.replaceAll(" ", NBSP)}`
                            : `Running totals${retrieved !== null ? `, read ${formatDay(retrieved)}` : ""}`}
                        </dd>
                      </div>
                    </dl>
                    {behind && (
                      <div class="notice" role="status">
                        <Icon name="warn" size={20} />
                        <p>Nothing newer published{retrieved !== null ? ` as of ${formatDay(retrieved)}` : ""}.</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {health.anomalyCount > 0 && (
          <section aria-labelledby="health-anomalies">
            <h2 class="overline" id="health-anomalies">Unread lines</h2>
            <ul class="anomalies">
              {health.sources.flatMap(({ info, anomalies }) => anomalies.map((anomaly, index) => (
                <li key={`${info.id}-${index}`}>
                  <p class="anomaly-where" dir="auto">{info.name} · <code>{anomaly.file}:{anomaly.line}</code> · {anomaly.kind}</p>
                  <p class="anomaly-text" dir="auto">{anomaly.text}</p>
                </li>
              )))}
            </ul>
          </section>
        )}

        <section aria-labelledby="health-gone">
          <h2 class="overline" id="health-gone">Stale and archived</h2>
          <Finding count={health.staleLinks.length} one="stale store link" many="stale store links" filter={has("stale")} entries={health.staleLinks} />
          <Finding count={health.repoGone.length} one="repository gone" many="repositories gone" filter={has("gone")} entries={health.repoGone} />
          <Finding count={health.archived.length} one="archived project" many="archived projects" filter={has("archived")} entries={health.archived} />
        </section>

        {(moved.length > 0 || missing.length > 0) && (
          <section aria-labelledby="health-device">
            <h2 class="overline" id="health-device">On this device</h2>
            {moved.length > 0 && (
              <>
                <p class="page-text">{plural(moved.length, "saved app")} {moved.length === 1 ? "has" : "have"} a new id.</p>
                <ul class="moved">
                  {moved.map(({ from, entry }) => {
                    const route = entryRoute(entry);
                    return (
                      <li key={from}>
                        <code dir="auto">{from}</code> <span aria-hidden="true">→</span><span class="sr"> is now </span>{" "}
                        {route ? <RouteLink route={route}>{entry.app.name}</RouteLink> : entry.app.name} <code dir="auto">{entry.app.id}</code>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {missing.length > 0 && (
              <p class="page-text">
                {plural(missing.length, "saved app")} {missing.length === 1 ? "has" : "have"} left the catalogs. {missing.length === 1 ? "It stays" : "They stay"} in{" "}
                <RouteLink route={{ path: ["saved"], params: {} }}>Saved</RouteLink>.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
