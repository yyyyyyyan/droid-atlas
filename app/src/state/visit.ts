/**
 * The one date Saved keeps on the device, which decides which saved apps
 * carry a release mark: the build time of the catalog on screen when Saved
 * was last opened.
 *
 * The catalog's time and not the clock's, because a release reaches the app
 * only with the next catalog. Opened at 20:00 on a catalog built at 01:00,
 * Saved has not shown a release made at 10:00 that day; the clock's time
 * would hide it for good when the next catalog brings it.
 *
 * The date is read once, the first time Saved is opened in a session of the
 * app, and the new one is stored at that moment. The value read stays in
 * force for the rest of the session, so a mark is still there when the
 * reader comes back to Saved, and goes at the next session. The stored date
 * never moves back: a tab still on an older catalog does not undo what a
 * newer one wrote.
 *
 * A release is marked when it is later than both this date and the moment
 * the app was saved. That leaves one gap: an app saved after its catalog was
 * built is not marked for a release made between that build and the save,
 * because which catalog was on screen at the save is not kept.
 *
 * When the browser keeps no data, or the stored value cannot be read, there
 * is no date, and so no release mark.
 */

import { signal, type ReadonlySignal } from "@preact/signals";
import { parseTime } from "../lib/format.ts";
import { createStore, isRecord, type StorageBackend, type Store } from "./storage.ts";

export interface VisitData {
  v: 1;
  /** Milliseconds; null before Saved has ever been opened here. */
  at: number | null;
}

export function parseVisit(raw: unknown): VisitData | null {
  if (!isRecord(raw) || raw.v !== 1) return null;
  const { at } = raw;
  return typeof at === "number" && Number.isFinite(at) && at >= 0 ? { v: 1, at } : null;
}

export function createVisitStore(backend?: StorageBackend | null): Store<VisitData> {
  const options = { key: "lastVisit", version: 1, parse: parseVisit, initial: (): VisitData => ({ v: 1, at: null }) };
  return backend === undefined ? createStore(options) : createStore(options, backend);
}

export interface LastVisit {
  /** The date this session measures release marks from; null until Saved is opened, and on a first visit. */
  readonly since: ReadonlySignal<number | null>;
  /**
   * Saved is being shown on this catalog. The first call of a session reads
   * the stored date and stores the catalog's build time; later calls do
   * nothing. A catalog with no readable build time stores nothing.
   */
  open(catalog: { generatedAt: string }): void;
}

export function createLastVisit(store: Store<VisitData>): LastVisit {
  const since = signal<number | null>(null);
  let opened = false;
  return {
    since,
    open(catalog) {
      const stamp = parseTime(catalog.generatedAt);
      if (opened || stamp === null) return;
      opened = true;
      let previous: number | null = null;
      store.update((current) => {
        previous = current.at;
        return current.at !== null && current.at >= stamp ? current : { v: 1, at: stamp };
      });
      since.value = previous;
    },
  };
}
