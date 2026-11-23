/**
 * Reads what one package's manifest declares, by address, without
 * downloading the whole file and without running anything: the zip's
 * directory and the `AndroidManifest.xml` entry are the only parts requested.
 * The resource table is never read, so labels are not part of a reading.
 */
import { createHash } from "node:crypto";
import { PACKAGE_READING_FORMAT, type PackageReading } from "../../schema/package-reading.ts";
import { AxmlError, parseAxml } from "./axml.ts";
import { HttpReadError, openPackage, packageHost, type OpenOptions } from "./http.ts";
import { ManifestError, readManifest } from "./manifest.ts";
import { findEntry, readDirectory, readEntry, ZipError } from "./zip.ts";

export interface ReadOptions extends OpenOptions {
  /** SHA-256 of the whole file as its host's index or release states it. */
  sha256?: string | null;
  now?: () => Date;
}

/** A reading that could not be made, with the stage that refused it. */
export class PackageReadError extends Error {
  /** "unexpected" is any error the reader did not foresee: a reading never fails with anything but this class. */
  readonly stage: "address" | "http" | "zip" | "manifest" | "unexpected";
  constructor(stage: PackageReadError["stage"], message: string) {
    super(message);
    this.stage = stage;
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/;
const FILE_NAME_RE = /^[A-Za-z0-9._+-]{1,255}$/;

function fileName(address: string): string {
  const last = new URL(address).pathname.split("/").at(-1) ?? "";
  let name: string;
  try {
    name = decodeURIComponent(last);
  } catch {
    throw new PackageReadError("address", "file name is not valid percent-encoding");
  }
  if (!FILE_NAME_RE.test(name)) throw new PackageReadError("address", "file name has unexpected characters");
  return name;
}

function rethrow(error: unknown): never {
  if (error instanceof PackageReadError) throw error;
  if (error instanceof HttpReadError) throw new PackageReadError("http", error.message);
  if (error instanceof ZipError) throw new PackageReadError("zip", error.message);
  if (error instanceof AxmlError || error instanceof ManifestError) throw new PackageReadError("manifest", error.message);
  throw new PackageReadError("unexpected", error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "unknown error");
}

/** Reads one package. Throws `PackageReadError` when the address, the server or the file is not as expected. */
export async function readPackage(address: string, options: ReadOptions = {}): Promise<PackageReading> {
  const sha256 = options.sha256?.toLowerCase() ?? null;
  if (sha256 !== null && !SHA256_RE.test(sha256)) throw new PackageReadError("address", "sha256 is not 64 hexadecimal digits");
  if (!packageHost(address, options.hosts)) throw new PackageReadError("address", "not an allowed package address, or not in the form the URL parser gives it");
  try {
    const name = fileName(address);
    const source = await openPackage(address, options);
    const directory = await readDirectory(source);
    const manifestBytes = await readEntry(source, directory, findEntry(directory, "AndroidManifest.xml"));
    const facts = readManifest(parseAxml(manifestBytes));
    return {
      format: PACKAGE_READING_FORMAT,
      evidence: "statically-discovered",
      source: { host: source.host, url: address },
      file: { name, sizeBytes: source.size, sha256 },
      readAt: (options.now ?? (() => new Date()))().toISOString(),
      package: facts.package,
      version: facts.version,
      manifest: { sha256: createHash("sha256").update(manifestBytes).digest("hex"), sizeBytes: manifestBytes.byteLength },
      transfer: { ...source.transfer },
      interfaces: facts.interfaces,
    };
  } catch (error) {
    rethrow(error);
  }
}
