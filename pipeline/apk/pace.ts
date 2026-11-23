/**
 * Spaces requests to each host: a request to a host starts no sooner than
 * `intervalMs` after the previous request to it started. Hosts are told
 * apart by hostname, so a redirect target is paced on its own.
 */

export interface Clock {
  /** Milliseconds, as `Date.now()`. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class Pacer {
  readonly #intervalMs: number;
  readonly #clock: Clock;
  readonly #next = new Map<string, number>();

  constructor(intervalMs: number, clock: Clock = systemClock) {
    this.#intervalMs = intervalMs;
    this.#clock = clock;
  }

  /** Resolves when a request to `host` may start, and books the slot after it. */
  async turn(host: string): Promise<void> {
    const now = this.#clock.now();
    const start = Math.max(now, this.#next.get(host) ?? now);
    this.#next.set(host, start + this.#intervalMs);
    if (start > now) await this.#clock.sleep(start - now);
  }

  /** `fetchFn`, waiting for its host's turn before each request. */
  fetch(fetchFn: typeof fetch): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      await this.turn(new URL(url).hostname);
      return fetchFn(input, init);
    }) as typeof fetch;
  }
}
