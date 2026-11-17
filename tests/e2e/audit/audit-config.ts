/** Shared settings for the data audit (M2). */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadBuild } from "../lib/catalog.ts";
import { SYNTHETIC } from "../lib/pick.ts";
import { REPO_ROOT } from "../site.ts";

/** The seed every sample in the audit is drawn with, so a reader can redraw it. */
export const SEED = 20261111;

/**
 * Why the cache in `dir` is not the one the served build was made from, or
 * null when it is: the build records the F-Droid and IzzyOnDroid index
 * timestamps and the GitHub fetch time, and the cache must carry the same.
 */
export function cacheMismatch(dir: string): string | null {
  const build = loadBuild();
  const json = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
  const indexAt = (name: string): string | null => {
    const timestamp = (json(name).repo as { timestamp?: number } | undefined)?.timestamp;
    return typeof timestamp === "number" ? new Date(timestamp).toISOString() : null;
  };
  const parts = build.manifest.files.filter((f) => f.role === "index" || f.role === "github").map((f) => JSON.parse(readFileSync(join(build.dir, f.path), "utf8")) as { origin?: string; indexAt?: string; fetchedAt?: string });
  const fdroidAt = parts.find((p) => p.origin === "fdroid")?.indexAt;
  const izzyAt = parts.find((p) => p.origin === "izzy")?.indexAt;
  const githubAt = parts.find((p) => p.fetchedAt)?.fetchedAt;
  const problems: string[] = [];
  if (fdroidAt !== indexAt("fdroid-index-v2.json")) problems.push(`F-Droid index ${indexAt("fdroid-index-v2.json")} ≠ build ${fdroidAt}`);
  if (izzyAt !== indexAt("izzy-index-v2.json")) problems.push(`IzzyOnDroid index ${indexAt("izzy-index-v2.json")} ≠ build ${izzyAt}`);
  if (githubAt !== json("github-repos.json").fetchedAt) problems.push(`GitHub fetch ${String(json("github-repos.json").fetchedAt)} ≠ build ${githubAt}`);
  return problems.length ? problems.join("; ") : null;
}

/**
 * The upstream cache the build was made from (F-Droid and IzzyOnDroid
 * indexes, GitHub facts): `E2E_CACHE_DIR`, else the repository's `.cache`,
 * which is where the refresh workflow restores it. The synthetic CI build is
 * audited only against a cache named explicitly, and a cache from another
 * build is never used.
 */
export function cacheDir(): string | null {
  const given = process.env.E2E_CACHE_DIR;
  if (SYNTHETIC && !given) return null;
  const dir = given ? resolve(given) : join(REPO_ROOT, ".cache");
  if (!existsSync(join(dir, "fdroid-index-v2.json"))) return null;
  return cacheMismatch(dir) === null ? dir : null;
}
