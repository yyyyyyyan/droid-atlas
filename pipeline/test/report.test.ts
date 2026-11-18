/** The build report states the catalog's size the way the app does: apps, and the guides and links beside them. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { catalogSize } from "../report.ts";

test("a record counts as an app when any source lists it as one, and as a guide or link otherwise", () => {
  const app = { listings: [{ kind: "app" as const }] };
  const listedBothWays = { listings: [{ kind: "resource" as const }, { kind: "app" as const }] };
  const guide = { listings: [{ kind: "resource" as const }] };
  assert.deepEqual(catalogSize([app, listedBothWays, guide, guide]), { installable: 2, resources: 2 });
  assert.deepEqual(catalogSize([]), { installable: 0, resources: 0 });
});
