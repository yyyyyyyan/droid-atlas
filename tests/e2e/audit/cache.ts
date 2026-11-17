/** Read-only access to the upstream cache the build was made from (indexes and GitHub facts). */

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface IndexVersion {
  added?: number;
  manifest?: { versionCode?: number; usesPermission?: { name: string }[] };
  antiFeatures?: Record<string, unknown> | null;
}

export interface IndexPackage {
  metadata: { sourceCode?: string; name?: Record<string, string>; summary?: Record<string, string>; description?: Record<string, string>; license?: string };
  versions: Record<string, IndexVersion>;
}

export interface Index { packages: Record<string, IndexPackage> }

export interface GithubRepo {
  fullName?: string;
  description: string | null;
  archived: boolean;
  forkOf: string | null;
  release: { tag: string; publishedAt: string; hasApk: boolean } | null;
}

export interface Cache {
  fdroid: Index;
  izzy: Index;
  github: Record<string, GithubRepo>;
}

let loaded: Cache | null = null;

export function readCache(dir: string): Cache {
  if (loaded) return loaded;
  const json = <T>(name: string): T => JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
  loaded = {
    fdroid: json<Index>("fdroid-index-v2.json"),
    izzy: json<Index>("izzy-index-v2.json"),
    github: json<{ repos: Record<string, GithubRepo> }>("github-repos.json").repos,
  };
  return loaded;
}

/** The version an index currently offers: the highest version code. */
export function latestVersion(pkg: IndexPackage): IndexVersion | null {
  let best: IndexVersion | null = null;
  for (const version of Object.values(pkg.versions)) {
    if (!best || (version.manifest?.versionCode ?? 0) > (best.manifest?.versionCode ?? 0)) best = version;
  }
  return best;
}

export function permissions(version: IndexVersion | null): string[] {
  return (version?.manifest?.usesPermission ?? []).map((permission) => permission.name);
}

/** `owner/name` of a GitHub, GitLab or Codeberg URL, lower-cased, with the forge as a prefix; null for anything else. */
export function repoKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^https?:\/\/(?:www\.)?(github\.com|gitlab\.com|codeberg\.org)\/([^/#?]+)\/([^/#?]+?)(?:\.git)?\/?(?:[#?].*)?$/i.exec(url.trim());
  if (!match) return null;
  const forge = match[1]?.toLowerCase().split(".")[0];
  return `${forge}:${match[2]?.toLowerCase()}/${match[3]?.toLowerCase()}`;
}

/** A GitHub repository key after GitHub's own rename, when the cache knows it. */
export function canonicalRepo(key: string | null, cache: Cache): string | null {
  if (!key?.startsWith("github:")) return key;
  const renamed = cache.github[key.slice("github:".length)]?.fullName;
  return renamed ? `github:${renamed.toLowerCase()}` : key;
}

export function storeLinkPackage(url: string): string | null {
  return /f-droid\.org\/(?:[a-z-]+\/)?packages\/([^/?#]+)/.exec(url)?.[1]
    ?? /apt\.izzysoft\.de\/(?:fdroid\/index\/apk|packages)\/([^/?#]+)/.exec(url)?.[1]
    ?? /play\.google\.com\/store\/apps\/details\?id=([^&#]+)/.exec(url)?.[1]
    ?? null;
}
