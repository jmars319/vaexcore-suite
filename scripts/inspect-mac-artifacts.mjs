#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { loadSuiteConfig, readJsonFile, suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const artifactDir = resolve(args["artifact-dir"] ?? join(suiteRoot, "dist/mac-suite"));
const manifestPath = resolve(args.manifest ?? join(artifactDir, "manifest.json"));
const manifest = readJsonFile(manifestPath);
const config = loadSuiteConfig();
const errors = [];

for (const app of config.apps) {
  const artifact = (manifest.artifacts ?? []).find(
    (candidate) => candidate.name?.startsWith(`${app.id}-`) && candidate.name?.endsWith(".zip")
  );
  if (!artifact) {
    errors.push(`Missing macOS zip artifact for ${app.id}.`);
    continue;
  }
  const zipPath = join(artifactDir, artifact.file);
  if (!existsSync(zipPath)) {
    errors.push(`Missing zip on disk for ${app.id}: ${zipPath}`);
    continue;
  }

  const extractDir = mkdtempSync(join(tmpdir(), `${app.id}-artifact-`));
  try {
    execFileSync("ditto", ["-x", "-k", zipPath, extractDir], { stdio: "pipe" });
    const appPath = findAppBundle(extractDir, `${app.launchName}.app`);
    if (!appPath) {
      errors.push(`Zip ${basename(zipPath)} does not contain ${app.launchName}.app.`);
      continue;
    }
    const plistPath = join(appPath, "Contents/Info.plist");
    const bundleId = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print CFBundleIdentifier", plistPath],
      { encoding: "utf8" }
    ).trim();
    if (bundleId !== app.bundleId) {
      errors.push(`${basename(zipPath)} bundle id mismatch: expected ${app.bundleId}, got ${bundleId}.`);
    }
  } catch (error) {
    errors.push(`Could not inspect ${basename(zipPath)}: ${error.message}`);
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

console.log(`macOS artifact inspection passed: ${artifactDir}`);

function findAppBundle(dir, appName) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name === appName) {
      return path;
    }
    if (entry.isDirectory()) {
      const nested = findAppBundle(path, appName);
      if (nested) return nested;
    }
  }
  return null;
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
