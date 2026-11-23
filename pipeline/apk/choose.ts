/**
 * Which APK of a GitHub release is read, when a release carries several.
 *
 * The rule: among the release's `.apk` assets, leave out any whose name
 * contains "debug". Of the rest, take those whose name names no processor
 * architecture (a universal build); the largest of them, ties broken by name.
 * When every APK names an architecture, take the arm64 ones the same way.
 * Otherwise no file is read.
 */

export interface ReleaseAsset {
  name: string;
  size: number;
  /** `browser_download_url`. */
  url: string;
  /** SHA-256 as the release API states it, or null when it states none. */
  sha256: string | null;
  /** ISO time GitHub last changed the asset. */
  updatedAt: string;
}

const APK_RE = /\.apk$/i;
const DEBUG_RE = /debug/i;
const SEPARATOR = "(?:^|[-_.\\s])";
const END = "(?=[-_.\\s]|$)";
const ABI_RE = new RegExp(`${SEPARATOR}(arm64-v8a|arm64|aarch64|armeabi-v7a|armeabi|armv7a?|armv8a?|arm|x86_64|x86-64|x86|x64|mips64|mips)${END}`, "i");
const ARM64_RE = new RegExp(`${SEPARATOR}(arm64-v8a|arm64|aarch64|armv8a?)${END}`, "i");

function largest(assets: readonly ReleaseAsset[]): ReleaseAsset | null {
  const sorted = [...assets].sort((a, b) => b.size - a.size || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sorted[0] ?? null;
}

/** The APK the rule picks, or null when the release has none it accepts. */
export function chooseApk(assets: readonly ReleaseAsset[]): ReleaseAsset | null {
  const apks = assets.filter((asset) => APK_RE.test(asset.name) && !DEBUG_RE.test(asset.name));
  const universal = apks.filter((asset) => !ABI_RE.test(asset.name.replace(APK_RE, "")));
  if (universal.length) return largest(universal);
  return largest(apks.filter((asset) => ARM64_RE.test(asset.name.replace(APK_RE, ""))));
}
