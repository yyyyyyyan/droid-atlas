/** M2 precondition: the audit compares the build with the very cache it was made from, or with none. */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { SYNTHETIC } from "../lib/pick.ts";
import { REPO_ROOT } from "../site.ts";
import { cacheMismatch } from "./audit-config.ts";

test("the upstream cache is the one the served build was made from (index timestamps and GitHub fetch time agree)", () => {
  const dir = process.env.E2E_CACHE_DIR ? resolve(process.env.E2E_CACHE_DIR) : join(REPO_ROOT, ".cache");
  if (SYNTHETIC && !process.env.E2E_CACHE_DIR) test.skip(true, "the synthetic build is audited only against a cache named in E2E_CACHE_DIR");
  expect(existsSync(join(dir, "fdroid-index-v2.json")), `a cache at ${process.env.E2E_CACHE_DIR ? "E2E_CACHE_DIR" : ".cache"}`).toBe(true);
  expect(cacheMismatch(dir)).toBeNull();
});
