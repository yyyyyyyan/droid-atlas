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
import { siteDir, siteReady } from "./site.ts";

const dir = siteDir();
if (!siteReady(dir)) {
  if (process.env.E2E_SITE_DIR) {
    console.error(`E2E_SITE_DIR is set but holds no site (index.html and data/version.json): ${dir}`);
    process.exit(1);
  }
  console.log("END-TO-END SUITE NOT RUN: no built site. Build app/dist, or set E2E_SITE_DIR to an assembled site.");
  process.exit(0);
}

const result = spawnSync("playwright", ["test", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
