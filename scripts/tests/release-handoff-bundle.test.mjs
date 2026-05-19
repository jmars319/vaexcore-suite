import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  appVersion,
  loadSuiteConfig,
  sha256File,
  suiteRoot,
} from "../lib/suite-config.mjs";

test("release handoff bundle writes redacted local-only reports", () => {
  const artifactDir = writeDryRunManifestFixture();
  mkdirSync(join(suiteRoot, ".local"), { recursive: true });
  const outputDir = mkdtempSync(join(suiteRoot, ".local/test-release-handoff-"));

  try {
    execFileSync(
      "node",
      [
        "scripts/write-release-handoff-bundle.mjs",
        "--skip-git",
        "--skip-remote",
        "--artifact-dir",
        artifactDir,
        "--output-dir",
        outputDir,
        "--require-artifacts",
      ],
      { cwd: suiteRoot, encoding: "utf8" },
    );

    const summaryPath = join(outputDir, "handoff-summary.json");
    const readinessPath = join(outputDir, "release-readiness.json");
    const markdownPath = join(outputDir, "handoff-summary.md");
    const ciPath = join(outputDir, "ci-summary.json");
    const manifestPath = join(outputDir, "artifact-manifest.json");

    assert.equal(existsSync(summaryPath), true);
    assert.equal(existsSync(readinessPath), true);
    assert.equal(existsSync(markdownPath), true);
    assert.equal(existsSync(ciPath), true);
    assert.equal(existsSync(manifestPath), true);

    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    assert.equal(summary.ok, true);
    assert.equal(summary.artifacts.status, "pass");
    assert.equal(summary.releaseReadiness.status, "warn");
    assert.equal(summary.ciSummary.status, "warn");
    assert.equal(JSON.stringify(summary).includes("Bearer "), false);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

function writeDryRunManifestFixture() {
  const config = loadSuiteConfig();
  const dir = mkdtempSync(join(tmpdir(), "vaexcore-handoff-artifacts-"));
  const artifacts = [];
  for (const app of config.apps) {
    const file = `${app.id}-${appVersion(suiteRoot, app)}-dry-run.txt`;
    const path = join(dir, file);
    writeFileSync(path, `${app.id}\n`);
    artifacts.push({
      file,
      name: file,
      size: 1,
      sha256: sha256File(path),
    });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    `${JSON.stringify(
      {
        manifestVersion: 1,
        suiteName: "vaexcore",
        schemaVersion: 1,
        builtAt: "2026-05-19T00:00:00Z",
        platform: "macOS",
        arch: "arm64",
        suite: {
          gitSha: "suite-sha",
          dirty: false,
        },
        release: {
          schemaVersion: 1,
          version: "0.1.0",
          compatibleApps: Object.fromEntries(
            config.apps.map((app) => [app.id, appVersion(suiteRoot, app)]),
          ),
        },
        apps: config.apps.map((app) => ({
          id: app.id,
          name: app.name,
          version: appVersion(suiteRoot, app),
          gitSha: "app-sha",
          dirty: false,
          bundleId: app.bundleId,
          launchName: app.launchName,
          discoveryFile: app.discoveryFile,
          healthEndpoint: app.healthEndpoint,
          capabilities: app.capabilities,
        })),
        artifacts,
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}
