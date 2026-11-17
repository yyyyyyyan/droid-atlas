import assert from "node:assert/strict";
import { test } from "node:test";
import { checkConfig } from "../refresh-config.mjs";

const base = { SITE_URL: "https://atlas.example.org/" };

test("a site URL alone is enough to build without deploying", () => {
  assert.deepEqual(checkConfig(base), []);
  assert.deepEqual(checkConfig({ ...base, REFRESH_BOOTSTRAP: "true" }), []);
});

test("the site URL is required and must be plain https", () => {
  for (const bad of [undefined, "", "http://atlas.example.org/", "atlas.example.org", "https://user:pw@atlas.example.org/", "https://atlas.example.org/?x=1"]) {
    assert.match(checkConfig({ SITE_URL: bad }).join("\n"), /SITE_URL/, String(bad));
  }
});

test("a mistyped switch fails instead of being read as off", () => {
  assert.match(checkConfig({ ...base, REFRESH_BOOTSTRAP: "yes" }).join("\n"), /REFRESH_BOOTSTRAP/);
  assert.match(checkConfig({ ...base, DEPLOY_TARGET: "gh-pages", PROJECT_URL: "https://example.org/r" }).join("\n"), /DEPLOY_TARGET/);
});

const workers = { ...base, DEPLOY_TARGET: "cloudflare-workers", PROJECT_URL: "https://example.org/repo" };

test("the pipeline's placeholder is not a project URL", () => {
  for (const placeholder of ["https://droid-atlas.invalid/", "https://atlas.example/repo", "https://atlas.test/"]) {
    assert.match(checkConfig({ ...base, DEPLOY_TARGET: "github-pages", PROJECT_URL: placeholder }).join("\n"), /PROJECT_URL must be the project's real address/, placeholder);
  }
});

test("deploying needs the project URL, and Cloudflare needs its account and Worker name", () => {
  assert.match(checkConfig({ ...base, DEPLOY_TARGET: "github-pages" }).join("\n"), /PROJECT_URL must be set/);
  assert.deepEqual(checkConfig({ ...base, DEPLOY_TARGET: "github-pages", PROJECT_URL: "https://example.org/repo" }), []);
  assert.deepEqual(checkConfig(workers).map((p) => p.split(" ")[0]), ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_WORKER_NAME"]);
  assert.deepEqual(checkConfig({ ...workers, CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_WORKER_NAME: "droid-atlas" }), []);
});

test("the Pages target is gone rather than read as another name for Workers", () => {
  assert.match(checkConfig({ ...workers, DEPLOY_TARGET: "cloudflare-pages" }).join("\n"), /DEPLOY_TARGET must be unset or one of github-pages, cloudflare-workers/);
});

test("the Worker name must be usable as a DNS label with room for the preview suffix", () => {
  const ok = { ...workers, CLOUDFLARE_ACCOUNT_ID: "a" };
  for (const name of ["a", "droid-atlas", "atlas2", "a".repeat(55)]) assert.deepEqual(checkConfig({ ...ok, CLOUDFLARE_WORKER_NAME: name }), [], name);
  for (const name of ["Droid-Atlas", "droid_atlas", "-atlas", "atlas-", "droid atlas", "a".repeat(56)]) {
    assert.match(checkConfig({ ...ok, CLOUDFLARE_WORKER_NAME: name }).join("\n"), /CLOUDFLARE_WORKER_NAME must be/, name);
  }
});

test("a Workers custom domain serves a whole host, so the site URL may not have a path", () => {
  const ok = { ...workers, CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_WORKER_NAME: "droid-atlas" };
  assert.deepEqual(checkConfig({ ...ok, SITE_URL: "https://atlas.example.org" }), []);
  assert.match(checkConfig({ ...ok, SITE_URL: "https://example.org/atlas/" }).join("\n"), /SITE_URL must have no path/);
  assert.deepEqual(checkConfig({ ...base, SITE_URL: "https://example.org/atlas/", DEPLOY_TARGET: "github-pages", PROJECT_URL: "https://example.org/repo" }), []);
});
