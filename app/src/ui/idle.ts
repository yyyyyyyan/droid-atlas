/**
 * Runs a task when the page has nothing more pressing to do, and within
 * `timeout` milliseconds in any case. Returns how to call it off.
 */
export function whenIdle(task: () => void, timeout = 300): () => void {
  if (typeof requestIdleCallback === "function") {
    const handle = requestIdleCallback(task, { timeout });
    return () => cancelIdleCallback(handle);
  }
  const timer = setTimeout(task, 30);
  return () => clearTimeout(timer);
}
