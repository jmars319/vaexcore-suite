#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  appAbsolutePath,
  loadSuiteConfig,
  suiteRoot,
} from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const outputPath = args.output ? resolve(args.output) : null;
const tempDir = mkdtempSync(join(tmpdir(), "vaexcore-marker-rehearsal-"));
const report = await runSmoke().finally(() => {
  if (!args["keep-temp"]) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
const rendered = args.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered);
}
process.stdout.write(rendered);
if (!report.ok) {
  process.exit(1);
}

async function runSmoke() {
  const generatedAt = new Date().toISOString();
  const config = loadSuiteConfig();
  const studio = config.apps.find((app) => app.id === "vaexcore-studio");
  const consoleApp = config.apps.find((app) => app.id === "vaexcore-console");
  const studioPath = studio ? appAbsolutePath(suiteRoot, studio) : null;
  const consolePath = consoleApp ? appAbsolutePath(suiteRoot, consoleApp) : null;
  const port = await reservePort();
  const apiUrl = `http://127.0.0.1:${port}`;
  const databasePath = join(tempDir, "studio-marker-rehearsal.sqlite");
  const checks = [];

  if (!studioPath || !consolePath) {
    return {
      ok: false,
      generatedAt,
      apiUrl,
      tempDir,
      checks: [
        check("suite-config", false, "Studio or Console is missing from suite config."),
      ],
    };
  }

  const studioProcess = spawn(
    "cargo",
    [
      "run",
      "-p",
      "vaexcore-api",
      "--bin",
      "marker_smoke_server",
      "--",
      "--port",
      String(port),
      "--database",
      databasePath,
    ],
    {
      cwd: studioPath,
      env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? "warn" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const studioLogs = collectProcessOutput(studioProcess);

  try {
    await waitForHealth(apiUrl, 90_000);
    checks.push(check("studio-api", true, "Studio marker smoke API is reachable.", { apiUrl }));

    const consoleRun = spawnSync("npm", ["run", "rehearse:studio-markers"], {
      cwd: consolePath,
      env: {
        ...process.env,
        VAEXCORE_STUDIO_INTEGRATION: "1",
        VAEXCORE_STUDIO_API_URL: apiUrl,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    checks.push(
      check(
        "console-rehearsal",
        consoleRun.status === 0,
        consoleRun.status === 0
          ? "Console created chat and giveaway markers and verified idempotency."
          : "Console marker rehearsal failed.",
        {
          stdoutTail: tail(consoleRun.stdout),
          stderrTail: tail(consoleRun.stderr),
        },
      ),
    );

    const markersResponse = await fetch(`${apiUrl}/markers?source_app=vaexcore-console`);
    const markersBody = await markersResponse.json();
    const markers = Array.isArray(markersBody?.data?.markers)
      ? markersBody.data.markers
      : [];
    checks.push(
      check(
        "studio-marker-query",
        markersResponse.ok && markers.length === 2,
        markersResponse.ok && markers.length === 2
          ? "Studio query returned the two Console rehearsal markers."
          : "Studio marker query did not return the expected Console markers.",
        {
          markerCount: markers.length,
          sourceEventIds: markers.map((marker) => marker.source_event_id),
        },
      ),
    );
  } catch (error) {
    checks.push(
      check("smoke-error", false, error instanceof Error ? error.message : "Marker smoke failed."),
    );
  } finally {
    studioProcess.kill("SIGTERM");
  }

  return {
    ok: checks.every((item) => item.ok),
    generatedAt,
    apiUrl,
    tempDir: args["keep-temp"] ? tempDir : null,
    databasePath: args["keep-temp"] ? databasePath : null,
    checks,
    studioLogs: {
      stdoutTail: tail(studioLogs.stdout()),
      stderrTail: tail(studioLogs.stderr()),
    },
  };
}

async function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) {
          resolvePort(port);
        } else {
          reject(new Error("could not reserve a localhost port"));
        }
      });
    });
    server.on("error", reject);
  });
}

async function waitForHealth(apiUrl, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${apiUrl}/health`);
      const body = await response.json().catch(() => null);
      if (response.ok && body?.ok) {
        return;
      }
      lastError = new Error(`health returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError instanceof Error ? lastError : new Error("Studio health check timed out.");
}

function collectProcessOutput(child) {
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
  return {
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
  };
}

function check(id, ok, summary, detail = {}) {
  return { id, ok, summary, detail };
}

function tail(value, lines = 20) {
  return String(value ?? "")
    .trim()
    .split(/\r?\n/)
    .slice(-lines)
    .join("\n");
}

function renderMarkdown(report) {
  return [
    "# Console/Studio Marker Smoke",
    "",
    `Generated: ${report.generatedAt}`,
    `Result: ${report.ok ? "pass" : "fail"}`,
    "",
    ...report.checks.map((item) => `- ${item.ok ? "PASS" : "FAIL"} ${item.id}: ${item.summary}`),
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") parsed.json = true;
    else if (arg === "--keep-temp") parsed["keep-temp"] = true;
    else if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--output") parsed.output = argv[++index];
    else throw new Error(`Unknown argument ${arg}`);
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/smoke-console-studio-markers.mjs [options]

Starts an isolated Studio marker API and rehearses Console chat/giveaway markers.

Options:
  --json            Print JSON instead of Markdown.
  --output <path>   Write the report to a file.
  --keep-temp       Keep the temporary Studio database.
`);
}
