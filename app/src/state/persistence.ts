/**
 * Whether the browser has promised to keep this site's data.
 *
 * By default a site's storage is "best effort": the browser may clear it when
 * the device runs short of space. A site can ask for it to be persistent.
 * Chromium decides without asking the user, from how the site is used
 * (installed, bookmarked, visited often), so a request can simply be declined.
 */

export type Persistence = "persistent" | "best-effort" | "unknown";

export interface StorageManagerLike {
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

function manager(): StorageManagerLike | null {
  return globalThis.navigator?.storage ?? null;
}

export async function readPersistence(storage: StorageManagerLike | null = manager()): Promise<Persistence> {
  if (!storage || typeof storage.persisted !== "function") return "unknown";
  try {
    return (await storage.persisted()) ? "persistent" : "best-effort";
  } catch {
    return "unknown";
  }
}

/** Asks for persistent storage and reports what the browser decided. */
export async function requestPersistence(storage: StorageManagerLike | null = manager()): Promise<Persistence> {
  if (!storage || typeof storage.persist !== "function") return "unknown";
  try {
    return (await storage.persist()) ? "persistent" : "best-effort";
  } catch {
    return "unknown";
  }
}

/** Bytes this site uses, or null where the browser does not say. */
export async function readUsage(storage: StorageManagerLike | null = manager()): Promise<number | null> {
  if (!storage || typeof storage.estimate !== "function") return null;
  try {
    const { usage } = await storage.estimate();
    return typeof usage === "number" && Number.isFinite(usage) ? usage : null;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}\u00a0B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)}\u00a0kB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)}\u00a0MB`;
}
