/**
 * The one date Saved keeps on the device: when it was last opened, which
 * decides which saved apps carry a release mark.
 *
 * The date is read once, the first time Saved is opened in a session of the
 * app, and the new one is stored at that moment. The value read stays in
 * force for the rest of the session, so a mark is still there when the
 * reader comes back to Saved, and goes at the next session. The stored date
 * never moves back: a tab still on an older catalog does not undo what a
 * newer one wrote.
 *
 * When the browser keeps no data, or the stored value cannot be read, there
 * is no date, and so no release mark.
 */

import { signal, type ReadonlySignal } from "@preact/signals";
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
  /** Saved is being shown. The first call of a session reads the stored date and stores `stamp`; later calls do nothing. */
  open(stamp: number): void;
}

export function createLastVisit(store: Store<VisitData>): LastVisit {
  const since = signal<number | null>(null);
  let opened = false;
  return {
    since,
    open(stamp) {
      if (opened) return;
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
