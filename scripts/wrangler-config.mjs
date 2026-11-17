#!/usr/bin/env node
/**
 * Writes the Wrangler configuration that deploys the assembled site as an
 * assets-only Cloudflare Worker: no Worker script, every request answered from
 * the site directory, `_headers` included.
 *
 *   node scripts/wrangler-config.mjs --assets <site dir> --out <file.json> [--preview]
 *
 * Reads `CLOUDFLARE_WORKER_NAME` and `SITE_URL` from the environment, so the
 * Worker's name and domain live in repository variables and nowhere in the
 * tree. Then `wrangler deploy --config <file.json>`.
 *
 * The production Worker is served on `SITE_URL`'s host only, as a custom
 * domain that the first deploy creates (DNS record and certificate included);
 * its `workers.dev` address and preview URLs are off, so the app has exactly
 * one origin. `--preview` instead describes a separate Worker,
 * `<name>-preview`, on `workers.dev` and no domain: the throwaway copy the
 * release check reads headers from before the real domain is attached
 * (`docs/RELEASE.md` §4).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { httpsUrl, isWorkerName } from "./refresh-config.mjs";

/** The Workers runtime version the site is served under; not newer than the pinned Wrangler (4.152.0, 2026-10-22) knows. */
export const COMPATIBILITY_DATE = "2026-10-01";

/**
 * The configuration object for `name` serving `assets` at `siteUrl`'s host,
 * or for its `workers.dev` preview copy. Throws on a name or URL that
 * `scripts/refresh-config.mjs` would also refuse.
 */
export function workerConfig({ name, siteUrl, assets, preview = false }) {
  if (!isWorkerName(name)) throw new Error(`not a usable Worker name: ${JSON.stringify(name)}`);
  if (!httpsUrl(siteUrl) || new URL(siteUrl).pathname !== "/") throw new Error(`SITE_URL must be an https:// origin with no path: ${JSON.stringify(siteUrl)}`);
  const config = {
    name: preview ? `${name}-preview` : name,
    compatibility_date: COMPATIBILITY_DATE,
    assets: {
      directory: resolve(assets),
      html_handling: "auto-trailing-slash",
      not_found_handling: "none",
    },
    workers_dev: preview,
    preview_urls: false,
  };
  if (!preview) config.routes = [{ pattern: new URL(siteUrl).hostname, custom_domain: true }];
  return config;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { assets: { type: "string" }, out: { type: "string" }, preview: { type: "boolean", default: false } } });
  if (!values.assets || !values.out) {
    process.stderr.write("usage: wrangler-config.mjs --assets <site dir> --out <file.json> [--preview]\n");
    process.exit(2);
  }
  try {
    const config = workerConfig({
      name: (process.env.CLOUDFLARE_WORKER_NAME ?? "").trim(),
      siteUrl: (process.env.SITE_URL ?? "").trim(),
      assets: values.assets,
      preview: values.preview,
    });
    writeFileSync(values.out, `${JSON.stringify(config, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
