import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appVersion, loadSuiteConfig, suiteRoot } from "../lib/suite-config.mjs";

test("packaged app boot smoke waits for isolated Suite heartbeats", { skip: process.platform !== "darwin" }, () => {
  const config = loadSuiteConfig();
  const root = mkdtempSync(join(tmpdir(), "vaexcore-packaged-boot-test-"));
  const appsDir = join(root, "Applications");
  const homeDir = join(root, "home");
  mkdirSync(appsDir, { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  for (const app of config.apps) {
    writeFakeApp(appsDir, app);
  }

  const output = execFileSync(
    "node",
    [
      "scripts/smoke-packaged-app-boot.mjs",
      "--apps-dir",
      appsDir,
      "--home-dir",
      homeDir,
      "--timeout-ms",
      "7000",
      "--poll-ms",
      "100",
    ],
    { cwd: suiteRoot, encoding: "utf8" },
  );

  assert.match(output, /packaged app boot smoke passed/);
});

function writeFakeApp(appsDir, app) {
  const appPath = join(appsDir, `${app.launchName}.app`);
  const contentsDir = join(appPath, "Contents");
  const macOSDir = join(contentsDir, "MacOS");
  mkdirSync(macOSDir, { recursive: true });
  writeFileSync(
    join(contentsDir, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${app.id}-fake</string>
  <key>CFBundleIdentifier</key>
  <string>${app.bundleId}</string>
</dict>
</plist>
`,
  );

  const executablePath = join(macOSDir, `${app.id}-fake`);
  writeFileSync(executablePath, fakeExecutableSource(app));
  chmodSync(executablePath, 0o755);
}

function fakeExecutableSource(app) {
  const version = appVersion(suiteRoot, app);
  return `#!/usr/bin/env node
const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

process.on("SIGTERM", () => process.exit(0));
const suiteDir = join(process.env.HOME, "Library", "Application Support", "vaexcore", "suite");
mkdirSync(suiteDir, { recursive: true });
const now = new Date().toISOString();
writeFileSync(join(suiteDir, ${JSON.stringify(app.discoveryFile)}), JSON.stringify({
  schemaVersion: 1,
  appId: ${JSON.stringify(app.id)},
  appName: ${JSON.stringify(app.name)},
  bundleIdentifier: ${JSON.stringify(app.bundleId)},
  version: ${JSON.stringify(version)},
  pid: process.pid,
  startedAt: now,
  updatedAt: now,
  apiUrl: ${JSON.stringify(app.healthEndpoint)},
  wsUrl: null,
  healthUrl: ${JSON.stringify(app.healthEndpoint)},
  capabilities: ${JSON.stringify(app.capabilities)},
  launchName: ${JSON.stringify(app.launchName)}
}, null, 2) + "\\n");
setInterval(() => {}, 1000);
`;
}
