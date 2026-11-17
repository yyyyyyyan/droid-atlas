import { defineConfig, devices } from "@playwright/test";

/** Where the suite serves the site under test. `E2E_PORT` moves it, so two checkouts can run at once. */
export const PORT = Number(process.env.E2E_PORT ?? 4322);
export const BASE_URL = `http://localhost:${PORT}/`;

/** Android Chrome's reduced user agent string. */
export const CHROME_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36";

export default defineConfig({
  testDir: ".",
  outputDir: "test-results",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: Number(process.env.E2E_WORKERS ?? 3),
  timeout: 90_000,
  expect: { timeout: 7_000 },
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
  webServer: {
    command: `node serve.ts --port ${PORT}`,
    url: `${BASE_URL}data/version.json`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: "phone",
      testMatch: "journeys/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        userAgent: CHROME_ANDROID_UA,
        viewport: { width: 384, height: 688 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "desktop",
      testMatch: "journeys/**/*.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "data",
      testMatch: "audit/**/*.spec.ts",
    },
  ],
});
