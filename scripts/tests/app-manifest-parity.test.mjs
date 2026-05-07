import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { appAbsolutePath, loadSuiteConfig, readJsonFile, suiteRoot } from "../lib/suite-config.mjs";

test("suite app contract matches each desktop app manifest", () => {
  const config = loadSuiteConfig();

  for (const app of config.apps) {
    const manifest = readDesktopManifest(app);
    assert.equal(app.bundleId, manifest.bundleId, `${app.id} bundle id`);
    assert.equal(app.launchName, manifest.productName, `${app.id} product name`);
  }
});

test("Pulse packaged app config bundles helper resources", () => {
  const pulse = loadSuiteConfig().apps.find((app) => app.id === "vaexcore-pulse");
  assert.ok(pulse, "pulse suite app is configured");

  const tauriConfig = readJsonFile(join(appAbsolutePath(suiteRoot, pulse), "apps/desktopapp/src-tauri/tauri.conf.json"));
  assert.match(tauriConfig.build.beforeBuildCommand, /build:service-bundle/);
  assert.deepEqual(tauriConfig.bundle.resources, {
    "resources/pulse-analyzer": "pulse-analyzer",
    "resources/pulse-api": "pulse-api",
  });
});

function readDesktopManifest(app) {
  const appRoot = appAbsolutePath(suiteRoot, app);
  const tauriConfigPaths = [
    join(appRoot, "apps/desktop/src-tauri/tauri.conf.json"),
    join(appRoot, "apps/desktopapp/src-tauri/tauri.conf.json"),
  ];
  for (const path of tauriConfigPaths) {
    if (!existsSync(path)) {
      continue;
    }
    const tauriConfig = readJsonFile(path);
    return {
      bundleId: tauriConfig.identifier,
      productName: tauriConfig.productName,
    };
  }

  const packageJson = readJsonFile(join(appRoot, "package.json"));
  assert.ok(packageJson.build, `${app.id} package.json has an Electron build manifest`);
  return {
    bundleId: packageJson.build.appId,
    productName: packageJson.build.productName,
  };
}
