/**
 * Writes `pipeline/android/permissions.json`, Android's statements about
 * its own permissions at one released platform tag (`lib/android-permissions.ts`).
 *
 *   node scripts/vendor-android-permissions.ts android-17.0.0_r1 --release-config cp2a
 *
 * The release configuration is the one the tag's build was made with: the
 * first four characters of its build id, lower-cased, as
 * https://source.android.com/docs/setup/reference/build-numbers lists them
 * (android-17.0.0_r1 is CP2A.260605.016, so cp2a).
 *
 * Reads, at the tag: `core/res/AndroidManifest.xml` and
 * `core/res/res/values/strings.xml` of platform/frameworks/base through
 * Gitiles, and the release configurations and flag values of
 * platform/build/release from a shallow clone in a temporary directory,
 * removed afterwards. Run by hand; the daily build reads only the table.
 *
 * The flag values are the release's default configuration. The script
 * prints how many of the flags the declarations depend on the configuration
 * sets read-only, which no device can change, and how many it does not set.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  ANDROID_TABLE_PATH,
  androidVersionOf,
  buildTable,
  checkAndroidTable,
  parseBuildFlagValue,
  parseFlagValues,
  parseReleaseConfig,
  permissionDeclarations,
  resolveFlags,
  serializeTable,
  stringResources,
  type AndroidTable,
  type ReleaseConfig,
} from "../lib/android-permissions.ts";
import { retry } from "../lib/retry.ts";

const FRAMEWORKS = "https://android.googlesource.com/platform/frameworks/base";
const RELEASE = "https://android.googlesource.com/platform/build/release";
const FILES = ["core/res/AndroidManifest.xml", "core/res/res/values/strings.xml"] as const;
const USER_AGENT = "droid-atlas-pipeline";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { "release-config": { type: "string" } } });
const tag = positionals[0] ?? "";
const releaseConfig = values["release-config"] ?? "";
const androidVersion = androidVersionOf(tag);
if (!/^[a-z0-9_]+$/.test(releaseConfig)) throw new Error("usage: node scripts/vendor-android-permissions.ts android-17.0.0_r1 --release-config cp2a");

/** The commit a tag points at, peeled through an annotated tag. */
function tagCommit(remote: string): string {
  const out = execFileSync("git", ["ls-remote", "--tags", remote, `refs/tags/${tag}`, `refs/tags/${tag}^{}`], { encoding: "utf8" });
  const lines = out.trim().split("\n").map((line) => line.split("\t"));
  const peeled = lines.find(([, ref]) => ref === `refs/tags/${tag}^{}`) ?? lines.find(([, ref]) => ref === `refs/tags/${tag}`);
  const commit = peeled?.[0] ?? "";
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`${remote} has no tag ${tag}`);
  return commit;
}

async function gitilesFile(commit: string, path: string): Promise<string> {
  return retry(async () => {
    const response = await fetch(`${FRAMEWORKS}/+/${commit}/${path}?format=TEXT`, { headers: { "user-agent": USER_AGENT } });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return Buffer.from(await response.text(), "base64").toString("utf8");
  });
}

function releaseFlags(dir: string, wanted: ReadonlySet<string>, read: "state" | "permission"): Map<string, boolean> {
  const configs = new Map<string, ReleaseConfig>();
  for (const file of readdirSync(join(dir, "release_configs")).filter((name) => name.endsWith(".textproto"))) {
    const config = parseReleaseConfig(readFileSync(join(dir, "release_configs", file), "utf8"));
    configs.set(config.name, config);
  }
  const valueSets = new Map<string, Map<string, boolean>>();
  for (const setDir of readdirSync(join(dir, "aconfig"), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const bp = join(dir, "aconfig", setDir.name, "Android.bp");
    if (!existsSync(bp)) continue;
    const name = /aconfig_value_set\s*\{\s*name:\s*"([^"]+)"/.exec(readFileSync(bp, "utf8"))?.[1];
    if (!name) continue;
    const flags = new Map<string, boolean>();
    for (const pkg of readdirSync(join(dir, "aconfig", setDir.name), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      for (const file of readdirSync(join(dir, "aconfig", setDir.name, pkg.name)).filter((f) => f.endsWith("_flag_values.textproto"))) {
        for (const [flag, on] of parseFlagValues(readFileSync(join(dir, "aconfig", setDir.name, pkg.name, file), "utf8"), read)) flags.set(flag, on);
      }
    }
    valueSets.set(name, flags);
  }
  return resolveFlags(releaseConfig, configs, valueSets, wanted);
}

const commit = tagCommit(FRAMEWORKS);
const releaseCommit = tagCommit(RELEASE);
const [manifest = "", strings = ""] = await Promise.all(FILES.map((path) => gitilesFile(commit, path)));
const declarations = permissionDeclarations(manifest);
const wanted = new Set(declarations.flatMap((declaration) => (declaration.featureFlag ? [declaration.featureFlag.replace(/^!/, "")] : [])));

const work = mkdtempSync(join(tmpdir(), "droid-atlas-release-"));
let flags: Map<string, boolean>;
let readOnly: Map<string, boolean>;
let apiLevel: number;
try {
  execFileSync("git", ["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", tag, RELEASE, work], { stdio: ["ignore", "ignore", "inherit"] });
  const head = execFileSync("git", ["-C", work, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (head !== releaseCommit) throw new Error(`the clone of ${RELEASE} is at ${head}, not ${releaseCommit}`);
  flags = releaseFlags(work, wanted, "state");
  readOnly = releaseFlags(work, wanted, "permission");
  const sdk = parseBuildFlagValue(readFileSync(join(work, "flag_values", releaseConfig, "RELEASE_PLATFORM_SDK_VERSION.textproto"), "utf8"));
  apiLevel = Number(sdk.value);
  if (sdk.name !== "RELEASE_PLATFORM_SDK_VERSION" || !/^\d{1,4}$/.test(sdk.value)) throw new Error(`${releaseConfig} states no platform API level`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

const { rows, counts } = buildTable(declarations, stringResources(strings), flags);
const retrieved = new Date().toISOString().slice(0, 10);
const table: AndroidTable = {
  source: {
    name: "Android Open Source Project",
    repository: FRAMEWORKS,
    tag,
    commit,
    files: [...FILES],
    releaseRepository: RELEASE,
    releaseCommit,
    releaseConfig,
    retrieved,
    license: "Apache-2.0",
  },
  androidVersion,
  apiLevel,
  changes:
    `Extracted by Droid Atlas on ${retrieved} from ${FILES.join(" and ")} at ${tag}: each permission's name and protection level as stated, and its label's default English text with Android's string escapes resolved; `
    + `a label that is not one line of plain text is left out; declarations behind a build flag kept or left out by the flag values of release configuration ${releaseConfig} in platform/build/release at ${tag}, the release's default configuration, a flag it does not set counting as off; `
    + `API level ${apiLevel} as that configuration states it.`,
  permissions: rows,
};
checkAndroidTable(JSON.parse(serializeTable(table)) as unknown);
writeFileSync(ANDROID_TABLE_PATH, serializeTable(table));
const set = [...wanted].filter((flag) => flags.has(flag));
process.stderr.write(`flags the declarations depend on: ${wanted.size}; set by ${releaseConfig}: ${set.length}, ${set.filter((flag) => readOnly.get(flag) === true).length} of them read-only; API level ${apiLevel}\n`);
process.stderr.write(
  `wrote ${counts.rows} permissions, ${counts.labels} with a label, from ${counts.declarations} declarations (${counts.leftOutByFlag} left out by a flag, ${counts.flagNotSet} behind a flag the release does not set) at ${tag} ${commit}\n`,
);
