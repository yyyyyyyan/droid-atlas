/**
 * M2: the build's files against docs/LICENSING.md §1.1–1.2: one file per
 * origin, each opening with its own license header; a manifest that lists
 * every file with its sha256, license and attribution; the text of every
 * license named; source commits that match the shipped snapshots.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "@playwright/test";
import { loadBuild, type Header } from "../lib/catalog.ts";

const build = loadBuild();

interface Expected { license: string; attribution: RegExp; sourceUrl: RegExp | null; notice?: RegExp }

/** LICENSING.md §1.1 table and §1.2 layout, part by part. */
const EXPECTED: Record<string, Expected> = {
  "atlas.json": { license: "CC0-1.0", attribution: /Droid Atlas/, sourceUrl: null },
  "sources/android-foss.json": { license: "GPL-3.0-only", attribution: /^Android FOSS by offa and contributors$/, sourceUrl: /^https:\/\/github\.com\/offa\/android-foss$/ },
  "sources/awesome-shizuku.json": { license: "CC-BY-SA-3.0", attribution: /^awesome-shizuku by timschneeb and contributors$/, sourceUrl: /^https:\/\/github\.com\/timschneeb\/awesome-shizuku$/ },
  "sources/fdroid.json": { license: "LicenseRef-per-record", attribution: /F-Droid/, sourceUrl: /f-droid\.org/, notice: /AGPL-3\.0-only/ },
  "sources/izzy.json": { license: "LicenseRef-per-record", attribution: /IzzyOnDroid/, sourceUrl: /izzysoft|izzyondroid/, notice: /AGPL-3\.0-or-later/ },
  "sources/github.json": { license: "NOASSERTION", attribution: /GitHub/, sourceUrl: /github\.com/ },
  "icons.json": { license: "CC0-1.0", attribution: /authors/, sourceUrl: null, notice: /To have an icon removed/ },
};

function header(path: string): Header {
  return (JSON.parse(readFileSync(join(build.dir, path), "utf8")) as { header: Header }).header;
}

test("the manifest lists every file of the build, and each file's bytes match its sha256 and size", () => {
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const file of build.manifest.files) {
    const path = join(build.dir, file.path);
    listed.add(relative(build.dir, path));
    if (!existsSync(path)) {
      problems.push(`${file.path}: listed but missing`);
      continue;
    }
    const bytes = readFileSync(path);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== file.sha256) problems.push(`${file.path}: sha256 ${sha} ≠ manifest ${file.sha256}`);
    if (bytes.length !== file.bytes) problems.push(`${file.path}: ${bytes.length} bytes ≠ manifest ${file.bytes}`);
    if (!file.license) problems.push(`${file.path}: no license`);
    if (!file.attribution) problems.push(`${file.path}: no attribution`);
  }
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [relative(build.dir, full)];
  });
  for (const file of walk(build.dir)) {
    if (file !== "manifest.json" && !listed.has(file)) problems.push(`${file}: in the build directory but not in the manifest`);
  }
  expect(problems).toEqual([]);
});

test("every part opens with a complete license header that agrees with LICENSING.md and the manifest", () => {
  const problems: string[] = [];
  for (const [path, expected] of Object.entries(EXPECTED)) {
    const entry = build.manifest.files.find((f) => f.path === path);
    if (!entry) {
      problems.push(`${path}: not in the manifest`);
      continue;
    }
    const h = header(path);
    for (const field of ["license", "attribution", "changes", "warranty"] as const) {
      if (typeof h[field] !== "string" || !h[field]) problems.push(`${path}: header.${field} missing`);
    }
    if (!h.source || typeof h.source.name !== "string" || typeof h.source.url !== "string" || typeof h.source.retrieved !== "string") problems.push(`${path}: header.source incomplete`);
    if (h.license !== expected.license) problems.push(`${path}: header license ${h.license}, LICENSING.md says ${expected.license}`);
    if (entry.license !== h.license) problems.push(`${path}: manifest license ${entry.license} ≠ header ${h.license}`);
    if (entry.attribution !== h.attribution) problems.push(`${path}: manifest attribution “${entry.attribution}” ≠ header “${h.attribution}”`);
    if (!expected.attribution.test(h.attribution)) problems.push(`${path}: attribution “${h.attribution}” does not match ${expected.attribution}`);
    if (expected.sourceUrl && !expected.sourceUrl.test(h.source.url)) problems.push(`${path}: source url ${h.source.url}`);
    if (expected.notice && !expected.notice.test(`${h.attribution} ${h.changes} ${h.licenseUrl ?? ""}`)) problems.push(`${path}: no ${expected.notice} notice in the header`);
    if (!/\d{4}-\d{2}-\d{2}/.test(h.changes)) problems.push(`${path}: the statement of changes carries no date`);
    if (!/no warranty|without warranty/i.test(h.warranty)) problems.push(`${path}: warranty statement “${h.warranty}”`);
  }
  expect(problems).toEqual([]);
});

test("license notices read as sentences: no part's attribution or statement of changes is garbled", () => {
  const garbled = build.manifest.files
    .filter((file) => file.role !== "upstream")
    .flatMap((file) => {
      const h = file.role === "details" ? null : header(file.path);
      return [file.attribution, h?.attribution ?? "", h?.changes ?? ""].map((text) => ({ path: file.path, text }));
    })
    .filter(({ text }) => /\bunder from\b|\b(\w+) \1\b/i.test(text))
    .map(({ path, text }) => `${path}: “${text}”`);
  expect([...new Set(garbled)]).toEqual([]);
});

test("each source part's commit is the commit of the upstream snapshot the build ships, and SourceInfo agrees", () => {
  const problems: string[] = [];
  for (const source of build.sources) {
    const snapshots = build.manifest.files.filter((f) => f.role === "upstream" && f.origin === source.info.id);
    if (!snapshots.length) problems.push(`${source.info.id}: no upstream snapshot shipped`);
    for (const snapshot of snapshots) {
      if (!snapshot.path.includes(source.info.commit)) problems.push(`${source.info.id}: snapshot ${snapshot.path} is not commit ${source.info.commit}`);
      if (snapshot.license !== source.header.license) problems.push(`${source.info.id}: snapshot license ${snapshot.license} ≠ part ${source.header.license}`);
    }
    if (source.header.source.commit !== source.info.commit) problems.push(`${source.info.id}: header commit ${source.header.source.commit} ≠ SourceInfo ${source.info.commit}`);
  }
  expect(problems).toEqual([]);
});

test("the text of every license the manifest and the headers name is shipped under licenses/", () => {
  const ids = new Set<string>();
  for (const file of build.manifest.files) ids.add(file.license);
  for (const notice of ["AGPL-3.0-only", "AGPL-3.0-or-later"]) ids.add(notice);
  const missing = [...ids]
    .filter((id) => id !== "LicenseRef-per-record" && id !== "NOASSERTION")
    .filter((id) => !existsSync(join(build.dataRoot, "licenses", `${id}.txt`)));
  expect(missing).toEqual([]);
});

test("every icon record names a shipped file, and every shipped icon has a record", () => {
  const icons = JSON.parse(readFileSync(join(build.dir, "icons.json"), "utf8")) as { icons: { file: string; license: string; app: string; author: string }[] };
  const records = new Set(icons.icons.map((r) => r.file));
  const problems: string[] = [];
  for (const record of icons.icons) {
    if (!existsSync(join(build.dataRoot, record.file))) problems.push(`${record.file}: recorded but not shipped`);
    if (!record.author || !record.license) problems.push(`${record.file}: record without author or license`);
  }
  for (const app of build.apps) {
    if (app.atlas.icon && !records.has(app.atlas.icon)) problems.push(`${app.id}: icon ${app.atlas.icon} has no attribution record`);
  }
  expect(problems).toEqual([]);
});

test("awesome-shizuku's category → Droid Atlas category mapping lives in its own CC-BY-SA file, and the atlas part carries no source text", () => {
  const shizuku = build.sources.find((s) => s.info.id === "awesome-shizuku");
  expect(shizuku?.categories.every((c) => c.category === null || (typeof c.category === "string" && build.categories.has(c.category)))).toBe(true);
  expect(shizuku?.categories.some((c) => c.category !== null)).toBe(true);
  const atlasText = readFileSync(join(build.dir, "atlas.json"), "utf8");
  const descriptions = (shizuku?.listings ?? []).map((l) => l.description).filter((d): d is string => Boolean(d) && (d?.length ?? 0) > 30);
  const leaked = descriptions.filter((d) => atlasText.includes(JSON.stringify(d).slice(1, -1)));
  expect(leaked).toEqual([]);
});

test("every F-Droid and IzzyOnDroid record states its own license (LicenseRef-per-record)", () => {
  const problems: string[] = [];
  for (const [origin, part] of [["fdroid", build.fdroid], ["izzy", build.izzy]] as const) {
    for (const [id, record] of Object.entries(part.apps)) {
      if (!("license" in record)) problems.push(`${origin} ${id}: no license field`);
      else if (record.license === null && record.summary !== null) problems.push(`${origin} ${id}: summary shipped with no license stated`);
    }
  }
  expect(problems).toEqual([]);
});
