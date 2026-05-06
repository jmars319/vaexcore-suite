#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { ciRepositories, latestWorkflowRun } from "./lib/ci-status.mjs";
import { loadSuiteConfig, suiteRoot } from "./lib/suite-config.mjs";

const localRepos = [
  {
    key: "suite",
    path: suiteRoot,
    expectedBranch: "main",
  },
  ...loadSuiteConfig().apps.map((app) => ({
    key: app.id.replace("vaexcore-", ""),
    path: resolve(suiteRoot, app.path),
    expectedBranch: app.branch,
  })),
];

const errors = [];
for (const repo of localRepos) {
  const branch = git(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== repo.expectedBranch) {
    errors.push(`${repo.key} is on ${branch}; expected ${repo.expectedBranch}`);
  }

  const status = git(repo.path, ["status", "--short"]);
  if (status.length > 0) {
    errors.push(`${repo.key} has uncommitted changes`);
  }

  const upstream = git(repo.path, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], true);
  if (upstream !== `origin/${repo.expectedBranch}`) {
    errors.push(`${repo.key} tracks ${upstream || "(none)"}; expected origin/${repo.expectedBranch}`);
  }

  const head = git(repo.path, ["rev-parse", "HEAD"]);
  const upstreamHead = git(repo.path, ["rev-parse", "@{u}"], true);
  if (upstreamHead && head !== upstreamHead) {
    errors.push(`${repo.key} local HEAD is not pushed to ${upstream}`);
  }
}

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
  const local = localRepos.find((repo) => repo.key === target.key);
  const localHead = local ? git(local.path, ["rev-parse", "HEAD"]) : null;
  if (latest?.status !== "completed" || latest?.conclusion !== "success") {
    errors.push(`${target.key} latest ${target.workflowName} is not green: ${latest?.url ?? "(missing run)"}`);
  } else if (localHead && latest.headSha !== localHead) {
    errors.push(`${target.key} latest green CI is ${latest.headSha?.slice(0, 7)}; local HEAD is ${localHead.slice(0, 7)}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

console.log("release preflight passed: local repos are clean, pushed, on main, and green in CI");

function git(repoPath, args, allowFailure = false) {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (allowFailure) {
      return "";
    }
    throw error;
  }
}
