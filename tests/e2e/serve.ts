/**
 * A plain static file server for the site under test, standing in for the
 * static host: files by path, `index.html` for a directory, 404 otherwise.
 * Nothing is rewritten and no header beyond the content type is added, so
 * the app is tested as a static host would serve it.
 *
 *   node serve.ts [--port 4322]
 */

import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { parseArgs } from "node:util";
import { siteDir, siteReady } from "./site.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const { values } = parseArgs({ options: { port: { type: "string", default: "4322" } } });
const root = siteDir();
if (!siteReady(root)) {
  console.error(`no site to serve: ${root} has no index.html and data/version.json`);
  process.exit(1);
}

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? "/", "http://site.invalid").pathname);
  const file = normalize(join(root, path));
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  let target = file;
  try {
    if (statSync(target).isDirectory()) target = join(target, "index.html");
    statSync(target);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }
  response.writeHead(200, { "content-type": TYPES[extname(target)] ?? "application/octet-stream" });
  createReadStream(target).pipe(response);
});

server.listen(Number(values.port), "localhost", () => {
  console.log(`serving ${root} on port ${values.port}`);
});
