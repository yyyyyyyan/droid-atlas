/**
 * The package's `test` script (RELEASE.md §8: root `pnpm run test:e2e`).
 *
 * The root `test` script runs every workspace package's `test`, including
 * this one, before any site has been built. So: with `E2E_SITE_DIR` set the
 * suite must run and a missing site is a failure; without it, the suite runs
 * against `app/dist` when that build exists, and otherwise says plainly that
 * it did not run.
 */

import { spawnSync } from "node:child_process";
import { loadBuild, unlistedLicenses } from "./lib/catalog.ts";
import { siteDir, siteReady } from "./site.ts";

/** A statement from a source as plain text that a workflow command cannot be built from: one bounded line, without `::` or control characters. */
function workflowText(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/:{2,}/g, ":").replace(/%/g, "%25").slice(0, 80);
}

const dir = siteDir();
if (!siteReady(dir)) {
  if (process.env.E2E_SITE_DIR) {
    console.error(`E2E_SITE_DIR is set but holds no site (index.html and data/version.json): ${dir}`);
    process.exit(1);
  }
  console.log("END-TO-END SUITE NOT RUN: no built site. Build app/dist, or set E2E_SITE_DIR to an assembled site.");
  process.exit(0);
}

/* The license journeys count lists with a table written out by hand; a statement it does not know turns those counts off, which a run then says. */
for (const statement of unlistedLicenses(loadBuild())) {
  console.log(`::warning::License statement not in the end-to-end table, so license list sizes go unchecked: ${workflowText(statement)}`);
}

const result = spawnSync("playwright", ["test", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
