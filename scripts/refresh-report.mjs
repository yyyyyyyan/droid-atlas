#!/usr/bin/env node
/**
 * Names the gate a daily refresh failed at and writes the issue text for it.
 *
 *   node scripts/refresh-report.mjs --outcomes <json> [--report report.json] [--freshness <text>] [--run-url <url>]
 *
 * `--outcomes` maps each stage of the refresh to its GitHub step or job
 * outcome (`success`, `failure`, `canceled`, `skipped`, or empty when it never
 * ran). The first stage, in pipeline order, that did not succeed is the
 * failing gate; a failing pipeline is narrowed to the validation gate it
 * failed on, read from the build report. Prints JSON:
 * `{ "ok": boolean, "gate": string | null, "title": string, "body": string }`.
 *
 * The title depends only on the gate, so a failure that repeats day after day
 * updates one issue instead of opening a new one.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";

/** Stages in the order the refresh runs them, with how to name each in an issue. */
export const STAGES = [
  ["config", "configuration"],
  ["unit", "unit tests"],
  ["mirror", "previous build from the live site"],
  ["pipeline", "catalog build"],
  ["app", "app build"],
  ["site", "site assembly"],
  ["e2e", "end-to-end journeys"],
  ["deploy", "deploy"],
  ["freshness", "live catalog freshness"],
];

const MAX_BODY = 60_000;
const MAX_FAILURES = 25;

/** The gate name of a validation failure line (`entries:android-foss: 760 → 700 …` → `entries:android-foss`). */
export function gateOf(failure) {
  const match = /^([a-z]+(?::[^:\s]+)?):\s/.exec(failure);
  return match ? match[1] : "validation";
}

function fence(lines) {
  const text = lines.join("\n").replace(/`{3,}/g, "``");
  return ["```", text, "```"];
}

export function summarize({ outcomes, report = null, freshness = null, runUrl = null }) {
  const failed = STAGES.find(([stage]) => outcomes[stage] && outcomes[stage] !== "success" && outcomes[stage] !== "skipped");
  const ranAll = STAGES.every(([stage]) => outcomes[stage] === "success" || outcomes[stage] === "skipped");
  if (!failed && ranAll) return { ok: true, gate: null, title: "", body: "" };

  const [stage, label] = failed ?? ["unknown", "an unreported stage"];
  let gate = stage;
  let detail = [];
  const failures = report?.validation?.failures ?? [];
  if (stage === "pipeline" && failures.length) {
    gate = `validation ${gateOf(failures[0])}`;
    detail = [
      `The catalog build failed ${failures.length} validation check(s). First ${Math.min(failures.length, MAX_FAILURES)}:`,
      "",
      ...fence(failures.slice(0, MAX_FAILURES)),
    ];
    if ((report.validation.baselineUsed ?? []).length) detail.push("", `Accepted-baseline entries in use: ${report.validation.baselineUsed.length}.`);
  } else if (stage === "pipeline") {
    detail = ["The catalog build stopped before validation (an upstream fetch that still failed after retries, or an error). The run log has the cause."];
  } else if (stage === "freshness" && freshness) {
    detail = [freshness];
  } else {
    detail = [`The ${label} stage reported \`${outcomes[stage] ?? "nothing"}\`. The run log has the cause.`];
  }

  const table = ["| Stage | Outcome |", "|---|---|", ...STAGES.map(([s, l]) => `| ${l} | ${outcomes[s] || "not run"} |`)];
  const body = [
    `The daily catalog refresh failed at **${label}**. Nothing was deployed by this run; the last good catalog stays live.`,
    "",
    ...(runUrl ? [`Run: ${runUrl}`, ""] : []),
    ...detail,
    "",
    ...table,
    "",
    "This issue is updated while the same gate keeps failing and closed by the next successful refresh.",
  ].join("\n");
  return {
    ok: false,
    gate,
    title: `Daily refresh failing: ${gate}`,
    body: body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}\n\n(truncated)` : body,
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { outcomes: { type: "string" }, report: { type: "string" }, freshness: { type: "string" }, "run-url": { type: "string" } },
  });
  if (!values.outcomes) {
    process.stderr.write("usage: refresh-report.mjs --outcomes <json> [--report <file>] [--freshness <text>] [--run-url <url>]\n");
    process.exit(2);
  }
  const report = values.report && existsSync(values.report) ? JSON.parse(readFileSync(values.report, "utf8")) : null;
  const result = summarize({ outcomes: JSON.parse(values.outcomes), report, freshness: values.freshness ?? null, runUrl: values["run-url"] ?? null });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
