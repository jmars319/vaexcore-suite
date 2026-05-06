import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appAbsolutePath, appVersion, loadSuiteConfig, readJsonFile, sha256File, suiteRoot } from "../lib/suite-config.mjs";

test("suite release compatibility matches app package and desktop Cargo versions", () => {
  const config = loadSuiteConfig();
  const release = readJsonFile(join(suiteRoot, "suite/release.json"));

  for (const app of config.apps) {
    const packageVersion = appVersion(suiteRoot, app);
    assert.equal(release.compatibleApps[app.id], packageVersion, `${app.id} package.json`);

    const cargoVersion = readDesktopCargoVersion(app);
    if (cargoVersion) {
      assert.equal(release.compatibleApps[app.id], cargoVersion, `${app.id} desktop Cargo.toml`);
    }
  }
});

test("release manifest rejects missing compatibility entries", () => {
  const fixture = writeManifestFixture();
  delete fixture.manifest.release.compatibleApps["vaexcore-pulse"];
  writeManifest(fixture);

  assert.match(validateManifest(fixture.manifestPath), /compatibleApps is missing vaexcore-pulse/);
});

test("release manifest rejects checksum mismatches", () => {
  const fixture = writeManifestFixture();
  fixture.manifest.artifacts[0].sha256 = "0".repeat(64);
  writeManifest(fixture);

  assert.match(validateManifest(fixture.manifestPath), /checksum mismatch/);
});

test("release manifest rejects missing artifact files", () => {
  const fixture = writeManifestFixture();
  unlinkSync(join(fixture.dir, fixture.manifest.artifacts[0].file));

  assert.match(validateManifest(fixture.manifestPath), /artifact is missing on disk/);
});

test("release manifest rejects duplicate artifacts", () => {
  const fixture = writeManifestFixture();
  fixture.manifest.artifacts.push({ ...fixture.manifest.artifacts[0] });
  writeManifest(fixture);

  assert.match(validateManifest(fixture.manifestPath), /duplicate artifact entry/);
});

test("release manifest rejects unknown apps", () => {
  const fixture = writeManifestFixture();
  fixture.manifest.apps.push({
    ...fixture.manifest.apps[0],
    id: "vaexcore-unknown",
    name: "vaexcore unknown",
  });
  fixture.manifest.release.compatibleApps["vaexcore-unknown"] = "9.9.9";
  writeManifest(fixture);

  assert.match(validateManifest(fixture.manifestPath), /unknown app in manifest[\s\S]*compatibleApps includes unknown app/);
});

function writeManifestFixture() {
  const config = loadSuiteConfig();
  const dir = mkdtempSync(join(tmpdir(), "vaexcore-release-manifest-"));
  const artifacts = config.apps.map((app) => {
    const file = `${app.id}-${appVersion(suiteRoot, app)}.txt`;
    const path = join(dir, file);
    writeFileSync(path, `${app.id}\n`);
    return {
      file,
      name: file,
      size: 1,
      sha256: sha256File(path),
    };
  });
  const manifest = {
    manifestVersion: 1,
    suiteName: "vaexcore",
    schemaVersion: 1,
    builtAt: "2026-05-06T12:00:00Z",
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
  };
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifest, manifestPath };
}

function writeManifest(fixture) {
  writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
}

function validateManifest(manifestPath) {
  try {
    execFileSync("node", ["scripts/validate-release-manifest.mjs", manifestPath], {
      cwd: suiteRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("manifest validation unexpectedly passed");
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

function readDesktopCargoVersion(app) {
  const candidates = [
    join(appAbsolutePath(suiteRoot, app), "apps/desktop/src-tauri/Cargo.toml"),
    join(appAbsolutePath(suiteRoot, app), "apps/desktopapp/src-tauri/Cargo.toml"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const match = readFileSync(path, "utf8").match(/^version = "([^"]+)"/m);
    return match?.[1] ?? null;
  }
  return null;
}
