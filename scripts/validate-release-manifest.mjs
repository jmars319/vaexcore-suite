#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { loadSuiteConfig, sha256File } from "./lib/suite-config.mjs";

const manifestPath = resolve(process.argv[2] ?? "dist/mac-suite/manifest.json");
const manifestDir = dirname(manifestPath);
const config = loadSuiteConfig();
const expectedAppsById = new Map(config.apps.map((app) => [app.id, app]));

if (!existsSync(manifestPath)) {
  throw new Error(`Missing release manifest: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const errors = [];

if (manifest.manifestVersion !== 1) errors.push("manifestVersion must be 1.");
if (!manifest.suiteName) errors.push("suiteName is required.");
if (!manifest.builtAt || Number.isNaN(Date.parse(manifest.builtAt))) errors.push("builtAt must be a date-time.");
if (!manifest.release || manifest.release.schemaVersion !== 1) errors.push("release metadata with schemaVersion 1 is required.");
if (!manifest.release?.version) errors.push("release.version is required.");
if (!manifest.release?.compatibleApps || typeof manifest.release.compatibleApps !== "object") {
  errors.push("release.compatibleApps is required.");
}
if (!Array.isArray(manifest.apps) || manifest.apps.length === 0) errors.push("apps must be a non-empty array.");
if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) errors.push("artifacts must be a non-empty array.");

const manifestAppIds = new Set();
for (const app of manifest.apps ?? []) {
  if (manifestAppIds.has(app.id)) {
    errors.push(`duplicate app entry: ${app.id}.`);
  }
  manifestAppIds.add(app.id);
  if (app.id && !expectedAppsById.has(app.id)) {
    errors.push(`unknown app in manifest: ${app.id}.`);
  }
  for (const field of ["id", "name", "version", "gitSha", "bundleId", "launchName", "discoveryFile", "healthEndpoint"]) {
    if (!app[field]) {
      errors.push(`app ${app.id ?? "(unknown)"} is missing ${field}.`);
    }
  }
  const expectedVersion = manifest.release?.compatibleApps?.[app.id];
  if (!expectedVersion) {
    errors.push(`release.compatibleApps is missing ${app.id}.`);
  } else if (app.version !== expectedVersion) {
    errors.push(`app ${app.id} version ${app.version} does not match release compatibility ${expectedVersion}.`);
  }
}

for (const app of config.apps) {
  if (!manifestAppIds.has(app.id)) {
    errors.push(`manifest is missing app ${app.id}.`);
  }
}

for (const appId of Object.keys(manifest.release?.compatibleApps ?? {})) {
  if (!expectedAppsById.has(appId)) {
    errors.push(`release.compatibleApps includes unknown app ${appId}.`);
  }
}

const artifactFiles = new Set();
for (const artifact of manifest.artifacts ?? []) {
  for (const field of ["file", "name", "sha256", "size"]) {
    if (!artifact[field]) {
      errors.push(`artifact ${artifact.file ?? "(unknown)"} is missing ${field}.`);
    }
  }
  if (artifact.file && artifactFiles.has(artifact.file)) {
    errors.push(`duplicate artifact entry: ${artifact.file}.`);
  }
  artifactFiles.add(artifact.file);
  if (!artifact.file || isAbsolute(artifact.file) || normalize(artifact.file).startsWith("..")) {
    errors.push(`artifact file must stay inside the manifest directory: ${artifact.file}.`);
    continue;
  }
  const artifactPath = join(manifestDir, artifact.file);
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
