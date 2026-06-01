#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  appAbsolutePath,
  loadSuiteConfig,
  readJsonFile,
  suiteRoot,
} from "./lib/suite-config.mjs";
import { validateJsonSchema } from "./lib/json-schema-lite.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const json = Boolean(args.json);
const outputPath = args.output ? resolve(args.output) : null;
const report = buildReport();
const rendered = json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered);
}

process.stdout.write(rendered);
if (!report.ok) {
  process.exit(1);
}

function buildReport() {
  const generatedAt = new Date().toISOString();
  const config = loadSuiteConfig();
  const studio = config.apps.find((app) => app.id === "vaexcore-studio");
  const pulse = config.apps.find((app) => app.id === "vaexcore-pulse");
  const schemaPath = join(
    suiteRoot,
    "suite/schemas/pulse-recording-handoff.schema.json",
  );
  const schema = readJsonFile(schemaPath);
  const fixture = buildOutputReadyHandoffFixture();
  const schemaErrors = validateJsonSchema(schema, fixture, {
    path: "studio-pulse-output-ready-handoff",
  });

  const checks = [
    check(
      "suite-contract",
      schemaErrors.length === 0,
      schemaErrors.length === 0
        ? "Output-ready Studio recording handoff fixture matches the Suite schema."
        : schemaErrors.join(" "),
      { schemaPath: relativePath(schemaPath), requestId: fixture.requestId },
    ),
    check(
      "studio-capability",
      Boolean(studio?.capabilities?.includes("pulse.recording.handoff")),
      "Studio advertises the pulse.recording.handoff capability.",
      { app: studio?.id ?? null },
    ),
    check(
      "pulse-capability",
      Boolean(pulse?.capabilities?.includes("studio.recording.intake")),
      "Pulse advertises the studio.recording.intake capability.",
      { app: pulse?.id ?? null },
    ),
    sourceGroupCheck({
      id: "studio-writes-handoff",
      project: studio,
      files: [
        {
          relativeFile:
            "apps/desktop/src-tauri/src/desktop/suite_commands/commands_discovery/command_handlers.rs",
          patterns: ["handoff_recording_to_pulse", "write_pulse_recording_handoff"],
        },
        {
          relativeFile:
            "apps/desktop/src-tauri/src/desktop/suite_commands/commands_discovery/session_io.rs",
          patterns: ["completion_state", "verification_state"],
        },
        {
          relativeFile: "apps/desktop/src-tauri/src/suite_protocol.rs",
          patterns: ["PULSE_RECORDING_INTAKE_FILE"],
        },
      ],
      passSummary:
        "Studio desktop command writes the Suite pulse-recording-intake handoff.",
    }),
    sourceGroupCheck({
      id: "pulse-consumes-handoff",
      project: pulse,
      files: [
        {
          relativeFile: "apps/desktopapp/src-tauri/src/lib.rs",
          patterns: ["consume_pulse_recording_handoff"],
        },
        {
          relativeFile: "apps/desktopapp/src-tauri/src/suite_runtime/commands.rs",
          patterns: [
            "consume_pulse_recording_handoff_file",
            "captureMode",
            "outputReady",
          ],
        },
      ],
      passSummary:
        "Pulse desktop command consumes and validates Suite recording handoffs with capture metadata.",
    }),
    sourceGroupCheck({
      id: "pulse-review-export-marker",
      project: pulse,
      files: [
        {
          relativeFile: "apps/desktopapp/src/hooks/useStudioIntakeController.ts",
          patterns: ["captureDetail", "verificationState", "outputReadinessLabel"],
        },
        {
          relativeFile: "apps/desktopapp/src/hooks/useStudioExportController.ts",
          patterns: ["accepted-highlight-export"],
        },
      ],
      passSummary:
        "Pulse review workspace surfaces Studio output readiness and exports accepted markers.",
    }),
  ];

  return {
    schemaVersion: 1,
    generatedAt,
    ok: checks.every((item) => item.status !== "fail"),
    fixture: {
      requestId: fixture.requestId,
      handoffFile: config.contract.handoffs.pulseRecordingIntakeFile,
      outputReadyState: fixture.outputReady.state,
    },
    checks,
  };
}

function sourceGroupCheck({ id, project, files, passSummary }) {
  if (!project) {
    return check(id, false, "Project is missing from apps.json.", null);
  }

  const checkedFiles = [];
  const missingMessages = [];
  for (const file of files) {
    const filePath = join(appAbsolutePath(suiteRoot, project), file.relativeFile);
    if (!existsSync(filePath)) {
      missingMessages.push(`${file.relativeFile} is missing`);
      checkedFiles.push({ path: relativePath(filePath), patterns: file.patterns });
      continue;
    }

    const source = readFileSync(filePath, "utf8");
    const missingPatterns = file.patterns.filter((pattern) => !source.includes(pattern));
    if (missingPatterns.length > 0) {
      missingMessages.push(`${file.relativeFile} is missing ${missingPatterns.join(", ")}`);
    }
    checkedFiles.push({ path: relativePath(filePath), patterns: file.patterns });
  }

  return check(
    id,
    missingMessages.length === 0,
    missingMessages.length === 0 ? passSummary : `${missingMessages.join("; ")}.`,
    { files: checkedFiles },
  );
}

function check(id, ok, summary, details) {
  return {
    id,
    status: ok ? "pass" : "fail",
    summary,
    details,
  };
}

function buildOutputReadyHandoffFixture() {
  return {
    schemaVersion: 1,
    requestId: "studio-pulse-handoff-smoke-1",
    sourceApp: "vaexcore-studio",
    sourceAppName: "vaexcore studio",
    targetApp: "vaexcore-pulse",
    requestedAt: "2026-05-19T12:00:00Z",
    recording: {
      sessionId: "studio_pulse_handoff_smoke",
      outputPath: "/tmp/studio-pulse-handoff-smoke.mkv",
      profileId: "profile_1080p",
      profileName: "1080p",
      captureMode: "display",
      captureDetail: "Main Display recorded as a source-backed display.",
      completionState: "completed",
      completionDetail: "FFmpeg stopped after a quit signal. Output passed recording verification.",
      verificationState: "verified",
      verificationDetail:
        "Recording file exists, is non-empty, and ffprobe metadata was read.",
      fileSizeBytes: 360093,
      durationMs: 2125,
      processStatus: "exit status: 0",
      stoppedAt: "2026-05-19T12:05:00Z",
    },
    outputReady: {
      ready: true,
      state: "ready",
      detail: "Scene output handoff is ready for Pulse intake.",
      activeSceneId: "scene-main",
      activeSceneName: "Main scene",
      programPreviewFrameReady: true,
      compositorRenderPlanReady: true,
      outputPreflightReady: true,
      mediaPipelineReady: true,
      blockers: [],
      warnings: [],
    },
  };
}

function renderMarkdown(report) {
  const lines = [
    "# vaexcore Studio/Pulse Handoff Smoke",
    "",
    `Generated: ${report.generatedAt}`,
    `Overall: ${report.ok ? "pass" : "blocked"}`,
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
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function relativePath(path) {
  return path.startsWith(suiteRoot) ? path.slice(suiteRoot.length + 1) : path;
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
  console.log(`Usage: node scripts/smoke-studio-pulse-handoff.mjs [options]

Options:
  --json              Print JSON instead of Markdown.
  --output <path>     Write the rendered report to a file.
  --help              Show this help.
`);
}
