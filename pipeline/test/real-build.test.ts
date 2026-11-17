/**
 * The real build, offline from the repository's `.cache/`. Skipped when the
 * cache has not been filled by an online build (`pnpm --filter
 * @droid-atlas/pipeline run build -- --bootstrap`).
 *
 * Proves on real data what the unit tests prove on synthetic data: the parts
 * written to disk join back into the catalog the build made, output is
 * byte-identical for the same inputs, and a rebuild against the previous
 * build carries every id forward.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { joinCatalog } from "../../schema/join.ts";
import { build } from "../build.ts";
import { loadPrevious } from "../validate.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE = join(ROOT, ".cache");
const ready = ["android-foss", "awesome-shizuku", "fdroid-index-v2.json", "izzy-index-v2.json", "github-repos.json"].every((f) => existsSync(join(CACHE, f)));
const AT = "2026-11-11T12:00:00.000Z";

function digest(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (!name.startsWith("report.")) files.set(relative(dir, path), createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
  };
  walk(dir);
  return files;
}

test("real build: round trip from disk, determinism, ids carried forward, no immutable file rewritten", { skip: ready ? false : "the cache has not been filled", timeout: 180_000 }, async () => {
  const first = mkdtempSync(join(tmpdir(), "atlas-a-"));
  const second = mkdtempSync(join(tmpdir(), "atlas-b-"));
  try {
    const args = ["--offline", "--bootstrap", "--generated-at", AT];
    const a = await build([...args, "--out", first]);
    assert.equal(a.code, 0, a.report.validation.failures.join("\n"));
    assert.deepStrictEqual(joinCatalog(a.parts), a.catalog);

    const fromDisk = await loadPrevious(first);
    assert.deepStrictEqual(fromDisk.catalog, a.catalog);

    const b = await build([...args, "--out", second]);
    assert.equal(b.code, 0);
    assert.deepEqual(digest(second), digest(first));

    const manifestOf = (dir: string): string => (JSON.parse(readFileSync(join(dir, "version.json"), "utf8")) as { manifest: string }).manifest;
    const firstManifest = manifestOf(first);
    const firstPart = readFileSync(join(first, dirname(firstManifest), "sources", "fdroid.json"));

    const again = await build(["--offline", "--generated-at", "2026-11-12T12:00:00.000Z", "--out", first]);
    assert.equal(again.code, 0, again.report.validation.failures.join("\n"));
    assert.deepEqual(again.catalog.apps.map((app) => app.id), a.catalog.apps.map((app) => app.id));
    assert.deepEqual(again.catalog.redirects, {});
    assert.equal(again.catalog.hash, a.catalog.hash);
    assert.notEqual(manifestOf(first), firstManifest, "headers carry the build date, so a later build must not reuse an immutable directory");
    assert.deepEqual(readFileSync(join(first, dirname(firstManifest), "sources", "fdroid.json")), firstPart);
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});
