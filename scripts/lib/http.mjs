/**
 * HTTP for the release scripts: a GET with retries and backoff on transient
 * failures, and a small bounded-concurrency map.
 */

export class HttpError extends Error {
  constructor(url, status) {
    super(`${url}: HTTP ${status}`);
    this.url = url;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** True for failures worth retrying: network errors, 408, 429 and 5xx. */
export function isTransient(error) {
  if (!(error instanceof HttpError)) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

/**
 * Fetches `url` and returns its body as bytes. `cache: "no-store"` keeps a
 * stale intermediary copy out of the decision. Transient failures are retried
 * `tries - 1` times with doubling delays.
 */
export async function getBytes(url, { tries = 4, delayMs = 2000, fetchImpl = fetch } = {}) {
  let delay = delayMs;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetchImpl(url, {
        cache: "no-store",
        redirect: "follow",
        headers: { "user-agent": "release-scripts", "cache-control": "no-cache" },
      });
      if (!response.ok) throw new HttpError(url, response.status);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= tries || !isTransient(error)) throw error;
      await sleep(delay);
      delay *= 2;
    }
  }
}

/** Maps `items` through `task` with at most `limit` in flight; results keep input order. */
export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
