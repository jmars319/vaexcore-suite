#!/usr/bin/env node
import { validateSuiteConfig } from "./lib/suite-config.mjs";

const requireLocalRepos = process.argv.includes("--require-local-repos");
const { errors, warnings } = validateSuiteConfig({ requireLocalRepos });

for (const warning of warnings) {
  console.warn(`warning: ${warning}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

console.log("suite config validation passed");
