/**
 * Reads one package by address and prints the reading as JSON, for checking
 * the reader by hand. Only F-Droid and GitHub release addresses are accepted.
 *
 *   node pipeline/scripts/read-package.ts <package address> [--sha256 <hex>]
 *
 * `--sha256` records the whole file's hash as its index or release states it;
 * the reader never downloads enough of the file to compute it.
 */
import { parseArgs } from "node:util";
import { PackageReadError, readPackage } from "../apk/read.ts";

const { values, positionals } = parseArgs({ options: { sha256: { type: "string" } }, allowPositionals: true });
const [address] = positionals;
if (!address || positionals.length !== 1) {
  console.error("usage: node pipeline/scripts/read-package.ts <package address> [--sha256 <hex>]");
  process.exit(2);
}
try {
  const reading = await readPackage(address, { sha256: values.sha256 ?? null });
  console.log(JSON.stringify(reading, null, 2));
} catch (error) {
  if (!(error instanceof PackageReadError)) throw error;
  console.error(`not read (${error.stage}): ${error.message}`);
  process.exit(1);
}
