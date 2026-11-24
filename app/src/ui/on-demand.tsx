/**
 * A file loaded on demand while a view is on screen: loading, ready, or
 * failed with a way to try again.
 */

import { useEffect, useState } from "preact/hooks";
import { leftBehind, reloadForNewShell } from "../offline/client.ts";
import { useServices } from "../services.ts";

/** `behind` on a failure: the device holds a newer catalog than the one on screen, so trying again will not help and loading the page again will. */
export type Loadable<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; behind: boolean; retry(): void };

/** Loads once per `key`, and again when a failure is retried. */
export function useOnDemand<T>(key: string, load: () => Promise<T>): Loadable<T> {
  const { build } = useServices();
  const [result, setResult] = useState<Loadable<T>>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setResult({ state: "loading" });
    load().then(
      (value) => {
        if (current) setResult({ state: "ready", value });
      },
      async () => {
        /* The failure shows at once; finding out whether a newer catalog is the reason can take a check of the site. */
        const retry = (): void => setAttempt((count) => count + 1);
        if (current) setResult({ state: "failed", behind: false, retry });
        const behind = await leftBehind(build.dataRoot, build.version.hash);
        if (current && behind) setResult({ state: "failed", behind, retry });
      },
    );
    return () => {
      current = false;
    };
  }, [key, attempt]);
  return result;
}

/** What a view says when a file it loads on demand did not load: reload when a newer catalog is the reason, else try again. */
export function NotLoaded({ loaded, what }: { loaded: Extract<Loadable<unknown>, { state: "failed" }>; what: string }) {
  return (
    <p class="credit-note" role="status">
      {loaded.behind ? "A newer catalog is out." : `The ${what} did not load.`}{" "}
      <button type="button" class="link-btn retry-btn" onClick={loaded.behind ? () => void reloadForNewShell() : loaded.retry}>{loaded.behind ? "Reload" : "Try again"}</button>
    </p>
  );
}
