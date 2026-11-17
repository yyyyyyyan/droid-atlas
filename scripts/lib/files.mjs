/**
 * File helpers shared by the release scripts. Node built-ins only, so the
 * scripts run straight from a checkout without an install.
 */
import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Every file under `root`, as sorted POSIX paths relative to it. Symbolic links are reported, not followed. */
export function walk(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(relative(root, path).split(sep).join("/"));
    }
  };
  visit(root);
  return files.sort();
}

export function isSymlink(path) {
  return lstatSync(path).isSymbolicLink();
}

/**
 * Translates a glob into a regular expression over POSIX paths: `**` spans
 * directories, `*` stays within one segment, `?` is one character. A pattern
 * ending in `/` matches everything below that directory.
 */
export function globToRegExp(glob) {
  const pattern = glob.endsWith("/") ? `${glob}**` : glob;
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") {
      out += "[^/]*";
    } else if (char === "?") {
      out += "[^/]";
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesAny(path, globs) {
  return globs.some((glob) => globToRegExp(glob).test(path));
}
