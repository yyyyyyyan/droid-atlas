/**
 * Pinned queries: a query worth returning to, stored as the three URL
 * parameters it is made of. A first visit starts with a few pins that show
 * what combining filters is for; they are ordinary pins and can be removed.
 */

import { createStore, isRecord, type StorageBackend, type Store } from "./storage.ts";

export interface Pin {
  id: string;
  name: string;
  q: string;
  f: string;
  sort: string;
}

export interface PinsData {
  v: 1;
  items: Pin[];
}

export const STARTER_PINS: Pin[] = [
  { id: "starter-shizuku-open", name: "Shizuku, open source", q: "", f: "shizuku,open", sort: "" },
  { id: "starter-offline-clean", name: "No internet, no anti-features", q: "", f: "no-internet,clean", sort: "" },
  { id: "starter-new", name: "Added in 90 days", q: "", f: "new", sort: "added" },
  { id: "starter-trackable", name: "Released in 90 days, with an APK", q: "", f: "apk,fresh", sort: "release" },
];

export const MAX_PINS = 40;

/** A stored starter pin is read with the name the starter has today, so rewording one reaches devices that already hold it. */
function parsePin(raw: unknown): Pin | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const starter = STARTER_PINS.find((pin) => pin.id === raw.id);
  return { id: raw.id, name: starter?.name ?? raw.name.slice(0, 80), q: text(raw.q), f: text(raw.f), sort: text(raw.sort) };
}

export function parsePins(raw: unknown): PinsData | null {
  if (!isRecord(raw) || raw.v !== 1 || !Array.isArray(raw.items)) return null;
  const items: Pin[] = [];
  for (const candidate of raw.items) {
    const pin = parsePin(candidate);
    if (pin && !items.some((other) => other.id === pin.id)) items.push(pin);
  }
  return { v: 1, items: items.slice(0, MAX_PINS) };
}

export function createPinsStore(backend?: StorageBackend | null): Store<PinsData> {
  const options = { key: "pins", version: 1, parse: parsePins, initial: (): PinsData => ({ v: 1, items: STARTER_PINS.map((pin) => ({ ...pin })) }) };
  return backend === undefined ? createStore(options) : createStore(options, backend);
}

export function addPin(store: Store<PinsData>, pin: Pin): void {
  store.update((current) => ({ v: 1, items: [pin, ...current.items.filter((other) => other.id !== pin.id)].slice(0, MAX_PINS) }));
}

export function removePin(store: Store<PinsData>, id: string): void {
  store.update((current) => ({ v: 1, items: current.items.filter((pin) => pin.id !== id) }));
}

/** What a pin asks, regardless of its id and name: the same text, the same filters in any order, the same sort. */
function question(pin: Pin): string {
  return [pin.q.trim().toLowerCase(), pin.f.split(",").map((token) => token.trim()).filter(Boolean).sort().join(","), pin.sort].join("|");
}

/**
 * Adds the pins of another copy that this one does not have, after its own.
 * A pin counts as present when its id or its question is. Pins that do not
 * fit under the limit are left out and counted.
 */
export function mergePins(local: PinsData, incoming: PinsData): { data: PinsData; added: number; dropped: number } {
  const items = [...local.items];
  const ids = new Set(items.map((pin) => pin.id));
  const questions = new Set(items.map(question));
  let added = 0;
  let dropped = 0;
  for (const pin of incoming.items) {
    if (ids.has(pin.id) || questions.has(question(pin))) continue;
    if (items.length >= MAX_PINS) {
      dropped += 1;
      continue;
    }
    items.push({ ...pin });
    ids.add(pin.id);
    questions.add(question(pin));
    added += 1;
  }
  return { data: { v: 1, items }, added, dropped };
}
