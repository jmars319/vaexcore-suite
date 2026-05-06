import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export function normalizeGitUrl(value) {
  return String(value ?? "")
    .trim()
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/\.git$/, "")
    .toLowerCase();
}

export function checkSuiteAppRepos(root, apps, runGit = defaultRunGit) {
  const errors = [];
  const warnings = [];

  for (const app of apps) {
    const appDir = resolve(root, app.path);
    const label = app.id ?? app.name ?? app.path;
    if (!existsSync(join(appDir, ".git"))) {
      errors.push(`${label} is missing a local git repo at ${appDir}`);
      continue;
    }

    const branch = runGit(appDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch === "HEAD") {
      errors.push(`${label} is detached; expected branch ${app.branch}`);
    } else if (branch !== app.branch) {
      errors.push(`${label} is on branch ${branch}; expected ${app.branch}`);
    }

    const remote = normalizeGitUrl(runGit(appDir, ["remote", "get-url", "origin"]));
    const expectedRemote = normalizeGitUrl(app.repo);
    if (remote !== expectedRemote) {
      errors.push(`${label} origin is ${remote}; expected ${expectedRemote}`);
    }

    const upstream = runGit(appDir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], {
      allowFailure: true,
    });
    if (!upstream) {
      warnings.push(`${label} branch ${app.branch} has no upstream tracking branch`);
    } else if (upstream !== `origin/${app.branch}`) {
      errors.push(`${label} tracks ${upstream}; expected origin/${app.branch}`);
    }
  }

  return { errors, warnings };
}

function defaultRunGit(repoPath, args, options = {}) {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (options.allowFailure) {
      return "";
    }
    throw error;
  }
}
