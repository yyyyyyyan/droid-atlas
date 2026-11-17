import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { exportTree, reasonFor } from "../export-public.mjs";
import { allowed, readConfig, readDenyList } from "../leak-scan.mjs";
import { ROOT, tempDir, writeTree } from "./helpers.mjs";

const CONFIG = {
  include: ["README.md", "NOTICE.md", "app/**", "docs/PUBLIC.md", "scripts/**"],
  exclude: ["scripts/deny.txt", "**/.env"],
  withheld: { "docs/STATUS.md": "working record", "prototypes/": "not the product" },
};

function repository(t, files, { symlink = false } = {}) {
  const repo = tempDir(t, "repo-");
  writeTree(repo, files);
  if (symlink) symlinkSync("../README.md", join(repo, "app", "link.md"));
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "--no-gpg-sign", "-m", "test");
  return repo;
}

const FILES = {
  "README.md": "Public readme.",
  "NOTICE.md": "Contact: [contact to be set before release].",
  "app/src/main.ts": "export const x = 1;\n",
  "app/.env": "TOKEN=1",
  "docs/PUBLIC.md": "Public doc.",
  "docs/STATUS.md": "Private status.",
  "prototypes/a/index.html": "<p>old</p>",
  "scripts/deny.txt": "Hostbox",
  "scripts/tool.mjs": "export {};\n",
  "loose.txt": "no decision recorded",
};

test("only allowlisted files are exported, from the commit, with no history", (t) => {
  const repo = repository(t, FILES);
  writeFileSync(join(repo, "README.md"), "uncommitted edit");
  const out = join(tempDir(t), "public");
  const result = exportTree({ repo, out, config: CONFIG, deny: null });
  const exported = execFileSync("find", [out, "-type", "f", "-printf", "%P\n"], { encoding: "utf8" }).trim().split("\n").sort();
  assert.deepEqual(exported, ["NOTICE.md", "README.md", "app/src/main.ts", "docs/PUBLIC.md", "scripts/tool.mjs"]);
  assert.equal(readFileSync(join(out, "README.md"), "utf8"), "Public readme.");
  assert.equal(existsSync(join(out, ".git")), false);
  assert.equal(result.exported, 5);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(
    result.withheld.map((w) => `${w.path}: ${w.reason}`).sort(),
    ["app/.env: null", "docs/STATUS.md: working record", "loose.txt: null", "prototypes/a/index.html: not the product", "scripts/deny.txt: null"],
  );
});

test("a leak in an exported file fails the export", (t) => {
  const repo = repository(t, { ...FILES, "docs/PUBLIC.md": "Built on Hostbox." });
  const denyPath = join(tempDir(t), "deny.txt");
  writeFileSync(denyPath, "Hostbox\n");
  const result = exportTree({ repo, out: join(tempDir(t), "public"), config: CONFIG, deny: readDenyList(denyPath) });
  assert.deepEqual(result.findings.map((f) => `${f.cls} ${f.path}`), ["deny-list docs/PUBLIC.md"]);
});

test("the release check refuses placeholders", (t) => {
  const repo = repository(t, FILES);
  const result = exportTree({ repo, out: join(tempDir(t), "public"), config: CONFIG, deny: null, final: true });
  assert.equal(result.placeholders.length, 1);
  assert.match(result.placeholders[0], /^NOTICE\.md/);
});

test("symbolic links, a non-empty target and a target inside the repository are refused", (t) => {
  const repo = repository(t, FILES, { symlink: true });
  assert.throws(() => exportTree({ repo, out: join(tempDir(t), "public"), config: CONFIG, deny: null }), /symbolic links/);
  const plain = repository(t, FILES);
  const busy = tempDir(t);
  writeFileSync(join(busy, "x"), "");
  assert.throws(() => exportTree({ repo: plain, out: busy, config: CONFIG, deny: null }), /not empty/);
  mkdirSync(join(plain, "out"));
  assert.throws(() => exportTree({ repo: plain, out: join(plain, "out"), config: CONFIG, deny: null }), /inside the repository/);
});

test("withheld reasons resolve exact paths before the closest directory", () => {
  const withheld = { "docs/": "docs", "docs/design/": "design", "docs/design/x.md": "x" };
  assert.equal(reasonFor("docs/design/x.md", withheld), "x");
  assert.equal(reasonFor("docs/design/y.md", withheld), "design");
  assert.equal(reasonFor("docs/z.md", withheld), "docs");
  assert.equal(reasonFor("other.md", withheld), null);
});

test("the project's own allowlist withholds the private material the release plan names", () => {
  const config = readConfig(join(ROOT, "scripts", "public-export.json"));
  for (const path of [
    "docs/STATUS.md",
    "docs/PUBLICATION.md",
    "docs/VERIFICATION.md",
    "docs/research/device-tests.md",
    "prototypes/atlas/index.html",
    "shared/links.js",
    "data/catalog.json",
    "scripts/leak-scan.deny.txt",
    ".cache/fdroid-index-v2.json",
    "app/public/data/version.json",
  ]) {
    assert.equal(allowed(path, config), false, `${path} would be exported`);
  }
  for (const path of [
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "NOTICE.md",
    "LICENSES/GPL-3.0-or-later.txt",
    "LICENSES/AGPL-3.0-only.txt",
    "pipeline/build.ts",
    "docs/LICENSING.md",
    "docs/RELEASE.md",
    "docs/TAXONOMY.md",
    "docs/images/explore-light.webp",
    ".github/ISSUE_TEMPLATE/config.yml",
  ]) {
    assert.equal(allowed(path, config), true, `${path} would be withheld`);
  }
});
