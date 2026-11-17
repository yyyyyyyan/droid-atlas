/**
 * The planted examples are assembled from pieces at run time, so that no file
 * in the repository contains a credential-shaped string or a private address
 * (the scanner would rightly flag its own tests, and so would push-time secret
 * scanning).
 */
import assert from "node:assert/strict";
import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { allowed, readDenyList, scanTree } from "../leak-scan.mjs";
import { tempDir, writeTree } from "./helpers.mjs";

const at = "@";
const dot = ".";

/** One planted example per class and shape: [class, file, content]. */
const PLANTED = [
  ["home-path", "docs/home-linux.md", `Built in /${"home"}/alice/src/atlas.`],
  ["home-path", "docs/home-mac.md", `See /${"Users"}/alice/Projects for the clone.`],
  ["home-path", "docs/home-windows.md", `Copied to C:\\${"Users"}\\alice\\atlas.`],
  ["private-ip", "docs/ip-10.md", `Server at ${["10", "1", "2", "3"].join(dot)}.`],
  ["private-ip", "docs/ip-172.md", `Server at ${["172", "20", "0", "9"].join(dot)}.`],
  ["private-ip", "docs/ip-192.md", `Server at ${["192", "168", "1", "20"].join(dot)}.`],
  ["private-ip", "docs/ip-cgnat.md", `Tailnet peer ${["100", "101", "7", "8"].join(dot)}.`],
  ["private-ip", "docs/ip-tailscale6.md", `Address ${"fd7a"}:115c:a1e0::1.`],
  ["tailnet", "docs/tailnet.md", `Open https://box.tail1234${dot}ts${dot}net:8443/.`],
  ["email", "docs/email.md", `Mail alice${at}mail-provider${dot}com about it.`],
  ["device", "docs/adb.md", `Run ${"adb"} -s R5CT20ABCDE shell.`],
  ["device", "docs/emulator.md", `Device ${"emulator"}-5554 attached.`],
  ["device", "docs/serialno.md", `getprop ro${dot}serialno`],
  ["device", "docs/mac.md", `Wi-Fi ${["a4", "c3", "f0", "85", "ac", "2d"].join(":")}.`],
  ["device", "docs/imei.md", `IMEI ${"35" + "2099001761481"}.`],
  ["device", "docs/model.md", `Tested on an ${"SM"}-G991B.`],
  ["deny-list", "docs/deny.md", "Notes from Hostbox about the release."],
  ["session", "docs/uuid.md", `Session ${["4f6c2a10", "9b3e", "4c1d", "8e2f", "0a1b2c3d4e5f"].join("-")}.`],
  ["session", "docs/resume.md", `Continue with ${"claude"} --resume.`],
  ["session", "docs/agent.md", `${"agentId"}: abc123`],
  ["session", "docs/coauthor.md", `fix: thing\n\n${"Co-Authored-By"}: someone`],
  ["session", "docs/config-path.md", `Read ~/.${"claude"}/settings.json first.`],
  ["token", "docs/gh.md", `token ${"gh" + "p_"}${"a1B2".repeat(9)}`],
  ["token", "docs/aws.md", `key ${"AK" + "IA"}${"ABCDEFGH23456789"}`],
  ["token", "docs/pem.md", `${"-----BEGIN"} RSA PRIVATE KEY${"-----"}\nMIIE`],
  ["token", "docs/jwt.md", `${"ey" + "J"}hbGciOiJIUzI1NiJ9.${"ey" + "J"}zdWIiOiIxMjM0NTYifQ.abcdefghijklmnop`],
  ["token", "docs/bearer.md", `Authorization: ${"Bear" + "er"} abcdefghijklmnopqrstuvwxyz0123`],
  ["token", "docs/sk.md", `export KEY=${"sk" + "-ant-"}${"x1y2".repeat(8)}`],
];

const CLEAN = {
  "README.md": [
    "Run the dev server on http://127.0.0.1:4320/ and open https://example.org/.",
    `Mail contact${at}example${dot}org or the reserved ${"user"}${at}atlas${dot}invalid.`,
    "Install pnpm@12.19.0 and @preact/signals; pin actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1.",
    "Clone git@github.com:owner/repo.git. A longer word that contains a deny term: hostboxes.",
    "Version 10.4 and sha 1a2b3c4d. A timestamp 1794404913394 is thirteen digits.",
    "Commits use ID+USERNAME@users.noreply.github.com.",
  ].join("\n"),
};

function denyFile(t) {
  const path = join(tempDir(t), "deny.txt");
  writeFileSync(path, "# private terms\nHostbox\nre:\\bwp-\\d+\\b\n");
  return readDenyList(path);
}

test("every planted example is caught, by its own class", (t) => {
  const root = tempDir(t);
  writeTree(root, Object.fromEntries(PLANTED.map(([, file, content]) => [file, content])));
  const { findings } = scanTree(root, { deny: denyFile(t) });
  for (const [cls, file] of PLANTED) {
    assert.ok(
      findings.some((f) => f.path === file && f.cls === cls),
      `${cls} not caught in ${file}: ${JSON.stringify(findings.filter((f) => f.path === file))}`,
    );
  }
  const classes = new Set(PLANTED.map(([cls]) => cls));
  assert.deepEqual([...classes].sort(), ["deny-list", "device", "email", "home-path", "private-ip", "session", "tailnet", "token"]);
});

test("ordinary text produces no finding", (t) => {
  const root = tempDir(t);
  writeTree(root, CLEAN);
  assert.deepEqual(scanTree(root, { deny: denyFile(t) }).findings, []);
});

test("file names are scanned as well as contents", (t) => {
  const root = tempDir(t);
  writeTree(root, { [`shots/${"SM"}-S911B-home.png.txt`]: "", [`logs/${["9f1c2a10", "1b3e", "4c1d", "8e2f", "0a1b2c3d4e5f"].join("-")}.jsonl`]: "" });
  const classes = scanTree(root).findings.map((f) => `${f.cls}:${f.line}`).sort();
  assert.deepEqual(classes, ["device:0", "session:0"]);
});

test("with an allowlist, a file it does not cover is a finding, and excludes win over includes", (t) => {
  const config = { include: ["docs/**", "README.md"], exclude: ["docs/private/**"] };
  assert.equal(allowed("docs/a.md", config), true);
  assert.equal(allowed("docs/private/b.md", config), false);
  assert.equal(allowed("notes.md", config), false);
  const root = tempDir(t);
  writeTree(root, { "README.md": "fine", "docs/private/b.md": "fine", "stray.txt": "fine" });
  const findings = scanTree(root, { config }).findings.filter((f) => f.cls === "not-allowed").map((f) => f.path);
  assert.deepEqual(findings, ["docs/private/b.md", "stray.txt"]);
});

test("a reviewed exception covers exactly one path, class and match", (t) => {
  const ip = ["192", "168", "0", "1"].join(dot);
  const other = ["192", "168", "0", "2"].join(dot);
  const root = tempDir(t);
  writeTree(root, { "docs/a.md": `${ip} and ${other}`, "docs/b.md": ip });
  const config = { include: ["docs/**"], allowFindings: [{ path: "docs/a.md", class: "private-ip", match: ip, reason: "example" }] };
  const left = scanTree(root, { config }).findings.map((f) => `${f.path} ${f.match}`).sort();
  assert.deepEqual(left, [`docs/a.md ${other}`, `docs/b.md ${ip}`]);
});

test("documented public contacts are allowed; other addresses are not", (t) => {
  const root = tempDir(t);
  writeTree(root, { "NOTICE.md": `Write to atlas${at}project-domain${dot}org or bob${at}project-domain${dot}org.` });
  const config = { include: ["**"], publicContacts: [`atlas${at}project-domain${dot}org`] };
  assert.deepEqual(scanTree(root, { config }).findings.map((f) => f.match), [`bob${at}project-domain${dot}org`]);
});

test("site mode skips data except the build reports, and skips e-mail", (t) => {
  const root = tempDir(t);
  writeTree(root, {
    "index.html": `<p>${["10", "0", "0", "7"].join(dot)}</p>`,
    "third-party-licenses.txt": `Copyright Jane <jane${at}mail-provider${dot}com>`,
    "data/c/0123456789abcdef/sources/fdroid.json": `{"summary": "connects to ${["192", "168", "1", "1"].join(dot)}"}`,
    "data/report.json": `{"previous": "/${"home"}/alice/atlas/app/public/data"}`,
  });
  const found = scanTree(root, { site: true }).findings.map((f) => `${f.cls} ${f.path}`).sort();
  assert.deepEqual(found, ["home-path data/report.json", "private-ip index.html"]);
});

test("in a site's build reports a UUID inside a web address is not a finding; anywhere else it is", (t) => {
  const uuid = (first) => [first, "9b3e", "4c1d", "8e2f", "0a1b2c3d4e5f"].join("-");
  const [quoted, bare, spaced, local, linked, elsewhere] = ["1f6c2a10", "2f6c2a10", "3f6c2a10", "5f6c2a10", "6f6c2a10", "7f6c2a10"].map(uuid);
  const address = (id) => `https://github.com/user-attachments/assets/${id}`;
  const root = tempDir(t);
  writeTree(root, {
    "data/report.md": [
      `| github-owner-app | ${address(quoted)} | request budget for this run is spent |`,
      `| github-owner-app | https://example.org/icons ${spaced} | a UUID after an address, not in it |`,
      `Built in session ${bare}.`,
      `Cache at file:///var/tmp/${local}/icons.`,
    ].join("\n"),
    "data/report.json": JSON.stringify({ icons: [{ url: address(quoted) }, { url: `http://example.org/a?b=${quoted}&c=1` }], run: bare, page: `https://${"claude"}.ai/code/${linked}` }, null, 2),
    "index.html": `<a href="${address(elsewhere)}">icon</a>`,
  });
  const found = scanTree(root, { site: true }).findings.map((f) => `${f.path} ${f.match}`).sort();
  assert.deepEqual(found, [
    `data/report.json ${"claude"}.ai/code/`,
    `data/report.json ${bare}`,
    `data/report.md ${bare}`,
    `data/report.md ${local}`,
    `data/report.md ${spaced}`,
    `index.html ${elsewhere}`,
  ].sort());
});

test("a source tree's UUIDs are findings inside a web address too, also in a file named like a build report", (t) => {
  const id = ["4f6c2a10", "9b3e", "4c1d", "8e2f", "0a1b2c3d4e5f"].join("-");
  const root = tempDir(t);
  writeTree(root, { "docs/a.md": `See https://github.com/user-attachments/assets/${id}.`, "data/report.md": `| app | https://github.com/user-attachments/assets/${id} |` });
  assert.deepEqual(scanTree(root).findings.map((f) => `${f.cls} ${f.path}`).sort(), ["session data/report.md", "session docs/a.md"]);
});

test("symbolic links are reported as files, not followed", (t) => {
  const root = tempDir(t);
  writeTree(root, { "a.md": "fine" });
  symlinkSync("a.md", join(root, "b.md"));
  assert.deepEqual(scanTree(root).findings, []);
});

test("the deny-list matches whole words in any case and supports regular expressions", (t) => {
  const deny = denyFile(t);
  const root = tempDir(t);
  writeTree(root, { "a.md": "HOSTBOX, hostboxes, wp-12, swp-12x" });
  assert.deepEqual(scanTree(root, { deny }).findings.map((f) => f.match), ["HOSTBOX", "wp-12"]);
});
