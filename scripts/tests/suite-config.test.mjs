import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateSuiteConfig } from "../lib/suite-config.mjs";

test("validates a minimal suite config", () => {
  const root = writeSuiteFixture();
  const { errors } = validateSuiteConfig({ root });
  assert.deepEqual(errors, []);
});

test("reports duplicate health ports and missing contract entries", () => {
  const root = writeSuiteFixture({
    mutateApps(apps) {
      apps.apps.push({ ...apps.apps[0], id: "vaexcore-extra", path: "extra" });
      apps.apps[1].macBuildCommand = "";
    },
    mutateContract(contract) {
      contract.apps[1].healthEndpoint = contract.apps[0].healthEndpoint;
    },
  });

  const { errors } = validateSuiteConfig({ root });
  assert.match(errors.join("\n"), /missing from suite\/contract\.json/);
  assert.match(errors.join("\n"), /healthEndpoint port/);
  assert.match(errors.join("\n"), /macBuildCommand/);
});

function writeSuiteFixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "vaexcore-suite-config-"));
  mkdirSync(join(root, "suite"), { recursive: true });
  const apps = {
    schemaVersion: 1,
    apps: [
      appConfig("vaexcore-studio", "studio", "npm", "51287"),
      appConfig("vaexcore-pulse", "pulse", "pnpm", "4010"),
    ],
  };
  const contract = {
    schemaVersion: 1,
    suiteName: "vaexcore",
    discovery: {
      macOSDirectory: "~/Library/Application Support/vaexcore/suite",
      windowsDirectory: "%APPDATA%\\vaexcore\\suite",
      heartbeatStaleMs: 30000,
      schemaVersion: 1,
    },
    handoffs: {
      macOSDirectory: "~/Library/Application Support/vaexcore/suite/handoffs",
      windowsDirectory: "%APPDATA%\\vaexcore\\suite\\handoffs",
      pulseRecordingIntakeFile: "pulse-recording-intake.json",
    },
    markerContract: {
      name: "vaexcore.studio.marker.v1",
      schemaVersion: 1,
      requiredMetadataFields: ["contract", "schemaVersion", "eventType", "source", "createdAt"],
    },
    apps: [
      contractApp("vaexcore-studio", "studio", "com.vaexcore.studio", "51287"),
      contractApp("vaexcore-pulse", "pulse", "com.vaexil.vaexcore.pulse", "4010"),
    ],
  };
  options.mutateApps?.(apps);
  options.mutateContract?.(contract);
  writeFileSync(join(root, "apps.json"), `${JSON.stringify(apps, null, 2)}\n`);
  writeFileSync(join(root, "suite/contract.json"), `${JSON.stringify(contract, null, 2)}\n`);
  return root;
}

function appConfig(id, shortName, packageManager, port) {
  return {
    id,
    name: `vaexcore ${shortName}`,
    repo: `https://github.com/jmars319/${id}`,
    path: shortName,
    branch: "main",
    packageManager,
    dependencyInstallCommand: `${packageManager} install`,
    windowsDistCommand: `${packageManager} run app:dist:windows`,
    windowsArtifactPatterns: [`${shortName}\\release\\*.exe`],
    macBuildCommand: `${packageManager} run app:build`,
    macArtifactSearchDir: "release",
    artifactFolder: shortName,
  };
}

function contractApp(id, shortName, bundleId, port) {
  return {
    id,
    name: `vaexcore ${shortName}`,
    bundleId,
    macOSInstallPath: `/Applications/vaexcore ${shortName}.app`,
    windowsInstallPath: `%LOCALAPPDATA%\\Programs\\vaexcore ${shortName}\\vaexcore ${shortName}.exe`,
    launchName: `vaexcore ${shortName}`,
    discoveryFile: `${id}.json`,
    healthEndpoint: `http://127.0.0.1:${port}/health`,
    capabilities: [`${shortName}.api`, "suite.launcher"],
  };
}
