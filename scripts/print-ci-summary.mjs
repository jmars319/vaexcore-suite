#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { ciRepositories, latestWorkflowRun, runStatusRecord } from "./lib/ci-status.mjs";

const json = process.argv.includes("--json");
const unknownArgs = process.argv.slice(2).filter((arg) => !["--json"].includes(arg));
if (unknownArgs.length > 0) {
  console.error(`Unknown option: ${unknownArgs.join(", ")}`);
  process.exit(2);
}

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
      { encoding: "utf8" },
    ),
  );
  records.push(runStatusRecord(target, latestWorkflowRun(runs, target.workflowName)));
}

if (json) {
  console.log(JSON.stringify({ repositories: records }, null, 2));
} else {
  console.log("| Repo | Workflow | Status | SHA | Updated | URL |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const record of records) {
    const status = record.green ? "green" : record.conclusion || record.status;
    const sha = record.headSha ? record.headSha.slice(0, 7) : "missing";
    console.log(`| ${record.key} | ${record.workflowName} | ${status} | ${sha} | ${record.updatedAt ?? "missing"} | ${record.url ?? "missing"} |`);
  }
}
