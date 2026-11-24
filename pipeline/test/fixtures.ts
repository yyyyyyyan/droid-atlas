/**
 * Synthetic test data. The index fixtures are hand-written fake packages,
 * never copied from the real F-Droid or IzzyOnDroid indexes
 * (docs/LICENSING.md §1.2): every name, id and text here is invented.
 */
import type { SourceCategory } from "../../schema/catalog.ts";
import type { GithubLookup, GithubRepo, GithubResult } from "../enrich/github.ts";
import type { IndexData } from "../enrich/index-v2.ts";
import { parseIndex } from "../enrich/index-v2.ts";
import type { SourceEntry } from "../sources/types.ts";

export interface FakePackage {
  name?: string;
  summary?: string;
  description?: string;
  license?: string;
  sourceCode?: string;
  webSite?: string;
  author?: string;
  permissions?: string[];
  antiFeatures?: string[];
  /** The index's reason for an anti-feature of the latest version, by key, as a localized map. */
  reasons?: Record<string, unknown>;
  /** Permissions in the manifest's `usesPermissionSdk23` list. */
  permissionsSdk23?: string[];
  /** Anti-features on an older version only. */
  oldAntiFeatures?: string[];
  /** The older version's reason for an anti-feature, by key, as a localized map. */
  oldReasons?: Record<string, unknown>;
  icon?: { locale?: string; name: string; sha256: string } | null;
  versionName?: string;
}

/** An index-v2 document with the given fake packages. */
export function fakeIndexJson(packages: Record<string, FakePackage>, timestamp = 1_700_000_000_000): unknown {
  const out: Record<string, unknown> = {};
  for (const [pkg, p] of Object.entries(packages)) {
    const icon = p.icon === null ? undefined : (p.icon ?? { name: `/${pkg}/en-US/icon.png`, sha256: "a".repeat(64) });
    out[pkg] = {
      metadata: {
        name: { "en-US": p.name ?? pkg },
        summary: p.summary === undefined ? undefined : { "en-US": p.summary },
        description: p.description === undefined ? undefined : { "en-US": p.description },
        license: p.license ?? "GPL-3.0-or-later",
        sourceCode: p.sourceCode,
        webSite: p.webSite,
        authorName: p.author,
        added: 1_600_000_000_000,
        lastUpdated: 1_690_000_000_000,
        icon: icon ? { [icon.locale ?? "en-US"]: { name: icon.name, sha256: icon.sha256, size: 100 } } : undefined,
      },
      versions: {
        old: {
          added: 1_600_000_000_000,
          file: { name: `/${pkg}_1.apk`, size: 1000 },
          manifest: { versionName: "0.9", versionCode: 1, usesSdk: { minSdkVersion: 21, targetSdkVersion: 30 }, usesPermission: [] },
          antiFeatures: Object.fromEntries((p.oldAntiFeatures ?? []).map((a) => [a, p.oldReasons?.[a] ?? {}])),
        },
        new: {
          added: 1_690_000_000_000,
          file: { name: `/${pkg}_2.apk`, size: 2048 },
          manifest: {
            versionName: p.versionName ?? "1.0",
            versionCode: 2,
            usesSdk: { minSdkVersion: 24, targetSdkVersion: 35 },
            usesPermission: (p.permissions ?? []).map((name) => ({ name })),
            usesPermissionSdk23: (p.permissionsSdk23 ?? []).map((name) => ({ name })),
          },
          antiFeatures: Object.fromEntries((p.antiFeatures ?? []).map((a) => [a, p.reasons?.[a] ?? {}])),
        },
      },
    };
  }
  return { repo: { timestamp }, packages: out };
}

export function fakeIndex(origin: "fdroid" | "izzy", packages: Record<string, FakePackage>): IndexData {
  const base = origin === "fdroid" ? "https://f-droid.org/repo" : "https://apt.izzysoft.de/fdroid/repo";
  return parseIndex(origin, base, fakeIndexJson(packages));
}

export function fakeRepo(fullName: string, extra: Partial<GithubRepo> = {}): GithubRepo {
  return {
    fullName,
    description: null,
    stars: 10,
    pushedAt: "2026-01-01T00:00:00Z",
    archived: false,
    homepage: null,
    license: null,
    forkOf: null,
    release: null,
    head: null,
    owner: { login: fullName.split("/")[0] ?? "", organization: false, avatarUrl: null },
    ...extra,
  };
}

export function fakeGithub(repos: Record<string, GithubResult> = {}): GithubLookup {
  const lower = new Map(Object.entries(repos).map(([k, v]) => [k.toLowerCase(), v]));
  return { fetchedAt: "2026-01-02T00:00:00.000Z", get: (slug) => lower.get(slug.toLowerCase()), unresolved: [], fetched: false };
}

let line = 1;

export function entry(partial: Partial<SourceEntry> & Pick<SourceEntry, "name" | "url">): SourceEntry {
  return {
    source: "android-foss",
    file: "README.md",
    line: line++,
    order: 0,
    kind: "app",
    category: "android-foss/apps-tools",
    description: null,
    tags: [],
    license: null,
    parent: null,
    sourceCode: null,
    channels: [],
    extraLinks: [],
    historyKey: partial.url.toLowerCase(),
    added: null,
    ...partial,
  };
}

export const SOURCE_CATEGORIES: SourceCategory[] = [
  { id: "android-foss/apps-tools", source: "android-foss", name: "Tools", section: "Apps", category: "other-apps", region: "world", order: 0, note: null },
  { id: "android-foss/getting-more", source: "android-foss", name: "Getting more …", section: null, category: "app-lists", region: "guides", order: 1, note: null },
  { id: "awesome-shizuku/audio", source: "awesome-shizuku", name: "Audio", section: "Apps", category: "sound-volume", region: "media", order: 0, note: null },
  { id: "awesome-shizuku/closed-audio", source: "awesome-shizuku", name: "Audio", section: "Closed-source apps", category: "sound-volume", region: "media", order: 1, note: null },
];
