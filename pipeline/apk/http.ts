/**
 * Byte ranges of a package over HTTPS, under a fixed host list, a request
 * budget and time limits.
 *
 * The first request asks for the file's first four bytes, which tells the
 * size (from `Content-Range`) and that the file starts like a zip. GitHub's
 * file host refuses a request for the last N bytes, so every later request
 * names an explicit range. Redirects are followed by hand, and only to a host
 * the starting host is allowed to send the reader to.
 */
import type { PackageHost } from "../../schema/package-reading.ts";
import type { RangeSource } from "./zip.ts";

export interface HttpLimits {
  requestTimeoutMs: number;
  /** For the whole reading, every request included. */
  totalTimeoutMs: number;
  maxRequests: number;
  /** Response body bytes over the whole reading. */
  maxBytes: number;
  maxRedirects: number;
  /** Largest package accepted, by the size the server states. */
  maxFileBytes: number;
}

export const HTTP_LIMITS: Readonly<HttpLimits> = {
  requestTimeoutMs: 20_000,
  totalTimeoutMs: 90_000,
  maxRequests: 10,
  maxBytes: 16 * 1024 * 1024,
  maxRedirects: 3,
  maxFileBytes: 2 * 1024 * 1024 * 1024,
};

interface HostRule {
  host: PackageHost;
  /** Where a package address may start: hostname and path. */
  start: (url: URL) => boolean;
  /** Hostnames a redirect may lead to. */
  redirects: readonly string[];
}

const FDROID_PATH = /^\/(repo|archive)\/[A-Za-z0-9._-]+\.apk$/;
/** GitHub writes a tag that contains "/" into the address as it is, so the tag may take several segments. */
const GITHUB_PATH = /^\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/releases\/download\/(?:[^/]+\/)+[^/]+\.apk$/i;

/** The hosts a package may be read from. IzzyOnDroid's are deliberately absent. */
export const PACKAGE_HOSTS: readonly HostRule[] = [
  { host: "fdroid", start: (url) => url.hostname === "f-droid.org" && FDROID_PATH.test(url.pathname), redirects: ["f-droid.org"] },
  {
    host: "github",
    start: (url) => url.hostname === "github.com" && GITHUB_PATH.test(url.pathname),
    redirects: ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"],
  },
];

export class HttpReadError extends Error {}

/** A server-given value fit for a message: printable ASCII only, at most 60 characters. */
function clean(value: string | null): string {
  if (value === null) return "none";
  const printable = value.replace(/[^\x20-\x7e]/g, "?");
  return printable.length > 60 ? `${printable.slice(0, 60)}...` : printable;
}

/** Which host a package address belongs to, or null when it is not one the reader may use. */
export function packageHost(address: string, hosts: readonly HostRule[] = PACKAGE_HOSTS): HostRule | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  if (url.href !== address) return null;
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return null;
  return hosts.find((rule) => rule.start(url)) ?? null;
}

const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;

export interface HttpRangeSource extends RangeSource {
  readonly host: PackageHost;
  readonly transfer: { requests: number; bytes: number };
}

export interface OpenOptions {
  fetch?: typeof fetch;
  limits?: HttpLimits;
  hosts?: readonly HostRule[];
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** Opens a package address for range reads. Throws `HttpReadError` when the address is not allowed or the server does not serve ranges. */
export async function openPackage(address: string, options: OpenOptions = {}): Promise<HttpRangeSource> {
  const fetchFn = options.fetch ?? fetch;
  const limits = options.limits ?? HTTP_LIMITS;
  const rule = packageHost(address, options.hosts);
  if (!rule) throw new HttpReadError("not an allowed package address");
  const allowedRedirects = rule.redirects;
  const deadline = AbortSignal.timeout(limits.totalTimeoutMs);
  const transfer = { requests: 0, bytes: 0 };
  let current = address;
  let size: number | null = null;

  async function body(response: Response, expected: number): Promise<Uint8Array> {
    const out = new Uint8Array(expected);
    let filled = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new HttpReadError("response has no body");
    for (;;) {
      const { done, value } = await reader.read().catch((error: unknown) => {
        throw new HttpReadError(`response interrupted: ${clean(error instanceof Error ? error.message : String(error))}`);
      });
      if (done) break;
      if (filled + value.byteLength > expected) {
        await reader.cancel();
        throw new HttpReadError(`server sent more than the ${expected} bytes asked for`);
      }
      out.set(value, filled);
      filled += value.byteLength;
      transfer.bytes += value.byteLength;
      if (transfer.bytes > limits.maxBytes) {
        await reader.cancel();
        throw new HttpReadError(`more than ${limits.maxBytes} bytes received`);
      }
    }
    if (filled !== expected) throw new HttpReadError(`server sent ${filled} of ${expected} bytes`);
    return out;
  }

  async function request(start: number, length: number): Promise<Uint8Array> {
    const end = start + length - 1;
    if (length > limits.maxBytes - transfer.bytes) throw new HttpReadError(`a read of ${length} bytes is over what is left of the byte budget`);
    for (let hops = 0; ; hops++) {
      if (++transfer.requests > limits.maxRequests) throw new HttpReadError(`more than ${limits.maxRequests} requests`);
      let response: Response;
      try {
        response = await fetchFn(current, {
          redirect: "manual",
          headers: { range: `bytes=${start}-${end}`, "accept-encoding": "identity", "user-agent": "droid-atlas-pipeline" },
          signal: AbortSignal.any([deadline, AbortSignal.timeout(limits.requestTimeoutMs)]),
        });
      } catch (error) {
        throw new HttpReadError(`request failed: ${clean(error instanceof Error ? error.message : String(error))}`);
      }
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) throw new HttpReadError("redirect without a location");
        if (hops >= limits.maxRedirects) throw new HttpReadError(`more than ${limits.maxRedirects} redirects`);
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new HttpReadError("redirect to a location that does not parse");
        }
        if (next.protocol !== "https:" || next.username || next.password || next.port || !allowedRedirects.includes(next.hostname)) {
          throw new HttpReadError(`redirect to a host that is not allowed: ${clean(next.hostname)}`);
        }
        current = next.href;
        continue;
      }
      if (response.status !== 206) {
        await response.body?.cancel();
        throw new HttpReadError(`HTTP ${response.status} for a range request`);
      }
      const encoding = response.headers.get("content-encoding");
      if (encoding && encoding !== "identity") {
        await response.body?.cancel();
        throw new HttpReadError(`response is ${clean(encoding)}-encoded`);
      }
      const range = CONTENT_RANGE.exec(response.headers.get("content-range") ?? "");
      const total = range ? Number(range[3]) : NaN;
      if (!range || Number(range[1]) !== start || Number(range[2]) !== end || (size !== null && total !== size)) {
        await response.body?.cancel();
        throw new HttpReadError(`server answered another range: ${clean(response.headers.get("content-range"))}`);
      }
      if (size === null) {
        if (!Number.isSafeInteger(total) || total > limits.maxFileBytes) {
          await response.body?.cancel();
          throw new HttpReadError(`file of ${total} bytes`);
        }
        size = total;
      }
      return body(response, length);
    }
  }

  const magic = await request(0, ZIP_MAGIC.length);
  if (!ZIP_MAGIC.every((byte, i) => magic[i] === byte)) throw new HttpReadError("file does not start like a zip");
  const fileSize = size as number | null;
  if (fileSize === null) throw new HttpReadError("server stated no size");

  return {
    host: rule.host,
    size: fileSize,
    transfer,
    read(start: number, length: number): Promise<Uint8Array> {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 1 || start + length > fileSize) {
        return Promise.reject(new HttpReadError(`range ${start}+${length} is outside the file`));
      }
      return request(start, length);
    },
  };
}
