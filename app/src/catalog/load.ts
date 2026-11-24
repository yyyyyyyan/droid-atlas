/**
 * Loading a build. `version.json` (the one mutable file) names a manifest by
 * hash; the manifest lists every file of the build with its sha256, license
 * and attribution. A file is used only when its bytes match the manifest.
 *
 * This module holds what does not depend on how a catalog is assembled: the
 * loader's result, the verified fetch, the manifest, and the on-demand files
 * (description shards, icon attributions). `source.ts` is the one place that
 * turns a manifest into a `Catalog`.
 */

import { CATALOG_SCHEMA_VERSION, detailsShard, type Catalog, type CatalogVersion, type DetailsEntry, type DetailsShard, type Origin } from "./schema.ts";
import type { IconRecord, Manifest, ManifestFile, PartHeader } from "../../../schema/parts.ts";
import type { AndroidStatements } from "./permissions.ts";

export type { IconRecord, Manifest, ManifestFile, PartHeader };

export type LoadFailure = "offline" | "missing" | "newer-schema" | "damaged";

export class CatalogError extends Error {
  readonly kind: LoadFailure;

  constructor(kind: LoadFailure, message: string) {
    super(message);
    this.name = "CatalogError";
    this.kind = kind;
  }
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** SHA-256 of a buffer as lower-case hex, or null where the platform offers no digest (a page not served securely). */
export type Digest = (bytes: ArrayBuffer) => Promise<string | null>;

export interface LoadedBuild {
  version: CatalogVersion;
  manifest: Manifest;
  /** Absolute URL of the directory that holds the manifest, ending in a slash. */
  base: string;
  /** Absolute URL of the data root, ending in a slash. Icons live under it. */
  dataRoot: string;
  /** False when files could not be checked against the manifest because the platform has no digest. */
  verified: boolean;
}

/** A part that was loaded, with the license and provenance statement it opens with (null when the statement is malformed). */
export interface LoadedPart {
  file: ManifestFile;
  header: PartHeader | null;
}

export interface LoadedCatalog extends LoadedBuild {
  catalog: Catalog;
  /** The parts the catalog was joined from, in the order the manifest lists them. */
  parts: LoadedPart[];
  /** Android's statements about the permissions apps declare; null when the build has none, or they are not in the expected form. */
  android: AndroidStatements | null;
}

/**
 * Turns a build into a catalog. The implementation lives in `source.ts`. With `known`, the build that version names is
 * loaded and `version.json` is not fetched: a launch renders the build stored on the device, not the one the site serves now.
 */
export type CatalogSource = (dataRoot: string, versionFile: string, fetcher: Fetch, digest: Digest, known?: CatalogVersion) => Promise<LoadedCatalog>;

export const sha256: Digest = async (bytes) => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const hash = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the header a part opens with. Every field is a string the views render as text; anything else makes the header unusable. */
export function readHeader(part: unknown): PartHeader | null {
  if (!isRecord(part) || !isRecord(part.header) || !isRecord(part.header.source)) return null;
  const { source, license, licenseUrl, attribution, changes, warranty } = part.header;
  const text = (value: unknown): value is string => typeof value === "string";
  if (!text(source.name) || !text(source.url) || !text(source.retrieved) || !(source.commit === null || text(source.commit))) return null;
  if (!text(license) || !(licenseUrl === null || text(licenseUrl)) || !text(attribution) || !text(changes) || !text(warranty)) return null;
  return {
    source: { name: source.name, url: source.url, commit: source.commit, retrieved: source.retrieved },
    license,
    licenseUrl,
    attribution,
    changes,
    warranty,
  };
}

/**
 * The URL of a file the manifest lists. Unlike `dataUrl`, the path may climb out of the build's own directory
 * (upstream snapshots and icons live beside the builds), but never out of the data root.
 */
export function manifestFileUrl(build: Pick<LoadedBuild, "base" | "dataRoot">, path: unknown): string | null {
  if (typeof path !== "string" || path === "" || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/") || path.includes("\\")) return null;
  if (!/^[A-Za-z0-9._~\-/%@+]+$/.test(path)) return null;
  let url: string;
  try {
    url = new URL(path, build.base).href;
  } catch {
    return null;
  }
  return url.startsWith(build.dataRoot) ? url : null;
}

/** Accepts only a plain relative path below `base`: no scheme, no host, no climbing out. */
export function dataUrl(base: string, path: unknown): string | null {
  if (typeof path !== "string" || path === "") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("/") || path.includes("\\")) return null;
  if (path.split("/").some((segment) => segment === ".." || segment === "." || segment === "")) return null;
  if (!/^[A-Za-z0-9._~\-/%@+]+$/.test(path)) return null;
  return base + path;
}

async function fetchBytes(fetcher: Fetch, url: string, init?: RequestInit): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw new CatalogError("offline", "The catalog could not be reached.");
  }
  if (!response.ok) throw new CatalogError("missing", `The server answered ${response.status} for part of the catalog.`);
  try {
    return await response.arrayBuffer();
  } catch {
    throw new CatalogError("offline", "The connection dropped while the catalog was loading.");
  }
}

/** Parses a file and records how long that took as a `atlas:json-parse` performance entry, for the parse budget. */
function parseJson(bytes: ArrayBuffer): unknown {
  const start = performance.now();
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CatalogError("damaged", "A catalog file is not valid JSON.");
  } finally {
    performance.measure("atlas:json-parse", { start, end: performance.now(), detail: { bytes: bytes.byteLength } });
  }
}

function readVersion(value: unknown): CatalogVersion {
  if (!isRecord(value) || typeof value.schema !== "number") throw new CatalogError("damaged", "version.json is not in the expected form.");
  if (value.schema > CATALOG_SCHEMA_VERSION) throw new CatalogError("newer-schema", "The catalog is in a newer format than this version of the app reads.");
  const { hash, manifest, generatedAt } = value;
  if (value.schema !== CATALOG_SCHEMA_VERSION || typeof hash !== "string" || typeof manifest !== "string" || typeof generatedAt !== "string") {
    throw new CatalogError("damaged", "version.json is not in the expected form.");
  }
  return { schema: CATALOG_SCHEMA_VERSION, generatedAt, hash, manifest };
}

function isManifestFile(value: unknown): value is ManifestFile {
  return isRecord(value) && typeof value.path === "string" && typeof value.role === "string" && typeof value.origin === "string"
    && typeof value.sha256 === "string" && typeof value.license === "string" && typeof value.attribution === "string";
}

function readManifest(value: unknown, version: CatalogVersion): Manifest {
  if (isRecord(value) && typeof value.schema === "number" && value.schema > CATALOG_SCHEMA_VERSION) {
    throw new CatalogError("newer-schema", "The catalog is in a newer format than this version of the app reads.");
  }
  if (!isRecord(value) || value.schema !== CATALOG_SCHEMA_VERSION || !Array.isArray(value.files) || !value.files.every(isManifestFile)
    || typeof value.detailsShards !== "number" || !Number.isInteger(value.detailsShards) || value.detailsShards < 1) {
    throw new CatalogError("damaged", "The build manifest is not in the expected form.");
  }
  if (value.hash !== version.hash) throw new CatalogError("damaged", "The build manifest does not match the version that names it.");
  return value as unknown as Manifest;
}

/** Fetches `version.json` (never from the HTTP cache), unless the version is already known, and the manifest it names. */
export async function loadBuild(dataRoot: string, versionFile: string, fetcher: Fetch, digest: Digest, known?: CatalogVersion): Promise<LoadedBuild> {
  const version = known ? readVersion(known) : readVersion(parseJson(await fetchBytes(fetcher, dataRoot + versionFile, { cache: "no-cache" })));
  const manifestUrl = dataUrl(dataRoot, version.manifest);
  if (!manifestUrl) throw new CatalogError("damaged", "version.json points outside the data directory.");
  const manifest = readManifest(parseJson(await fetchBytes(fetcher, manifestUrl)), version);
  const verified = (await digest(new ArrayBuffer(0))) !== null;
  return { version, manifest, base: manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1), dataRoot, verified };
}

/** Fetches one file the manifest lists and returns its JSON only when the bytes match the manifest's sha256. */
export async function fetchListed(build: Pick<LoadedBuild, "base">, file: ManifestFile, fetcher: Fetch, digest: Digest): Promise<unknown> {
  const url = dataUrl(build.base, file.path);
  if (!url) throw new CatalogError("damaged", "The build manifest lists a file outside its directory.");
  const bytes = await fetchBytes(fetcher, url);
  const actual = await digest(bytes);
  if (actual !== null && actual !== file.sha256.toLowerCase()) {
    throw new CatalogError("damaged", `${file.path} does not match the build manifest.`);
  }
  return parseJson(bytes);
}

export interface Description {
  origin: Origin;
  text: string;
}

/** One index's permission names for an app, and the API level each name it declares only up to is capped at. */
export interface DeclaredNames {
  names: string[];
  caps: Record<string, number>;
}

/** What the description lookup reads for an app: the description, and the permission names in each shard it read, in the order it read them. */
export interface DetailsRead {
  description: Description | null;
  permissions: ({ origin: "fdroid" | "izzy" } & DeclaredNames)[];
}

export interface OnDemand {
  /**
   * The long description of an app, with the permission names of every shard
   * read to find it. The build holds at most one description per app, in the
   * shard of the first repository index that has one, so the origins that
   * index the app (`App.index`) are tried in the pipeline's order, F-Droid then
   * IzzyOnDroid, one shard at a time, and the second is fetched only when the
   * first has no description for this app. No shard is fetched for an origin
   * that does not index the app, so the names add no request to an open
   * sheet. Rejects when a shard cannot be loaded.
   */
  detailsRead(appId: string, indexedBy: readonly Origin[]): Promise<DetailsRead>;
  /**
   * The permission names one index states for the app, in the order the
   * build stores them, with their caps, from that index's details shard
   * alone. Empty when the shard has none for the app. Rejects when the shard
   * cannot be loaded.
   */
  permissionNames(appId: string, origin: "fdroid" | "izzy"): Promise<DeclaredNames>;
  /** The attribution record of a self-hosted icon, by the path `App.icon` holds. Null when there is none. */
  iconRecord(iconPath: string): Promise<IconRecord | null>;
  /** Every icon attribution record of the build, with the header of the file that holds them. Rejects when the file cannot be loaded. */
  iconCredits(): Promise<{ header: PartHeader | null; records: IconRecord[] }>;
}

/** The order in which the pipeline looks for an app's long description. */
const DESCRIPTION_ORIGINS: readonly ("fdroid" | "izzy")[] = ["fdroid", "izzy"];

const ICON_TEXT_FIELDS = ["file", "fileLarge", "app", "name", "rule", "retrieved", "author", "license", "changes"] as const;

/** Whether a value read from the build's icons file has every field of an icon record, each of its type. */
export function isIconRecord(record: unknown): record is IconRecord {
  if (!isRecord(record)) return false;
  const nullableText = (value: unknown): boolean => value === null || typeof value === "string";
  return ICON_TEXT_FIELDS.every((field) => typeof record[field] === "string")
    && nullableText(record.revision)
    && nullableText(record.project)
    && isRecord(record.original) && typeof record.original.url === "string" && typeof record.original.sha256 === "string";
}

export function createOnDemand(build: LoadedBuild, fetcher: Fetch = fetch, digest: Digest = sha256): OnDemand {
  const cache = new Map<string, Promise<unknown>>();
  const listed = (file: ManifestFile): Promise<unknown> => {
    const cached = cache.get(file.path);
    if (cached) return cached;
    const pending = fetchListed(build, file, fetcher, digest);
    cache.set(file.path, pending);
    pending.catch(() => cache.delete(file.path));
    return pending;
  };
  const detailFiles = build.manifest.files.filter((file) => file.role === "details");
  const iconsFile = build.manifest.files.find((file) => file.role === "icons") ?? null;
  let icons: Promise<Map<string, IconRecord>> | null = null;

  const detailsEntry = async (appId: string, origin: Origin): Promise<DetailsEntry | null> => {
    const path = `details/${origin}/${detailsShard(appId, build.manifest.detailsShards)}.json`;
    const file = detailFiles.find((candidate) => candidate.path === path);
    if (!file) return null;
    const content = await listed(file);
    const entry = isRecord(content) && Object.hasOwn(content, appId) ? (content as DetailsShard)[appId] : undefined;
    return isRecord(entry) ? entry : null;
  };

  /** A cap is kept only for a listed name, as a whole number from 1 to 1000. */
  const namesOf = (entry: DetailsEntry | null): DeclaredNames => {
    const listed: unknown = entry?.permissions;
    const names = Array.isArray(listed) ? listed.filter((name): name is string => typeof name === "string" && name.trim() !== "") : [];
    const given: unknown = entry?.permissionCaps;
    const caps: Record<string, number> = {};
    if (isRecord(given)) {
      for (const name of names) {
        const cap = Object.hasOwn(given, name) ? given[name] : undefined;
        if (typeof cap === "number" && Number.isInteger(cap) && cap >= 1 && cap <= 1000) caps[name] = cap;
      }
    }
    return { names, caps };
  };

  const detailsRead = async (appId: string, indexedBy: readonly Origin[]): Promise<DetailsRead> => {
    const permissions: DetailsRead["permissions"] = [];
    for (const origin of DESCRIPTION_ORIGINS) {
      if (!indexedBy.includes(origin)) continue;
      const entry = await detailsEntry(appId, origin);
      permissions.push({ origin, ...namesOf(entry) });
      if (entry && typeof entry.description === "string" && entry.description.trim()) return { description: { origin, text: entry.description }, permissions };
    }
    return { description: null, permissions };
  };

  return {
    detailsRead,
    async permissionNames(appId, origin) {
      return namesOf(await detailsEntry(appId, origin));
    },
    async iconRecord(iconPath) {
      if (!iconsFile) return null;
      icons ??= listed(iconsFile).then((value) => {
        const records = isRecord(value) && Array.isArray(value.icons) ? (value.icons as unknown[]).filter(isIconRecord) : [];
        return new Map(records.flatMap((record) => [[record.file, record], [record.fileLarge, record]]));
      });
      icons.catch(() => {
        icons = null;
      });
      return (await icons).get(iconPath) ?? null;
    },
    async iconCredits() {
      if (!iconsFile) return { header: null, records: [] };
      const value = await listed(iconsFile);
      const records = isRecord(value) && Array.isArray(value.icons) ? (value.icons as unknown[]).filter(isIconRecord) : [];
      return { header: readHeader(value), records };
    },
  };
}
