import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { quietLimited, type Fetch } from "./quiet.ts";

/**
 * A fetch that answers after `headersAfter` ms (never, for null) with a body
 * of `chunks`, one every `every` ms, and that ends its request and its body
 * when the signal aborts, as the browser's does.
 */
function slowServer(headersAfter: number | null, chunks: number, every: number, ends = true): Fetch {
  return (_url, init) => new Promise((resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener("abort", () => reject(signal.reason));
    if (headersAfter === null) return;
    setTimeout(() => {
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener("abort", () => controller.error(signal.reason));
          const tick = (): void => {
            if (signal?.aborted) return;
            if (sent === chunks) {
              if (ends) controller.close();
              return;
            }
            sent += 1;
            controller.enqueue(new Uint8Array([sent]));
            setTimeout(tick, every);
          };
          setTimeout(tick, every);
        },
      });
      resolve(new Response(body, { status: 200 }));
    }, headersAfter);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a request that gives up when the network goes quiet", () => {
  test("a server that never answers is given up on after the quiet limit, as a network failure", async () => {
    const pending = quietLimited(slowServer(null, 0, 0), 8000)("/x");
    const outcome = pending.then(() => "answered", (error: unknown) => (error instanceof DOMException ? error.name : "other"));
    await vi.advanceTimersByTimeAsync(7999);
    await vi.advanceTimersByTimeAsync(2);
    expect(await outcome).toBe("TimeoutError");
  });

  test("a body that stops arriving is given up on, and its read fails", async () => {
    const response = quietLimited(slowServer(10, 2, 1000, false), 8000)("/x");
    await vi.advanceTimersByTimeAsync(20);
    const read = (await response).arrayBuffer().then(() => "read", () => "failed");
    await vi.advanceTimersByTimeAsync(2000 + 7900);
    expect(await Promise.race([read, Promise.resolve("still reading")])).toBe("still reading");
    await vi.advanceTimersByTimeAsync(200);
    expect(await read).toBe("failed");
  });

  test("a slow connection that keeps delivering is never cut, however long the whole takes", async () => {
    const response = quietLimited(slowServer(6000, 12, 5000), 8000)("/x");
    await vi.advanceTimersByTimeAsync(6001);
    const bytes = (await response).arrayBuffer();
    await vi.advanceTimersByTimeAsync(13 * 5000 + 10);
    expect((await bytes).byteLength).toBe(12);
  });

  test("a response that is quick and whole is passed on as it came", async () => {
    const response = quietLimited(async () => new Response("abc", { status: 404, statusText: "Not Found" }), 8000)("/x");
    const answered = await response;
    expect(answered.status).toBe(404);
    expect(await answered.text()).toBe("abc");
    await vi.advanceTimersByTimeAsync(20_000);
  });
});
