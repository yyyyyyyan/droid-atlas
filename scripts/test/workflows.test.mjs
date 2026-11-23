/**
 * Policy checks on the workflow files: the guards that keep anything from
 * being published without the documented switches, pinned actions, and
 * least-privilege tokens. actionlint checks syntax; these check intent.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { STAGES } from "../refresh-report.mjs";
import { ROOT } from "./helpers.mjs";

const DIR = join(ROOT, ".github", "workflows");

function read(name) {
  return readFileSync(join(DIR, name), "utf8");
}

/** Job name → the text of its block, from a workflow written with two-space indentation. */
function jobs(text) {
  const lines = text.split("\n");
  const start = lines.indexOf("jobs:");
  assert.notEqual(start, -1, "no jobs: block");
  const blocks = {};
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      blocks[current] = "";
    } else if (/^\S/.test(line)) {
      break;
    } else if (current) {
      blocks[current] += `${line}\n`;
    }
  }
  return blocks;
}

function ifOf(block) {
  const match = /^ {4}if: (>-\n((?: {6}.*\n)+)|.*)/m.exec(block);
  return match ? (match[2] ?? match[1]).replace(/\s+/g, " ").trim() : "";
}

const workflows = readdirSync(DIR).filter((f) => f.endsWith(".yml"));

test("every action is pinned to a full commit SHA", () => {
  for (const name of workflows) {
    for (const line of read(name).split("\n").filter((l) => /^\s*(- )?uses:/.test(l))) {
      assert.match(line, /uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40}( #|$)/, `${name}: ${line.trim()}`);
    }
  }
});

test("workflows grant no token permission at the top level and none that writes contents", () => {
  for (const name of workflows) {
    const text = read(name);
    assert.match(text, /^permissions: \{\}$/m, `${name}: top-level permissions must be {}`);
    assert.doesNotMatch(text, /contents: write/, name);
    for (const [job, block] of Object.entries(jobs(text))) assert.match(block, /^ {4}permissions:/m, `${name} ${job}: no explicit permissions`);
  }
});

test("CI uses no secret and only a read-only token", () => {
  const text = read("ci.yml");
  assert.doesNotMatch(text, /secrets\./);
  for (const block of Object.values(jobs(text))) assert.match(block, /permissions:\n {6}contents: read\n(?! {6})/);
});

test("every refresh job is off unless REFRESH_ENABLED is true", () => {
  for (const [job, block] of Object.entries(jobs(read("refresh.yml")))) {
    assert.match(ifOf(block), /vars\.REFRESH_ENABLED == 'true'/, `refresh ${job}`);
  }
});

test("the refresh tests the code before a catalog or an upstream cache is in the checkout, and reports its stages in the order it runs them", () => {
  const build = jobs(read("refresh.yml")).build;
  const at = (text) => {
    const index = build.indexOf(text);
    assert.notEqual(index, -1, text);
    return index;
  };
  for (const later of ["name: Restore the upstream cache", "id: mirror", "id: pipeline"]) assert.ok(at("id: unit") < at(later), `unit tests run before "${later}"`);
  const steps = [...build.matchAll(/^ {6}- id: (\w+)$/gm)].map((match) => match[1]);
  assert.deepEqual(steps, ["config", "unit", "mirror", "pipeline", "app", "site", "e2e"]);
  assert.deepEqual(STAGES.map(([stage]) => stage).slice(0, steps.length), steps);
});

test("only the deploy jobs can publish, and only with a deploy target on the default branch after a good build", () => {
  const blocks = jobs(read("refresh.yml"));
  const publishing = Object.entries(blocks).filter(([, block]) => /pages: write|deploy-pages|wrangler|CLOUDFLARE_API_TOKEN/.test(block));
  assert.deepEqual(publishing.map(([job]) => job).sort(), ["deploy-cloudflare-workers", "deploy-github-pages"]);
  for (const [job, block] of publishing) {
    const condition = ifOf(block);
    assert.match(condition, /vars\.DEPLOY_TARGET == '(github-pages|cloudflare-workers)'/, job);
    assert.match(condition, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/, job);
    assert.doesNotMatch(condition, /always\(\)|failure\(\)|canceled\(\)/, `${job} must run only after a successful build`);
    assert.match(block, /^ {4}needs: build$/m, job);
  }
});

test("Cloudflare deploys the site as a Worker from the generated configuration, with a pinned Wrangler", () => {
  const text = read("refresh.yml");
  const block = jobs(text)["deploy-cloudflare-workers"];
  assert.doesNotMatch(text, /pages deploy|cloudflare-pages|CLOUDFLARE_PAGES_PROJECT/);
  const version = /WRANGLER_VERSION: "(\d+)\.(\d+)\.(\d+)"/.exec(block);
  assert.ok(version, "Wrangler must be pinned to an exact version");
  const [major, minor] = version.slice(1).map(Number);
  assert.ok(major > 4 || (major === 4 && minor >= 34), "Wrangler 4.34.0 or newer is needed for the 20,000-file limit");
  assert.match(block, /node scripts\/wrangler-config\.mjs --assets "\$RUNNER_TEMP\/site" --out "\$RUNNER_TEMP\/wrangler\.json"/);
  assert.match(block, /wrangler@\$\{WRANGLER_VERSION\}" deploy\s+--config "\$RUNNER_TEMP\/wrangler\.json"/);
  assert.match(block, /permissions:\n {6}contents: read\n(?! {6})/);
  for (const [name, store] of [["CLOUDFLARE_ACCOUNT_ID", "secrets"], ["CLOUDFLARE_WORKER_NAME", "vars"]]) {
    assert.match(block, new RegExp(`${name}: \\$\\{\\{ ${store}\\.${name} \\}\\}`), name);
    assert.match(jobs(text).build, new RegExp(`${name}: \\$\\{\\{ ${store}\\.${name} \\}\\}`), `the switch check must see ${name}`);
  }
});

test("the only secrets are the optional Cloudflare token and account id, the build sees the id in the switch check alone, and the GraphQL token is the workflow's own, read-only", () => {
  const text = read("refresh.yml");
  assert.deepEqual([...new Set(text.match(/secrets\.[A-Z_]+/g))].sort(), ["secrets.CLOUDFLARE_ACCOUNT_ID", "secrets.CLOUDFLARE_API_TOKEN"]);
  const build = jobs(text).build;
  assert.equal(build.match(/secrets\.[A-Z_]+/g).length, 1, "one step of the build reads one secret");
  assert.match(build, /name: Check the switches\n {8}env:\n {10}CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.match(build, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(build, /permissions:\n {6}contents: read\n(?! {6})/);
});

test("package readings run on schedule only when switched on, by hand with a cap of 20, and publish nothing", () => {
  const text = read("package-readings.yml");
  const blocks = jobs(text);
  assert.deepEqual(Object.keys(blocks), ["read"]);
  const block = blocks.read;
  assert.equal(ifOf(block), "github.event_name == 'workflow_dispatch' || vars.PACKAGE_READINGS_ENABLED == 'true'");
  assert.match(text, /workflow_dispatch:\n {4}inputs:\n {6}cap:\n(?: {8}.*\n)*? {8}default: 20\n/);
  assert.match(block, /permissions:\n {6}contents: read\n(?! {6})/);
  assert.match(block, /timeout-minutes: \d+/);
  const code = text.replace(/^\s*#.*$/gm, "");
  assert.doesNotMatch(code, /secrets\.|upload-artifact|deploy|pages|wrangler|gh issue|issues: write/);
  let runIndent = -1;
  for (const line of text.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (runIndent >= 0 && line.trim() && indent <= runIndent) runIndent = -1;
    const run = /^(\s*)run: (.*)$/.exec(line);
    if (run) {
      assert.doesNotMatch(run[2], /\$\{\{/, "expressions reach the shell through env only");
      if (run[2].startsWith("|")) runIndent = run[1].length;
    } else if (runIndent >= 0) {
      assert.doesNotMatch(line, /\$\{\{/, `expressions reach the shell through env only: ${line.trim()}`);
    }
  }
  assert.match(block, /CAP_INPUT: \$\{\{ inputs\.cap \}\}/);
  assert.doesNotMatch(block, /--izzy"?\)?\s*$/m, "IzzyOnDroid is not read unless its variable is true");
  assert.match(block, /if \[ "\$READINGS_IZZY" = "true" \]; then args\+=\(--izzy\); fi/);
  assert.match(block, /if \[ "\$READINGS_CLOSED" = "true" \]; then args\+=\(--closed\); fi/);
  const uses = [...text.matchAll(/uses: (actions\/cache\/(?:restore|save))@/g)].map((match) => match[1]);
  assert.deepEqual(uses, ["actions/cache/restore", "actions/cache/restore", "actions/cache/save"], "the upstream cache is restored, never saved");
  assert.match(block, /name: Save the package readings\n {8}if: always\(\) && steps\.check\.outcome == 'success'\n/);
  assert.match(block, /path: \.package-readings\n {10}key: package-readings-\$\{\{ github\.run_id \}\}\n\s*$/);
});

test("the keep-alive token can only manage workflows", () => {
  const block = jobs(read("refresh.yml")).keepalive;
  assert.match(block, /permissions:\n {6}actions: write(?: #.*)?\n(?! {6})/);
  assert.match(block, /actions\/workflows\/refresh\.yml\/enable/);
});
