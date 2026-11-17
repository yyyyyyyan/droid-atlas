/**
 * GitHub repository facts through the GraphQL API: stars, activity, archived
 * state, the repository's current name (GitHub follows renames and transfers)
 * and whether the latest release ships an APK.
 *
 * Requests carry only repository names and the token. Results are cached in
 * one file so an offline build can reuse them.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface GithubRepo {
  fullName: string;
  description: string | null;
  stars: number;
  pushedAt: string;
  archived: boolean;
  homepage: string | null;
  license: string | null;
  /** `owner/name` of the repository this one was forked from. */
  forkOf: string | null;
  /** The latest release; `apkDownloads` is GitHub's download count summed over its `.apk` assets. */
  release: { tag: string; publishedAt: string; hasApk: boolean; apkDownloads: number } | null;
  /** Commit at the head of the default branch; null for an empty repository. */
  head: string | null;
  owner: { login: string; organization: boolean; avatarUrl: string | null };
}

export type GithubResult = GithubRepo | { missing: true };

/** Bumped whenever the cached shape changes, so an older cache is ignored rather than misread. */
const CACHE_VERSION = 3;

export interface GithubCache {
  version: number;
  fetchedAt: string;
  repos: Record<string, GithubResult>;
}

export interface GithubLookup {
  fetchedAt: string;
  /** Result for an `owner/name`, or undefined when it was never resolved. */
  get(slug: string): GithubResult | undefined;
  /** Requested repositories with no result, online or cached. */
  unresolved: string[];
  /** True when this run queried the API, false when it used the cache only. */
  fetched: boolean;
}

const ENDPOINT = "https://api.github.com/graphql";
const BATCH = 50;
const NAME_RE = /^[A-Za-z0-9_.-]{1,100}$/;

export function githubKey(slug: string): string {
  return slug.toLowerCase();
}

function fieldsFragment(): string {
  return `nameWithOwner description stargazerCount pushedAt isArchived homepageUrl
    licenseInfo { spdxId }
    isFork parent { nameWithOwner }
    latestRelease { tagName publishedAt releaseAssets(first: 50) { nodes { name downloadCount } } }
    defaultBranchRef { target { oid } }
    owner { __typename login avatarUrl(size: 460) }`;
}

/** One GraphQL document asking for every repository in the batch under aliases r0…rN. */
export function batchQuery(slugs: string[]): string {
  const parts = slugs.map((slug, i) => {
    const [owner = "", name = ""] = slug.split("/");
    return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fieldsFragment()} }`;
  });
  return `query {\n${parts.join("\n")}\n}`;
}

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
}

function nodes(value: unknown): Json[] {
  const list = asObject(value)?.["nodes"];
  return Array.isArray(list) ? list.map(asObject).filter((n): n is Json => n !== null) : [];
}

function apkAssets(release: Json): Json[] {
  return nodes(release["releaseAssets"]).filter((a) => /\.apk$/i.test(String(a["name"] ?? "")));
}

/** Converts one GraphQL repository node into the cached shape, rejecting anything malformed. */
export function repoFromNode(node: unknown): GithubRepo | null {
  const n = asObject(node);
  if (!n || typeof n["nameWithOwner"] !== "string" || typeof n["stargazerCount"] !== "number") return null;
  const release = asObject(n["latestRelease"]);
  const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
  const owner = asObject(n["owner"]);
  const head = text(asObject(asObject(n["defaultBranchRef"])?.["target"])?.["oid"]);
  return {
    fullName: n["nameWithOwner"],
    description: text(n["description"]),
    stars: n["stargazerCount"],
    pushedAt: text(n["pushedAt"]) ?? "",
    archived: n["isArchived"] === true,
    homepage: text(n["homepageUrl"]),
    license: text(asObject(n["licenseInfo"])?.["spdxId"]),
    forkOf: n["isFork"] === true ? text(asObject(n["parent"])?.["nameWithOwner"]) : null,
    release:
      release && typeof release["tagName"] === "string"
        ? {
            tag: release["tagName"],
            publishedAt: text(release["publishedAt"]) ?? "",
            hasApk: apkAssets(release).length > 0,
            apkDownloads: apkAssets(release).reduce((sum, a) => sum + (typeof a["downloadCount"] === "number" && Number.isInteger(a["downloadCount"]) && a["downloadCount"] >= 0 ? a["downloadCount"] : 0), 0),
          }
        : null,
    head: head && /^[0-9a-f]{40}$/.test(head) ? head : null,
    owner: {
      login: text(owner?.["login"]) ?? n["nameWithOwner"].split("/")[0] ?? "",
      organization: owner?.["__typename"] === "Organization",
      avatarUrl: text(owner?.["avatarUrl"]),
    },
  };
}

export function readGithubCache(path: string): GithubCache | null {
  if (!existsSync(path)) return null;
  const parsed = asObject(JSON.parse(readFileSync(path, "utf8")));
  const repos = asObject(parsed?.["repos"]);
  if (!parsed || parsed["version"] !== CACHE_VERSION || typeof parsed["fetchedAt"] !== "string" || !repos) return null;
  const checked: Record<string, GithubResult> = {};
  for (const [key, value] of Object.entries(repos)) {
    if (asObject(value)?.["missing"] === true) checked[key] = { missing: true };
    else if (asObject(value) && typeof asObject(value)?.["fullName"] === "string") checked[key] = value as GithubRepo;
  }
  return { version: CACHE_VERSION, fetchedAt: parsed["fetchedAt"], repos: checked };
}

export function githubToken(): string {
  const fromEnv = process.env["GITHUB_TOKEN"]?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("GitHub token unavailable: set GITHUB_TOKEN or log in with `gh auth login`");
  }
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

async function postWithRetry(fetchImpl: Fetch, token: string, query: string): Promise<Json> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "droid-atlas-pipeline" },
        body: JSON.stringify({ query }),
      });
      if (response.status >= 500 || response.status === 429) {
        lastError = new Error(`GitHub GraphQL: HTTP ${response.status}`);
        continue;
      }
      if (!response.ok) throw new Error(`GitHub GraphQL: HTTP ${response.status}`);
      const body = asObject(await response.json());
      if (!body) throw new Error("GitHub GraphQL: malformed response");
      return body;
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /HTTP 4\d\d/.test(error.message) && !/HTTP 429/.test(error.message)) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("GitHub GraphQL: request failed");
}

/** Fetches every repository in `slugs`. Repositories GitHub reports as not found are recorded as missing. */
export async function fetchGithub(slugs: string[], token: string, fetchImpl: Fetch, log: (text: string) => void): Promise<Record<string, GithubResult>> {
  const results: Record<string, GithubResult> = {};
  const valid = slugs.filter((slug) => slug.split("/").length === 2 && slug.split("/").every((part) => NAME_RE.test(part)));
  for (const slug of slugs) if (!valid.includes(slug)) results[githubKey(slug)] = { missing: true };
  for (let start = 0; start < valid.length; start += BATCH) {
    const batch = valid.slice(start, start + BATCH);
    const body = await postWithRetry(fetchImpl, token, batchQuery(batch));
    const data = asObject(body["data"]) ?? {};
    const errors = Array.isArray(body["errors"]) ? body["errors"].map(asObject).filter((e): e is Json => e !== null) : [];
    const notFound = new Set<string>();
    for (const error of errors) {
      const path = Array.isArray(error["path"]) ? String(error["path"][0]) : "";
      if (error["type"] === "NOT_FOUND" && path) notFound.add(path);
      else throw new Error(`GitHub GraphQL error: ${String(error["message"] ?? "unknown")}`);
    }
    batch.forEach((slug, i) => {
      const alias = `r${i}`;
      const repo = repoFromNode(data[alias]);
      if (repo) results[githubKey(slug)] = repo;
      else if (notFound.has(alias) || data[alias] === null) results[githubKey(slug)] = { missing: true };
    });
    log(`github: ${Math.min(start + BATCH, valid.length)}/${valid.length}`);
  }
  return results;
}

export interface GithubOptions {
  cacheFile: string;
  offline: boolean;
  now: () => Date;
  fetchImpl?: Fetch;
  token?: () => string;
  log?: (text: string) => void;
}

/**
 * Resolves the requested repositories. Online, every one is fetched afresh
 * and the cache is replaced; offline, the cache is the only source.
 */
export async function loadGithub(slugs: string[], options: GithubOptions): Promise<GithubLookup> {
  const unique = [...new Set(slugs.map(githubKey))].sort();
  let cache = readGithubCache(options.cacheFile);
  let fetched = false;
  if (!options.offline) {
    const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as Fetch);
    const token = (options.token ?? githubToken)();
    const repos = await fetchGithub(unique, token, fetchImpl, options.log ?? (() => {}));
    cache = { version: CACHE_VERSION, fetchedAt: options.now().toISOString(), repos };
    writeFileSync(options.cacheFile, JSON.stringify(cache));
    fetched = true;
  }
  const repos = cache?.repos ?? {};
  return {
    fetchedAt: cache?.fetchedAt ?? "",
    get: (slug) => repos[githubKey(slug)],
    unresolved: unique.filter((key) => !(key in repos)),
    fetched,
  };
}
