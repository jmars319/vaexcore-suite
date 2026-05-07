#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const artifactDir = resolve(args["artifact-dir"] ?? join(suiteRoot, "dist/mac-suite"));
const manifestPath = resolve(args.manifest ?? join(artifactDir, "manifest.json"));
const manifestOnly = Boolean(args["manifest-only"]);

execFileSync("node", ["scripts/validate-release-manifest.mjs", manifestPath], {
  cwd: suiteRoot,
  stdio: "inherit",
});
if (!manifestOnly) {
  execFileSync("node", ["scripts/inspect-mac-artifacts.mjs", "--artifact-dir", artifactDir, "--manifest", manifestPath], {
    cwd: suiteRoot,
    stdio: "inherit",
  });
}

console.log(`${manifestOnly ? "release manifest dry-run" : "release artifact dry-run"} passed: ${artifactDir}`);

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
