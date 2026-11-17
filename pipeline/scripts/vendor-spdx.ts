/**
 * Refreshes the pinned SPDX license-list metadata in `pipeline/spdx/` from
 * spdx/license-list-data at a tag, read through the GitHub GraphQL API.
 *
 *   node scripts/vendor-spdx.ts v3.29.0
 *
 * Only identifiers and the flags the icon policy needs are kept. License texts
 * are fetched by the build as they are needed (see `lib/spdx.ts`).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { githubToken } from "../enrich/github.ts";
import { readSpdxBlob } from "../lib/spdx.ts";

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+(\.\d+)?$/.test(tag)) throw new Error("usage: node scripts/vendor-spdx.ts v3.29.0");
const token = githubToken();
const licenses = JSON.parse(await readSpdxBlob(`${tag}:json/licenses.json`, token)) as {
  licenseListVersion: string;
  releaseDate: string;
  licenses: { licenseId: string; isOsiApproved?: boolean; isFsfLibre?: boolean; isDeprecatedLicenseId?: boolean }[];
};
const exceptions = JSON.parse(await readSpdxBlob(`${tag}:json/exceptions.json`, token)) as {
  exceptions: { licenseExceptionId: string; isDeprecatedLicenseId?: boolean }[];
};
const out = {
  licenseListVersion: licenses.licenseListVersion,
  releaseDate: licenses.releaseDate,
  tag,
  licenses: Object.fromEntries(
    licenses.licenses
      .map((l) => [l.licenseId, { osi: Boolean(l.isOsiApproved), fsf: Boolean(l.isFsfLibre), deprecated: Boolean(l.isDeprecatedLicenseId) }] as const)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  ),
  exceptions: exceptions.exceptions
    .filter((e) => !e.isDeprecatedLicenseId)
    .map((e) => e.licenseExceptionId)
    .sort(),
};
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "spdx", "licenses.json");
writeFileSync(target, `${JSON.stringify(out, null, 1)}\n`);
process.stderr.write(`wrote ${Object.keys(out.licenses).length} licenses and ${out.exceptions.length} exceptions (${out.licenseListVersion})\n`);
