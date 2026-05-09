#!/usr/bin/env node
import { checkSuiteProjectRepos } from "./lib/git-repo-checks.mjs";
import { loadSuiteConfig, suiteRoot } from "./lib/suite-config.mjs";

const { services } = loadSuiteConfig();

if (services.length === 0) {
  console.log("suite services are not configured.");
  process.exit(0);
}

const { errors, warnings } = checkSuiteProjectRepos(suiteRoot, services);

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

console.log(
  `suite services are on expected branches: ${services.map((service) => `${service.id}:${service.branch}`).join(", ")}`,
);
