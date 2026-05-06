#!/usr/bin/env node
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import {
  appAbsolutePath,
  appVersion,
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
    const appDir = appAbsolutePath(suiteRoot, app);
    return {
      id: app.id,
      name: app.name,
      version: appVersion(suiteRoot, app),
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
    file: relative(artifactDir, path),
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
      parsed[key] = true;
    } else {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}
