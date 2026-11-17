/**
 * M2: facet claims against the cache the build was made from. Thirty claims
 * are sampled with the audit seed, five of each kind, and checked one by one;
 * then the same rule is applied to every app, so a systematic error shows as
 * a count. Both polarities are checked where a claim has one.
 */

import { expect, test } from "@playwright/test";
import { loadBuild, sample, type App } from "../lib/catalog.ts";
import { SYNTHETIC } from "../lib/pick.ts";
import { SEED, cacheDir } from "./audit-config.ts";
import { latestVersion, permissions, readCache, type Cache } from "./cache.ts";

const build = loadBuild();
const dir = cacheDir();
const SHIZUKU_PERMISSION = "moe.shizuku.manager.permission.API_V23";
const INTERNET = "android.permission.INTERNET";

test.beforeEach(() => {
  if (SYNTHETIC) test.skip(!dir, "the synthetic build ships no cache to audit against");
  else expect(dir, "the upstream cache (E2E_CACHE_DIR or .cache)").not.toBeNull();
});

interface IndexClaim { origin: "fdroid" | "izzy"; pkg: string }

function indexClaims(app: App): IndexClaim[] {
  return [app.fdroid?.facts, app.izzy?.facts].filter((f): f is NonNullable<typeof f> => Boolean(f)).map((f) => ({ origin: f.origin, pkg: f.pkg }));
}

function cachedVersion(cache: Cache, claim: IndexClaim) {
  const pkg = (claim.origin === "fdroid" ? cache.fdroid : cache.izzy).packages[claim.pkg];
  return pkg ? latestVersion(pkg) : undefined;
}

type Check = (app: App, cache: Cache) => string | null;

/** The cache is keyed by the repository a list links; the atlas holds GitHub's current name. Either finds it. */
function githubRepo(cache: Cache, slug: string) {
  return cache.github[slug] ?? Object.values(cache.github).find((repo) => repo.fullName?.toLowerCase() === slug);
}

/** Each kind: which apps carry the claim, and the check that returns a discrepancy or null. */
const KINDS: Record<string, { claimed: (app: App) => boolean; check: Check }> = {
  "declares Shizuku (index evidence)": {
    claimed: (app) => app.atlas.evidence.shizuku instanceof Array && (app.atlas.evidence.shizuku as string[]).some((o) => o === "fdroid" || o === "izzy"),
    check: (app, cache) => {
      const origins = (app.atlas.evidence.shizuku as string[]).filter((o) => o === "fdroid" || o === "izzy");
      for (const claim of indexClaims(app).filter((c) => origins.includes(c.origin))) {
        const version = cachedVersion(cache, claim);
        if (!version) return `${claim.origin} ${claim.pkg} is not in the cached index`;
        if (!permissions(version).includes(SHIZUKU_PERMISSION)) return `${claim.origin} ${claim.pkg} latest version does not request ${SHIZUKU_PERMISSION}`;
      }
      return null;
    },
  },
  "no internet permission": {
    claimed: (app) => app.atlas.facets.noInternet === true,
    check: (app, cache) => {
      const claims = indexClaims(app);
      if (!claims.length) return "claimed with no index to state it";
      for (const claim of claims) {
        const version = cachedVersion(cache, claim);
        if (!version) return `${claim.origin} ${claim.pkg} is not in the cached index`;
        if (permissions(version).includes(INTERNET)) return `${claim.origin} ${claim.pkg} latest version requests INTERNET`;
      }
      return null;
    },
  },
  "APK on GitHub releases": {
    claimed: (app) => app.atlas.facets.apkOnGithub === true,
    check: (app, cache) => {
      const slug = app.atlas.repo?.host === "github" ? app.atlas.repo.slug?.toLowerCase() : null;
      if (!slug) return "claimed for an app whose repository is not on GitHub";
      const repo = githubRepo(cache, slug);
      if (!repo) return `${slug} is not in the GitHub cache`;
      return repo.release?.hasApk ? null : `${slug}: cached release ${repo.release?.tag ?? "(none)"} has no APK`;
    },
  },
  "anti-features": {
    claimed: (app) => app.atlas.facets.noAntiFeatures === false,
    check: (app, cache) => {
      for (const record of [app.fdroid, app.izzy]) {
        if (!record) continue;
        const version = cachedVersion(cache, { origin: record.facts.origin, pkg: record.facts.pkg });
        if (!version) return `${record.facts.origin} ${record.facts.pkg} is not in the cached index`;
        const cached = Object.keys(version.antiFeatures ?? {}).sort().join(",");
        const stated = [...record.facts.antiFeatures].sort().join(",");
        if (cached !== stated) return `${record.facts.origin} ${record.facts.pkg}: build says [${stated}], latest version in the index has [${cached}]`;
      }
      return null;
    },
  },
  archived: {
    claimed: (app) => app.atlas.facets.archived === true,
    check: (app, cache) => {
      if (app.listings.some((l) => l.tags.includes("archived"))) return null;
      const slug = app.atlas.repo?.host === "github" ? app.atlas.repo.slug?.toLowerCase() : null;
      const repo = slug ? githubRepo(cache, slug) : undefined;
      return repo?.archived ? null : `neither the archive page lists it nor does GitHub say archived (${slug ?? "no GitHub repository"})`;
    },
  },
  "stale link": {
    claimed: (app) => app.atlas.facets.staleLink,
    check: (app, cache) => {
      const stale = app.atlas.channels.filter((c) => c.listed === false);
      if (!stale.length) return "claimed with no unlisted channel";
      for (const channel of stale) {
        if (channel.type === "play") return `play ${channel.pkg} is marked stale, but no index can say so`;
        const own = channel.type === "fdroid" ? cache.fdroid : cache.izzy;
        if (channel.pkg in own.packages) return `${channel.type} ${channel.pkg} is marked stale but ${channel.type}'s index carries it`;
      }
      return null;
    },
  },
};

const PER_KIND = 5;

for (const [kind, { claimed, check }] of Object.entries(KINDS)) {
  test(`${kind}: ${PER_KIND} sampled claims (seed ${SEED}) hold in the cache`, () => {
    const cache = readCache(dir ?? "");
    const picked = sample(build.apps.filter(claimed), PER_KIND, SEED);
    test.info().annotations.push({ type: "sample", description: picked.map((a) => a.id).join(", ") });
    expect(picked.length).toBe(PER_KIND);
    expect(picked.map((app) => [app.id, check(app, cache)]).filter(([, problem]) => problem !== null)).toEqual([]);
  });

  test(`${kind}: every claim holds in the cache`, () => {
    const cache = readCache(dir ?? "");
    const claims = build.apps.filter(claimed);
    test.info().annotations.push({ type: "claims", description: String(claims.length) });
    expect(claims.map((app) => [app.id, check(app, cache)]).filter(([, problem]) => problem !== null)).toEqual([]);
  });
}

test("the negative side: apps not claimed 'no internet' with index facts do request INTERNET somewhere, and live channels are in their index", () => {
  const cache = readCache(dir ?? "");
  const problems: string[] = [];
  for (const app of build.apps) {
    const claims = indexClaims(app);
    if (claims.length && app.atlas.facets.noInternet === false) {
      const anyInternet = claims.some((claim) => permissions(cachedVersion(cache, claim) ?? null).includes(INTERNET));
      if (!anyInternet) problems.push(`${app.id}: noInternet false, but no index's latest version requests INTERNET`);
    }
    for (const channel of app.atlas.channels) {
      if (channel.listed !== true || channel.type === "play") continue;
      const index = channel.type === "fdroid" ? cache.fdroid : cache.izzy;
      if (!(channel.pkg in index.packages)) problems.push(`${app.id}: ${channel.type} ${channel.pkg} is listed:true but not in the cached index`);
    }
  }
  expect(problems).toEqual([]);
});
