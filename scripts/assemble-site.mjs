#!/usr/bin/env node
/**
 * Assembles the deployable site from the app build and checks that it is
 * complete before anything can publish it.
 *
 *   node scripts/assemble-site.mjs --app-dist app/dist --third-party <file> --out site
 *
 * The app build already carries `data/` (Vite copies `app/public/`). Added
 * here: `third-party-licenses.txt` at the root. Then every check below must
 * pass, or the script exits 1 and the directory must not be deployed:
 *
 * - `index.html` and `data/version.json` exist;
 * - every file the current manifest lists exists with its sha256, and so
 *   does every file of the build that `version.json` replaced, when it is
 *   still present (an open client may be reading it);
 * - every icon the atlas names exists, at both sizes;
 * - a license text exists under `data/licenses/` for every license the
 *   manifest names (LICENSING.md §1.2). A license an `icons.json` record
 *   names describes the app's project, not a license a shipped file is under
 *   (§1.3 rule 7), so it requires no text;
 * - the files LICENSING.md §4 requires before a public deploy are present:
 *   `data/licenses/`, the manifest, `icons.json`, `third-party-licenses.txt`;
 * - nothing that must never be published is present (build reports outside
 *   `data/`, environment files, editor or VCS metadata, symbolic links);
 * - the app's JavaScript is within its budget (ARCHITECTURE.md § Budgets).
 */
import { copyFileSync, cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { isSymlink, matchesAny, sha256, walk } from "./lib/files.mjs";

const NEVER = ["**/.env", "**/.env.*", "**/.git/**", "**/.DS_Store", "**/*.log", "**/node_modules/**", "**/.npmrc", "**/*.pem", "**/*.key"];
const LICENSE_ID_RE = /^[A-Za-z0-9.+-]+$/;

/**
 * The App JavaScript budget of ARCHITECTURE.md § Budgets, in kB (1,000
 * bytes, as the build prints sizes) of gzip. The limit is kept here and
 * nowhere else in code; the document states the same number and a test
 * holds the two together.
 */
export const APP_JAVASCRIPT_BUDGET_KB = 85;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function plainLicense(id) {
  return typeof id === "string" && LICENSE_ID_RE.test(id) && id !== "NOASSERTION" && !id.startsWith("LicenseRef-");
}

/** Checks one build directory against its manifest. */
function checkBuild(data, manifestPath, problems) {
  const manifest = readJson(join(data, manifestPath));
  const buildDir = manifestPath.slice(0, -"manifest.json".length);
  const licenses = new Set();
  let atlas = null;
  let icons = null;
  for (const file of manifest.files ?? []) {
    const local = new URL(file.path, `file:///data/${buildDir}`).pathname.slice("/data/".length);
    const path = join(data, local);
    if (!existsSync(path)) {
      problems.push(`data/${local}: listed by ${manifestPath} but missing`);
      continue;
    }
    if (sha256(readFileSync(path)) !== file.sha256) problems.push(`data/${local}: does not match ${manifestPath}`);
    if (plainLicense(file.license)) licenses.add(file.license);
    if (file.role === "atlas") atlas = readJson(path);
    if (file.role === "icons") icons = readJson(path);
  }
  if (!atlas) problems.push(`${manifestPath}: lists no atlas part`);
  if (!icons) problems.push(`${manifestPath}: lists no icons.json`);
  for (const app of atlas?.apps ?? []) {
    for (const icon of new Set([app.icon, app.iconLarge])) if (icon && !existsSync(join(data, icon))) problems.push(`data/${icon}: named by the atlas but missing`);
  }
  for (const id of licenses) {
    if (!existsSync(join(data, "licenses", `${id}.txt`))) problems.push(`data/licenses/${id}.txt: ${manifestPath} names ${id} but its text is missing`);
  }
}

/**
 * A release build must say where the project lives: the atlas part's header is
 * what the Sources page and the license notices show, and the pipeline's
 * default for it is a placeholder under `.invalid`.
 */
function checkProjectAddress(data, manifestPath, problems) {
  const manifest = readJson(join(data, manifestPath));
  const atlasFile = (manifest.files ?? []).find((file) => file.role === "atlas");
  if (!atlasFile) return;
  const atlasPath = join(data, manifestPath.slice(0, -"manifest.json".length), atlasFile.path);
  if (!existsSync(atlasPath)) return;
  const address = readJson(atlasPath).header?.source?.url;
  if (typeof address !== "string" || /\.invalid\/?$/.test(address)) {
    problems.push(`data/${manifestPath}: the atlas part names no project address; build the data with --project-url`);
  }
}

/**
 * Gzip size, in kB, of the JavaScript the app loads: every script under
 * `assets/`, each compressed on its own as a host serves it. Source maps and
 * the service worker at the root are not part of it. The measure is zlib at
 * its default level; the bundler's own report compresses otherwise and
 * prints about one percent more for the same file.
 */
export function appJavaScriptKb(site) {
  const scripts = walk(site).filter((file) => /^assets\/.*\.js$/.test(file) && !isSymlink(join(site, file)));
  return scripts.reduce((bytes, file) => bytes + gzipSync(readFileSync(join(site, file))).length, 0) / 1000;
}

/** Every problem that makes `site` unfit to publish; empty when it is fit. */
export function checkSite(site) {
  const problems = [];
  const files = walk(site);
  for (const required of ["index.html", "third-party-licenses.txt", "data/version.json"]) {
    if (!files.includes(required)) problems.push(`${required}: missing`);
  }
  for (const file of files) {
    if (isSymlink(join(site, file))) problems.push(`${file}: symbolic link`);
    if (matchesAny(file, NEVER)) problems.push(`${file}: must never be published`);
    if (/(^|\/)report\.(json|md)$/.test(file) && file !== "data/report.json" && file !== "data/report.md") problems.push(`${file}: a build report outside data/`);
  }
  const javaScript = appJavaScriptKb(site);
  if (javaScript > APP_JAVASCRIPT_BUDGET_KB) {
    problems.push(`assets/: the app's JavaScript is ${javaScript.toFixed(2)} kB gzip, over its budget of ${APP_JAVASCRIPT_BUDGET_KB} kB`);
  }
  if (!files.includes("data/version.json")) return problems;

  const data = join(site, "data");
  const version = readJson(join(data, "version.json"));
  if (typeof version.manifest !== "string" || !/^c\/[0-9a-f]{16}\/manifest\.json$/.test(version.manifest)) {
    problems.push("data/version.json: names no valid manifest");
    return problems;
  }
  if (!existsSync(join(data, version.manifest))) {
    problems.push(`data/${version.manifest}: named by version.json but missing`);
    return problems;
  }
  checkBuild(data, version.manifest, problems);
  if (process.env.DROID_ATLAS_RELEASE === "1") checkProjectAddress(data, version.manifest, problems);
  for (const other of files.filter((f) => /^data\/c\/[0-9a-f]{16}\/manifest\.json$/.test(f) && f !== `data/${version.manifest}`)) {
    checkBuild(data, other.slice("data/".length), problems);
  }
  if (!files.some((f) => f.startsWith("data/licenses/"))) problems.push("data/licenses/: empty");
  return problems;
}

/** Copies the app build into `out` (emptied first) with the third-party notice, then checks it. */
export function assembleSite({ appDist, thirdParty, out }) {
  if (!existsSync(join(appDist, "index.html"))) throw new Error(`${appDist}: no index.html; build the app first`);
  rmSync(out, { recursive: true, force: true });
  cpSync(appDist, out, { recursive: true, verbatimSymlinks: true });
  copyFileSync(thirdParty, join(out, "third-party-licenses.txt"));
  return checkSite(out);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { "app-dist": { type: "string" }, "third-party": { type: "string" }, out: { type: "string" }, "check-only": { type: "string" } },
  });
  let problems;
  let site;
  if (values["check-only"]) {
    site = resolve(values["check-only"]);
    problems = checkSite(site);
  } else if (values["app-dist"] && values["third-party"] && values.out) {
    site = values.out;
    problems = assembleSite({ appDist: values["app-dist"], thirdParty: values["third-party"], out: site });
  } else {
    process.stderr.write("usage: assemble-site.mjs --app-dist <dir> --third-party <file> --out <dir>\n       assemble-site.mjs --check-only <site dir>\n");
    process.exit(2);
  }
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.stderr.write(`app JavaScript: ${appJavaScriptKb(site).toFixed(2)} kB gzip of ${APP_JAVASCRIPT_BUDGET_KB} kB\n`);
  process.stderr.write(problems.length ? `site is not fit to publish: ${problems.length} problem(s)\n` : "site complete\n");
  process.exitCode = problems.length ? 1 : 0;
}
