import { appAbsolutePath, suiteRoot } from "../suite-config.mjs";
import { git } from "./common.mjs";

export function projectGitRecords(config, options) {
  if (options.skipGit) {
    return [
      {
        id: "suite",
        kind: "suite",
        path: ".",
        expectedBranch: "main",
        status: "warn",
        summary: "Skipped git status because --skip-git was passed.",
      },
      ...config.apps.map((app) => skippedProjectRecord("app", app)),
      ...config.services.map((service) =>
        skippedProjectRecord("service", service),
      ),
    ];
  }

  return [
    projectGitRecord("suite", {
      id: "suite",
      path: ".",
      branch: "main",
      name: "vaexcore suite",
    }),
    ...config.apps.map((app) => projectGitRecord("app", app)),
    ...config.services.map((service) => projectGitRecord("service", service)),
  ];
}

export function projectStatusCheck(projects) {
  const failed = projects.filter((project) => project.status === "fail");
  const warned = projects.filter((project) => project.status === "warn");
  return {
    id: "project-git-status",
    label: "App and service git status",
    status: failed.length > 0 ? "fail" : warned.length > 0 ? "warn" : "pass",
    summary:
      failed.length > 0
        ? `${failed.length} app/service repo(s) are stale, dirty, or not pushed.`
        : warned.length > 0
          ? "Project git status was skipped."
          : "All app/service repos are clean, pushed, and on their expected branches.",
    details: {
      failCount: failed.length,
      warnCount: warned.length,
    },
  };
}

function projectGitRecord(kind, project) {
  const repoPath =
    project.id === "suite" ? suiteRoot : appAbsolutePath(suiteRoot, project);
  const expectedBranch = project.branch ?? "main";
  const branch = git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"], true);
  const head = git(repoPath, ["rev-parse", "HEAD"], true);
  const upstream = git(repoPath, ["rev-parse", "@{u}"], true);
  const statusShort = git(repoPath, ["status", "--short"], true);
  const clean = statusShort.trim().length === 0;
  const pushed = Boolean(head && upstream && head === upstream);
  const status = branch === expectedBranch && clean && pushed ? "pass" : "fail";
  return {
    id: project.id,
    name: project.name,
    kind,
    path: project.path,
    expectedBranch,
    branch,
    head,
    upstream: upstream || null,
    clean,
    pushed,
    status,
    summary:
      status === "pass"
        ? "Clean, on expected branch, and pushed."
        : "Project branch, cleanliness, or upstream state needs attention.",
  };
}

function skippedProjectRecord(kind, project) {
  return {
    id: project.id,
    name: project.name,
    kind,
    path: project.path,
    expectedBranch: project.branch ?? "main",
    status: "warn",
    summary: "Skipped git status because --skip-git was passed.",
  };
}
