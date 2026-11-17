/** Saved: the apps kept on this device, most recently saved first, with the same list tools as everywhere else. */

import { plural } from "../lib/format.ts";
import { EXPLORE } from "../router/route.ts";
import { useServices } from "../services.ts";
import { AppList, nounsFor } from "../ui/AppList.tsx";
import { Icon } from "../ui/Icon.tsx";
import { RouteLink } from "../ui/Link.tsx";
import { StoreNotice } from "../ui/StoreNotice.tsx";
import { offerUndo } from "../ui/UndoBar.tsx";

export function Saved() {
  const { saved } = useServices();
  const { entries, missing, notes } = saved.view.value;
  const nouns = nounsFor(entries);

  return (
    <div class="view view-list place">
      <header class="plain-head is-root">
        <div>
          <h1>Saved</h1>
          {entries.length + missing.length > 0 && <p class="head-sub">{plural(entries.length + missing.length, nouns.noun, nouns.nounPlural)}</p>}
        </div>
      </header>

      <StoreNotice store={saved.store} what="saved apps" fresh="an empty list" />

      {missing.length > 0 && (
        <section class="gone" aria-labelledby="gone-title">
          <h2 class="overline" id="gone-title">No longer in the catalogs</h2>
          <ul>
            {missing.map((item) => (
              <li key={item.id}>
                <span class="gone-id" dir="auto">{item.packages[0] ?? item.id}</span>
                <button
                  type="button"
                  class="link-btn"
                  onClick={() => {
                    const at = Date.now();
                    saved.forget(item.id, at);
                    offerUndo(`Removed ${item.packages[0] ?? item.id}`, "Saved again", () => saved.restore(at));
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <AppList
        label="Saved entries"
        scope={entries}
        natural="saved"
        mixed
        {...nouns}
        metaOf={(entry) => {
          const note = notes.get(entry.app.id);
          return note ? `Note: ${note}` : undefined;
        }}
        whenEmpty={(
          <div class="status">
            <div class="status-inner">
              <p class="status-title">Nothing saved yet</p>
              <p class="status-text">Use the bookmark on an app to keep it here.</p>
              <div class="status-actions">
                <RouteLink route={EXPLORE} class="btn"><Icon name="explore" size={18} />Explore the map</RouteLink>
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}
