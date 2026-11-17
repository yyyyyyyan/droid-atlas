/**
 * Persistent stores over `localStorage`, under `droid-atlas:v1:`.
 *
 * A browser tab and the installed app share this storage, so a store never
 * writes from memory alone: every change re-reads the stored value, applies
 * the change to that, and writes the result. Changes made by the other window
 * arrive through the `storage` event and replace the value in memory.
 *
 * Every read tolerates missing, corrupt, older and newer data:
 * - corrupt data is set aside under `<key>.corrupt` rather than destroyed;
 * - an older shape is upgraded by the store's own parser;
 * - data written by a newer version of the app is left exactly as it is. A
 *   tab still running yesterday's shell beside an updated installed app would
 *   otherwise overwrite what the newer one saved. While that lasts, changes
 *   made here live in memory only.
 * The store's `status` says which of these happened so a view can tell the
 * user.
 */

import { signal, type ReadonlySignal } from "@preact/signals";

export const STORAGE_PREFIX = "droid-atlas:v1:";

export type StoreStatus = "ok" | "recovered" | "unavailable" | "newer";

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Store<T> {
  readonly value: ReadonlySignal<T>;
  /**
   * "recovered": the stored value was unreadable and has been set aside.
   * "unavailable": the browser is not keeping data.
   * "newer": the stored value was written by a newer version and is not touched.
   */
  readonly status: ReadonlySignal<StoreStatus>;
  update(change: (current: T) => T): void;
  /** Re-reads the stored value, as the `storage` event does. */
  refresh(): void;
  acknowledge(): void;
}

export interface StoreOptions<T> {
  key: string;
  /** Returns the value when the parsed JSON is usable, otherwise null. Older shapes are upgraded here. */
  parse(raw: unknown): T | null;
  initial(): T;
  /** The highest `v` this build writes and reads. Stored data with a higher one is left alone. Omitted for values that carry no version. */
  version?: number;
}

function defaultBackend(): StorageBackend | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const stores = new Map<string, () => void>();

type Read<T> = { kind: "value"; value: T } | { kind: "none" } | { kind: "newer" };

export function createStore<T>(options: StoreOptions<T>, backend: StorageBackend | null = defaultBackend()): Store<T> {
  const key = STORAGE_PREFIX + options.key;
  const status = signal<StoreStatus>("ok");

  const read = (): Read<T> => {
    if (!backend) {
      status.value = "unavailable";
      return { kind: "none" };
    }
    let raw: string | null;
    try {
      raw = backend.getItem(key);
    } catch {
      status.value = "unavailable";
      return { kind: "none" };
    }
    if (raw === null) {
      if (status.peek() === "newer") status.value = "ok";
      return { kind: "none" };
    }
    let json: unknown;
    let parsed: T | null = null;
    try {
      json = JSON.parse(raw);
      if (options.version !== undefined && isRecord(json) && typeof json.v === "number" && json.v > options.version) {
        status.value = "newer";
        return { kind: "newer" };
      }
      parsed = options.parse(json);
    } catch {
      parsed = null;
    }
    if (status.peek() === "newer") status.value = "ok";
    if (parsed === null) {
      try {
        backend.setItem(`${key}.corrupt`, raw);
      } catch {
        /* The copy is a courtesy; without it the value is simply replaced. */
      }
      status.value = "recovered";
      return { kind: "none" };
    }
    return { kind: "value", value: parsed };
  };

  const first = read();
  const value = signal<T>(first.kind === "value" ? first.value : options.initial());

  const refresh = (): void => {
    const stored = read();
    /* Newer data cannot be shown, and what this window holds is still the best it has. */
    if (stored.kind === "newer") return;
    value.value = stored.kind === "value" ? stored.value : options.initial();
  };
  stores.set(key, refresh);

  return {
    value,
    status,
    refresh,
    acknowledge: () => {
      if (status.value === "recovered") status.value = "ok";
    },
    update(change) {
      const stored = read();
      const next = change(stored.kind === "value" ? stored.value : value.peek());
      value.value = next;
      if (!backend || stored.kind === "newer") return;
      /* A change that handed back what is stored has nothing to write, and a write would wake every other window for nothing. */
      if (stored.kind === "value" && next === stored.value) return;
      try {
        backend.setItem(key, JSON.stringify(next));
      } catch {
        status.value = "unavailable";
      }
    },
  };
}

/** Wires the `storage` event to every store. Called once at boot. */
export function listenForStorageChanges(target: Pick<Window, "addEventListener"> = window): void {
  target.addEventListener("storage", (event) => {
    if (event.key === null) {
      for (const refresh of stores.values()) refresh();
      return;
    }
    stores.get(event.key)?.();
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
