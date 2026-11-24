/**
 * Boot: load the catalog, build the model, start the router, render. Until the
 * catalog is in, the page shows the map's outline; if it cannot be loaded, it
 * says why and offers to try again.
 */

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { signal } from "@preact/signals";
import { App, NavBar } from "./app.tsx";
import { buildVocabulary } from "./catalog/filters.ts";
import { CatalogError, createOnDemand, sha256 } from "./catalog/load.ts";
import { buildModel } from "./catalog/model.ts";
import { loadCatalog } from "./catalog/source.ts";
import { isFramed, platformOf } from "./links.ts";
import { QUIET_MS, quietLimited } from "./lib/quiet.ts";
import { afterLaunch, launchedFromNetwork, prepareLaunch, storedFetch, takeOverIfWaiting } from "./offline/client.ts";
import { watchInstall } from "./state/install.ts";
import { PRODUCT_NAME } from "./product.ts";
import { browserEnv, catalogPlaces } from "./router/browser.ts";
import { Router, type Navigation } from "./router/router.ts";
import { destinationOf, parseHash, placeOf, type Place } from "./router/route.ts";
import { ServicesContext, type Services } from "./services.ts";
import { createPinsStore } from "./state/pins.ts";
import { createSaved, createSavedStore } from "./state/saved.ts";
import { applySettings, createSettingsStore } from "./state/settings.ts";
import { listenForStorageChanges } from "./state/storage.ts";
import { createLastVisit, createVisitStore } from "./state/visit.ts";
import { Mark } from "./ui/Icon.tsx";
import { whenIdle } from "./ui/idle.ts";
import { captureScroll } from "./ui/scroll.ts";
import "./styles/index.css";

const settings = createSettingsStore();
const pins = createPinsStore();
const savedStore = createSavedStore();
const visit = createLastVisit(createVisitStore());
/** How long after the first view the owner and license index waits for an idle moment before it is built anyway. */
const FACT_INDEX_WITHIN_MS = 3000;
applySettings(settings);
listenForStorageChanges();
watchInstall();

function versionFile(): string {
  if (!import.meta.env.DEV) return "version.json";
  const requested = new URLSearchParams(window.location.search).get("catalog") ?? "";
  return /^[a-z0-9-]+$/.test(requested) ? `version.${requested}.json` : "version.json";
}

async function start(): Promise<Services> {
  const dataRoot = new URL("./data/", document.baseURI).href;
  const fetcher = quietLimited((url, init) => fetch(url, init), QUIET_MS);
  const stored = await prepareLaunch(dataRoot);
  let build = stored ? await loadCatalog(dataRoot, versionFile(), storedFetch(dataRoot, stored) ?? fetcher, sha256, stored).catch(() => null) : null;
  if (!build) {
    if (stored) launchedFromNetwork();
    build = await loadCatalog(dataRoot, versionFile(), fetcher, sha256);
  }
  /* Parsing, joining and indexing are each kept to a task of their own, so none of them blocks input for long. */
  await new Promise((resolve) => setTimeout(resolve, 0));
  performance.mark("atlas:catalog-loaded");
  const model = buildModel(build.catalog, Date.now());
  const vocabulary = buildVocabulary(model);
  performance.measure("atlas:model-build", "atlas:catalog-loaded");
  const router = new Router(browserEnv(catalogPlaces(model, vocabulary), captureScroll, settings.value.peek().resume));
  const noteVisit = (next: Navigation): void => {
    if (placeOf(next.route).kind === "saved") visit.open(model.catalog);
  };
  const first = router.start();
  noteVisit(first);
  const navigation = signal<Navigation>(first);
  router.subscribe((next) => {
    noteVisit(next);
    navigation.value = next;
  });
  return {
    model,
    vocabulary,
    build,
    onDemand: createOnDemand(build, quietLimited((url, init) => fetch(url, init), QUIET_MS)),
    router,
    navigation,
    saved: createSaved(model, savedStore),
    visit,
    pins,
    settings,
    platform: platformOf(),
    framed: isFramed(),
  };
}

const FAILURE_TEXT: Record<CatalogError["kind"], { title: string; text: string | null }> = {
  offline: { title: "The catalog did not load", text: "Check the connection and try again." },
  missing: { title: "The catalog is missing", text: "The fault is on the site’s side. Try again later." },
  "newer-schema": { title: "The app needs an update", text: null },
  damaged: { title: "The catalog arrived damaged", text: null },
};

/**
 * The column a page will stand in, so the loading frame can stand there too;
 * null for Explore. A list of guides is narrower, but which places hold only
 * guides is known only once the catalog has arrived. A plain page below About
 * has a back control beside its title, which sets the height of its line.
 */
function frameColumn(place: Place): string | null {
  switch (place.kind) {
    case "explore":
      return null;
    case "region":
    case "category":
    case "lens":
    case "share":
    case "search":
    case "saved":
      return "view-list";
    case "about":
      return place.page === "home" ? "view-page view-about" : "view-page";
    default:
      return "view-page";
  }
}

type BootState = { phase: "loading" } | { phase: "failed"; error: unknown } | { phase: "ready"; services: Services };

function Boot() {
  const [state, setState] = useState<BootState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setState({ phase: "loading" });
    start().then(
      (services) => {
        if (current) setState({ phase: "ready", services });
      },
      (error: unknown) => {
        if (current) setState({ phase: "failed", error });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  const failure = state.phase === "failed" ? state.error : null;
  useEffect(() => {
    if (failure !== null) console.error(failure);
  }, [failure]);

  const shown = state.phase === "ready" ? state.services.build.version.hash : null;
  const model = state.phase === "ready" ? state.services.model : null;
  useEffect(() => {
    if (shown === null) return;
    /* The frame after the first commit is the first one that can show the list; the mark is what the paint budget is measured against. */
    requestAnimationFrame(() => requestAnimationFrame(() => performance.mark("atlas:first-view")));
    afterLaunch(new URL("./data/", document.baseURI).href, shown);
  }, [shown]);
  /* The owner and license index is built while the page is idle, so the first app opened does not wait for it; whatever needs it sooner builds it then. */
  useEffect(() => (model ? whenIdle(() => {
    const start = performance.now();
    model.facts();
    performance.measure("atlas:fact-index", { start, end: performance.now() });
  }, FACT_INDEX_WITHIN_MS) : undefined), [model]);

  if (state.phase === "ready") {
    return <ServicesContext.Provider value={state.services}><App /></ServicesContext.Provider>;
  }
  if (state.phase === "loading") {
    /*
     * The app's own frame from the first frame, with the place asked for marked,
     * in the page's own layout so nothing moves when the page arrives: Explore's
     * name where Explore draws it, over the map in outline; for any other page,
     * "Loading…" after a moment where its title will stand.
     */
    const route = parseHash(window.location.hash);
    const column = frameColumn(placeOf(route));
    return (
      <>
        <NavBar current={destinationOf(route)} />
        <div class="main" aria-busy="true">
          {column === null ? (
            <div class="view view-home" role="status" aria-label="Loading">
              <header class="home-head"><p class="wordmark"><Mark />{PRODUCT_NAME}</p></header>
              <div class="boot-body">
                <div class="boot-map" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
                <p class="boot-text">Loading…</p>
              </div>
            </div>
          ) : (
            <div class={`view ${column}`} role="status" aria-label="Loading">
              <header class={column === "view-page" ? "plain-head is-root has-back" : "plain-head is-root"}><p class="boot-wait">Loading…</p></header>
            </div>
          )}
        </div>
      </>
    );
  }
  const kind = state.error instanceof CatalogError ? state.error.kind : null;
  const copy = kind ? FAILURE_TEXT[kind] : { title: `${PRODUCT_NAME} could not start`, text: "Something failed while the catalog was being read." };
  return (
    <div class="boot">
      <p class="boot-head"><Mark />{PRODUCT_NAME}</p>
      <div class="status" role="alert">
        <div class="status-inner">
          <h1 class="status-title">{copy.title}</h1>
          {copy.text && <p class="status-text">{copy.text}</p>}
          <div class="status-actions">
            {kind === "newer-schema"
              ? <button type="button" class="btn btn-strong" onClick={() => window.location.reload()}>Reload</button>
              : <button type="button" class="btn btn-strong" onClick={() => setAttempt(attempt + 1)}>Try again</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

/*
 * A newer shell that is waiting takes over now or not at all this session,
 * and the question is settled before anything is rendered: the loading
 * screen asks for fonts, and the page must not be asking for anything while
 * the workers change over. When the answer is yes the page loads again under
 * the new worker and nothing is rendered here. A question that cannot even be
 * asked (a browser that refuses access to service workers in this context)
 * is a "no".
 */
void takeOverIfWaiting().catch(() => "continue" as const).then((outcome) => {
  const root = document.getElementById("app");
  if (outcome === "continue" && root) render(<Boot />, root);
});
