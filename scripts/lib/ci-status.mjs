export const ciRepositories = [
  {
    key: "suite",
    repo: "jmars319/vaexcore-suite",
    workflowName: "Suite CI",
  },
  {
    key: "studio",
    repo: "jmars319/vaexcore-studio",
    workflowName: "Studio CI",
  },
  {
    key: "pulse",
    repo: "jmars319/vaexcore-pulse",
    workflowName: "Pulse CI",
  },
  {
    key: "console",
    repo: "jmars319/vaexcore-console",
    workflowName: "Console CI",
  },
];

export function latestWorkflowRun(runs, workflowName) {
  return runs
    .filter((run) => run.workflowName === workflowName)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0] ?? null;
}

export function isGreenRun(run) {
  return run?.status === "completed" && run?.conclusion === "success";
}

export function formatRunSummary(key, run) {
  if (!run) {
    return `${key}: missing`;
  }
  const sha = run.headSha ? run.headSha.slice(0, 7) : "unknown";
  const conclusion = run.conclusion || run.status;
  return `${key}: ${conclusion} ${sha} ${run.url}`;
}
