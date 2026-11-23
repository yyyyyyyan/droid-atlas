/**
 * The package readings job, as the package-readings workflow runs it: reads
 * the package files no earlier run has read, keeps the readings in one JSON
 * file, and prints counts only.
 *
 *   node pipeline/scripts/package-readings.ts --catalog <data dir, version.json or URL> --store <file>
 *       [--cache <dir>] [--cap <n>] [--izzy] [--closed] [--stop-after-minutes <n>] [--summary <file>]
 *   node pipeline/scripts/package-readings.ts --check <file>
 *
 * The catalog is a built one, read as the build reads its previous build. The
 * F-Droid index comes from the upstream cache (`<cache>/fdroid-index-v2.json`);
 * without it, F-Droid apps are skipped. `--izzy` and `--closed` are the two
 * switches, both off unless given. `--check` exits 0 only for a store file
 * that loads with every entry intact.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { JOB_DEFAULTS, runJob, summary } from "../apk/job.ts";
import { systemClock } from "../apk/pace.ts";
import { checkStore, loadStore, saveStore } from "../apk/store.ts";
import { loadPrevious } from "../validate.ts";

const { values } = parseArgs({
  options: {
    catalog: { type: "string" },
    store: { type: "string" },
    cache: { type: "string", default: ".cache" },
    cap: { type: "string", default: String(JOB_DEFAULTS.cap) },
    izzy: { type: "boolean", default: false },
    closed: { type: "boolean", default: false },
    "stop-after-minutes": { type: "string", default: String(JOB_DEFAULTS.stopAfterMs / 60_000) },
    summary: { type: "string" },
    check: { type: "string" },
  },
});

if (values.check !== undefined) {
  const loaded = loadStore(values.check);
  const ok = loaded.status === "read" && loaded.dropped === 0 && checkStore(loaded.store) === 0;
  console.log(ok ? "package readings: store passes its check" : `package readings: store fails its check (${loaded.status}, ${loaded.dropped} bad entries)`);
  process.exit(ok ? 0 : 1);
}

function wholeNumber(text: string, name: string, max: number): number {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0 || value > max) throw new Error(`--${name} must be a whole number from 0 to ${max}`);
  return value;
}

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

if (!values.catalog || !values.store) {
  console.error("usage: node pipeline/scripts/package-readings.ts --catalog <data dir, version.json or URL> --store <file> [options]");
  process.exit(2);
}
const storePath = values.store;
const cap = wholeNumber(values.cap, "cap", 2000);
const stopAfterMs = wholeNumber(values["stop-after-minutes"], "stop-after-minutes", 360) * 60_000;

const { catalog } = await loadPrevious(values.catalog);
const loaded = loadStore(storePath);
mkdirSync(dirname(storePath), { recursive: true });
const counts = await runJob(
  {
    catalog,
    fdroidIndex: readJson(join(values.cache, "fdroid-index-v2.json")),
    izzyIndex: values.izzy ? readJson(join(values.cache, "izzy-index-v2.json")) : null,
  },
  loaded.store,
  {
    ...JOB_DEFAULTS,
    cap,
    stopAfterMs,
    izzy: values.izzy,
    closed: values.closed,
    fetch,
    githubToken: process.env["GITHUB_TOKEN"] || null,
    clock: systemClock,
    onProgress: (store) => saveStore(storePath, store),
  },
);
counts.dropped += loaded.dropped;
saveStore(storePath, loaded.store);
const text = summary(counts, loaded.status);
console.log(text);
if (values.summary) appendFileSync(values.summary, `${text}\n`);
