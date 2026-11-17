/**
 * A server that resolves and never answers: a request gives up after a few
 * quiet seconds and the existing failure line takes over, with its retry; a
 * first load that is slow but arriving is never cut; and a first load that
 * gets no answer says the catalog did not load, not that it is damaged.
 *
 * The requests are held by the test (`page.route` that never answers), which
 * stands in for a dead signal. Service workers are blocked in the journeys,
 * so the worker's own limit for files viewed on demand is not covered here.
 */

import { expect, test } from "../lib/fixtures.ts";
import { sheetHash } from "../lib/catalog.ts";
import { featuredApp } from "../lib/pick.ts";
import { ready } from "../lib/app.ts";

const APP = featuredApp();

test.describe.configure({ timeout: 90_000 });

test("a description the server never sends gives way to Try again within seconds, and Try again waits as long again", async ({ page }) => {
  await page.route("**/details/**", () => new Promise<void>(() => undefined));
  await page.goto(`/${sheetHash(APP)}`);
  await ready(page);
  const dialog = page.getByRole("dialog").or(page.getByRole("complementary")).filter({ has: page.getByRole("heading", { level: 2, name: APP.name }) });
  await expect(dialog.getByText("Loading…")).toBeVisible();
  const started = Date.now();
  const retry = dialog.getByRole("button", { name: "Try again" });
  await expect(retry).toBeVisible({ timeout: 12_000 });
  const waited = Date.now() - started;
  expect(waited, "it waited for the network first").toBeGreaterThan(5_000);
  expect(waited, "and gave up within the limit").toBeLessThan(11_000);
  await retry.click();
  await expect(dialog.getByText("Loading…")).toBeVisible();
  await expect(retry).toBeVisible({ timeout: 12_000 });
});

test("a first load whose catalog is slow to answer, within the limit, is not cut off", async ({ page }) => {
  await page.route("**/atlas.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6_000));
    await route.continue();
  });
  await page.goto("/#/");
  await expect(page.getByRole("main")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByText("The catalog did not load")).toHaveCount(0);
});

test("a first load that gets no answer says the catalog did not load, and does not call it damaged", async ({ page }) => {
  await page.route("**/manifest.json", () => new Promise<void>(() => undefined));
  const started = Date.now();
  await page.goto("/#/");
  await expect(page.getByText("The catalog did not load")).toBeVisible({ timeout: 25_000 });
  expect(Date.now() - started, "given up on within the limit every request has").toBeLessThan(11_000);
  await expect(page.getByText(/damaged|missing/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
