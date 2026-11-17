/**
 * A text the site publishes, read inside the app: a license, or the notices
 * of the libraries the site ships. Opening the file itself would replace the
 * installed app's window with a bare text file and nothing to go back with,
 * so the app shows the text under its own header.
 */

import { useEffect, useState } from "preact/hooks";
import { licenseTextPath } from "../catalog/credits.ts";
import { licenseName } from "../lib/format.ts";
import { useServices } from "../services.ts";
import { PageHead } from "../ui/LevelHead.tsx";

/** The site's third-party notices, beside the page itself. */
export function noticesUrl(): string {
  return new URL("./third-party-licenses.txt", document.baseURI).href;
}

type Loaded = { state: "loading" } | { state: "failed" } | { state: "ready"; text: string };

function TextPage({ title, url }: { title: string; url: string | null }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  useEffect(() => {
    let current = true;
    if (!url) {
      setLoaded({ state: "failed" });
      return undefined;
    }
    setLoaded({ state: "loading" });
    fetch(url).then(async (response) => {
      /* A host that answers a missing file with the app's own page must not have that page shown as a license. */
      const type = response.headers.get("content-type") ?? "";
      if (!response.ok || type.includes("html")) throw new Error("not a text file");
      return response.text();
    }).then(
      (text) => {
        if (current) setLoaded({ state: "ready", text });
      },
      () => {
        if (current) setLoaded({ state: "failed" });
      },
    );
    return () => {
      current = false;
    };
  }, [url]);

  return (
    <div class="view view-page">
      <PageHead title={title} />
      <div class="page">
        {loaded.state === "loading" && <p class="page-text" role="status">Loading the text…</p>}
        {loaded.state === "failed" && (
          <p class="page-text" role="alert">
            This text could not be loaded. It is published with the site; try again when the connection is back.
          </p>
        )}
        {loaded.state === "ready" && <pre class="reader" dir="ltr" tabIndex={0}>{loaded.text}</pre>}
      </div>
    </div>
  );
}

/** The full text of a license the site ships, by its SPDX identifier. */
export function LicenseText({ id }: { id: string }) {
  const { build } = useServices();
  const path = licenseTextPath(id);
  return <TextPage title={licenseName(id)} url={path ? build.dataRoot + path : null} />;
}

export function ThirdPartyNotices() {
  return <TextPage title="Third-party licenses" url={noticesUrl()} />;
}
