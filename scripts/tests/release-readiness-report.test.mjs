import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appVersion, loadSuiteConfig, sha256File, suiteRoot } from "../lib/suite-config.mjs";

test("release readiness report combines local gates without remote CI", () => {
  const artifactDir = writeDryRunManifestFixture();
  const output = execFileSync(
    "node",
    [
      "scripts/release-readiness-report.mjs",
      "--skip-git",
      "--skip-remote",
      "--artifact-dir",
      artifactDir,
      "--require-artifacts",
      "--json",
    ],
    { cwd: suiteRoot, encoding: "utf8" },
  );
  const report = JSON.parse(output);

  assert.equal(report.ok, true);
  assert.ok(report.checks.some((item) => item.id === "git-clean-and-pushed" && item.status === "warn"));
  assert.ok(report.checks.some((item) => item.id === "version-alignment" && item.status === "pass"));
  assert.ok(report.checks.some((item) => item.id === "artifact-manifest" && item.status === "pass"));
  assert.ok(report.checks.some((item) => item.id === "automation-boundary" && item.status === "warn"));
  assert.ok(report.checks.some((item) => item.id === "go-live-dry-run" && item.status === "warn"));
  assert.ok(report.checks.some((item) => item.id === "pulse-intake-readiness" && item.status === "pass"));
  assert.ok(report.checks.some((item) => item.id === "suite-static-checks" && item.status === "pass"));
  assert.ok(report.checks.some((item) => item.id === "windows-handoff-pack" && item.status === "warn"));
  assert.ok(report.manualBlockers.some((item) => item.id === "live-twitch-oauth-chat"));
  assert.ok(report.manualBlockers.some((item) => item.id === "windows-hardware-capture-and-encoder-validation"));
});

function writeDryRunManifestFixture() {
  const config = loadSuiteConfig();
  const dir = mkdtempSync(join(tmpdir(), "vaexcore-readiness-artifacts-"));
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
        builtAt: "2026-05-07T00:00:00Z",
        platform: "macOS",
        arch: "arm64",
        suite: {
          gitSha: "suite-sha",
          dirty: false,
        },
        release: {
          schemaVersion: 1,
          version: "0.1.0",
          compatibleApps: Object.fromEntries(config.apps.map((app) => [app.id, appVersion(suiteRoot, app)])),
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
