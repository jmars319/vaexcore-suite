#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  appAbsolutePath,
  loadSuiteConfig,
  suiteRoot,
} from "./lib/suite-config.mjs";
import { redactReportValue } from "./lib/redact-report.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const json = Boolean(args.json);
const outputPath = resolve(
  args.output ?? join(suiteRoot, ".local/capture-to-review-smoke.json"),
);
const outputDir = dirname(outputPath);

mkdirSync(outputDir, { recursive: true });

const report = buildReport();
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));

if (!report.ok) {
  process.exit(1);
}

function buildReport() {
  const generatedAt = new Date().toISOString();
  const config = loadSuiteConfig();
  const studio = config.apps.find((app) => app.id === "vaexcore-studio");
  const pulse = config.apps.find((app) => app.id === "vaexcore-pulse");
  const studioPath = studio ? appAbsolutePath(suiteRoot, studio) : null;
  const pulsePath = pulse ? appAbsolutePath(suiteRoot, pulse) : null;
  const checks = [];

  const studioSmoke = studioPath
    ? runCommand("npm", ["run", "smoke:media-recording"], { cwd: studioPath })
    : missingProjectResult("Studio");
  checks.push(
    check(
      "studio-media-recording-smoke",
      studioSmoke.ok,
      studioSmoke.ok
        ? "Studio media-recording smoke completed."
        : "Studio media-recording smoke failed.",
      {
        stdoutTail: outputTail(studioSmoke.stdout),
        stderrTail: outputTail(studioSmoke.stderr),
      },
    ),
  );

  const studioResultPath = studioPath
    ? join(studioPath, ".local/media-recording-smoke/result.json")
    : null;
  const studioResult = studioResultPath ? readOptionalJson(studioResultPath) : null;
  const studioResultStatus = !studioSmoke.ok
    ? "fail"
    : studioResult?.skipped
      ? "warn"
      : studioResult?.ok
        ? "pass"
        : "fail";
  checks.push({
    id: "studio-recording-result",
    status: studioResultStatus,
    summary: studioResult?.skipped
      ? `Studio media recording skipped: ${studioResult.reason ?? "missing ffmpeg"}`
      : studioResult?.ok
        ? "Studio media recording result includes a concrete output."
        : "Studio media recording result JSON was missing or failed.",
    details: {
      output: relativeToSuite(studioResultPath),
      sessionId: studioResult?.sessionId ?? null,
      recordingPath: studioResult?.recordingPath ?? null,
      size: studioResult?.size ?? null,
      completion: studioResult?.completion ?? null,
      verification: studioResult?.verification ?? null,
    },
  });

  let handoff = null;
  let handoffPath = null;
  let pulseSmoke = null;
  if (studioResult?.ok && !studioResult.skipped) {
    handoff = buildHandoffFixture(studioResult, generatedAt);
    handoffPath = join(outputDir, "studio-pulse-recording-handoff.json");
    writeFileSync(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
    pulseSmoke = pulsePath
      ? runCommand(
          "pnpm",
          [
            "exec",
            "tsx",
            "scripts/smoke-studio-handoff-review-export.ts",
            "--handoff",
            handoffPath,
          ],
          { cwd: pulsePath },
        )
      : missingProjectResult("Pulse");
  }

  if (pulseSmoke) {
    checks.push(
      check(
        "pulse-handoff-review-export-smoke",
        pulseSmoke.ok,
        pulseSmoke.ok
          ? "Pulse consumed the Studio handoff fixture and exported accepted moments."
          : "Pulse handoff/review/export smoke failed.",
        {
          handoff: relativeToSuite(handoffPath),
          stdoutTail: outputTail(pulseSmoke.stdout),
          stderrTail: outputTail(pulseSmoke.stderr),
        },
      ),
    );
  } else {
    checks.push({
      id: "pulse-handoff-review-export-smoke",
      status: "warn",
      summary: "Pulse handoff/review/export smoke skipped because Studio recording was skipped.",
      details: {
        handoff: null,
      },
    });
  }

  const failCount = checks.filter((item) => item.status === "fail").length;
  const warnCount = checks.filter((item) => item.status === "warn").length;

  return redactReportValue({
    schemaVersion: 1,
    generatedAt,
    reportType: "capture-to-review smoke",
    ok: failCount === 0,
    summary: {
      status:
        failCount > 0
          ? "blocked"
          : warnCount > 0
            ? "ready-with-warnings"
            : "code-ready",
      passCount: checks.filter((item) => item.status === "pass").length,
      warnCount,
      failCount,
    },
    output: {
      json: relativeToSuite(outputPath),
      handoff: relativeToSuite(handoffPath),
    },
    studioMediaSmoke: summarizeCommand(studioSmoke),
    studioResult,
    handoff,
    pulseHandoffExportSmoke: pulseSmoke ? summarizeCommand(pulseSmoke) : null,
    checks,
  });
}

function buildHandoffFixture(studioResult, generatedAt) {
  const completion = studioResult.completion ?? {};
  const verification = studioResult.verification ?? completion.verification ?? {};
  return {
    schemaVersion: 1,
    requestId: `capture-to-review-${Date.now()}`,
    sourceApp: "vaexcore-studio",
    sourceAppName: "vaexcore studio",
    targetApp: "vaexcore-pulse",
    requestedAt: generatedAt,
    recording: {
      sessionId: studioResult.sessionId ?? "studio-media-smoke",
      outputPath: studioResult.recordingPath,
      profileId: "smoke-local-recording",
      profileName: "Smoke Local Recording",
      captureMode: "synthetic",
      captureDetail:
        "Studio media smoke recorded synthetic video with silent fallback audio.",
      completionState: completion.completion_state ?? null,
      completionDetail: completion.detail ?? null,
      verificationState: verification.state ?? null,
      verificationDetail: verification.detail ?? null,
      fileSizeBytes: studioResult.size ?? verification.file_size_bytes ?? null,
      durationMs: completion.duration_ms ?? verification.duration_ms ?? null,
      processStatus: completion.process_status ?? null,
      stoppedAt: studioResult.checkedAt ?? generatedAt,
    },
    outputReady: {
      ready: true,
      state: "ready",
      detail: "Studio recording smoke output is ready for Pulse intake.",
      activeSceneId: "smoke-scene",
      activeSceneName: "Media smoke",
      programPreviewFrameReady: true,
      compositorRenderPlanReady: true,
      outputPreflightReady: true,
      mediaPipelineReady: true,
      blockers: [],
      warnings: [],
    },
  };
}

function check(id, ok, summary, details) {
  return {
    id,
    status: ok ? "pass" : "fail",
    summary,
    details,
  };
}

function runCommand(command, argsForCommand, options = {}) {
  const started = Date.now();
  try {
    const stdout = execFileSync(command, argsForCommand, {
      cwd: options.cwd ?? suiteRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: true,
      stdout,
      stderr: "",
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? error),
      durationMs: Date.now() - started,
    };
  }
}

function missingProjectResult(name) {
  return {
    ok: false,
    stdout: "",
    stderr: `${name} project was not found in suite config.`,
    durationMs: 0,
  };
}

function summarizeCommand(result) {
  return {
    ok: result.ok,
    durationMs: result.durationMs,
    stdoutTail: outputTail(result.stdout),
    stderrTail: outputTail(result.stderr),
  };
}

function readOptionalJson(path) {
  if (!path || !existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function outputTail(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-20)
    .join("\n");
}

function relativeToSuite(path) {
  if (!path) return null;
  return path.startsWith(suiteRoot) ? path.slice(suiteRoot.length + 1) : path;
}

function renderMarkdown(report) {
  const lines = [
    "# vaexcore Capture-to-Review Smoke",
    "",
    `Generated: ${report.generatedAt}`,
    `Overall: ${report.summary.status}`,
    "",
    "| Check | Status | Summary |",
    "| --- | --- | --- |",
  ];
  for (const item of report.checks) {
    lines.push(`| ${item.id} | ${item.status} | ${escapeTable(item.summary)} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function escapeTable(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\s+/g, " ");
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

function printHelp() {
  console.log(`Usage: node scripts/smoke-capture-to-review.mjs [options]

Runs Studio media-recording smoke, converts the result into a Studio-to-Pulse
handoff fixture, and runs Pulse's handoff/review/export smoke against it.

Options:
  --output <path>  JSON report output path. Defaults to .local/capture-to-review-smoke.json.
  --json           Print JSON instead of Markdown.
  --help           Show this help text.
`);
}
