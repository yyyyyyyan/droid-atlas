#!/usr/bin/env node
/**
 * The catalog the live site serves: its age, and a verified local copy.
 *
 *   node scripts/live-build.mjs age    --site <url> [--max-age-days 3]
 *   node scripts/live-build.mjs mirror --site <url> --out <data dir> [--bootstrap]
 *
 * `age` exits 1 when the live catalog's `generatedAt` is older than the limit,
 * or when the site serves no catalog at all.
 *
 * `mirror` copies the live build into `--out` the way the pipeline left it on
 * the last good run: `version.json`, the manifest and every file it lists
 * (parts, details shards, upstream snapshots), every icon the atlas names,
 * the license texts the manifest and the pipeline's part headers name (the
 * index parts are `LicenseRef-per-record` but carry AGPL notices whose texts
 * ship beside them), and, where the live site has them, the texts of the
 * licenses `icons.json` records name: a record's license describes the app's
 * project, so its text is shipped when the SPDX list has one and is never
 * required. Each file is
 * checked against the manifest's sha256 (icons against the hash in their
 * name); a mismatch, a missing file or an unexpected path fails. The pipeline
 * then runs with `--previous <data dir>`, compares against exactly what users
 * have, and keeps that build's directory beside the new one so a client still
 * reading it is not left with dead links.
 *
 * The site must serve a catalog unless `--bootstrap` is given, and must not
 * serve one when it is: bootstrapping over a live catalog would discard every
 * permanent id. With `--bootstrap`, a host that has no address yet counts as
 * serving none: a first deploy to Cloudflare Workers is what creates the
 * site's DNS record. Any other failure to reach the site still stops the run.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { HEADER_LICENSES } from "../pipeline/split.ts";
import { sha256 } from "./lib/files.mjs";
import { HttpError, getBytes, mapLimit } from "./lib/http.mjs";

const MANIFEST_RE = /^c\/[0-9a-f]{16}\/manifest\.json$/;
const PART_RE = /^(?:[a-z0-9_-]+\/)*[a-z0-9_.-]+\.json$/;
const UPSTREAM_RE = /^\.\.\/\.\.\/upstream\/[a-z0-9-]+\/[0-9a-f]{40}(?:\.md|\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+)$/;
const ICON_RE = /^icons\/([0-9a-f]{16})\.webp$/;
const LICENSE_ID_RE = /^[A-Za-z0-9.+-]+$/;
const DAY_MS = 86_400_000;

/** `<site>/data/` as a URL, whatever the trailing slashes. */
export function dataRoot(site) {
  const url = new URL(site);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`--site must be http(s): ${site}`);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/data/`;
  url.search = "";
  url.hash = "";
  return url;
}

function parseJson(bytes, what) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error(`${what} is not JSON`);
  }
}

/** Reads and checks `version.json`; null when the site has none (404). */
export async function readVersion(root, options = {}) {
  let bytes;
  try {
    bytes = await getBytes(new URL("version.json", root).href, options);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
  const version = parseJson(bytes, "version.json");
  if (typeof version?.manifest !== "string" || !MANIFEST_RE.test(version.manifest)) {
    throw new Error(`version.json names an unexpected manifest: ${JSON.stringify(version?.manifest)}`);
  }
  if (!Number.isFinite(Date.parse(version.generatedAt))) throw new Error("version.json has no valid generatedAt");
  return { version, bytes };
}

/** Age check. Returns the outcome rather than exiting, so it can be tested. */
export async function checkAge(site, maxAgeDays, { now = new Date(), ...options } = {}) {
  const live = await readVersion(dataRoot(site), options);
  if (!live) return { ok: false, message: `${dataRoot(site).href}version.json: the site serves no catalog` };
  const ageDays = (now.getTime() - Date.parse(live.version.generatedAt)) / DAY_MS;
  const generatedAt = live.version.generatedAt;
  const ok = ageDays <= maxAgeDays;
  const message = ok
    ? `live catalog generated ${generatedAt} (${ageDays.toFixed(1)} days old; limit ${maxAgeDays})`
    : `live catalog is stale: generated ${generatedAt}, ${ageDays.toFixed(1)} days old (limit ${maxAgeDays})`;
  return { ok, message, generatedAt, ageDays };
}

function plainLicenseIds(ids) {
  return [...new Set(ids)].filter((id) => LICENSE_ID_RE.test(id) && id !== "NOASSERTION" && !id.startsWith("LicenseRef-")).sort();
}

function write(out, path, bytes) {
  const target = resolve(out, path);
  if (!target.startsWith(`${resolve(out)}/`)) throw new Error(`refusing to write outside ${out}: ${path}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

/** True when a request failed because the host's name resolves to no address. */
function hostHasNoAddress(error) {
  return error?.cause?.code === "ENOTFOUND";
}

/**
 * Mirrors the live build into `out`, which is emptied first. Returns a
 * summary, or `{ bootstrap: true }` when bootstrapping a site with no catalog.
 */
export async function mirror(site, out, { bootstrap = false, concurrency = 8, ...options } = {}) {
  const root = dataRoot(site);
  let live = null;
  try {
    live = await readVersion(root, options);
  } catch (error) {
    if (!bootstrap || !hostHasNoAddress(error)) throw error;
  }
  if (bootstrap) {
    if (live) throw new Error(`--bootstrap, but ${root.href}version.json exists (generated ${live.version.generatedAt}): bootstrapping would discard every permanent id`);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    return { bootstrap: true, files: 0 };
  }
  if (!live) throw new Error(`${root.href}version.json: the site serves no catalog; the first build needs --bootstrap`);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const buildDir = live.version.manifest.slice(0, -"manifest.json".length);
  const manifestBytes = await getBytes(new URL(live.version.manifest, root).href, options);
  const manifest = parseJson(manifestBytes, live.version.manifest);
  if (manifest.hash !== live.version.hash) throw new Error("the manifest's hash differs from version.json's");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("the manifest lists no files");
  write(out, live.version.manifest, manifestBytes);

  const files = manifest.files.map((file) => {
    const valid = file.role === "upstream" ? UPSTREAM_RE.test(file.path) : PART_RE.test(file.path) && !file.path.includes("..");
    if (!valid || !/^[0-9a-f]{64}$/.test(file.sha256 ?? "")) throw new Error(`the manifest lists an unexpected file: ${JSON.stringify(file.path)}`);
    return { ...file, local: new URL(file.path, new URL(buildDir, root)).href.slice(root.href.length) };
  });
  const contents = new Map();
  await mapLimit(files, concurrency, async (file) => {
    const bytes = await getBytes(new URL(file.local, root).href, options);
    if (sha256(bytes) !== file.sha256) throw new Error(`${file.local} does not match the manifest's sha256`);
    contents.set(file.local, bytes);
    write(out, file.local, bytes);
  });

  const atlasFile = files.find((f) => f.role === "atlas");
  const iconsFile = files.find((f) => f.role === "icons");
  if (!atlasFile || !iconsFile) throw new Error("the manifest lists no atlas or icons part");
  const atlas = parseJson(contents.get(atlasFile.local), atlasFile.local);
  const iconRecords = parseJson(contents.get(iconsFile.local), iconsFile.local).icons ?? [];
  const icons = [...new Set((atlas.apps ?? []).flatMap((app) => [app.icon, app.iconLarge]).filter((icon) => icon !== null && icon !== undefined))].sort();
  await mapLimit(icons, concurrency, async (icon) => {
    const match = ICON_RE.exec(icon);
    if (!match) throw new Error(`the atlas names an unexpected icon path: ${JSON.stringify(icon)}`);
    const bytes = await getBytes(new URL(icon, root).href, options);
    if (!sha256(bytes).startsWith(match[1])) throw new Error(`${icon} does not match the hash in its name`);
    write(out, icon, bytes);
  });

  const required = plainLicenseIds([...HEADER_LICENSES, ...files.map((f) => f.license)]);
  await mapLimit(required, concurrency, async (id) => {
    write(out, `licenses/${id}.txt`, await getBytes(new URL(`licenses/${id}.txt`, root).href, options));
  });
  const described = plainLicenseIds(iconRecords.flatMap((r) => (typeof r.license === "string" ? r.license.split(/[()\s]+/) : []))).filter((id) => !required.includes(id));
  const mirrored = await mapLimit(described, concurrency, async (id) => {
    try {
      write(out, `licenses/${id}.txt`, await getBytes(new URL(`licenses/${id}.txt`, root).href, options));
      return true;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return false;
      throw error;
    }
  });

  write(out, "version.json", live.bytes);
  return { bootstrap: false, generatedAt: live.version.generatedAt, hash: live.version.hash, files: files.length, icons: icons.length, licenses: required.length + mirrored.filter(Boolean).length };
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      site: { type: "string" },
      out: { type: "string" },
      bootstrap: { type: "boolean", default: false },
      "max-age-days": { type: "string", default: "3" },
    },
  });
  const [command] = positionals;
  if (!values.site || (command !== "age" && command !== "mirror") || (command === "mirror" && !values.out)) {
    process.stderr.write("usage: live-build.mjs age --site <url> [--max-age-days 3]\n       live-build.mjs mirror --site <url> --out <dir> [--bootstrap]\n");
    return 2;
  }
  if (command === "age") {
    const result = await checkAge(values.site, Number(values["max-age-days"]));
    process.stdout.write(`${result.message}\n`);
    return result.ok ? 0 : 1;
  }
  const summary = await mirror(values.site, values.out, { bootstrap: values.bootstrap });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
