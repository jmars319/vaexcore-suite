#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { ciRepositories, latestWorkflowRun } from "./lib/ci-status.mjs";
import { loadSuiteConfig, suiteRoot } from "./lib/suite-config.mjs";

const repoPaths = new Map([
  ["suite", suiteRoot],
  ...loadSuiteConfig().apps.map((app) => [app.id.replace("vaexcore-", ""), resolve(suiteRoot, app.path)]),
]);

for (const target of ciRepositories) {
  const repoPath = repoPaths.get(target.key);
  if (!repoPath) {
    console.log(`${target.key}: local repo path is not configured`);
    continue;
  }

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
        "--status",
        "success",
        "--limit",
        "20",
        "--json",
        "databaseId,headSha,status,conclusion,workflowName,url,createdAt,updatedAt,event",
      ],
      { encoding: "utf8" },
    ),
  );
  const latestGreen = latestWorkflowRun(runs, target.workflowName);
  const head = git(repoPath, ["rev-parse", "HEAD"]);

  if (!latestGreen?.headSha) {
    console.log(`${target.key}: no green ${target.workflowName} run found`);
    continue;
  }

  if (head === latestGreen.headSha) {
    console.log(`${target.key}: no local commits since green CI (${head.slice(0, 7)})`);
    continue;
  }

  if (!isAncestor(repoPath, latestGreen.headSha, head)) {
    console.log(`${target.key}: latest green ${latestGreen.headSha.slice(0, 7)} is not an ancestor of local HEAD ${head.slice(0, 7)}`);
    continue;
  }

  const changes = git(repoPath, ["log", "--oneline", `${latestGreen.headSha}..HEAD`]);
  console.log(`${target.key}: commits since green ${latestGreen.headSha.slice(0, 7)}`);
  console.log(changes || "  (none)");
}

function isAncestor(repoPath, ancestor, descendant) {
  try {
    execFileSync("git", ["-C", repoPath, "merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function git(repoPath, args) {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}
