/**
 * Whether a file the page would like to link is actually published. License
 * texts and the third-party notice are added to the site by the build and the
 * release tooling, so a page asks before it links: a link that 404s on a
 * licenses page is worse than a plain name.
 */

import { useEffect, useState } from "preact/hooks";

const known = new Map<string, Promise<boolean>>();

export function isAvailable(url: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const cached = known.get(url);
  if (cached) return cached;
  const check = fetcher(url, { method: "HEAD" }).then(
    /* A host that answers a missing path with its HTML shell would otherwise make every file look present. */
    (response) => response.ok && !(response.headers.get("content-type") ?? "").includes("text/html"),
    () => false,
  );
  known.set(url, check);
  return check;
}

/** The subset of `urls` that are published; empty until the answers arrive. */
export function useAvailable(urls: readonly string[]): ReadonlySet<string> {
  const [available, setAvailable] = useState<ReadonlySet<string>>(new Set());
  const key = urls.join("\n");
  useEffect(() => {
    let current = true;
    void Promise.all(urls.map(async (url) => ((await isAvailable(url)) ? url : null))).then((found) => {
      if (current) setAvailable(new Set(found.filter((url): url is string => url !== null)));
    });
    return () => {
      current = false;
    };
  }, [key]);
  return available;
}
