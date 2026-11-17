/**
 * Serves the catalog under test with some of its parts changed, for shapes of
 * data a journey needs and the build may not hold today: a retired id with a
 * redirect, download figures, an entry with no link at all.
 *
 * The app refuses a part whose bytes do not match the manifest, so the
 * manifest is served with the changed part's own digest and size. Everything
 * else is the build as it is on disk.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { Build, ManifestFile } from "./catalog.ts";

export interface PartChange {
  role: "atlas" | "index" | "github" | "source" | "icons";
  /** Which part of that role, for roles with several ("fdroid", "izzy", a catalog's id). */
  origin?: string;
  /** Changes the parsed part in place. */
  change(part: Record<string, unknown>): void;
}

export async function serveChanged(page: Page, build: Build, changes: readonly PartChange[]): Promise<void> {
  const manifest = JSON.parse(JSON.stringify(build.manifest)) as Build["manifest"];
  for (const { role, origin, change } of changes) {
    const listed = manifest.files.find((file: ManifestFile) => file.role === role && (origin === undefined || file.origin === origin));
    if (!listed) throw new Error(`the manifest lists no ${role} part${origin ? ` for ${origin}` : ""}`);
    const part = JSON.parse(readFileSync(join(build.dir, listed.path), "utf8")) as Record<string, unknown>;
    change(part);
    const body = JSON.stringify(part);
    listed.sha256 = createHash("sha256").update(body).digest("hex");
    listed.bytes = Buffer.byteLength(body);
    await page.route(`**/${listed.path}`, (route) => route.fulfill({ body, contentType: "application/json" }));
  }
  await page.route(`**/data/${build.version.manifest}`, (route) => route.fulfill({ json: manifest }));
}
