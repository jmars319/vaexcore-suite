#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { loadSuiteConfig, readJsonFile, suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const artifactDir = resolve(args["artifact-dir"] ?? join(suiteRoot, "dist/mac-suite"));
const manifestPath = resolve(args.manifest ?? join(artifactDir, "manifest.json"));
const manifest = readJsonFile(manifestPath);
const config = loadSuiteConfig();
const manifestApps = new Map((manifest.apps ?? []).map((app) => [app.id, app]));
const errors = [];

for (const app of config.apps) {
  const matchingArtifacts = (manifest.artifacts ?? []).filter(
    (candidate) => candidate.name?.startsWith(`${app.id}-`) && candidate.name?.endsWith(".zip")
  );
  if (matchingArtifacts.length > 1) {
    errors.push(`Multiple macOS zip artifacts found for ${app.id}.`);
    continue;
  }
  const artifact = matchingArtifacts[0];
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
    if (!existsSync(plistPath)) {
      errors.push(`${basename(zipPath)} is missing Contents/Info.plist.`);
      continue;
    }
    const bundleId = readPlistValue(plistPath, "CFBundleIdentifier");
    if (bundleId !== app.bundleId) {
      errors.push(`${basename(zipPath)} bundle id mismatch: expected ${app.bundleId}, got ${bundleId}.`);
    }
    const expectedVersion = manifestApps.get(app.id)?.version;
    const bundleVersion = readPlistValue(plistPath, "CFBundleShortVersionString");
    if (expectedVersion && bundleVersion !== expectedVersion) {
      errors.push(`${basename(zipPath)} version mismatch: expected ${expectedVersion}, got ${bundleVersion}.`);
    }
    const executableName = readPlistValue(plistPath, "CFBundleExecutable");
    let executablePath = null;
    if (!executableName) {
      errors.push(`${basename(zipPath)} is missing CFBundleExecutable.`);
    } else {
      executablePath = join(appPath, "Contents/MacOS", executableName);
      if (!existsSync(executablePath)) {
        errors.push(`${basename(zipPath)} is missing executable ${executableName}.`);
      } else if ((statSync(executablePath).mode & 0o111) === 0) {
        errors.push(`${basename(zipPath)} executable ${executableName} is not executable.`);
      }
    }
    const iconFile = readPlistValue(plistPath, "CFBundleIconFile");
    if (!iconFile) {
      errors.push(`${basename(zipPath)} is missing CFBundleIconFile.`);
    } else {
      const iconName = iconFile.endsWith(".icns") ? iconFile : `${iconFile}.icns`;
      const iconPath = join(appPath, "Contents/Resources", iconName);
      if (!existsSync(iconPath)) {
        errors.push(`${basename(zipPath)} is missing icon ${iconName}.`);
      }
    }
    try {
      execFileSync("/usr/bin/codesign", ["--verify", "--deep", appPath], { stdio: "pipe" });
    } catch (error) {
      if (!executablePath || !verifyExecutableSignature(executablePath)) {
        errors.push(`${basename(zipPath)} failed codesign verification: ${commandErrorMessage(error)}`);
      }
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

function readPlistValue(plistPath, key) {
  try {
    return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print ${key}`, plistPath], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function commandErrorMessage(error) {
  const stderr = error.stderr?.toString().trim();
  return stderr || error.message;
}

function verifyExecutableSignature(executablePath) {
  try {
    execFileSync("/usr/bin/codesign", ["--verify", executablePath], { stdio: "pipe" });
    return true;
  } catch {
    try {
      execFileSync("/usr/bin/codesign", ["-dv", executablePath], { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
}

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
