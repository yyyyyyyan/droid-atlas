/**
 * Retries an upstream operation with exponential backoff before giving up.
 * A transient failure must not fail the daily build; a persistent one must.
 */
export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** Return false for errors that retrying cannot fix. */
  retryable?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function retry<T>(run: () => T | Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 4;
  const base = options.baseDelayMs ?? 2000;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown = new Error("retry: no attempt made");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || (options.retryable && !options.retryable(error))) break;
      options.onRetry?.(error, attempt);
      await sleep(base * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

/** Error for an HTTP status, so retry policies can tell client errors from server errors. */
export class HttpError extends Error {
  readonly status: number;
  constructor(url: string, status: number) {
    super(`${url}: HTTP ${status}`);
    this.status = status;
  }
}

/** Server errors, rate limiting and network failures are retried; other client errors are not. */
export function isTransient(error: unknown): boolean {
  if (error instanceof HttpError) return error.status >= 500 || error.status === 429 || error.status === 408;
  return true;
}
