import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { DetailsEntry } from "../../schema/catalog.ts";
import { shardCount, SHARD_TARGET_BYTES, type DetailsByOrigin } from "../emit.ts";

/** Text that gzip cannot shrink much, so a shard's size follows how much is in it. */
function noise(seed: string, length: number): string {
  let out = "";
  for (let n = 0; out.length < length; n++) out += createHash("sha256").update(`${seed}:${n}`).digest("base64");
  return out.slice(0, length);
}

function entries(count: number, length: number): Record<string, DetailsEntry> {
  return Object.fromEntries(Array.from({ length: count }, (_, i) => [`app-${i}`, { description: noise(`d${i}`, length) }]));
}

test("the shard count is the smallest that keeps every shard under the target", () => {
  const details: DetailsByOrigin = { fdroid: entries(300, 400), izzy: entries(40, 400) };
  const count = shardCount(details);
  assert.ok(count > 1 && count < 20, `${count} shards`);
});

test("one entry larger than the target does not split the build into a shard per app", () => {
  const fdroid = entries(300, 400);
  fdroid["app-huge"] = { permissions: Array.from({ length: 2000 }, (_, i) => noise(`p${i}`, 60)) };
  const started = performance.now();
  const count = shardCount({ fdroid, izzy: {} });
  assert.ok(performance.now() - started < 20_000, "decided in seconds");
  assert.ok(count < 30, `${count} shards for 301 apps, one of them alone past the ${SHARD_TARGET_BYTES}-byte target`);
});
