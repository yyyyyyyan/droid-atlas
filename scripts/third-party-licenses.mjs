#!/usr/bin/env node
/**
 * Generates `third-party-licenses.txt` for the npm packages the app ships,
 * and fails when one is under a license that is unknown or not allowed.
 *
 *   node scripts/third-party-licenses.mjs --filter ./app --dist app/dist --out <file>
 *
 * The shipped set is the package's production dependency closure, as
 * `pnpm licenses list --prod` reports it (this includes the self-hosted
 * fonts). With `--dist`, the build's source maps are read as well, and any
 * package bundled into the JavaScript that is not in that closure fails the
 * run: a dependency declared as a devDependency but imported by the app
 * would otherwise ship without a notice.
 *
 * Each package's own license file is copied verbatim; a package without one
 * is listed with the license its `package.json` declares.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { walk } from "./lib/files.mjs";

/**
 * Licenses a shipped dependency may carry: permissive licenses compatible
 * with GPL-3.0-or-later, and OFL-1.1 for fonts. Anything else needs a
 * decision, so it fails the build instead of shipping quietly.
 */
export const ALLOWED = ["0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "ISC", "MIT", "OFL-1.1", "Unlicense", "Zlib"];

const LICENSE_FILE_RE = /^(licen[cs]e|copying|ofl)(\.(md|txt|markdown))?$/i;

/**
 * True when an SPDX expression is satisfiable from `allowed`: every `AND`
 * term must be allowed, and at least one alternative of each `OR`.
 * Unparsable input is not allowed.
 */
export function licenseAllowed(expression, allowed = ALLOWED) {
  if (typeof expression !== "string" || !expression.trim()) return false;
  const tokens = expression.replace(/[()]/g, " $& ").trim().split(/\s+/);
  let position = 0;
  const peek = () => tokens[position];
  const primary = () => {
    const token = tokens[position++];
    if (token === "(") {
      const value = or();
      if (tokens[position++] !== ")") throw new Error("unbalanced");
      return value;
    }
    if (!token || ["AND", "OR", ")", "WITH"].includes(token)) throw new Error("unexpected token");
    if (peek() === "WITH") throw new Error("exceptions are not allowed");
    return allowed.includes(token);
  };
  const and = () => {
    let value = primary();
    while (peek() === "AND") {
      position++;
      value = primary() && value;
    }
    return value;
  };
  const or = () => {
    let value = and();
    while (peek() === "OR") {
      position++;
      value = and() || value;
    }
    return value;
  };
  try {
    const value = or();
    return position === tokens.length && value;
  } catch {
    return false;
  }
}

/** Flattens `pnpm licenses list --json` output into one record per package version. */
export function packagesFrom(report) {
  const packages = [];
  for (const [group, entries] of Object.entries(report)) {
    for (const entry of entries) {
      entry.versions.forEach((version, i) => {
        packages.push({
          name: entry.name,
          version,
          license: entry.license ?? group,
          path: entry.paths?.[i] ?? entry.paths?.[0] ?? null,
          homepage: entry.homepage ?? null,
          author: entry.author ?? null,
        });
      });
    }
  }
  return packages.sort((a, b) => (a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1));
}

/** npm package names that appear in the build's source maps. */
export function bundledPackages(dist) {
  const names = new Set();
  for (const file of walk(dist).filter((f) => f.endsWith(".map"))) {
    const map = JSON.parse(readFileSync(join(dist, file), "utf8"));
    for (const source of map.sources ?? []) {
      const at = source.lastIndexOf("node_modules/");
      if (at === -1) continue;
      const rest = source.slice(at + "node_modules/".length).split("/");
      const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

function licenseText(path) {
  if (!path || !existsSync(path)) return null;
  const file = readdirSync(path).filter((name) => LICENSE_FILE_RE.test(name)).sort()[0];
  return file ? readFileSync(join(path, file), "utf8").trim() : null;
}

/** Problems and the notice text for a set of packages. */
export function buildNotice(packages, { bundled = [], allowed = ALLOWED } = {}) {
  const problems = [];
  for (const pkg of packages) {
    if (!licenseAllowed(pkg.license, allowed)) problems.push(`${pkg.name}@${pkg.version}: license ${JSON.stringify(pkg.license)} is unknown or not on the allowlist`);
  }
  const shipped = new Set(packages.map((p) => p.name));
  for (const name of bundled) {
    if (!shipped.has(name)) problems.push(`${name}: bundled into the JavaScript but not a production dependency, so it has no notice`);
  }
  const blocks = packages.map((pkg) => {
    const text = licenseText(pkg.path);
    const head = [`${pkg.name} ${pkg.version}`, `License: ${pkg.license}`];
    if (pkg.homepage) head.push(`Homepage: ${pkg.homepage}`);
    return [...head, "", text ?? `The package ships no license file; its package.json declares ${pkg.license}.`].join("\n");
  });
  const rule = "=".repeat(78);
  const text = [
    "Third-party software shipped with this site",
    "",
    "The site's own code is GPL-3.0-or-later; the catalog data is under its",
    "sources' licenses (see data/licenses/ and the Sources page). The packages",
    "below are bundled into the site's JavaScript or served from it (fonts).",
    "",
    ...blocks.flatMap((block) => [rule, block, ""]),
  ].join("\n");
  return { problems, text };
}

function pnpmLicenses(filter) {
  const output = execFileSync("pnpm", ["licenses", "list", "--json", "--prod", "--filter", filter], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(output.trim() || "{}");
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { filter: { type: "string" }, dist: { type: "string" }, out: { type: "string" } } });
  if (!values.filter || !values.out) {
    process.stderr.write("usage: third-party-licenses.mjs --filter <package> [--dist <dir>] --out <file>\n");
    process.exit(2);
  }
  const packages = packagesFrom(pnpmLicenses(values.filter));
  const bundled = values.dist ? bundledPackages(values.dist) : [];
  const { problems, text } = buildNotice(packages, { bundled });
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  if (problems.length) {
    process.stderr.write("third-party licenses: refused; extend the allowlist only with a recorded decision\n");
    process.exitCode = 1;
  } else {
    writeFileSync(values.out, text);
    process.stderr.write(`third-party licenses: ${packages.length} packages written to ${values.out}\n`);
  }
}
