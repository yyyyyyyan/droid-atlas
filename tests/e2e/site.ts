/**
 * Where the site under test lives. RELEASE.md §8: the suite tests the
 * assembled site in `E2E_SITE_DIR` when that is set, and otherwise the app's
 * own build in `app/dist`.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function siteDir(): string {
  const given = process.env.E2E_SITE_DIR;
  return given ? resolve(given) : join(REPO_ROOT, "app", "dist");
}

export function siteReady(dir: string = siteDir()): boolean {
  return existsSync(join(dir, "index.html")) && existsSync(join(dir, "data", "version.json"));
}
