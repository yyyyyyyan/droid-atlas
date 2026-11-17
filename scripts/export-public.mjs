#!/usr/bin/env node
/**
 * Exports the public source tree: a fresh directory, with no git history,
 * holding only the files `scripts/public-export.json` allows, ready to become
 * the first commit of a public repository.
 *
 *   node scripts/export-public.mjs --out <empty dir> [--ref HEAD] [--final]
 *
 * Deny by default: a tracked file is exported only when an `include` pattern
 * matches it and no `exclude` pattern does. Files come from the committed tree
 * at `--ref`, never from the working directory, so what is exported is what
 * was reviewed. Symbolic links and submodules are refused.
 *
 * The exported tree is then scanned with `leak-scan.mjs` (every class, the
 * deny-list, and the allowlist itself); any finding fails the export. The
 * summary lists every withheld file with the recorded reason, or flags it as
 * having none.
 *
 * `--final` adds the checks for a release: placeholders that must be replaced
 * before publishing (the removal contact) fail the export.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_CONFIG, DEFAULT_DENY, allowed, formatFinding, readConfig, readDenyList, scanTree } from "./leak-scan.mjs";

/** Values still to be decided before release, in the files that carry them. */
export const PLACEHOLDERS = [
  { path: "NOTICE.md", pattern: /\[contact to be set before release\]/i },
  { path: "README.md", pattern: /\[contact to be set before release\]/i },
];

function git(repo, args, options = {}) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1024 * 1024 * 1024, ...options });
}

/** Tracked entries at `ref`: `{ mode, path }`. */
export function trackedFiles(repo, ref) {
  return git(repo, ["ls-tree", "-r", "-z", "--full-tree", ref])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split("\t");
      return { mode: meta.split(" ")[0], path };
    });
}

/** The recorded reason a withheld path is withheld: an exact key, or the closest directory key. */
export function reasonFor(path, withheld) {
  if (withheld[path]) return withheld[path];
  const dirs = Object.keys(withheld).filter((key) => key.endsWith("/") && path.startsWith(key));
  return dirs.length ? withheld[dirs.sort((a, b) => b.length - a.length)[0]] : null;
}

export function exportTree({ repo, ref = "HEAD", out, config, deny, final = false }) {
  const target = resolve(out);
  if (existsSync(target) && readdirSync(target).length) throw new Error(`${out} is not empty`);
  const top = git(repo, ["rev-parse", "--show-toplevel"]).toString().trim();
  if (!relative(top, target).startsWith("..")) throw new Error(`${out} is inside the repository; export outside it`);
  const commit = git(repo, ["rev-parse", "--verify", `${ref}^{commit}`]).toString().trim();

  const tracked = trackedFiles(repo, commit);
  const exported = tracked.filter((file) => allowed(file.path, config));
  const refused = exported.filter((file) => file.mode === "120000" || file.mode === "160000");
  if (refused.length) throw new Error(`symbolic links and submodules cannot be exported: ${refused.map((f) => f.path).join(", ")}`);
  if (!exported.length) throw new Error("the allowlist matches no tracked file");

  mkdirSync(target, { recursive: true });
  const archive = git(repo, ["archive", "--format=tar", commit, "--", ...exported.map((f) => `:(literal)${f.path}`)]);
  execFileSync("tar", ["-x", "-C", target], { input: archive });

  const withheld = tracked
    .filter((file) => !allowed(file.path, config))
    .map((file) => ({ path: file.path, reason: reasonFor(file.path, config.withheld ?? {}) }));
  const { findings } = scanTree(target, { config, deny });
  const placeholders = [];
  if (final) {
    for (const { path, pattern } of PLACEHOLDERS) {
      const file = join(target, path);
      if (existsSync(file) && pattern.test(readFileSync(file, "utf8"))) placeholders.push(`${path}: ${pattern.source}`);
    }
  }
  return { commit, exported: exported.length, withheld, findings, placeholders, denyList: deny !== null };
}

function summary(result) {
  const lines = [`exported ${result.exported} files from ${result.commit}`];
  const groups = new Map();
  for (const { path, reason } of result.withheld) {
    const key = reason ?? "NO RECORDED REASON";
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  lines.push(`withheld ${result.withheld.length} files:`);
  for (const [reason, paths] of groups) {
    const shown = paths.length > 4 ? `${paths.slice(0, 3).join(", ")} … (+${paths.length - 3})` : paths.join(", ");
    lines.push(`  ${String(paths.length).padStart(4)}  ${reason}: ${shown}`);
  }
  if (!result.denyList) lines.push("deny-list: not found; account, host and device names were not checked");
  lines.push(`leak scan: ${result.findings.length} finding(s)`);
  for (const finding of result.findings) lines.push(`  ${formatFinding(finding)}`);
  for (const placeholder of result.placeholders) lines.push(`  placeholder  ${placeholder}`);
  return lines.join("\n");
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      out: { type: "string" },
      ref: { type: "string", default: "HEAD" },
      config: { type: "string", default: DEFAULT_CONFIG },
      deny: { type: "string", default: DEFAULT_DENY },
      final: { type: "boolean", default: false },
    },
  });
  if (!values.out) {
    process.stderr.write("usage: export-public.mjs --out <empty dir> [--ref HEAD] [--final]\n");
    process.exit(2);
  }
  try {
    const result = exportTree({
      repo: process.cwd(),
      ref: values.ref,
      out: values.out,
      config: readConfig(values.config),
      deny: readDenyList(values.deny),
      final: values.final,
    });
    process.stdout.write(`${summary(result)}\n`);
    const failed = result.findings.length > 0 || result.placeholders.length > 0;
    if (failed) process.stderr.write("export: refused; the directory must not be published\n");
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    process.stderr.write(`export: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
