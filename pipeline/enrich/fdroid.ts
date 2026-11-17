import { parseIndex, type IndexData } from "./index-v2.ts";

export const FDROID = {
  indexUrl: "https://f-droid.org/repo/index-v2.json",
  repoBase: "https://f-droid.org/repo",
  cacheFile: "fdroid-index-v2.json",
} as const;

export function parseFdroidIndex(json: unknown): IndexData {
  return parseIndex("fdroid", FDROID.repoBase, json);
}
