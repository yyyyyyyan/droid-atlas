import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { contentSecurityPolicy, pageTemplate, serviceWorker, siteFiles } from "./build/shell.ts";
import { readCheckout, siteVersion } from "./build/site-version.ts";

/**
 * A relative base lets the built site run from any static host and sub-path.
 * `server.fs.allow` admits the repository root so the app can import the
 * catalog contract from `schema/`. The build is one JavaScript file: a client
 * holding yesterday's page must never need a chunk that a newer deploy removed.
 * `__SITE_VERSION__` is the code's own version, fixed here once per build.
 */
export default defineConfig({
  base: "./",
  define: {
    __SITE_VERSION__: JSON.stringify(siteVersion(process.env, () => readCheckout(resolve(import.meta.dirname, "..")))),
  },
  plugins: [pageTemplate(), contentSecurityPolicy(), siteFiles(), serviceWorker()],
  server: {
    host: "127.0.0.1",
    port: 4320,
    strictPort: true,
    fs: { allow: [".."] },
  },
  build: {
    target: "es2023",
    sourcemap: true,
    modulePreload: false,
    rolldownOptions: {
      output: { codeSplitting: false },
    },
  },
  test: {
    include: ["src/**/*.test.ts", "build/**/*.test.ts"],
    environment: "node",
  },
});
