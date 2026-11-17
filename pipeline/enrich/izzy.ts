import { parseIndex, type IndexData } from "./index-v2.ts";

export const IZZY = {
  indexUrl: "https://apt.izzysoft.de/fdroid/repo/index-v2.json",
  repoBase: "https://apt.izzysoft.de/fdroid/repo",
  cacheFile: "izzy-index-v2.json",
} as const;

export function parseIzzyIndex(json: unknown): IndexData {
  return parseIndex("izzy", IZZY.repoBase, json);
}
