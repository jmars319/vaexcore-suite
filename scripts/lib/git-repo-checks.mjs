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
  return checkSuiteProjectRepos(root, apps, runGit);
}

export function checkSuiteProjectRepos(root, projects, runGit = defaultRunGit) {
  const errors = [];
  const warnings = [];

  for (const project of projects) {
    const appDir = resolve(root, project.path);
    const label = project.id ?? project.name ?? project.path;
    if (!existsSync(join(appDir, ".git"))) {
      errors.push(`${label} is missing a local git repo at ${appDir}`);
      continue;
    }

    const branch = runGit(appDir, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (branch === "HEAD") {
      errors.push(`${label} is detached; expected branch ${project.branch}`);
    } else if (branch !== project.branch) {
      errors.push(
        `${label} is on branch ${branch}; expected ${project.branch}`,
      );
    }

    const remote = normalizeGitUrl(
      runGit(appDir, ["remote", "get-url", "origin"], {
        allowFailure: Boolean(project.remoteOptional),
      }),
    );
    const expectedRemote = normalizeGitUrl(project.repo);
    if (!remote && project.remoteOptional) {
      warnings.push(
        `${label} origin is not configured yet; expected ${expectedRemote}`,
      );
    } else if (remote !== expectedRemote) {
      errors.push(`${label} origin is ${remote}; expected ${expectedRemote}`);
    }

    const upstream = runGit(
      appDir,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      {
        allowFailure: true,
      },
    );
    if (!upstream) {
      warnings.push(
        `${label} branch ${project.branch} has no upstream tracking branch`,
      );
    } else if (upstream !== `origin/${project.branch}`) {
      errors.push(
        `${label} tracks ${upstream}; expected origin/${project.branch}`,
      );
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
