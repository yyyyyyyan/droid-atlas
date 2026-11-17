import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { HEADER_LICENSES } from "../../pipeline/split.ts";
import { sha256 } from "../lib/files.mjs";
import { checkAge, dataRoot, mirror } from "../live-build.mjs";
import { digest, fixtureBuild, quietStderr, serve, tempDir, writeTree } from "./helpers.mjs";

const fast = { tries: 1 };

test("dataRoot appends data/ to the site URL whatever its slashes", () => {
  assert.equal(dataRoot("https://example.org").href, "https://example.org/data/");
  assert.equal(dataRoot("https://example.org/atlas//").href, "https://example.org/atlas/data/");
  assert.throws(() => dataRoot("file:///etc/"), /http/);
});

test("mirror copies the live build byte for byte, and the pipeline accepts it as --previous", async (t) => {
  quietStderr(t);
  const site = tempDir(t);
  const first = await fixtureBuild(t, join(site, "data"));
  assert.equal(first.outcome.code, 0, first.outcome.report.validation.failures.join("\n"));
  const url = await serve(t, site);

  const out = join(tempDir(t), "data");
  const summary = await mirror(url, out, fast);
  assert.equal(summary.bootstrap, false);
  const notReport = (f) => !f.startsWith("report.");
  assert.deepEqual(digest(out), digest(join(site, "data"), notReport));

  const { build } = await import("../../pipeline/build.ts");
  const again = await build(["--offline", "--cache", first.cache, "--generated-at", "2026-11-12T12:00:00.000Z", "--out", out, "--previous", out]);
  assert.equal(again.code, 0, again.report.validation.failures.join("\n"));
  assert.deepEqual(
    again.catalog.apps.map((a) => a.id),
    first.outcome.catalog.apps.map((a) => a.id),
  );
});

test("mirror refuses a part that does not match the manifest", async (t) => {
  quietStderr(t);
  const site = tempDir(t);
  const { outcome } = await fixtureBuild(t, join(site, "data"));
  const version = JSON.parse(readFileSync(join(site, "data", "version.json"), "utf8"));
  const dir = version.manifest.replace(/manifest\.json$/, "");
  assert.equal(outcome.code, 0);
  const url = await serve(t, site, { [`/data/${dir}atlas.json`]: "{}" });
  await assert.rejects(mirror(url, join(tempDir(t), "data"), fast), /atlas\.json does not match/);
});

test("mirror fails when a listed file is missing", async (t) => {
  quietStderr(t);
  const site = tempDir(t);
  await fixtureBuild(t, join(site, "data"));
  const manifest = JSON.parse(readFileSync(join(site, "data", JSON.parse(readFileSync(join(site, "data", "version.json"), "utf8")).manifest), "utf8"));
  const upstream = manifest.files.find((f) => f.role === "upstream").path.replace("../../", "/data/");
  const url = await serve(t, site, { [upstream]: 404 });
  await assert.rejects(mirror(url, join(tempDir(t), "data"), fast), /404/);
});

test("mirror fetches named icons and license texts, the texts of icon records only where the site has them, and checks icon hashes", async (t) => {
  const site = tempDir(t);
  const icon = new TextEncoder().encode("not really a webp");
  const iconPath = `icons/${sha256(icon).slice(0, 16)}.webp`;
  const atlas = JSON.stringify({ apps: [{ icon: iconPath }, { icon: null }] });
  const icons = JSON.stringify({ icons: [{ license: "MIT" }, { license: "Proprietary" }, { license: "Apache-2.0 OR GPL-3.0" }] });
  const manifest = {
    hash: "f".repeat(64),
    files: [
      { path: "atlas.json", role: "atlas", sha256: sha256(atlas), license: "CC0-1.0" },
      { path: "icons.json", role: "icons", sha256: sha256(icons), license: "CC0-1.0" },
      { path: "sources/x.json", role: "index", sha256: sha256("{}"), license: "LicenseRef-per-record" },
    ],
  };
  writeTree(join(site, "data"), {
    "version.json": JSON.stringify({ generatedAt: "2026-11-11T00:00:00Z", hash: "f".repeat(64), manifest: "c/0123456789abcdef/manifest.json" }),
    "c/0123456789abcdef/manifest.json": JSON.stringify(manifest),
    "c/0123456789abcdef/atlas.json": atlas,
    "c/0123456789abcdef/icons.json": icons,
    "c/0123456789abcdef/sources/x.json": "{}",
    [iconPath]: icon,
    "licenses/MIT.txt": "MIT text",
    "licenses/Apache-2.0.txt": "Apache text",
    ...Object.fromEntries(HEADER_LICENSES.map((id) => [`licenses/${id}.txt`, `${id} text`])),
  });
  const url = await serve(t, site);
  const out = join(tempDir(t), "data");
  const summary = await mirror(url, out, fast);
  assert.deepEqual([summary.icons, summary.licenses], [1, new Set([...HEADER_LICENSES, "MIT", "Apache-2.0"]).size], "a record's license is mirrored when the site has its text, and its absence is no error");
  assert.equal(readFileSync(join(out, "licenses", "MIT.txt"), "utf8"), "MIT text");
  assert.equal(readFileSync(join(out, "licenses", "Apache-2.0.txt"), "utf8"), "Apache text");

  writeFileSync(join(site, "data", iconPath), "tampered");
  await assert.rejects(mirror(url, out, fast), /does not match the hash in its name/);
});

test("mirror refuses unexpected paths in version.json and the manifest", async (t) => {
  const site = tempDir(t);
  writeTree(join(site, "data"), { "version.json": JSON.stringify({ generatedAt: "2026-11-11T00:00:00Z", manifest: "../../etc/passwd" }) });
  const url = await serve(t, site);
  await assert.rejects(mirror(url, join(tempDir(t), "data"), fast), /unexpected manifest/);

  const manifest = { hash: "a", files: [{ path: "../../../escape.json", role: "atlas", sha256: "0".repeat(64), license: "CC0-1.0" }] };
  writeTree(join(site, "data"), {
    "version.json": JSON.stringify({ generatedAt: "2026-11-11T00:00:00Z", hash: "a", manifest: "c/0123456789abcdef/manifest.json" }),
    "c/0123456789abcdef/manifest.json": JSON.stringify(manifest),
  });
  await assert.rejects(mirror(url, join(tempDir(t), "data"), fast), /unexpected file/);
});

test("bootstrap is required when the site has no catalog, and refused when it has one", async (t) => {
  const empty = await serve(t, tempDir(t));
  await assert.rejects(mirror(empty, join(tempDir(t), "data"), fast), /needs --bootstrap/);
  assert.deepEqual(await mirror(empty, join(tempDir(t), "data"), { ...fast, bootstrap: true }), { bootstrap: true, files: 0 });

  const site = tempDir(t);
  writeTree(join(site, "data"), { "version.json": JSON.stringify({ generatedAt: "2026-11-11T00:00:00Z", manifest: "c/0123456789abcdef/manifest.json" }) });
  const live = await serve(t, site);
  await assert.rejects(mirror(live, join(tempDir(t), "data"), { ...fast, bootstrap: true }), /discard every permanent id/);
});

test("bootstrap accepts a host that has no address yet, and no other failure to reach the site", async (t) => {
  const failing = (code) => ({ ...fast, fetchImpl: () => Promise.reject(new TypeError("fetch failed", { cause: { code } })) });
  const site = "https://no-address.example.invalid/";
  assert.deepEqual(await mirror(site, join(tempDir(t), "data"), { ...failing("ENOTFOUND"), bootstrap: true }), { bootstrap: true, files: 0 });
  await assert.rejects(mirror(site, join(tempDir(t), "data"), failing("ENOTFOUND")), /fetch failed/);
  for (const code of ["ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT"]) {
    await assert.rejects(mirror(site, join(tempDir(t), "data"), { ...failing(code), bootstrap: true }), /fetch failed/, code);
  }
});

test("age passes within the limit and fails beyond it or without a catalog", async (t) => {
  const site = tempDir(t);
  writeTree(join(site, "data"), { "version.json": JSON.stringify({ generatedAt: "2026-11-11T12:00:00Z", manifest: "c/0123456789abcdef/manifest.json" }) });
  const url = await serve(t, site);
  const fresh = await checkAge(url, 3, { ...fast, now: new Date("2026-11-14T11:00:00Z") });
  assert.equal(fresh.ok, true, fresh.message);
  const stale = await checkAge(url, 3, { ...fast, now: new Date("2026-11-14T13:00:00Z") });
  assert.equal(stale.ok, false);
  assert.match(stale.message, /stale/);
  const none = await checkAge(await serve(t, tempDir(t)), 3, fast);
  assert.equal(none.ok, false);
  assert.match(none.message, /serves no catalog/);
});
