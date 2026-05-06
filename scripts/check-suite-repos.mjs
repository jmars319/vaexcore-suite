#!/usr/bin/env node
import { checkSuiteAppRepos } from "./lib/git-repo-checks.mjs";
import { loadSuiteConfig, suiteRoot } from "./lib/suite-config.mjs";

const { apps } = loadSuiteConfig();
const { errors, warnings } = checkSuiteAppRepos(suiteRoot, apps);

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

console.log(`suite app repos are on expected branches: ${apps.map((app) => `${app.id}:${app.branch}`).join(", ")}`);
