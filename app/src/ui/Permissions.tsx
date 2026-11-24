/**
 * What the sheet shows under an app's permission count.
 *
 * Closed, the row says, for each index whose list is on the device and
 * complete, how many runtime and special permissions the app declares, the
 * two kinds a person grants themselves, and names them; it says "no" of a
 * kind only where Android states a level for every name the list holds
 * (`rowSummaries`). "Show names" is offered once that read shows there are
 * names to open (`namesOffered`). Those names come
 * from the sheet's one read of the details shards (`OnDemand.detailsRead`),
 * shared with the description: the row makes no request of its own, fills in
 * with the description, and when that read fails it waits for the
 * description's "Try again". Opened, every name of each index that counts
 * any is shown in groups by Android's stated level (`catalog/permissions.ts`),
 * with Android's label where it has one; the names under the app's own
 * package are folded into one line.
 */

import { useState } from "preact/hooks";
import type { DetailsRead } from "../catalog/load.ts";
import type { Entry } from "../catalog/model.ts";
import {
  androidCredit,
  countOf,
  LEVELS_CAVEAT,
  namesNotShown,
  namesOffered,
  ownNamesToggle,
  permissionLists,
  permissionListsCredited,
  permissionOrigins,
  rowSummaries,
  summaryLine,
  upToLine,
  type AndroidStatements,
  type LoadedNames,
  type RowSummary,
  type ShownName,
} from "../catalog/permissions.ts";
import { useServices } from "../services.ts";
import { NotLoaded, useOnDemand, type Loadable } from "./on-demand.tsx";
import { Breakable, Names } from "./Whole.tsx";

/** A name as the index states it, Android's label for it in Android's words, and the version the app declares it up to. */
function NameItem({ item }: { item: ShownName }) {
  return (
    <li class="perm-item">
      {item.label && <q class="perm-label">{item.label}</q>}
      <span class="perm-name" translate={false}><Breakable text={item.name} /></span>
      {item.upTo !== null && <span class="perm-cap">{upToLine(item.upTo)}</span>}
    </li>
  );
}

function OwnNames({ names }: { names: readonly string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="perm-own">
      <button type="button" class="link-btn perm-own-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {ownNamesToggle(names.length, open)}
      </button>
      {open && (
        <ul class="perm-items">
          {names.map((name) => <NameItem key={name} item={{ name, label: null, upTo: null }} />)}
        </ul>
      )}
    </div>
  );
}

function NameLists({ entry, loaded, android }: { entry: Entry; loaded: readonly LoadedNames[]; android: AndroidStatements | null }) {
  const { model } = useServices();
  const lists = permissionLists(model, entry, loaded, android);
  const credited = permissionListsCredited(entry);
  return (
    <div class="perm-lists">
      {android && (
        <>
          <p class="credit">Levels and labels from {androidCredit(android)}</p>
          <p class="credit-note perm-caveat">{LEVELS_CAVEAT}</p>
        </>
      )}
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

/** Most names of one kind the closed row spells out; the rest are counted, and all are under "Show names". */
const SUMMARY_NAMES = 6;

function Labels({ kind, names }: { kind: string; names: readonly ShownName[] }) {
  const more = names.length - SUMMARY_NAMES;
  return (
    <span class="fact-detail">
      {kind}:{" "}
      {names.slice(0, SUMMARY_NAMES).map((item, at) => (
        <span key={item.name}>
          {at > 0 && ", "}
          {item.label ? <q>{item.label}</q> : <span translate={false}><Breakable text={item.name} /></span>}
        </span>
      ))}
      {more > 0 && `, and ${more} more`}
    </span>
  );
}

function Summary({ summary, android }: { summary: RowSummary; android: AndroidStatements }) {
  return (
    <div class="fact-line fact-neutral has-source perm-summary">
      <span class="fact-value">{summaryLine(summary.runtime.length, summary.special.length, summary.whole)}</span>
      <span class="fact-source"><Names names={[...summary.sources, androidCredit(android)]} /></span>
      {summary.runtime.length > 0 && <Labels kind="Runtime" names={summary.runtime} />}
      {summary.special.length > 0 && <Labels kind="Special" names={summary.special} />}
    </div>
  );
}

/**
 * @param details the sheet's one read of the details shards, shared with the description
 */
export function PermissionDetails({ entry, details }: { entry: Entry; details: Loadable<DetailsRead | null> }) {
  const { build, model, onDemand } = useServices();
  const { android } = build;
  const appId = entry.app.id;
  const origins = permissionOrigins(entry);
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  const all = useOnDemand<LoadedNames[] | null>(`${appId} ${asked ? "all" : "idle"}`, async () =>
    (asked ? Promise.all(origins.map(async (origin) => ({ origin, ...(await onDemand.permissionNames(appId, origin)), count: countOf(entry, origin) }))) : null));
  if (origins.length === 0 || details.state === "failed") return null;

  const fromRead: LoadedNames[] = details.state === "ready" && details.value
    ? details.value.permissions.filter((item) => origins.includes(item.origin)).map((item) => ({ ...item, count: countOf(entry, item.origin) }))
    : [];
  const known = all.state === "ready" && all.value ? all.value : fromRead;
  const summaries = rowSummaries(model, entry, known, android);

  return (
    <>
      {android && details.state === "loading" && <div class="fact-line perm-pending" aria-hidden="true"><span class="fact-value">{" "}</span></div>}
      {android && summaries.map((summary) => <Summary key={summary.sources.join()} summary={summary} android={android} />)}
      {details.state === "ready" && namesOffered(fromRead) && (
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
      )}
      {open && all.state === "loading" && <p class="credit-note" role="status">Loading…</p>}
      {open && all.state === "failed" && <NotLoaded loaded={all} what="names" />}
      {open && all.state === "ready" && all.value && <NameLists entry={entry} loaded={all.value} android={android} />}
    </>
  );
}
