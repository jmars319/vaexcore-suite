#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { ciRepositories, formatRunSummary, isGreenRun, latestWorkflowRun, runStatusRecord } from "./lib/ci-status.mjs";

const requireGreen = process.argv.includes("--require-green");
const json = process.argv.includes("--json");
const unknownArgs = process.argv.slice(2).filter((arg) => !["--require-green", "--json"].includes(arg));
if (unknownArgs.length > 0) {
  console.error(`Unknown option: ${unknownArgs.join(", ")}`);
  process.exit(2);
}

let failed = false;
const records = [];
for (const target of ciRepositories) {
  const runs = JSON.parse(
    execFileSync(
      "gh",
      [
        "run",
        "list",
        "--repo",
        target.repo,
        "--branch",
        "main",
        "--limit",
        "10",
        "--json",
        "databaseId,headSha,status,conclusion,workflowName,url,createdAt,updatedAt,event",
      ],
      { encoding: "utf8" }
    )
  );
  const latest = latestWorkflowRun(runs, target.workflowName);
  records.push(runStatusRecord(target, latest));
  if (!json) {
    console.log(formatRunSummary(target.key, latest));
  }
  if (requireGreen && !isGreenRun(latest)) {
    failed = true;
  }
}

if (json) {
  console.log(JSON.stringify({ repositories: records, green: records.every((record) => record.green) }, null, 2));
}

if (failed) {
  process.exit(1);
}
