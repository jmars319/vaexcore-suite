#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sha256File } from "./lib/suite-config.mjs";

const manifestPath = resolve(process.argv[2] ?? "dist/mac-suite/manifest.json");
const manifestDir = dirname(manifestPath);

if (!existsSync(manifestPath)) {
  throw new Error(`Missing release manifest: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const errors = [];

if (manifest.manifestVersion !== 1) errors.push("manifestVersion must be 1.");
if (!manifest.suiteName) errors.push("suiteName is required.");
if (!manifest.builtAt || Number.isNaN(Date.parse(manifest.builtAt))) errors.push("builtAt must be a date-time.");
if (!Array.isArray(manifest.apps) || manifest.apps.length === 0) errors.push("apps must be a non-empty array.");
if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) errors.push("artifacts must be a non-empty array.");

for (const app of manifest.apps ?? []) {
  for (const field of ["id", "name", "version", "gitSha", "bundleId", "launchName", "discoveryFile", "healthEndpoint"]) {
    if (!app[field]) {
      errors.push(`app ${app.id ?? "(unknown)"} is missing ${field}.`);
    }
  }
}

for (const artifact of manifest.artifacts ?? []) {
  const artifactPath = join(manifestDir, artifact.file ?? "");
  if (!existsSync(artifactPath)) {
    errors.push(`artifact is missing on disk: ${artifact.file}`);
    continue;
  }
  const actual = sha256File(artifactPath);
  if (actual !== artifact.sha256) {
    errors.push(`artifact checksum mismatch for ${artifact.file}.`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

console.log(`release manifest validation passed: ${manifestPath}`);
