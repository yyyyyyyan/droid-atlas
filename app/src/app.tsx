/**
 * The shell: navigation (bottom bar on a phone, rail when wide), the view for
 * the current route, the app sheet, and the glue that applies each
 * navigation's scroll plan after its view has rendered.
 */

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { buildHash, destinationOf, destinationRoot, levelKey, placeOf, sheetOf, type Destination, type Route } from "./router/route.ts";
import { nameInId } from "./lib/format.ts";
import { PRODUCT_NAME } from "./product.ts";
import { announce, announcement, isWide, prefersReducedMotion, useServices, type Services } from "./services.ts";
import { Icon, Mark, type IconName } from "./ui/Icon.tsx";
import { asksForKeyboardHelp, KeyboardHelp, openKeyboardHelp } from "./ui/KeyboardHelp.tsx";
import { isPlainClick } from "./ui/Link.tsx";
import { watchKeyboard } from "./ui/keyboard.ts";
import { PullToRefresh } from "./ui/PullToRefresh.tsx";
import { watchInput } from "./ui/modality.ts";
import { applyScroll, captureScroll, expectAnchor } from "./ui/scroll.ts";
import { Sheet } from "./ui/Sheet.tsx";
import { Tip } from "./ui/Tip.tsx";
import { UndoBar } from "./ui/UndoBar.tsx";
import { ReloadPrompt } from "./ui/UpdateStatus.tsx";
import { AboutSources } from "./views/About.tsx";
import { AboutHome } from "./views/AboutHome.tsx";
import { Explore } from "./views/Explore.tsx";
import { DataHealth } from "./views/Health.tsx";
import { IconCredits } from "./views/IconCredits.tsx";
import { CategoryLevel, LensLevel, RegionLevel } from "./views/Levels.tsx";
import { NotFound } from "./views/NotFound.tsx";
import { Saved } from "./views/Saved.tsx";
import { focusSearch, Search } from "./views/Search.tsx";
import { SettingsView } from "./views/Settings.tsx";
import { LicenseText, ThirdPartyNotices } from "./views/TextPage.tsx";

const SCROLL_SETTLE_MS = 150;

const DESTINATIONS: { id: Destination; label: string; icon: IconName }[] = [
  { id: "explore", label: "Explore", icon: "explore" },
  { id: "search", label: "Search", icon: "search" },
  { id: "saved", label: "Saved", icon: "bookmark" },
  { id: "about", label: "About", icon: "info" },
];

interface Resolved {
  view: ComponentChildren;
  title: string | null;
  /** A list view: on the wide layout the app detail sits in a panel beside it. */
  list: boolean;
}

function resolveView(services: Services, route: Route): Resolved {
  const { model, vocabulary } = services;
  const place = placeOf(route);
  switch (place.kind) {
    case "explore":
      return { view: <Explore />, title: null, list: false };
    case "region": {
      const view = model.regionById.get(place.id);
      if (view) return { view: <RegionLevel view={view} />, title: view.region.name, list: true };
      break;
    }
    case "category": {
      const view = model.categoryById.get(place.id);
      if (view) return { view: <CategoryLevel view={view} />, title: view.category.name, list: true };
      break;
    }
    case "lens": {
      const lens = vocabulary.lenses.find((candidate) => candidate.key === place.id);
      if (lens) return { view: <LensLevel lens={lens} />, title: lens.label, list: true };
      break;
    }
    case "search":
      return { view: <Search />, title: "Search", list: true };
    case "saved":
      return { view: <Saved />, title: "Saved", list: true };
    case "settings":
      return { view: <SettingsView />, title: "Settings", list: false };
    case "about":
      if (place.page === "icons") return { view: <IconCredits />, title: "Icon credits", list: false };
      if (place.page === "health") return { view: <DataHealth />, title: "Data health", list: false };
      if (place.page === "sources") return { view: <AboutSources />, title: "Sources and licenses", list: false };
      if (place.page === "notices") return { view: <ThirdPartyNotices />, title: "Third-party licenses", list: false };
      return { view: <AboutHome />, title: "About", list: false };
    case "license":
      return { view: <LicenseText id={place.id} />, title: "License", list: false };
    case "share":
      return {
        view: <NotFound message={`No app has the id “${place.id}”.`} search={nameInId(place.id)} />,
        title: "Not found",
        list: false,
      };
    default:
      break;
  }
  return { view: <NotFound />, title: "Not found", list: false };
}

/** The rail or the bottom bar. Without `select`, its links are plain links: the frame drawn while the catalog loads. */
export function NavBar({ current, select }: { current: Destination; select?: (destination: Destination) => (event: MouseEvent) => void }) {
  return (
    <nav class="nav" aria-label="Primary">
      <a class="nav-mark" href={buildHash(destinationRoot("explore"))} aria-label={`${PRODUCT_NAME}, the map`} onClick={select?.("explore")}><Mark /><Tip text="Explore" at="side" /></a>
      {DESTINATIONS.map((destination) => (
        <a
          key={destination.id}
          class="nav-item"
          href={buildHash(destinationRoot(destination.id))}
          aria-current={current === destination.id ? "page" : undefined}
          aria-keyshortcuts={destination.id === "search" ? "/" : undefined}
          onClick={select?.(destination.id)}
        >
          <span class="nav-pill"><Icon name={destination.icon} /></span>
          <span class="nav-label">{destination.label}</span>
          {destination.id === "search" && <Tip text="Search" keys="/" at="side" />}
        </a>
      ))}
    </nav>
  );
}

function Nav() {
  const { router, navigation } = useServices();
  const select = (destination: Destination) => (event: MouseEvent): void => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    if (destination === "search") focusSearch();
    if (router.selectDestination(destination)) return;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion.peek() ? "auto" : "smooth" });
  };
  return <NavBar current={destinationOf(navigation.value.route)} select={select} />;
}

export function App() {
  const services = useServices();
  const { router, navigation, model } = services;
  const nav = navigation.value;
  const mainRef = useRef<HTMLElement>(null);
  const seen = useRef({ seq: 0, level: "" });
  const resolved = resolveView(services, nav.route);
  const level = levelKey(nav.route);

  const levelChanged = seen.current.level !== level;
  if (seen.current.seq !== nav.seq) expectAnchor(nav.scroll);

  useLayoutEffect(() => {
    const first = seen.current.seq === 0;
    seen.current = { seq: nav.seq, level };
    applyScroll(nav.scroll);
    router.remember(captureScroll());
    if (levelChanged && !first) {
      /* The view that held focus is gone. The page takes it, and the live region names the new place for assistive technology. */
      mainRef.current?.focus({ preventScroll: true });
      announce(resolved.title ?? "Explore");
    }
    const app = sheetOf(nav.route);
    const appName = app ? model.resolve(app)?.app.name ?? null : null;
    document.title = [appName, resolved.title, PRODUCT_NAME].filter(Boolean).join(" · ");
  }, [nav.seq]);

  /* "/" goes to the search field from anywhere and "?" shows the keyboard shortcuts, unless something is being typed or a dialog is open. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (asksForKeyboardHelp(event)) {
        event.preventDefault();
        openKeyboardHelp();
        return;
      }
      if (event.key !== "/" || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      focusSearch();
      if (!router.selectDestination("search")) window.scrollTo(0, 0);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => watchKeyboard(), []);
  useEffect(() => watchInput(), []);

  useEffect(() => {
    let timer = 0;
    const onScroll = (): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => router.remember(captureScroll()), SCROLL_SETTLE_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const entering = levelChanged && nav.nav === "push";
  const withPanel = isWide.value && resolved.list && sheetOf(nav.route) !== null;

  return (
    <>
      <a class="skip" href="#main" onClick={(event) => { event.preventDefault(); mainRef.current?.focus(); }}>Skip to content</a>
      <Nav />
      <main id="main" class={`main${withPanel ? " has-panel" : ""}`} tabIndex={-1} ref={mainRef}>
        <ReloadPrompt />
        <div key={level} class={entering ? "view-wrap is-entering" : "view-wrap"}>{resolved.view}</div>
      </main>
      <Sheet />
      <KeyboardHelp />
      <UndoBar />
      <PullToRefresh />
      <p class="sr" role="status" aria-live="polite">{announcement}</p>
    </>
  );
}
