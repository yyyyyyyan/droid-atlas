/**
 * What the build knows about the code it is building: the commit and its
 * date. In GitHub Actions the commit is `GITHUB_SHA`; elsewhere it is the
 * checkout's HEAD when the site is built inside its own git checkout;
 * otherwise the build knows neither and says so by leaving both empty.
 */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import type { SiteVersion } from "../src/version.ts";

const FULL_COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const SHORT = 7;

export interface Checkout {
  commit: string;
  /** The committer date of `commit`, as git prints it in strict ISO 8601. */
  date: string | null;
  modified: boolean;
}

type Git = (args: readonly string[]) => string;

function gitIn(directory: string): Git {
  return (args) => execFileSync("git", [...args], { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/**
 * HEAD of the checkout whose top level is `root`, when it was committed, and
 * whether the tree has changes in no commit. Null without git, outside a
 * checkout, and when `root` merely sits inside some other repository, whose
 * commit would name other code.
 */
export function readCheckout(root: string, git: Git = gitIn(root)): Checkout | null {
  try {
    if (realpathSync(git(["rev-parse", "--show-toplevel"])) !== realpathSync(root)) return null;
    const commit = git(["rev-parse", "HEAD"]);
    if (!FULL_COMMIT.test(commit)) return null;
    const date = git(["show", "-s", "--format=%cI", "HEAD"]);
    return { commit, date: Number.isFinite(Date.parse(date)) ? date : null, modified: git(["status", "--porcelain"]) !== "" };
  } catch {
    return null;
  }
}

interface Repository {
  /** What makes two addresses the same repository: host and path, without case, a trailing slash or `.git`. */
  key: string;
  /** The address its pages are built on. */
  base: string;
}

function repository(address: string | undefined): Repository | null {
  if (!address) return null;
  try {
    const url = new URL(address);
    if (url.protocol !== "https:") return null;
    const base = `https://${url.host}${url.pathname.replace(/\/+$/, "").replace(/\.git$/, "")}`;
    return { key: base.toLowerCase(), base };
  } catch {
    return null;
  }
}

/**
 * The commit's page, only where the public repository is certain to have the
 * commit: the build ran in Actions, and `PROJECT_URL` names the very
 * repository the workflow ran in. A workflow in any other repository builds
 * commits the public one may never receive.
 */
function commitPage(env: Readonly<Record<string, string | undefined>>, commit: string): string | null {
  const project = repository(env.PROJECT_URL);
  const ran = repository(env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}` : undefined);
  return project !== null && project.key === ran?.key ? `${project.base}/commit/${commit}` : null;
}

/**
 * The site's version for this build. In Actions the checkout is asked only
 * for the date, and only believed when its HEAD is the commit Actions names;
 * its tree is never called modified, since the workflow itself writes into it.
 */
export function siteVersion(env: Readonly<Record<string, string | undefined>>, checkout: () => Checkout | null): SiteVersion {
  const local = checkout();
  const built = env.GITHUB_SHA?.trim().toLowerCase();
  if (built && FULL_COMMIT.test(built)) {
    return { commit: built.slice(0, SHORT), date: local?.commit === built ? local.date : null, modified: false, commitUrl: commitPage(env, built) };
  }
  return { commit: local ? local.commit.slice(0, SHORT) : null, date: local?.date ?? null, modified: local?.modified ?? false, commitUrl: null };
}
