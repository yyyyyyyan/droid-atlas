import assert from "node:assert/strict";
import { test } from "node:test";
import { gateOf, STAGES, summarize } from "../refresh-report.mjs";

const all = (value) => Object.fromEntries(STAGES.map(([stage]) => [stage, value]));

test("a run where every stage succeeded or was skipped is a success", () => {
  assert.deepEqual(summarize({ outcomes: { ...all("success"), e2e: "skipped", deploy: "skipped" } }).ok, true);
});

test("the first failing stage names the issue, and later skips do not mask it", () => {
  const result = summarize({ outcomes: { ...all("skipped"), config: "success", mirror: "failure" }, runUrl: "https://example.org/run/1" });
  assert.equal(result.ok, false);
  assert.equal(result.title, "Daily refresh failing: mirror");
  assert.match(result.body, /previous build from the live site/);
  assert.match(result.body, /https:\/\/example\.org\/run\/1/);
  assert.match(result.body, /last good catalog stays live/);
});

test("unit tests that fail name the issue before any catalog stage, which the run then skips", () => {
  const result = summarize({ outcomes: { ...all("skipped"), config: "success", unit: "failure" } });
  assert.equal(result.title, "Daily refresh failing: unit");
  assert.match(result.body, /failed at \*\*unit tests\*\*/);
  assert.ok(result.body.indexOf("| unit tests | failure |") < result.body.indexOf("| previous build from the live site | skipped |"));
});

test("a pipeline failure is narrowed to its first validation gate, with an excerpt", () => {
  const failures = [
    'entries:android-foss: 789 → 700 entries (accept with {"gate": "entries:android-foss", "value": 700} in accepted-baseline.json)',
    "coverage:summary: 98.1 → 90.0",
  ];
  const result = summarize({ outcomes: { ...all("skipped"), config: "success", mirror: "success", pipeline: "failure" }, report: { validation: { failures, baselineUsed: [] } } });
  assert.equal(result.title, "Daily refresh failing: validation entries:android-foss");
  assert.match(result.body, /failed 2 validation check/);
  assert.match(result.body, /789 → 700/);
});

test("a pipeline that stopped before validation is named as the build itself", () => {
  const result = summarize({ outcomes: { ...all("skipped"), config: "success", mirror: "success", pipeline: "failure" }, report: null });
  assert.equal(result.title, "Daily refresh failing: pipeline");
  assert.match(result.body, /stopped before validation/);
});

test("staleness is its own gate and carries the age message", () => {
  const result = summarize({ outcomes: { ...all("success"), deploy: "skipped", freshness: "failure" }, freshness: "live catalog is stale: 4.2 days old" });
  assert.equal(result.title, "Daily refresh failing: freshness");
  assert.match(result.body, /4\.2 days old/);
});

test("a stage that never reported cannot pass as success", () => {
  const outcomes = all("success");
  delete outcomes.e2e;
  outcomes.deploy = "canceled";
  assert.equal(summarize({ outcomes }).title, "Daily refresh failing: deploy");
});

test("report text cannot break out of its code fence", () => {
  const result = summarize({ outcomes: { config: "success", mirror: "success", pipeline: "failure" }, report: { validation: { failures: ["schema: ```\n# heading"] } } });
  assert.equal(result.body.split("```").length - 1, 2);
});

test("gateOf reads the gate name before the first colon-space", () => {
  assert.equal(gateOf("category:android-foss/apps-notes: 12 → 3 listings"), "category:android-foss/apps-notes");
  assert.equal(gateOf("schema: apps[3].id is not a string"), "schema");
  assert.equal(gateOf("Something unexpected"), "validation");
});
