import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { SITE_VERSION } from "../src/version.ts";
import { readCheckout, siteVersion } from "./site-version.ts";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const OTHER = "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f";
const DATE = "2026-11-17T09:30:00-03:00";
const ACTIONS = { GITHUB_SHA: SHA, GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "droid-atlas/droid-atlas" };
const noCheckout = (): null => null;
const head = (commit: string, modified = false) => () => ({ commit, date: DATE, modified });

describe("the site's version", () => {
  test("without git and without GITHUB_SHA the build states nothing", () => {
    expect(siteVersion({}, noCheckout)).toEqual({ commit: null, date: null, modified: false, commitUrl: null });
  });

  test("a local checkout gives its HEAD, shortened, and the commit's date, says when the tree is modified, and is never a link", () => {
    const env = { PROJECT_URL: "https://github.com/droid-atlas/droid-atlas" };
    expect(siteVersion(env, head(SHA))).toEqual({ commit: "a1b2c3d", date: DATE, modified: false, commitUrl: null });
    expect(siteVersion(env, head(SHA, true))).toEqual({ commit: "a1b2c3d", date: DATE, modified: true, commitUrl: null });
  });

  test("in Actions the commit is GITHUB_SHA, dated by the checkout when its HEAD is that commit, and never called modified", () => {
    expect(siteVersion(ACTIONS, head(SHA, true))).toEqual({ commit: "a1b2c3d", date: DATE, modified: false, commitUrl: null });
    expect(siteVersion(ACTIONS, head(OTHER))).toEqual({ commit: "a1b2c3d", date: null, modified: false, commitUrl: null });
    expect(siteVersion(ACTIONS, noCheckout)).toEqual({ commit: "a1b2c3d", date: null, modified: false, commitUrl: null });
  });

  test("a GITHUB_SHA that is not a commit id is ignored", () => {
    expect(siteVersion({ GITHUB_SHA: "main" }, noCheckout).commit).toBeNull();
    expect(siteVersion({ GITHUB_SHA: "<script>" }, head(SHA)).commit).toBe("a1b2c3d");
  });

  test("the commit is a link only when PROJECT_URL names the repository the workflow ran in", () => {
    const page = `https://github.com/droid-atlas/droid-atlas/commit/${SHA}`;
    for (const project of ["https://github.com/droid-atlas/droid-atlas", "https://github.com/droid-atlas/droid-atlas/", "https://github.com/droid-atlas/droid-atlas.git"]) {
      expect(siteVersion({ ...ACTIONS, PROJECT_URL: project }, noCheckout).commitUrl).toBe(page);
    }
    expect(siteVersion({ ...ACTIONS, PROJECT_URL: "https://github.com/Droid-Atlas/Droid-Atlas" }, noCheckout).commitUrl)
      .toBe(`https://github.com/Droid-Atlas/Droid-Atlas/commit/${SHA}`);
  });

  test.each([
    ["no PROJECT_URL", { ...ACTIONS }],
    ["the placeholder address", { ...ACTIONS, PROJECT_URL: "https://droid-atlas.invalid/" }],
    ["a workflow in another repository", { ...ACTIONS, GITHUB_REPOSITORY: "someone/private-copy", PROJECT_URL: "https://github.com/droid-atlas/droid-atlas" }],
    ["an address that is not https", { ...ACTIONS, PROJECT_URL: "http://github.com/droid-atlas/droid-atlas" }],
    ["an address that does not parse", { ...ACTIONS, PROJECT_URL: "droid-atlas" }],
    ["GITHUB_SHA without the repository's name", { GITHUB_SHA: SHA, PROJECT_URL: "https://github.com/droid-atlas/droid-atlas" }],
  ])("no link with %s", (_case, env) => {
    const site = siteVersion(env, noCheckout);
    expect(site.commit).toBe("a1b2c3d");
    expect(site.commitUrl).toBeNull();
  });
});

describe("reading the checkout", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const answers = (lines: Record<string, string>) => (args: readonly string[]): string => {
    const answer = lines[args.join(" ")];
    if (answer === undefined) throw new Error(`git ${args.join(" ")} failed`);
    return answer;
  };
  const clean = { "rev-parse --show-toplevel": root, "rev-parse HEAD": SHA, "show -s --format=%cI HEAD": DATE, "status --porcelain": "" };

  test("HEAD, its date and a clean tree", () => {
    expect(readCheckout(root, answers(clean))).toEqual({ commit: SHA, date: DATE, modified: false });
  });

  test("a tree with changes in no commit is modified", () => {
    expect(readCheckout(root, answers({ ...clean, "status --porcelain": " M app/src/product.ts" }))).toEqual({ commit: SHA, date: DATE, modified: true });
  });

  test("a date git prints in no readable form is left out", () => {
    expect(readCheckout(root, answers({ ...clean, "show -s --format=%cI HEAD": "yesterday" }))).toEqual({ commit: SHA, date: null, modified: false });
  });

  test("git missing or failing reads as no checkout", () => {
    expect(readCheckout(root, answers({}))).toBeNull();
    expect(readCheckout(root, answers({ "rev-parse --show-toplevel": root }))).toBeNull();
  });

  test("a directory that only sits inside another repository is not that repository's checkout", () => {
    expect(readCheckout(root, answers({ ...clean, "rev-parse --show-toplevel": join(root, "..") }))).toBeNull();
  });

  test("a real directory outside any repository has no checkout", () => {
    const outside = mkdtempSync(join(tmpdir(), "site-version-"));
    try {
      expect(readCheckout(outside)).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("the version the build defines reaches the app's module", () => {
  expect(SITE_VERSION.commit === null || /^[0-9a-f]{7}$/.test(SITE_VERSION.commit)).toBe(true);
  expect(SITE_VERSION.date === null || Number.isFinite(Date.parse(SITE_VERSION.date))).toBe(true);
  expect(SITE_VERSION.commit !== null || SITE_VERSION.date === null, "no date without a commit").toBe(true);
});
