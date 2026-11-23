/**
 * The package readings job, as the package-readings workflow runs it: reads
 * the package files no earlier run has read, keeps the readings in one JSON
 * file, and prints counts only (`pipeline/apk/cli.ts`).
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
import { main } from "../apk/cli.ts";
import { systemClock } from "../apk/pace.ts";
import { loadPrevious } from "../validate.ts";

process.exitCode = await main(process.argv.slice(2), {
  loadCatalog: async (location) => (await loadPrevious(location)).catalog,
  fetch,
  clock: systemClock,
  env: process.env,
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
