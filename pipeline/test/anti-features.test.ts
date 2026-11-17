import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveAntiFeatures } from "../../schema/join.ts";
import { antiFeatureDefinitions } from "../enrich/index-v2.ts";

test("index definitions: English text, plain, keyed by simple identifiers only", () => {
  const definitions = antiFeatureDefinitions({
    NonFreeNet: { name: { "en-US": "Non-Free Network Services", de: "Unfreie Netzwerkdienste" }, description: { "en-US": "Depends on a **non-free** service" } },
    Bare: {},
    "evil key": { name: { "en-US": "x" } },
    "__proto__x;end": { name: { "en-US": "x" } },
    Listed: "not an object",
  });
  assert.deepEqual(definitions, {
    Bare: { name: "Bare", description: null },
    Listed: { name: "Listed", description: null },
    NonFreeNet: { name: "Non-Free Network Services", description: "Depends on a non-free service" },
  });
  assert.deepEqual(antiFeatureDefinitions(null), {});
  assert.deepEqual(antiFeatureDefinitions(["NonFreeNet"]), {});
});

test("catalog anti-features: every key some app carries, each index's definition, F-Droid first", () => {
  const facts = (origin: "fdroid" | "izzy", antiFeatures: string[]) => ({ origin, antiFeatures }) as never;
  const apps = [{ index: [facts("fdroid", ["NonFreeNet"]), facts("izzy", ["NonFreeDep"])] }, { index: [facts("izzy", ["Mystery", "NonFreeNet"])] }, { index: [] }];
  const indexes = [
    { origin: "izzy" as const, antiFeatures: { NonFreeDep: { name: "Non-Free Dependencies", description: "…or contains non-free libraries" }, NonFreeNet: { name: "Izzy NFN", description: null } } },
    { origin: "fdroid" as const, antiFeatures: { NonFreeDep: { name: "Non-Free Dependencies", description: "depends on other non-free apps" }, NonFreeNet: { name: "Non-Free Network Services", description: "d" }, Unused: { name: "Unused", description: null } } },
  ];
  assert.deepEqual(deriveAntiFeatures(apps, indexes), [
    { id: "Mystery", name: "Mystery", definitions: [] },
    {
      id: "NonFreeDep",
      name: "Non-Free Dependencies",
      definitions: [
        { origin: "fdroid", name: "Non-Free Dependencies", description: "depends on other non-free apps" },
        { origin: "izzy", name: "Non-Free Dependencies", description: "…or contains non-free libraries" },
      ],
    },
    {
      id: "NonFreeNet",
      name: "Non-Free Network Services",
      definitions: [
        { origin: "fdroid", name: "Non-Free Network Services", description: "d" },
        { origin: "izzy", name: "Izzy NFN", description: null },
      ],
    },
  ]);
});
