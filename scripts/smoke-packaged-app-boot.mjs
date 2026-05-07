#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { appVersion, loadSuiteConfig, suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const appsDir = resolve(args["apps-dir"] ?? "/Applications");
const timeoutMs = Number(args["timeout-ms"] ?? 45_000);
const pollMs = Number(args["poll-ms"] ?? 500);
const keepHome = Boolean(args["keep-home"]);
const homeDir = args["home-dir"]
  ? resolve(args["home-dir"])
  : mkdtempSync(join(tmpdir(), "vaexcore-packaged-boot-home-"));
const logDir = resolve(args["log-dir"] ?? join(homeDir, "packaged-boot-logs"));
const config = loadSuiteConfig();
const suiteDir = join(homeDir, "Library", "Application Support", "vaexcore", "suite");
const children = [];
const logFds = [];
const childExits = new Map();

if (process.platform !== "darwin") {
  console.log("packaged app boot smoke skipped: macOS is required");
  process.exit(0);
}

mkdirSync(logDir, { recursive: true });
mkdirSync(suiteDir, { recursive: true });

try {
  for (const app of config.apps) {
    const appPath = join(appsDir, `${app.launchName}.app`);
    if (!existsSync(appPath)) {
      throw new Error(`Missing packaged app bundle: ${appPath}`);
    }

    const executableName = readBundleExecutable(appPath);
    const executablePath = join(appPath, "Contents", "MacOS", executableName);
    if (!existsSync(executablePath)) {
      throw new Error(`Missing packaged app executable: ${executablePath}`);
    }

    const launch = packagedBootLaunch(appPath, executablePath);
    const child = spawn(launch.command, launch.args, {
      detached: true,
      env: {
        ...process.env,
        ...launch.env,
        HOME: homeDir,
        XDG_DATA_HOME: join(homeDir, ".local", "share"),
        VAEXCORE_CONFIG_DIR: join(homeDir, "vaexcore-console-config"),
        VAEXCORE_MODE: "local",
        VAEXCORE_STUDIO_INTEGRATION: "false",
        VAEXCORE_PULSE_ALLOW_REPO_HELPERS: "0",
        VAEXCORE_PACKAGED_BOOT_SMOKE: "1",
      },
      stdio: [
        "ignore",
        openLog(app.id, "stdout"),
        openLog(app.id, "stderr"),
      ],
    });
    childExits.set(app.id, null);
    child.on("error", (error) => {
      childExits.set(app.id, { error: error.message });
    });
    child.on("exit", (code, signal) => {
      childExits.set(app.id, { code, signal });
    });
    children.push({ app, child });
  }

  await waitForHeartbeats();
  execFileSync(
    "node",
    [
      "scripts/validate-heartbeats.mjs",
      "--dir",
      suiteDir,
      "--strict-age",
      "--max-age-ms",
      String(config.contract.discovery.heartbeatStaleMs),
    ],
    { cwd: suiteRoot, stdio: "inherit" },
  );
  console.log(`packaged app boot smoke passed: ${appsDir}`);
} finally {
  await stopChildren();
  closeLogs();
  if (!keepHome && !args["home-dir"]) {
    rmSync(homeDir, { recursive: true, force: true });
  } else {
    console.log(`packaged boot smoke home preserved: ${homeDir}`);
  }
}

function packagedBootLaunch(appPath, executablePath) {
  const appAsar = join(appPath, "Contents", "Resources", "app.asar");
  if (existsSync(appAsar)) {
    return {
      command: executablePath,
      args: [join(appAsar, "desktop", "shared", "electron", "packaged-boot-smoke.cjs")],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    };
  }
  return { command: executablePath, args: [], env: {} };
}

function readBundleExecutable(appPath) {
  try {
    return execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print CFBundleExecutable", join(appPath, "Contents", "Info.plist")],
      { encoding: "utf8" },
    ).trim();
  } catch (error) {
    throw new Error(`Unable to read CFBundleExecutable for ${appPath}: ${commandError(error)}`);
  }
}

function openLog(appId, stream) {
  const fd = openSync(join(logDir, `${appId}.${stream}.log`), "a");
  logFds.push(fd);
  return fd;
}

function closeLogs() {
  for (const fd of logFds) {
    try {
      closeSync(fd);
    } catch {
      // The descriptor was already closed.
    }
  }
}

async function waitForHeartbeats() {
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(config.apps.map((app) => app.id));
  const errors = [];

  while (Date.now() < deadline && pending.size > 0) {
    for (const app of config.apps) {
      if (!pending.has(app.id)) {
        continue;
      }
      const exit = childExits.get(app.id);
      const heartbeatPath = join(suiteDir, app.discoveryFile);
      if (existsSync(heartbeatPath) && heartbeatLooksValid(app, heartbeatPath)) {
        pending.delete(app.id);
      } else if (exit) {
        errors.push(`${app.id} exited before publishing a heartbeat: ${JSON.stringify(exit)}`);
        pending.delete(app.id);
      }
    }
    if (pending.size > 0) {
      await sleep(pollMs);
    }
  }

  for (const appId of pending) {
    errors.push(`${appId} did not publish a heartbeat within ${timeoutMs}ms`);
  }
  if (errors.length > 0) {
    errors.push(`logs: ${logDir}`);
    throw new Error(errors.join("\n"));
  }
}

function heartbeatLooksValid(app, heartbeatPath) {
  try {
    const heartbeat = JSON.parse(readFileSync(heartbeatPath, "utf8"));
    return (
      heartbeat.appId === app.id &&
      heartbeat.bundleIdentifier === app.bundleId &&
      heartbeat.version === appVersion(suiteRoot, app) &&
      heartbeat.launchName === app.launchName &&
      Number.isInteger(heartbeat.pid) &&
      heartbeat.pid > 0
    );
  } catch {
    return false;
  }
}

async function stopChildren() {
  for (const { child } of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
      continue;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      continue;
    }
  }

  await sleep(1_000);

  for (const { child } of children) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
      continue;
    }
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // The app already exited.
    }
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function commandError(error) {
  return `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`.trim();
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
