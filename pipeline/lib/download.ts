/**
 * Downloads an upstream file into the cache, or reads the cached copy when
 * offline. Requests are conditional (ETag, Last-Modified), so an unchanged
 * index is not transferred again. A sidecar records when the copy was last
 * confirmed current, which license headers state as "retrieved".
 */
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { HttpError, isTransient, retry } from "./retry.ts";

export interface DownloadResult {
  text: string;
  /** True when this run contacted the server, false when the cache was used. */
  fetched: boolean;
  /** ISO time the cached copy was last confirmed current. */
  retrieved: string;
}

interface Meta {
  retrieved: string;
  etag: string | null;
  lastModified: string | null;
}

function readMeta(path: string): Meta | null {
  const metaPath = `${path}.meta.json`;
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
  } catch {
    return null;
  }
}

/** The recorded retrieval time, else the cached file's modification time. */
export function retrievedAt(path: string): string {
  return readMeta(path)?.retrieved ?? statSync(path).mtime.toISOString();
}

export async function cachedDownload(
  url: string,
  path: string,
  offline: boolean,
  log: (text: string) => void = () => {},
  now: () => Date = () => new Date(),
): Promise<DownloadResult> {
  if (offline) {
    if (!existsSync(path)) throw new Error(`--offline but ${path} is missing`);
    return { text: readFileSync(path, "utf8"), fetched: false, retrieved: retrievedAt(path) };
  }
  const meta = existsSync(path) ? readMeta(path) : null;
  const headers: Record<string, string> = { "user-agent": "droid-atlas-pipeline" };
  if (meta?.etag) headers["if-none-match"] = meta.etag;
  if (meta?.lastModified) headers["if-modified-since"] = meta.lastModified;
  const result = await retry(
    async () => {
      const response = await fetch(url, { headers, redirect: "follow" });
      if (response.status === 304) return null;
      if (!response.ok) throw new HttpError(url, response.status);
      return { text: await response.text(), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
    },
    { retryable: isTransient, onRetry: (error, attempt) => log(`retrying ${url} (${attempt}): ${String(error)}`) },
  );
  const retrieved = now().toISOString();
  if (result === null) {
    writeFileSync(`${path}.meta.json`, JSON.stringify({ ...meta, retrieved }));
    return { text: readFileSync(path, "utf8"), fetched: true, retrieved };
  }
  writeFileSync(`${path}.tmp`, result.text);
  renameSync(`${path}.tmp`, path);
  writeFileSync(`${path}.meta.json`, JSON.stringify({ retrieved, etag: result.etag, lastModified: result.lastModified } satisfies Meta));
  return { text: result.text, fetched: true, retrieved };
}
