#!/usr/bin/env node
import { readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { sha256File, suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const artifactDir = resolve(args["artifact-dir"] ?? join(suiteRoot, "dist/windows-suite"));
const arch = args.arch ?? "x64";

for (const path of listFiles(artifactDir)) {
  if (path.endsWith(".sha256") || basename(path) === "manifest.json") {
    continue;
  }
  const relativePath = relative(artifactDir, path).replaceAll("\\", "/");
  writeFileSync(`${path}.sha256`, `${sha256File(path)}  ${relativePath}\n`);
}

process.argv = [
  process.argv[0],
  "scripts/write-suite-manifest.mjs",
  "--platform",
  "Windows",
  "--arch",
  arch,
  "--artifact-dir",
  artifactDir,
];
await import("./write-suite-manifest.mjs");

function listFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(path));
    } else if (entry.isFile()) {
      results.push(path);
    }
  }
  return results.sort();
}

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
