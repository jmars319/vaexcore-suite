#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appVersion, loadSuiteConfig, suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const version = args.version;
if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: bump-suite-version.mjs --version <semver> [--channel <name>]");
  process.exit(2);
}

const releasePath = join(suiteRoot, "suite/release.json");
const release = JSON.parse(readFileSync(releasePath, "utf8"));
const config = loadSuiteConfig();

release.version = version;
release.updatedAt = new Date().toISOString();
if (args.channel) {
  release.channel = args.channel;
}
release.compatibleApps = Object.fromEntries(
  config.apps.map((app) => [app.id, appVersion(suiteRoot, app)])
);

writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);
console.log(`suite release version updated to ${version}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}
