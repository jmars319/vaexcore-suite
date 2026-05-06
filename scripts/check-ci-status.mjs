#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { ciRepositories, formatRunSummary, isGreenRun, latestWorkflowRun } from "./lib/ci-status.mjs";

const requireGreen = process.argv.includes("--require-green");
const unknownArgs = process.argv.slice(2).filter((arg) => !["--require-green"].includes(arg));
if (unknownArgs.length > 0) {
  console.error(`Unknown option: ${unknownArgs.join(", ")}`);
  process.exit(2);
}

let failed = false;
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
  console.log(formatRunSummary(target.key, latest));
  if (requireGreen && !isGreenRun(latest)) {
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
