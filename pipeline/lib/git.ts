/**
 * Local clones of the upstream lists and the dates entries first appeared in
 * them. Git is invoked with argument arrays only; no upstream string reaches
 * a shell.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { retry } from "./retry.ts";
import { normalizeUrl } from "./text.ts";

function git(dir: string, args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Clones the remote into `dir`, or brings an existing clone to the remote's
 * head unless offline. The clone is a cache, so a rewritten upstream history
 * is followed rather than refused.
 */
export async function syncClone(
  remote: string,
  dir: string,
  offline: boolean,
  log: (text: string) => void = () => {},
  now: () => Date = () => new Date(),
): Promise<void> {
  if (offline) {
    if (!existsSync(dir)) throw new Error(`--offline but ${dir} is missing`);
    return;
  }
  const onRetry = (error: unknown, attempt: number): void => log(`retrying ${remote} (${attempt}): ${String(error)}`);
  if (!existsSync(dir)) {
    await retry(() => execFileSync("git", ["clone", "--quiet", remote, dir], { stdio: ["ignore", "ignore", "pipe"] }), { onRetry });
  } else {
    await retry(() => git(dir, ["fetch", "--quiet", "origin"]), { onRetry });
    git(dir, ["reset", "--quiet", "--hard", "@{upstream}"]);
  }
  writeFileSync(`${dir}.retrieved`, now().toISOString());
}

/** When the clone was last brought up to date, else its HEAD commit time. */
export function cloneRetrievedAt(dir: string, head: HeadCommit): string {
  const path = `${dir}.retrieved`;
  const recorded = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
  return Number.isFinite(Date.parse(recorded)) ? new Date(recorded).toISOString() : head.committedAt;
}

export interface HeadCommit {
  sha: string;
  committedAt: string;
}

export function headCommit(dir: string): HeadCommit {
  const [sha = "", committedAt = ""] = git(dir, ["log", "-1", "--format=%H%x09%cI"]).trim().split("\t");
  const time = Date.parse(committedAt);
  if (!/^[0-9a-f]{40}$/.test(sha) || !Number.isFinite(time)) throw new Error(`${dir}: cannot read HEAD commit`);
  return { sha, committedAt: new Date(time).toISOString() };
}

/** An added Markdown list item linking somewhere: `+* [Name](url)` or `+  - [**Name**](url)`. */
const ADDED_ENTRY_RE = /^\+\s*[*-] \[(?:\*\*)?.+?(?:\*\*)?\]\((\S+?)\)/;

/**
 * Parses `git log --reverse --format=%x00%cI -p --unified=0` output into a
 * map of normalized entry URL → UTC date of the first commit that added it.
 */
export function parseFirstSeen(log: string): Map<string, string> {
  const firstSeen = new Map<string, string>();
  for (const chunk of log.split("\0").slice(1)) {
    const newline = chunk.indexOf("\n");
    const stamp = Date.parse(chunk.slice(0, newline === -1 ? undefined : newline).trim());
    if (!Number.isFinite(stamp)) continue;
    const date = new Date(stamp).toISOString().slice(0, 10);
    for (const line of chunk.slice(newline + 1).split("\n")) {
      const url = line.match(ADDED_ENTRY_RE)?.[1];
      if (!url) continue;
      const key = normalizeUrl(url);
      if (!firstSeen.has(key)) firstSeen.set(key, date);
    }
  }
  return firstSeen;
}

/**
 * Date each entry URL first appeared in any of `paths`, keyed by project URL
 * so later renames, moves between sections or badge changes keep the date.
 */
export function firstSeenDates(dir: string, paths: string[]): Map<string, string> {
  return parseFirstSeen(git(dir, ["log", "--reverse", "--format=%x00%cI", "-p", "--unified=0", "--", ...paths]));
}
