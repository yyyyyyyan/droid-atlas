/**
 * About: what the app is, the few things about using it that the screen
 * does not show, and the way to everything that is not a list: the project
 * on GitHub, corrections and removal, settings, sources and licenses, icon
 * credits and data health. Its last line is the site's own version,
 * where the build knows it.
 *
 * It is a bottom-bar destination, so it is one tap from every top-level view.
 */

import { Fragment, type ComponentChildren } from "preact";
import { formatDay, parseTime } from "../lib/format.ts";
import { safeWebUrl } from "../links.ts";
import { PRODUCT_CONTACT, PRODUCT_ISSUES, PRODUCT_NAME, PRODUCT_REPOSITORY } from "../product.ts";
import { SETTINGS, aboutRoute } from "../router/route.ts";
import { useServices } from "../services.ts";
import { contactTarget } from "../ui/Contact.tsx";
import { Icon, Mark } from "../ui/Icon.tsx";
import { openKeyboardHelp } from "../ui/KeyboardHelp.tsx";
import { RouteLink } from "../ui/Link.tsx";
import { SiteCommit } from "../ui/SiteCommit.tsx";
import { Prose } from "../ui/Whole.tsx";
import { SITE_VERSION } from "../version.ts";
import type { Platform } from "../links.ts";

/** What a person cannot learn by looking at the screen. Only Android has apps that answer a store's or Obtainium's link. */
function howTo(platform: Platform): readonly string[] {
  return [
    "Each map tile is a region, sized by the number of apps in it.",
    "Pin a search to keep it under the search field.",
    "With an app open, the arrows step to the previous and next result.",
    platform === "android" ? "The get-it buttons open your F-Droid app, the store’s web page or Obtainium." : "The get-it buttons open the store’s web page.",
    "Saved apps and their notes stay on this device.",
    "Settings exports them to a file and imports it on another device.",
  ];
}

function Outside({ href, class: className, children }: { href: string; class?: string; children: ComponentChildren }) {
  return <a href={href} target="_blank" rel="noopener" class={className}>{children}</a>;
}

export function AboutHome() {
  const { model, platform } = useServices();
  const { catalog } = model;
  const generated = parseTime(catalog.generatedAt);
  const icons = model.entries.filter((entry) => entry.app.icon).length;
  const names = catalog.sources.map((source, index) => {
    const url = safeWebUrl(source.url);
    return (
      <Fragment key={source.id}>
        {index > 0 && (index === catalog.sources.length - 1 ? " and " : ", ")}
        {url ? <Outside href={url} class="whole">{source.name}</Outside> : <span class="whole">{source.name}</span>}
      </Fragment>
    );
  });

  return (
    <div class="view view-page view-about">
      <header class="plain-head is-root">
        <h1>About</h1>
      </header>
      <div class="page about">
        <section aria-labelledby="about-what">
          <h2 class="about-mark" id="about-what"><Mark />{PRODUCT_NAME}</h2>
          <p class="page-lead">Android apps from two curated catalogs, {names}, <Prose>with facts from F-Droid, IzzyOnDroid and GitHub.</Prose></p>
          <p class="page-text">No account and no analytics.</p>
        </section>

        <section aria-labelledby="about-how">
          <h2 class="overline" id="about-how">How to use it</h2>
          <ul class="how-to">
            {howTo(platform).map((line) => <li key={line}><Prose>{line}</Prose></li>)}
          </ul>
          <button type="button" class="link-btn only-fine" onClick={openKeyboardHelp}>Keyboard shortcuts</button>
        </section>

        <nav aria-label="The project, settings and sources">
          <ul class="settings-links">
            <li>
              <a href={PRODUCT_REPOSITORY} target="_blank" rel="noopener" class="nav-row">
                <span class="nav-row-text"><span>Source code and issues</span><span class="nav-row-sub">GitHub</span></span>
                <Icon name="external" size={20} />
              </a>
            </li>
            <li>
              {PRODUCT_CONTACT ? (
                <a {...contactTarget(PRODUCT_CONTACT)} class="nav-row">
                  <span class="nav-row-text">
                    <span>Corrections and removal</span>
                    <span class="nav-row-sub contact-address" translate={false}>{PRODUCT_CONTACT.label}</span>
                  </span>
                  <Icon name="external" size={20} />
                </a>
              ) : (
                <a href={PRODUCT_ISSUES} target="_blank" rel="noopener" class="nav-row">
                  <span class="nav-row-text">
                    <span>Corrections and removal</span>
                    <span class="nav-row-sub">Open an issue on GitHub</span>
                  </span>
                  <Icon name="external" size={20} />
                </a>
              )}
            </li>
            <li>
              <RouteLink route={SETTINGS} class="nav-row">
                <span class="nav-row-text"><span>Settings</span></span>
                <Icon name="next" size={20} />
              </RouteLink>
            </li>
            <li>
              <RouteLink route={aboutRoute("sources")} class="nav-row">
                <span class="nav-row-text"><span>Sources and licenses</span></span>
                <Icon name="next" size={20} />
              </RouteLink>
            </li>
            <li>
              <RouteLink route={aboutRoute("icons")} class="nav-row">
                <span class="nav-row-text"><span>Icon credits</span><span class="nav-row-sub">{icons.toLocaleString("en")}</span></span>
                <Icon name="next" size={20} />
              </RouteLink>
            </li>
            <li>
              <RouteLink route={aboutRoute("health")} class="nav-row">
                <span class="nav-row-text">
                  <span>Data health</span>
                  {generated !== null && <span class="nav-row-sub">{formatDay(generated)}</span>}
                </span>
                <Icon name="next" size={20} />
              </RouteLink>
            </li>
          </ul>
        </nav>

        {SITE_VERSION.commit !== null && <p class="about-version">Site build <SiteCommit site={SITE_VERSION} join=" · " /></p>}
      </div>
    </div>
  );
}
