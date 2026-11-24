/**
 * Turns a build into the in-memory `Catalog`. This is the one file that knows
 * how a catalog is assembled: the manifest's atlas, source, index and GitHub
 * parts are fetched in parallel, each is checked against the manifest, and
 * `joinCatalog` (shared with the pipeline) puts them together. Android's
 * statements about permissions, where the build has them, are fetched with
 * them and kept beside the catalog. The sources' text reaches the app only
 * this way, through `fetch`.
 */

import { joinCatalog, type CatalogParts } from "../../../schema/join.ts";
import type { AtlasPart, GithubPart, IndexPart, SourcePart } from "../../../schema/parts.ts";
import { CATALOG_SCHEMA_VERSION } from "./schema.ts";
import { CatalogError, fetchListed, isRecord, loadBuild, readHeader, type CatalogSource, type LoadedPart, type ManifestFile } from "./load.ts";
import { readAndroidStatements } from "./permissions.ts";

function newer(): CatalogError {
  return new CatalogError("newer-schema", "The catalog is in a newer format than this version of the app reads.");
}

function malformed(file: ManifestFile): CatalogError {
  return new CatalogError("damaged", `${file.path} is not in the expected form.`);
}

function readAtlas(value: unknown, file: ManifestFile, hash: string): AtlasPart {
  if (isRecord(value) && typeof value.schema === "number" && value.schema > CATALOG_SCHEMA_VERSION) throw newer();
  const shaped = isRecord(value) && value.schema === CATALOG_SCHEMA_VERSION && Array.isArray(value.apps) && Array.isArray(value.regions)
    && isRecord(value.redirects) && typeof value.generatedAt === "string";
  if (!shaped) throw malformed(file);
  if (value.hash !== hash) throw new CatalogError("damaged", "The catalog does not match the version that names it.");
  return value as unknown as AtlasPart;
}

function readSource(value: unknown, file: ManifestFile): SourcePart {
  if (!isRecord(value) || !isRecord(value.info) || !Array.isArray(value.categories) || !Array.isArray(value.listings)) throw malformed(file);
  return value as unknown as SourcePart;
}

function readIndex(value: unknown, file: ManifestFile): IndexPart {
  if (!isRecord(value) || (value.origin !== "fdroid" && value.origin !== "izzy") || !isRecord(value.apps)) throw malformed(file);
  return value as unknown as IndexPart;
}

function readGithub(value: unknown, file: ManifestFile): GithubPart {
  if (!isRecord(value) || !isRecord(value.apps) || typeof value.fetchedAt !== "string") throw malformed(file);
  return value as unknown as GithubPart;
}

export const loadCatalog: CatalogSource = async (dataRoot, versionFile, fetcher, digest, known) => {
  const build = await loadBuild(dataRoot, versionFile, fetcher, digest, known);
  const ofRole = (role: ManifestFile["role"]): ManifestFile[] => build.manifest.files.filter((file) => file.role === role);
  const [atlasFile] = ofRole("atlas");
  const [githubFile] = ofRole("github");
  const [androidFile] = ofRole("android");
  if (!atlasFile || !githubFile || ofRole("source").length === 0) {
    throw new CatalogError("damaged", "The build manifest does not list the parts a catalog is made of.");
  }
  const loaded: LoadedPart[] = [];
  const get = async (file: ManifestFile): Promise<unknown> => {
    const value = await fetchListed(build, file, fetcher, digest);
    loaded.push({ file, header: readHeader(value) });
    return value;
  };
  const [atlas, github, sources, indexes, android] = await Promise.all([
    get(atlasFile).then((value) => readAtlas(value, atlasFile, build.version.hash)),
    get(githubFile).then((value) => readGithub(value, githubFile)),
    Promise.all(ofRole("source").map((file) => get(file).then((value) => readSource(value, file)))),
    Promise.all(ofRole("index").map((file) => get(file).then((value) => readIndex(value, file)))),
    androidFile ? get(androidFile).then(readAndroidStatements) : Promise.resolve(null),
  ]);
  const parts: CatalogParts = { atlas, sources, indexes, github };
  /* The join gets a task of its own, so it never adds to the task that parsed the last part to arrive. */
  await new Promise((resolve) => setTimeout(resolve, 0));
  const start = performance.now();
  const catalog = joinCatalog(parts);
  performance.measure("atlas:join", { start, end: performance.now() });
  const order = build.manifest.files;
  return { ...build, catalog, parts: loaded.sort((a, b) => order.indexOf(a.file) - order.indexOf(b.file)), android };
};
