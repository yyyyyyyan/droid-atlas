import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { COMPATIBILITY_DATE, workerConfig } from "../wrangler-config.mjs";
import { ROOT } from "./helpers.mjs";

const input = { name: "droid-atlas", siteUrl: "https://atlas.example.org/", assets: "site" };

test("production is an assets-only Worker on its custom domain and nowhere else", () => {
  assert.deepEqual(workerConfig(input), {
    name: "droid-atlas",
    compatibility_date: COMPATIBILITY_DATE,
    assets: { directory: resolve("site"), html_handling: "auto-trailing-slash", not_found_handling: "none" },
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: "atlas.example.org", custom_domain: true }],
  });
});

test("the preview is a separate Worker on workers.dev, with no domain", () => {
  const config = workerConfig({ ...input, preview: true });
  assert.equal(config.name, "droid-atlas-preview");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.deepEqual(config.assets, workerConfig(input).assets);
});

test("a missing file is a 404, never the app's page", () => {
  for (const preview of [false, true]) assert.equal(workerConfig({ ...input, preview }).assets.not_found_handling, "none");
});

test("the compatibility date is a real date no later than the pinned Wrangler's release", () => {
  assert.match(COMPATIBILITY_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(COMPATIBILITY_DATE <= "2026-10-22");
});

test("names and URLs the switch check refuses are refused here too", () => {
  assert.throws(() => workerConfig({ ...input, name: "" }), /Worker name/);
  assert.throws(() => workerConfig({ ...input, name: "Droid_Atlas" }), /Worker name/);
  assert.throws(() => workerConfig({ ...input, siteUrl: "https://example.org/atlas/" }), /no path/);
  assert.throws(() => workerConfig({ ...input, siteUrl: "http://atlas.example.org/" }), /https/);
});

test("the command writes the file from the environment, and fails without it", () => {
  const dir = mkdtempSync(join(tmpdir(), "wrangler-config-"));
  const out = join(dir, "wrangler.json");
  const script = join(ROOT, "scripts", "wrangler-config.mjs");
  execFileSync(process.execPath, [script, "--assets", dir, "--out", out], {
    env: { ...process.env, CLOUDFLARE_WORKER_NAME: "droid-atlas", SITE_URL: "https://atlas.example.org/" },
  });
  const written = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(written.assets.directory, dir);
  assert.deepEqual(written.routes, [{ pattern: "atlas.example.org", custom_domain: true }]);
  assert.throws(
    () => execFileSync(process.execPath, [script, "--assets", dir, "--out", out], { env: { ...process.env, CLOUDFLARE_WORKER_NAME: "", SITE_URL: "" }, stdio: "pipe" }),
    (error) => error.status === 1 && /Worker name/.test(String(error.stderr)),
  );
});
