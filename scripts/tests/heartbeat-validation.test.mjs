import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appVersion, loadSuiteConfig, suiteRoot } from "../lib/suite-config.mjs";

test("validate-heartbeats accepts fresh heartbeat files for every app", () => {
  const dir = writeHeartbeatDirectory();

  assert.doesNotThrow(() => {
    execFileSync("node", ["scripts/validate-heartbeats.mjs", "--dir", dir, "--strict-age", "--max-age-ms", "60000"], {
      cwd: suiteRoot,
      stdio: "pipe",
    });
  });
});

test("validate-heartbeats rejects malformed heartbeat JSON", () => {
  const dir = writeHeartbeatDirectory();
  writeFileSync(join(dir, "vaexcore-pulse.json"), "{bad json\n");

  assert.match(validateHeartbeats(dir), /Invalid heartbeat JSON for vaexcore-pulse/);
});

test("validate-heartbeats rejects stale heartbeat files", () => {
  const dir = writeHeartbeatDirectory();
  const stale = new Date(Date.now() - 10_000);
  utimesSync(join(dir, "vaexcore-console.json"), stale, stale);

  assert.match(validateHeartbeats(dir, ["--strict-age", "--max-age-ms", "1000"]), /vaexcore-console\.json is stale/);
});

test("validate-heartbeats rejects wrong bundle ids, missing capabilities, and non-local URLs", () => {
  const dir = writeHeartbeatDirectory({
    mutate(app, heartbeat) {
      if (app.id === "vaexcore-studio") heartbeat.bundleIdentifier = "com.example.wrong";
      if (app.id === "vaexcore-pulse") heartbeat.capabilities = [];
      if (app.id === "vaexcore-console") heartbeat.apiUrl = "https://example.com/status";
    },
  });

  assert.match(
    validateHeartbeats(dir),
    /bundleIdentifier expected[\s\S]*capabilities must contain at least 1 items[\s\S]*apiUrl must be a localhost URL/,
  );
});

function writeHeartbeatDirectory(options = {}) {
  const config = loadSuiteConfig();
  const dir = mkdtempSync(join(tmpdir(), "vaexcore-heartbeats-"));
  for (const app of config.apps) {
    const heartbeat = validHeartbeat(app);
    options.mutate?.(app, heartbeat);
    writeFileSync(join(dir, app.discoveryFile), `${JSON.stringify(heartbeat, null, 2)}\n`);
  }
  return dir;
}

function validHeartbeat(app) {
  const apiUrl = app.healthEndpoint.replace(/\/health$|\/api\/status$/, "");
  return {
    schemaVersion: 1,
    appId: app.id,
    appName: app.name,
    bundleIdentifier: app.bundleId,
    version: appVersion(suiteRoot, app),
    pid: 1234,
    startedAt: "2026-05-06T12:00:00Z",
    updatedAt: "2026-05-06T12:00:15Z",
    apiUrl,
    wsUrl: null,
    healthUrl: app.healthEndpoint,
    capabilities: app.capabilities,
    launchName: app.launchName,
    suiteSessionId: null,
    activity: "ready",
    activityDetail: "Ready",
    localRuntime: {
      contractVersion: 1,
      mode: "local-first",
      state: "ready",
      appStorageDir: `/tmp/${app.id}`,
      suiteDir: "/tmp/vaexcore/suite",
      secureStorage: "test",
      secretStorageState: "ready",
      durableStorage: ["sqlite"],
      networkPolicy: "localhost-only",
      dependencies: [
        {
          name: `${app.id}-api`,
          kind: "local-http-service",
          state: "reachable",
          detail: apiUrl,
        },
      ],
    },
  };
}

function validateHeartbeats(dir, extraArgs = []) {
  try {
    execFileSync("node", ["scripts/validate-heartbeats.mjs", "--dir", dir, ...extraArgs], {
      cwd: suiteRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.fail("heartbeat validation unexpectedly passed");
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
}
