import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appVersion, loadSuiteConfig, sha256File, suiteRoot } from "../lib/suite-config.mjs";

test("inspect-mac-artifacts validates synthetic signed app bundles", { skip: process.platform !== "darwin" }, () => {
  const fixture = writeMacArtifactFixture();

  assert.doesNotThrow(() => {
    execFileSync("node", ["scripts/inspect-mac-artifacts.mjs", "--artifact-dir", fixture.dir], {
      cwd: suiteRoot,
      stdio: "pipe",
    });
  });
});

test("inspect-mac-artifacts rejects wrong bundle ids", { skip: process.platform !== "darwin" }, () => {
  const fixture = writeMacArtifactFixture({
    mutate(app, bundle) {
      if (app.id === "vaexcore-pulse") bundle.bundleId = "com.example.wrong";
    },
  });

  assert.match(inspectMacArtifacts(fixture.dir), /bundle id mismatch/);
});

test("inspect-mac-artifacts rejects missing Info.plist", { skip: process.platform !== "darwin" }, () => {
  const fixture = writeMacArtifactFixture({
    mutate(app, bundle) {
      if (app.id === "vaexcore-console") {
        bundle.writePlist = false;
        bundle.sign = false;
      }
    },
  });

  assert.match(inspectMacArtifacts(fixture.dir), /missing Contents\/Info\.plist/);
});

test("inspect-mac-artifacts rejects missing bundle executables", { skip: process.platform !== "darwin" }, () => {
  const fixture = writeMacArtifactFixture({
    mutate(app, bundle) {
      if (app.id === "vaexcore-studio") {
        bundle.writeExecutable = false;
        bundle.sign = false;
      }
    },
  });

  assert.match(inspectMacArtifacts(fixture.dir), /missing executable/);
});

function writeMacArtifactFixture(options = {}) {
  const config = loadSuiteConfig();
  const dir = mkdtempSync(join(tmpdir(), "vaexcore-mac-artifacts-"));
  const manifest = {
    manifestVersion: 1,
    suiteName: "vaexcore",
    schemaVersion: 1,
    builtAt: "2026-05-06T12:00:00Z",
    platform: "macOS",
    arch: "arm64",
    suite: { gitSha: "suite-sha", dirty: false },
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
    artifacts: [],
  };

  for (const app of config.apps) {
    const zipPath = writeAppZip(dir, app, options);
    manifest.artifacts.push({
      file: `${app.id}-${appVersion(suiteRoot, app)}.zip`,
      name: `${app.id}-${appVersion(suiteRoot, app)}.zip`,
      size: 1,
      sha256: sha256File(zipPath),
    });
  }

  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, manifest };
}

function writeAppZip(dir, app, options) {
  const version = appVersion(suiteRoot, app);
  const bundle = {
    bundleId: app.bundleId,
    executable: app.launchName,
    icon: "icon.icns",
    writePlist: true,
    writeExecutable: true,
    sign: true,
  };
  options.mutate?.(app, bundle);

  const appPath = join(dir, `${app.launchName}.app`);
  mkdirSync(join(appPath, "Contents/MacOS"), { recursive: true });
  mkdirSync(join(appPath, "Contents/Resources"), { recursive: true });
  if (bundle.writePlist) {
    writeFileSync(join(appPath, "Contents/Info.plist"), plist({
      bundleId: bundle.bundleId,
      version,
      executable: bundle.executable,
      icon: bundle.icon,
    }));
  }
  if (bundle.writeExecutable) {
    const executablePath = join(appPath, "Contents/MacOS", bundle.executable);
    writeFileSync(executablePath, "#!/bin/sh\nexit 0\n");
    chmodSync(executablePath, 0o755);
  }
  writeFileSync(join(appPath, "Contents/Resources", bundle.icon), "icns\n");
  if (bundle.sign) {
    execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", appPath], { stdio: "pipe" });
  }

  const zipPath = join(dir, `${app.id}-${version}.zip`);
  execFileSync("ditto", ["-c", "-k", "--keepParent", appPath, zipPath], { stdio: "pipe" });
  return zipPath;
}

function inspectMacArtifacts(dir) {
  try {
    execFileSync("node", ["scripts/inspect-mac-artifacts.mjs", "--artifact-dir", dir], {
      cwd: suiteRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("mac artifact inspection unexpectedly passed");
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}

function plist({ bundleId, version, executable, icon }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleExecutable</key>
  <string>${executable}</string>
  <key>CFBundleIconFile</key>
  <string>${icon}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
</dict>
</plist>
`;
}
