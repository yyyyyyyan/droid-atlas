import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { APP_JAVASCRIPT_BUDGET_KB, appJavaScriptKb, assembleSite, checkSite } from "../assemble-site.mjs";
import { writeUpstreamCache } from "../fixture/upstream-cache.mjs";
import { buildNotice, bundledPackages, licenseAllowed, packagesFrom } from "../third-party-licenses.mjs";
import { digest, fixtureBuild, quietStderr, ROOT, tempDir, writeTree } from "./helpers.mjs";

async function builtApp(t) {
  quietStderr(t);
  const dist = tempDir(t);
  const { outcome } = await fixtureBuild(t, join(dist, "data"));
  assert.equal(outcome.code, 0);
  rmSync(join(dist, "data", "report.json"));
  writeTree(dist, { "index.html": "<!doctype html>", "assets/app.js": "" });
  const notice = join(tempDir(t), "third-party-licenses.txt");
  writeFileSync(notice, "notice");
  return { dist, notice };
}

function manifestOf(site) {
  const version = JSON.parse(readFileSync(join(site, "data", "version.json"), "utf8"));
  return { version, manifest: JSON.parse(readFileSync(join(site, "data", version.manifest), "utf8")) };
}

test("the synthetic upstream cache is deterministic and the pipeline builds it with no anomaly", async (t) => {
  quietStderr(t);
  const a = tempDir(t);
  const b = tempDir(t);
  writeUpstreamCache(join(a, "cache"));
  writeUpstreamCache(join(b, "cache"));
  const keep = (f) => !f.includes("/.git/") || f.endsWith("/.git/HEAD");
  assert.deepEqual(digest(join(a, "cache"), keep), digest(join(b, "cache"), keep));

  const { outcome } = await fixtureBuild(t, join(a, "data"));
  assert.equal(outcome.code, 0, outcome.report.validation.failures.join("\n"));
  assert.deepEqual(outcome.catalog.sources.map((s) => [s.id, s.anomalies.length]), [["android-foss", 0], ["awesome-shizuku", 0]]);
  assert.ok(outcome.catalog.apps.length >= 10);
  assert.ok(outcome.catalog.apps.some((app) => app.listings.length === 2), "one app is listed by both catalogs");
});

test("an assembled fixture site is complete", async (t) => {
  const { dist, notice } = await builtApp(t);
  const out = join(tempDir(t), "site");
  assert.deepEqual(assembleSite({ appDist: dist, thirdParty: notice, out }), []);
  assert.equal(readFileSync(join(out, "third-party-licenses.txt"), "utf8"), "notice");
});

test("a site with a missing or altered part, license text or icon is refused", async (t) => {
  const { dist, notice } = await builtApp(t);
  const out = join(tempDir(t), "site");
  assembleSite({ appDist: dist, thirdParty: notice, out });
  const { version, manifest } = manifestOf(out);
  const dir = join(out, "data", version.manifest.replace(/manifest\.json$/, ""));

  writeFileSync(join(dir, "atlas.json"), "{}");
  assert.match(checkSite(out).join("\n"), /atlas\.json: does not match/);

  rmSync(join(dir, manifest.files.find((f) => f.role === "details").path));
  assert.match(checkSite(out).join("\n"), /details\/.*missing/);

  rmSync(join(out, "data", "licenses", "GPL-3.0-only.txt"));
  assert.match(checkSite(out).join("\n"), /GPL-3\.0-only\.txt: .* text is missing/);
});

test("an atlas icon that is not in the site is refused", async (t) => {
  const { dist, notice } = await builtApp(t);
  const out = join(tempDir(t), "site");
  assembleSite({ appDist: dist, thirdParty: notice, out });
  const { version, manifest } = manifestOf(out);
  const dir = version.manifest.replace(/manifest\.json$/, "");
  const atlasPath = join(out, "data", dir, "atlas.json");
  const atlas = JSON.parse(readFileSync(atlasPath, "utf8"));
  atlas.apps[0].icon = "icons/0123456789abcdef.webp";
  const text = JSON.stringify(atlas);
  writeFileSync(atlasPath, text);
  const { createHash } = await import("node:crypto");
  manifest.files.find((f) => f.role === "atlas").sha256 = createHash("sha256").update(text).digest("hex");
  writeFileSync(join(out, "data", version.manifest), JSON.stringify(manifest));
  assert.deepEqual(checkSite(out), ["data/icons/0123456789abcdef.webp: named by the atlas but missing"]);
});

test("required files, forbidden files and symbolic links", async (t) => {
  const { dist, notice } = await builtApp(t);
  const out = join(tempDir(t), "site");
  assembleSite({ appDist: dist, thirdParty: notice, out });
  writeTree(out, { ".env": "TOKEN=x", "assets/report.json": "{}", "debug.log": "" });
  symlinkSync("/etc/hostname", join(out, "assets", "link"));
  rmSync(join(out, "third-party-licenses.txt"));
  const problems = checkSite(out).join("\n");
  for (const expected of ["third-party-licenses.txt: missing", ".env: must never", "assets/report.json: a build report", "debug.log: must never", "assets/link: symbolic link"]) {
    assert.ok(problems.includes(expected), `${expected}\n${problems}`);
  }
});

test("a site whose JavaScript is over its budget is refused, with the size and the limit", async (t) => {
  const { dist, notice } = await builtApp(t);
  const out = join(tempDir(t), "site");
  assembleSite({ appDist: dist, thirdParty: notice, out });
  const incompressible = (kB) => randomBytes(kB * 1000);

  writeTree(out, { "assets/index.js": incompressible(APP_JAVASCRIPT_BUDGET_KB - 1), "assets/index.js.map": incompressible(300), "sw.js": incompressible(300) });
  assert.deepEqual(checkSite(out), [], "under the budget; a source map and the service worker are not counted");
  assert.ok(appJavaScriptKb(out) > APP_JAVASCRIPT_BUDGET_KB - 1);

  writeTree(out, { "assets/index.js": incompressible(APP_JAVASCRIPT_BUDGET_KB) });
  const [problem, ...others] = checkSite(out);
  assert.deepEqual(others, []);
  assert.match(problem, new RegExp(`^assets/: the app's JavaScript is ${APP_JAVASCRIPT_BUDGET_KB}\\.\\d\\d kB gzip, over its budget of ${APP_JAVASCRIPT_BUDGET_KB} kB$`));

  writeTree(out, { "assets/index.js": incompressible(APP_JAVASCRIPT_BUDGET_KB - 1), "assets/more.js": incompressible(2) });
  assert.equal(checkSite(out).length, 1, "every script under assets/ counts");
});

test("ARCHITECTURE.md states the JavaScript budget the site check enforces", () => {
  const stated = /^\| App JavaScript \| (\d+) kB/m.exec(readFileSync(join(ROOT, "docs", "ARCHITECTURE.md"), "utf8"));
  assert.equal(Number(stated?.[1]), APP_JAVASCRIPT_BUDGET_KB);
});

test("the build kept beside the current one is checked too", async (t) => {
  const { dist, notice } = await builtApp(t);
  writeTree(dist, { "data/c/00000000000000aa/manifest.json": JSON.stringify({ files: [{ path: "atlas.json", role: "atlas", sha256: "0".repeat(64), license: "CC0-1.0" }] }) });
  const problems = assembleSite({ appDist: dist, thirdParty: notice, out: join(tempDir(t), "site") });
  assert.ok(problems.some((p) => p.startsWith("data/c/00000000000000aa/atlas.json: listed")), problems.join("\n"));
});

test("license expressions: AND needs every term, OR one alternative; unknown and exceptions fail", () => {
  assert.equal(licenseAllowed("MIT"), true);
  assert.equal(licenseAllowed("(MIT OR GPL-2.0-only)"), true);
  assert.equal(licenseAllowed("MIT AND LGPL-3.0-or-later"), false);
  assert.equal(licenseAllowed("(MIT AND Zlib) OR Apache-2.0"), true);
  assert.equal(licenseAllowed("GPL-2.0-only WITH Classpath-exception-2.0"), false);
  for (const bad of ["Unknown", "", undefined, "SEE LICENSE IN LICENSE", "MIT OR", "(MIT"]) assert.equal(licenseAllowed(bad), false, String(bad));
});

test("the notice copies license files, and refuses disallowed licenses and undeclared bundled packages", (t) => {
  const pkg = tempDir(t);
  writeTree(pkg, { "LICENSE.md": "Copyright Example\nPermission is hereby granted" });
  const report = {
    MIT: [{ name: "example", versions: ["1.0.0"], paths: [pkg], license: "MIT", homepage: "https://example.org" }],
    Unknown: [{ name: "mystery", versions: ["2.0.0"], paths: [], license: "Unknown" }],
  };
  const packages = packagesFrom(report);
  assert.deepEqual(packages.map((p) => `${p.name}@${p.version}`), ["example@1.0.0", "mystery@2.0.0"]);
  const { problems, text } = buildNotice(packages, { bundled: ["example", "stowaway"] });
  assert.deepEqual(problems, [
    'mystery@2.0.0: license "Unknown" is unknown or not on the allowlist',
    "stowaway: bundled into the JavaScript but not a production dependency, so it has no notice",
  ]);
  assert.match(text, /example 1\.0\.0\nLicense: MIT\nHomepage: https:\/\/example\.org\n\nCopyright Example/);
  assert.match(text, /mystery 2\.0\.0[\s\S]*ships no license file/);
});

test("bundled packages are read from source maps, scoped names included", (t) => {
  const dist = tempDir(t);
  writeTree(dist, {
    "assets/index.js.map": JSON.stringify({
      sources: ["../../src/main.tsx", "../../node_modules/.pnpm/preact@11.2.0/node_modules/preact/dist/preact.mjs", "../../node_modules/@preact/signals/dist/x.mjs"],
    }),
  });
  assert.deepEqual(bundledPackages(dist), ["@preact/signals", "preact"]);
});
