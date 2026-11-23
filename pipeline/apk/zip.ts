/**
 * Reads one entry of a zip file (an Android package is one) through byte
 * ranges: the end record, the central directory, then the entry's own bytes.
 * The rest of the file is never requested.
 *
 * Every size, count and offset comes from the untrusted file and is checked
 * against `ZipLimits` and against the file's size before it is used. Zip64,
 * split archives, encryption and compression other than deflate are refused.
 */
import { crc32, inflateRawSync } from "node:zlib";

/** Random access to a file of known size. */
export interface RangeSource {
  readonly size: number;
  /** Exactly `length` bytes from `start`, or an error. */
  read(start: number, length: number): Promise<Uint8Array>;
}

export interface ZipLimits {
  maxDirectoryBytes: number;
  maxEntries: number;
  maxCompressedBytes: number;
  maxUncompressedBytes: number;
}

export const ZIP_LIMITS: Readonly<ZipLimits> = {
  maxDirectoryBytes: 8 * 1024 * 1024,
  maxEntries: 65_535,
  maxCompressedBytes: 2 * 1024 * 1024,
  maxUncompressedBytes: 4 * 1024 * 1024,
};

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

export interface ZipDirectory {
  entries: ZipEntry[];
  /** Where the central directory starts: every entry's data ends before it. */
  directoryOffset: number;
}

export class ZipError extends Error {}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const CENTRAL_SIZE = 46;
const LOCAL_SIZE = 30;
/** Room for a local header's extra field (alignment padding) fetched with the entry, saving a request. */
const LOCAL_EXTRA_ALLOWANCE = 512;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findEndRecord(tail: Uint8Array): number {
  const data = view(tail);
  for (let at = tail.byteLength - EOCD_SIZE; at >= 0; at--) {
    if (data.getUint32(at, true) === EOCD_SIGNATURE && at + EOCD_SIZE + data.getUint16(at + 20, true) <= tail.byteLength) return at;
  }
  throw new ZipError("no end of central directory record");
}

/** Reads the central directory: one request for the file's tail, and a second only when the directory starts before it. */
export async function readDirectory(source: RangeSource, limits: ZipLimits = ZIP_LIMITS): Promise<ZipDirectory> {
  if (source.size < EOCD_SIZE) throw new ZipError("file too small to be a zip");
  const tailLength = Math.min(source.size, EOCD_SIZE + MAX_COMMENT);
  const tailStart = source.size - tailLength;
  const tail = await source.read(tailStart, tailLength);
  const at = findEndRecord(tail);
  const eocd = view(tail);
  const disk = eocd.getUint16(at + 4, true);
  const directoryDisk = eocd.getUint16(at + 6, true);
  const diskEntries = eocd.getUint16(at + 8, true);
  const count = eocd.getUint16(at + 10, true);
  const directorySize = eocd.getUint32(at + 12, true);
  const directoryOffset = eocd.getUint32(at + 16, true);
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== count) throw new ZipError("split archives are not supported");
  if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new ZipError("zip64 is not supported");
  if (count > limits.maxEntries) throw new ZipError(`${count} entries`);
  if (directorySize > limits.maxDirectoryBytes) throw new ZipError(`central directory of ${directorySize} bytes`);
  const endRecordOffset = tailStart + at;
  if (directoryOffset + directorySize > endRecordOffset) throw new ZipError("central directory overlaps its end record");

  const directory =
    directoryOffset >= tailStart
      ? tail.subarray(directoryOffset - tailStart, directoryOffset - tailStart + directorySize)
      : await source.read(directoryOffset, directorySize);
  const data = view(directory);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  let position = 0;
  for (let i = 0; i < count; i++) {
    if (position + CENTRAL_SIZE > directory.byteLength) throw new ZipError("central directory is truncated");
    if (data.getUint32(position, true) !== CENTRAL_SIGNATURE) throw new ZipError("bad central directory entry");
    const nameLength = data.getUint16(position + 28, true);
    const extraLength = data.getUint16(position + 30, true);
    const commentLength = data.getUint16(position + 32, true);
    const next = position + CENTRAL_SIZE + nameLength + extraLength + commentLength;
    if (next > directory.byteLength) throw new ZipError("central directory entry runs past the directory");
    let name: string;
    try {
      name = decoder.decode(directory.subarray(position + CENTRAL_SIZE, position + CENTRAL_SIZE + nameLength));
    } catch {
      throw new ZipError("entry name is not UTF-8");
    }
    entries.push({
      name,
      flags: data.getUint16(position + 8, true),
      method: data.getUint16(position + 10, true),
      crc32: data.getUint32(position + 16, true),
      compressedSize: data.getUint32(position + 20, true),
      size: data.getUint32(position + 24, true),
      localHeaderOffset: data.getUint32(position + 42, true),
    });
    position = next;
  }
  return { entries, directoryOffset };
}

/** The one entry of that name. Two entries of one name are refused, as Android refuses them. */
export function findEntry(directory: ZipDirectory, name: string): ZipEntry {
  const matches = directory.entries.filter((entry) => entry.name === name);
  if (matches.length === 0) throw new ZipError(`no ${name}`);
  if (matches.length > 1) throw new ZipError(`${matches.length} entries named ${name}`);
  return matches[0] as ZipEntry;
}

/** The uncompressed bytes of an entry, checked against its stated size and CRC-32. */
export async function readEntry(
  source: RangeSource,
  directory: ZipDirectory,
  entry: ZipEntry,
  limits: ZipLimits = ZIP_LIMITS,
): Promise<Uint8Array> {
  if (entry.flags & 0x1) throw new ZipError(`${entry.name} is encrypted`);
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`${entry.name} uses compression method ${entry.method}`);
  if (entry.compressedSize > limits.maxCompressedBytes) throw new ZipError(`${entry.name} is ${entry.compressedSize} bytes compressed`);
  if (entry.size > limits.maxUncompressedBytes) throw new ZipError(`${entry.name} is ${entry.size} bytes uncompressed`);
  const nameBytes = new TextEncoder().encode(entry.name).byteLength;
  const limit = directory.directoryOffset;
  if (entry.localHeaderOffset + LOCAL_SIZE + nameBytes + entry.compressedSize > limit) throw new ZipError(`${entry.name} runs into the central directory`);

  const first = Math.min(LOCAL_SIZE + nameBytes + LOCAL_EXTRA_ALLOWANCE + entry.compressedSize, limit - entry.localHeaderOffset);
  let bytes = await source.read(entry.localHeaderOffset, first);
  const header = view(bytes);
  if (header.getUint32(0, true) !== LOCAL_SIGNATURE) throw new ZipError(`bad local header for ${entry.name}`);
  if (header.getUint16(26, true) !== nameBytes) throw new ZipError(`local header of ${entry.name} names another entry`);
  const dataStart = LOCAL_SIZE + nameBytes + header.getUint16(28, true);
  const dataEnd = dataStart + entry.compressedSize;
  if (entry.localHeaderOffset + dataEnd > limit) throw new ZipError(`${entry.name} runs into the central directory`);
  if (dataEnd > bytes.byteLength) {
    const rest = await source.read(entry.localHeaderOffset + bytes.byteLength, dataEnd - bytes.byteLength);
    const joined = new Uint8Array(dataEnd);
    joined.set(bytes);
    joined.set(rest, bytes.byteLength);
    bytes = joined;
  }
  const stored = bytes.subarray(dataStart, dataEnd);
  let content: Uint8Array;
  if (entry.method === 0) {
    content = stored;
  } else {
    try {
      content = inflateRawSync(stored, { maxOutputLength: limits.maxUncompressedBytes });
    } catch (error) {
      throw new ZipError(`${entry.name} does not inflate: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (content.byteLength !== entry.size) throw new ZipError(`${entry.name} is ${content.byteLength} bytes, not the ${entry.size} stated`);
  if (crc32(content) !== entry.crc32) throw new ZipError(`${entry.name} fails its CRC-32`);
  return content;
}
