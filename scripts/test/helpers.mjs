/**
 * Test helpers: temporary directories, a static file server, and a fixture
 * catalog built by the real pipeline from the synthetic upstream cache.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, walk } from "../lib/files.mjs";
import { FIXTURE_GENERATED_AT, writeUpstreamCache } from "../fixture/upstream-cache.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function tempDir(t, prefix = "release-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** sha256 of every file under `dir`, keyed by relative path, optionally filtered. */
export function digest(dir, keep = () => true) {
  return Object.fromEntries(walk(dir).filter(keep).map((f) => [f, sha256(readFileSync(join(dir, f)))]));
}

/**
 * Serves `root` over HTTP on a free local port until the test ends.
 * `overrides` maps a URL path to a status code or a replacement body.
 */
export async function serve(t, root, overrides = {}) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const override = overrides[path];
    if (typeof override === "number") {
      response.writeHead(override).end();
      return;
    }
    if (override !== undefined) {
      response.writeHead(200).end(override);
      return;
    }
    const file = resolve(root, `.${path}`);
    let body = null;
    try {
      if (file.startsWith(resolve(root))) body = readFileSync(file);
    } catch {
      body = null;
    }
    if (body === null) response.writeHead(404).end();
    else response.writeHead(200).end(body);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((done) => server.close(done));
  });
  return `http://127.0.0.1:${server.address().port}/`;
}

/** Runs the real pipeline offline over the synthetic upstream cache. */
export async function fixtureBuild(t, out, extra = []) {
  const { build } = await import(join(ROOT, "pipeline", "build.ts"));
  const cache = join(tempDir(t, "upstream-"), "cache");
  writeUpstreamCache(cache);
  const previousOrBootstrap = extra.includes("--previous") ? [] : ["--bootstrap"];
  const outcome = await build(["--offline", "--cache", cache, "--generated-at", FIXTURE_GENERATED_AT, "--out", out, ...previousOrBootstrap, ...extra]);
  return { outcome, cache };
}

/** Silences the pipeline's progress lines on stderr for the duration of a test. */
export function quietStderr(t) {
  const write = process.stderr.write;
  process.stderr.write = () => true;
  t.after(() => {
    process.stderr.write = write;
  });
}
