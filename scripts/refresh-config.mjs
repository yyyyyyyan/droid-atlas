#!/usr/bin/env node
/**
 * Checks the repository variables the daily refresh reads, before it does
 * anything, so a typo fails the run instead of quietly changing what it does.
 *
 *   node scripts/refresh-config.mjs        (reads the variables from the environment)
 *
 * | Variable                   | Values                                             |
 * |----------------------------|----------------------------------------------------|
 * | `REFRESH_ENABLED`          | `true` runs the refresh; anything else and the workflow's jobs are skipped before this runs |
 * | `SITE_URL`                 | the live site, `https://…`; required               |
 * | `REFRESH_BOOTSTRAP`        | `true` for the very first build only; else unset or `false` |
 * | `PROJECT_URL`              | the public source repository, `https://…`; required once `DEPLOY_TARGET` is set |
 * | `DEPLOY_TARGET`            | unset (build and upload only), `github-pages`, or `cloudflare-workers` |
 * | `CLOUDFLARE_ACCOUNT_ID`    | required with `cloudflare-workers`                 |
 * | `CLOUDFLARE_WORKER_NAME`   | required with `cloudflare-workers`: lowercase letters, digits and inner dashes |
 *
 * With `cloudflare-workers`, `SITE_URL` must also be an origin with no path:
 * its host becomes the Worker's custom domain, which serves a whole hostname.
 *
 * Exits 1 with one line per problem; prints nothing else on success.
 */

export const DEPLOY_TARGETS = ["github-pages", "cloudflare-workers"];

/**
 * Whether `name` can name a Worker and still leave room for the `-preview`
 * suffix of the release check's throwaway Worker (`scripts/wrangler-config.mjs`):
 * lowercase letters, digits and dashes, neither first nor last a dash, so that
 * both names stay within a 63-character DNS label.
 */
export function isWorkerName(name) {
  return /^[a-z0-9](?:[a-z0-9-]{0,53}[a-z0-9])?$/.test(name);
}

/** Whether `host` is under a name reserved for placeholders (RFC 2606), as the pipeline's default project address is. */
export function isPlaceholderHost(host) {
  return /\.(invalid|example|test)$/.test(host);
}

export function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/** Every problem with the variables in `env`; empty when they are usable. */
export function checkConfig(env) {
  const problems = [];
  const get = (name) => (env[name] ?? "").trim();
  if (!httpsUrl(get("SITE_URL"))) problems.push(`SITE_URL must be the live site's https:// URL (got ${JSON.stringify(get("SITE_URL"))})`);
  if (!["", "true", "false"].includes(get("REFRESH_BOOTSTRAP"))) problems.push(`REFRESH_BOOTSTRAP must be "true", "false" or unset (got ${JSON.stringify(get("REFRESH_BOOTSTRAP"))})`);
  const target = get("DEPLOY_TARGET");
  if (target && !DEPLOY_TARGETS.includes(target)) problems.push(`DEPLOY_TARGET must be unset or one of ${DEPLOY_TARGETS.join(", ")} (got ${JSON.stringify(target)})`);
  if (get("PROJECT_URL") && !httpsUrl(get("PROJECT_URL"))) problems.push(`PROJECT_URL must be an https:// URL (got ${JSON.stringify(get("PROJECT_URL"))})`);
  if (httpsUrl(get("PROJECT_URL")) && isPlaceholderHost(new URL(get("PROJECT_URL")).hostname)) problems.push(`PROJECT_URL must be the project's real address, not a placeholder (got ${JSON.stringify(get("PROJECT_URL"))})`);
  if (target && !get("PROJECT_URL")) problems.push("PROJECT_URL must be set before anything is deployed: the data headers and the source offer name it");
  if (target === "cloudflare-workers") {
    for (const name of ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_WORKER_NAME"]) if (!get(name)) problems.push(`${name} must be set when DEPLOY_TARGET is cloudflare-workers`);
    const worker = get("CLOUDFLARE_WORKER_NAME");
    if (worker && !isWorkerName(worker)) problems.push(`CLOUDFLARE_WORKER_NAME must be 1-55 lowercase letters, digits or dashes, not starting or ending with a dash (got ${JSON.stringify(worker)})`);
    if (httpsUrl(get("SITE_URL")) && new URL(get("SITE_URL")).pathname !== "/") problems.push(`SITE_URL must have no path with cloudflare-workers: a custom domain serves the whole host (got ${JSON.stringify(get("SITE_URL"))})`);
  }
  return problems;
}

if (import.meta.main) {
  const problems = checkConfig(process.env);
  for (const problem of problems) process.stderr.write(`${problem}\n`);
  process.exitCode = problems.length ? 1 : 0;
}
