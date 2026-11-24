/**
 * What the sheet shows under an app's permission count.
 *
 * Closed, the row names what each index lists that Android asks for while
 * the app runs. Those names come from the details shards the sheet reads for
 * the description anyway (`OnDemand.detailsRead`), so the row makes no
 * request of its own and fills in with the description. Opened, every name
 * of each index that counts any is shown in groups by how Android grants it
 * (`catalog/permissions.ts`), with Android's label where it has one; the
 * names under the app's own package are folded into one line.
 */

import { useState } from "preact/hooks";
import type { Entry } from "../catalog/model.ts";
import {
  androidCredit,
  countOf,
  namesNotShown,
  ownNamesLine,
  permissionLists,
  permissionListsCredited,
  permissionOrigins,
  runtimeLine,
  runtimeSummaries,
  type AndroidStatements,
  type IndexOrigin,
  type LoadedNames,
  type ShownName,
} from "../catalog/permissions.ts";
import { reloadForNewShell } from "../offline/client.ts";
import { useServices } from "../services.ts";
import { useOnDemand, type Loadable } from "./on-demand.ts";
import { Breakable, Names } from "./Whole.tsx";

/** A name as the index states it, and Android's label for it in Android's words. */
function NameItem({ item }: { item: ShownName }) {
  return (
    <li class="perm-item">
      {item.label && <q class="perm-label">{item.label}</q>}
      <span class="perm-name" translate={false}><Breakable text={item.name} /></span>
    </li>
  );
}

function OwnNames({ names }: { names: readonly string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="perm-own">
      <button type="button" class="link-btn perm-own-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {ownNamesLine(names.length)}
      </button>
      {open && (
        <ul class="perm-items">
          {names.map((name) => <NameItem key={name} item={{ name, label: null }} />)}
        </ul>
      )}
    </div>
  );
}

function Failed({ loaded }: { loaded: Extract<Loadable<unknown>, { state: "failed" }> }) {
  return loaded.behind ? (
    <p class="credit-note" role="status">
      A newer catalog is out.{" "}
      <button type="button" class="link-btn retry-btn" onClick={() => void reloadForNewShell()}>Reload</button>
    </p>
  ) : (
    <p class="credit-note" role="status">
      The names did not load.{" "}
      <button type="button" class="link-btn retry-btn" onClick={loaded.retry}>Try again</button>
    </p>
  );
}

function NameLists({ entry, loaded, android }: { entry: Entry; loaded: readonly LoadedNames[]; android: AndroidStatements | null }) {
  const { model } = useServices();
  const lists = permissionLists(model, entry, loaded, android);
  const credited = permissionListsCredited(entry);
  return (
    <div class="perm-lists">
      {android && <p class="credit">Groups and labels from {androidCredit(android)}</p>}
      {lists.map((list) => (
        <div class="perm-list" key={list.sources.join()}>
          {credited && <p class="credit">From <Names names={list.sources} /></p>}
          {list.groups.map((group) => (
            <div class="perm-group" key={group.id}>
              {android && <h4 class="perm-heading">{group.heading}</h4>}
              <ul class="perm-items">{group.names.map((item) => <NameItem key={item.name} item={item} />)}</ul>
            </div>
          ))}
          {list.own.length > 0 && <OwnNames names={list.own} />}
          {list.hidden > 0 && <p class="credit-note">{namesNotShown(list.hidden)}</p>}
        </div>
      ))}
    </div>
  );
}

/**
 * @param shared the source the Details heading names; the closed row's line names an index only when it differs
 */
export function PermissionDetails({ entry, shared }: { entry: Entry; shared: string | null }) {
  const { build, model, onDemand } = useServices();
  const { android } = build;
  const appId = entry.app.id;
  const origins = permissionOrigins(entry);
  const indexedBy = entry.app.index.map((index) => index.origin);
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const read = useOnDemand(`${appId} read`, () => (origins.length ? onDemand.detailsRead(appId, indexedBy) : Promise.resolve(null)));
  const all = useOnDemand<LoadedNames[] | null>(`${appId} ${asked ? "all" : "idle"}`, async () =>
    (asked ? Promise.all(origins.map(async (origin: IndexOrigin) => ({ origin, names: await onDemand.permissionNames(appId, origin), count: countOf(entry, origin) }))) : null));
  if (origins.length === 0) return null;

  const fromRead: LoadedNames[] = read.state === "ready" && read.value
    ? read.value.permissions.filter((item) => origins.includes(item.origin)).map((item) => ({ ...item, count: countOf(entry, item.origin) }))
    : [];
  const known = all.state === "ready" && all.value ? all.value : fromRead;
  const summaries = runtimeSummaries(model, entry, known, android);

  return (
    <>
      {android && read.state === "loading" && <div class="fact-line perm-pending" aria-hidden="true"><span class="fact-value">{" "}</span></div>}
      {android && summaries.map((summary) => {
        const sources = [...(summary.sources.join(", ") === shared ? [] : summary.sources), androidCredit(android)];
        return (
          <div class="fact-line fact-neutral has-source perm-summary" key={summary.sources.join()}>
            <span class="fact-value">{runtimeLine(summary.names.length)}</span>
            <span class="fact-source"><Names names={sources} /></span>
            {summary.names.length > 0 && (
              <span class="fact-detail">
                {summary.names.map((item, at) => (
                  <span key={item.name}>
                    {at > 0 && ", "}
                    {item.label ? <q>{item.label}</q> : <span translate={false}><Breakable text={item.name} /></span>}
                  </span>
                ))}
              </span>
            )}
          </div>
        );
      })}
      <button
        type="button"
        class="link-btn desc-more"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setAsked(true);
        }}
      >
        {open ? "Hide names" : "Show names"}
      </button>
      {open && all.state === "loading" && <p class="credit-note" role="status">Loading…</p>}
      {open && all.state === "failed" && <Failed loaded={all} />}
      {open && all.state === "ready" && all.value && <NameLists entry={entry} loaded={all.value} android={android} />}
    </>
  );
}
