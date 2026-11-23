/**
 * The package readings command (`pipeline/scripts/package-readings.ts`) as a
 * function, so its failures can be tested.
 *
 * Its output is counts and fixed messages only. Every input it reads (the
 * catalog, the index, the store, the arguments) is untrusted, and error
 * messages from parsers and the file system quote their input, so a failure
 * at any stage prints the stage and the error's class and nothing else.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import type { Catalog } from "../../schema/catalog.ts";
import { JOB_DEFAULTS, runJob, summary } from "./job.ts";
import type { Clock } from "./pace.ts";
import { checkStore, loadStore, saveStore } from "./store.ts";

export interface CliDeps {
  loadCatalog(location: string): Promise<Catalog>;
  fetch: typeof fetch;
  clock: Clock;
  env: Readonly<Record<string, string | undefined>>;
  out(line: string): void;
  err(line: string): void;
}

type Stage = "arguments" | "check" | "catalog" | "index" | "store" | "job" | "save" | "summary";

function errorClass(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "error";
}

function wholeNumber(text: string, max: number): number {
  const value = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value > max) throw new RangeError();
  return value;
}

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/** Runs the command; returns the exit status. */
export async function main(argv: string[], deps: CliDeps): Promise<number> {
  let stage: Stage = "arguments";
  try {
    const { values } = parseArgs({
      args: argv,
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
      stage = "check";
      const now = deps.clock.now();
      const loaded = loadStore(values.check, now);
      if (loaded.status !== "read" || loaded.dropped > 0 || checkStore(loaded.store, now) > 0) {
        deps.err(`package readings: stopped at check (store ${loaded.status}, ${loaded.dropped} entries fail the check)`);
        return 1;
      }
      deps.out("package readings: store passes its check");
      return 0;
    }

    if (!values.catalog || !values.store) throw new TypeError();
    const storePath = values.store;
    const cap = wholeNumber(values.cap, 2000);
    const stopAfterMs = wholeNumber(values["stop-after-minutes"], 360) * 60_000;

    stage = "catalog";
    const catalog = await deps.loadCatalog(values.catalog);

    stage = "index";
    const fdroidIndex = readJson(join(values.cache, "fdroid-index-v2.json"));
    const izzyIndex = values.izzy ? readJson(join(values.cache, "izzy-index-v2.json")) : null;

    stage = "store";
    const loaded = loadStore(storePath, deps.clock.now());
    mkdirSync(dirname(storePath), { recursive: true });

    stage = "job";
    const counts = await runJob({ catalog, fdroidIndex, izzyIndex }, loaded.store, {
      ...JOB_DEFAULTS,
      cap,
      stopAfterMs,
      izzy: values.izzy,
      closed: values.closed,
      fetch: deps.fetch,
      githubToken: deps.env["GITHUB_TOKEN"] || null,
      clock: deps.clock,
      onProgress: (store) => saveStore(storePath, store, deps.clock.now()),
    });
    counts.dropped += loaded.dropped;

    stage = "save";
    saveStore(storePath, loaded.store, deps.clock.now());

    stage = "summary";
    const text = summary(counts, loaded.status);
    if (values.summary) appendFileSync(values.summary, `${text}\n`);
    deps.out(text);
    return 0;
  } catch (error) {
    deps.err(`package readings: stopped at ${stage} (${errorClass(error)})`);
    return 1;
  }
}
