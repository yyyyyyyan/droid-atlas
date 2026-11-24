/**
 * What an index says of an app's anti-features, in its own words: under an
 * anti-feature, the reason the index gives is quoted.
 */

import { expect, test } from "../lib/fixtures.ts";
import { sheetHash } from "../lib/catalog.ts";
import { build, requireShape } from "../lib/pick.ts";
import { launch, sheet } from "../lib/app.ts";

const sorted = [...build.apps].sort((a, b) => a.id.localeCompare(b.id));

const withReason = sorted.find((app) => Object.keys(app.fdroid?.facts.antiFeatureReasons ?? {}).length > 0);

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the quote does not depend on the layout; run once, at phone size");
  void page;
});

test(`an anti-feature quotes the reason its index gives${withReason ? ` (${withReason.id})` : ""}`, async ({ page }) => {
  requireShape(withReason !== undefined, "anti-feature with a reason");
  if (!withReason) return;
  await launch(page, sheetHash(withReason));
  const details = sheet(page, withReason.name).getByRole("region", { name: /^Details/ });
  await expect(details.locator("q").first()).toBeVisible();
  const quoted = await details.locator("q").allTextContents();
  for (const reason of Object.values(withReason.fdroid?.facts.antiFeatureReasons ?? {})) {
    expect(quoted, "each reason is quoted word for word").toContain(reason);
  }
});
