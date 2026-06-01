import {
  appAbsolutePath,
  gitDirty,
  suiteRoot,
} from "../suite-config.mjs";
import { git } from "./common.mjs";

export function gitRecords(config) {
  const repos = [
    { key: "suite", path: suiteRoot, expectedBranch: "main" },
    ...config.apps.map((app) => ({
      key: app.id,
      path: appAbsolutePath(suiteRoot, app),
      expectedBranch: app.branch,
    })),
    ...config.services.map((service) => ({
      key: service.id,
      path: appAbsolutePath(suiteRoot, service),
      expectedBranch: service.branch,
    })),
  ];
  const records = [];
  const errors = [];
  for (const repo of repos) {
    const branch = git(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"], true);
    const dirty = gitDirty(repo.path);
    const head = git(repo.path, ["rev-parse", "HEAD"], true);
    const upstreamHead = git(repo.path, ["rev-parse", "@{u}"], true);
    const record = {
      key: repo.key,
      branch,
      head,
      clean: dirty === false,
      pushed: Boolean(head && upstreamHead && head === upstreamHead),
    };
    records.push(record);
    if (branch !== repo.expectedBranch) {
      errors.push(
        `${repo.key} is on ${branch}; expected ${repo.expectedBranch}`,
      );
    }
    if (dirty) {
      errors.push(`${repo.key} has uncommitted changes`);
    }
    if (!record.pushed) {
      errors.push(`${repo.key} local HEAD is not pushed`);
    }
  }
  return { records, errors };
}
