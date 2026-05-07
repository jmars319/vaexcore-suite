#!/usr/bin/env node
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  appAbsolutePath,
  appVersion,
  gitDirty,
  gitSha,
  loadSuiteConfig,
  suiteRoot,
} from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const artifactDir = resolve(args["artifact-dir"] ?? join(suiteRoot, "dist/release-dry-run"));
const clean = Boolean(args.clean);
const config = loadSuiteConfig();

if (clean && existsSync(artifactDir)) {
  const relativePath = relative(suiteRoot, artifactDir);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Refusing to clean artifact directory outside suite root: ${artifactDir}`);
  }
  rmSync(artifactDir, { recursive: true, force: true });
}

mkdirSync(artifactDir, { recursive: true });

for (const app of config.apps) {
  const appDir = appAbsolutePath(suiteRoot, app);
  const version = appVersion(suiteRoot, app);
  if (!version) {
    throw new Error(`${app.id} is missing package.json version`);
  }

  const artifactPath = join(artifactDir, `${app.id}-${version}-dry-run.txt`);
  const content = [
    "vaexcore release dry-run artifact",
    `app=${app.id}`,
    `version=${version}`,
    `bundleId=${app.bundleId}`,
    `launchName=${app.launchName}`,
    `gitSha=${gitSha(appDir) ?? "unknown"}`,
    `dirty=${gitDirty(appDir)}`,
    "",
  ].join("\n");
  writeFileSync(artifactPath, content);
}

console.log(`dry-run artifacts written: ${artifactDir}`);

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
