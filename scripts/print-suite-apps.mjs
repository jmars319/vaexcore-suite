#!/usr/bin/env node
import {
  appVersion,
  expandedMacDirectory,
  loadSuiteConfig,
  suiteRoot,
} from "./lib/suite-config.mjs";

const command = process.argv[2];
const { apps, contract, services } = loadSuiteConfig();

const writeTsv = (rows) => {
  for (const row of rows) {
    console.log(row.map((value) => String(value ?? "")).join("\t"));
  }
};

if (command === "clone-tsv") {
  writeTsv(apps.map((app) => [app.name, app.repo, app.path, app.branch]));
} else if (command === "service-clone-tsv") {
  writeTsv(
    services.map((service) => [
      service.name,
      service.repo,
      service.path,
      service.branch,
      service.remoteOptional ? "true" : "false",
    ]),
  );
} else if (command === "mac-build-tsv") {
  writeTsv(
    apps.map((app) => [
      app.id,
      app.name,
      app.path,
      app.macBuildCommand,
      app.launchName,
      app.macArtifactSearchDir,
      app.macOSInstallPath,
    ]),
  );
} else if (command === "macos-verify-tsv") {
  writeTsv(
    apps.map((app) => [
      app.id,
      app.name,
      app.bundleId,
      app.discoveryFile,
      app.macOSInstallPath,
    ]),
  );
} else if (command === "macos-suite-info-tsv") {
  writeTsv([
    [
      expandedMacDirectory(contract.discovery.macOSDirectory),
      contract.discovery.heartbeatStaleMs,
    ],
  ]);
} else if (command === "macos-launch-names-tsv") {
  writeTsv(
    apps.map((app) => [app.id, app.launchName, appVersion(suiteRoot, app)]),
  );
} else {
  console.error(
    "Usage: print-suite-apps.mjs <clone-tsv|mac-build-tsv|macos-verify-tsv|macos-suite-info-tsv|macos-launch-names-tsv>",
  );
  process.exit(2);
}
