#!/usr/bin/env node
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  fileSize,
  gitDirty,
  gitSha,
  loadSuiteConfig,
  readJsonFile,
  sha256File,
  suiteRoot,
} from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const artifactDir = resolve(args["artifact-dir"] ?? join(suiteRoot, "dist/mac-suite"));
const platform = args.platform ?? process.platform;
const arch = args.arch ?? process.arch;
const manifestPath = resolve(args.output ?? join(artifactDir, "manifest.json"));
const config = loadSuiteConfig();
const appDirs = parseAppDirs(args["app-dir"]);

if (!existsSync(artifactDir)) {
  throw new Error(`Artifact directory does not exist: ${artifactDir}`);
}

const manifest = {
  manifestVersion: 1,
  suiteName: config.contract.suiteName,
  schemaVersion: config.contract.schemaVersion,
  builtAt: new Date().toISOString(),
  platform,
  arch,
  suite: {
    gitSha: gitSha(suiteRoot),
    dirty: gitDirty(suiteRoot),
  },
  release: readReleaseMetadata(),
  apps: config.apps.map((app) => {
    const appDir = appDirs.get(app.id) ?? resolve(suiteRoot, app.path);
    return {
      id: app.id,
      name: app.name,
      version: appVersionFromDirectory(appDir),
      gitSha: gitSha(appDir),
      dirty: gitDirty(appDir),
      bundleId: app.bundleId,
      launchName: app.launchName,
      discoveryFile: app.discoveryFile,
      healthEndpoint: app.healthEndpoint,
      capabilities: app.capabilities,
    };
  }),
  artifacts: listArtifacts(artifactDir).map((path) => ({
    file: relative(artifactDir, path).replaceAll("\\", "/"),
    name: basename(path),
    size: fileSize(path),
    sha256: sha256File(path),
  })),
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`suite manifest: ${manifestPath}`);

function listArtifacts(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "staging") {
        results.push(...listArtifacts(path));
      }
    } else if (entry.isFile() && entry.name !== "manifest.json" && !entry.name.endsWith(".sha256")) {
      results.push(path);
    }
  }
  return results.sort();
}

function readReleaseMetadata() {
  const path = join(suiteRoot, "suite/release.json");
  if (!existsSync(path)) {
    return null;
  }
  return readJsonFile(path);
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
      appendArg(parsed, key, true);
    } else {
      appendArg(parsed, key, value);
      index += 1;
    }
  }
  return parsed;
}

function appVersionFromDirectory(appDir) {
  const packagePath = join(appDir, "package.json");
  if (!existsSync(packagePath)) {
    return null;
  }
  return readJsonFile(packagePath).version ?? null;
}

function parseAppDirs(values) {
  const appDirs = new Map();
  for (const value of arrayValue(values)) {
    if (typeof value !== "string") {
      continue;
    }
    const separator = value.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Invalid --app-dir value: ${value}`);
    }
    const id = value.slice(0, separator);
    const path = value.slice(separator + 1);
    appDirs.set(id, resolve(path));
  }
  return appDirs;
}

function appendArg(parsed, key, value) {
  if (Object.hasOwn(parsed, key)) {
    parsed[key] = [...arrayValue(parsed[key]), value];
  } else {
    parsed[key] = value;
  }
}

function arrayValue(value) {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
