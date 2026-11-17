/**
 * Requests that give up when the network goes quiet. A server whose address
 * resolves and that never answers (a dead mobile signal, a captive portal, a
 * tunnel that is down) leaves a request open for minutes; the person meanwhile
 * watches "Loading…". A request here fails as soon as nothing has arrived for
 * a while: no response yet, or no new bytes of its body. A slow connection
 * that keeps delivering is never cut, however long the whole file takes.
 *
 * A request that gives up rejects as `fetch` does when the network fails
 * (a `TimeoutError` DOMException), so every caller reads it as "could not
 * be reached", never as a damaged or missing file.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * How long every request waits for its first or its next bytes: the first
 * load of the catalog, on-demand files, the check for a newer catalog. A phone
 * waking its radio answers well within it.
 */
export const QUIET_MS = 8_000;

function quietError(ms: number): DOMException {
  return new DOMException(`Nothing arrived for ${ms / 1000} s`, "TimeoutError");
}

/** `fetcher`, giving up when nothing has arrived for `quietMs`. */
export function quietLimited(fetcher: Fetch, quietMs: number): Fetch {
  return async (url, init = {}) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(quietError(quietMs)), quietMs);
    };
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    arm();
    let response: Response;
    try {
      response = await fetcher(url, { ...init, signal });
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
    if (!response.body) {
      clearTimeout(timer);
      return response;
    }
    arm();
    const watched = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, stream) {
        arm();
        stream.enqueue(chunk);
      },
      flush() {
        clearTimeout(timer);
      },
    }));
    signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    return new Response(watched, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

/**
 * For the service worker, which must hand on the response it got (a copy is
 * not one it may store): gives up only while no response has arrived. A body
 * that stalls afterwards is the page's to give up on.
 */
export async function fetchAnswering(request: Request, quietMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(quietError(quietMs)), quietMs);
  try {
    return await fetch(request, { signal: AbortSignal.any([request.signal, controller.signal]) });
  } finally {
    clearTimeout(timer);
  }
}
