/**
 * The Vite plugins that make the built site installable and offline-capable:
 * the page template filled from `src/product.ts`, the Content-Security-Policy,
 * the web app manifest, the `_headers` file, and the service worker, which is
 * bundled in a second pass once the first has written the files it must list.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { build, type Plugin, type ResolvedConfig } from "vite";
import {
  CONTENT_SECURITY_POLICY,
  fillTemplate,
  HEADERS_FILE,
  headersFile,
  isShellFile,
  MANIFEST_FILE,
  RELEASE_FLAG,
  releaseBlockers,
  shellVersion,
  webManifest,
  WORKER_FILE,
} from "./site-files.ts";

/** The product's name and colors in `index.html` come from one module. */
export function pageTemplate(): Plugin {
  return {
    name: "droid-atlas:page-template",
    transformIndexHtml: { order: "pre", handler: (html) => fillTemplate(html) },
  };
}

/**
 * Adds the Content-Security-Policy to the built page. The development server
 * injects inline styles and its own client, which the policy forbids, so the
 * policy is applied to builds only.
 */
export function contentSecurityPolicy(): Plugin {
  return {
    name: "droid-atlas:csp",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY }, injectTo: "head-prepend" },
    ],
  };
}

/** Writes the manifest and `_headers` into the build, and serves the manifest in development so the page's link to it resolves. */
export function siteFiles(): Plugin {
  const manifest = (): string => `${JSON.stringify(webManifest(), null, 2)}\n`;
  return {
    name: "droid-atlas:site-files",
    generateBundle() {
      const blockers = process.env[RELEASE_FLAG] === "1" ? releaseBlockers() : [];
      if (blockers.length > 0) this.error(`This is a release build (${RELEASE_FLAG}=1) and it is not ready:\n${blockers.join("\n")}`);
      this.emitFile({ type: "asset", fileName: MANIFEST_FILE, source: manifest() });
      this.emitFile({ type: "asset", fileName: HEADERS_FILE, source: headersFile() });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== `/${MANIFEST_FILE}`) {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/manifest+json");
        response.end(manifest());
      });
    },
  };
}

function walk(directory: string, root: string = directory): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path, root) : [relative(root, path).split("\\").join("/")];
  });
}

/**
 * Bundles `src/sw/sw.ts` to `sw.js` at the root of the build, after the main
 * build has written its files: the worker is compiled with the list of shell
 * files it has to store and a version derived from their content, so any
 * change to the shell changes the worker's bytes and browsers see an update.
 */
export function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  let shell: { path: string; content: string | Uint8Array }[] = [];
  return {
    name: "droid-atlas:service-worker",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    writeBundle(_options, bundle) {
      shell = Object.values(bundle)
        .filter((file) => isShellFile(file.fileName))
        .map((file) => ({ path: file.fileName, content: file.type === "asset" ? file.source : file.code }));
      const publicDir = config.publicDir;
      if (publicDir) {
        for (const path of walk(publicDir).filter(isShellFile)) shell.push({ path, content: readFileSync(join(publicDir, path)) });
      }
    },
    async closeBundle() {
      if (shell.length === 0) return;
      const files = shell.map((file) => file.path).sort();
      await build({
        configFile: false,
        root: config.root,
        logLevel: "warn",
        publicDir: false,
        define: { __SHELL_FILES__: JSON.stringify(files), __SHELL_VERSION__: JSON.stringify(shellVersion(shell)) },
        build: {
          outDir: resolve(config.root, config.build.outDir),
          emptyOutDir: false,
          copyPublicDir: false,
          target: config.build.target,
          sourcemap: false,
          rolldownOptions: {
            input: resolve(config.root, "src/sw/sw.ts"),
            output: { format: "iife", entryFileNames: WORKER_FILE, codeSplitting: false },
          },
        },
      });
    },
  };
}
