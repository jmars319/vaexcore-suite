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
    sourceCheck({
      id: "studio-writes-handoff",
      project: studio,
      relativeFile: "apps/desktop/src-tauri/src/lib.rs",
      patterns: [
        "handoff_recording_to_pulse",
        "write_pulse_recording_handoff",
        "PULSE_RECORDING_INTAKE_FILE",
      ],
      passSummary:
        "Studio desktop command writes the Suite pulse-recording-intake handoff.",
    }),
    sourceCheck({
      id: "pulse-consumes-handoff",
      project: pulse,
      relativeFile: "apps/desktopapp/src-tauri/src/lib.rs",
      patterns: [
        "consume_pulse_recording_handoff",
        "consume_pulse_recording_handoff_file",
        "outputReady",
      ],
      passSummary:
        "Pulse desktop command consumes and validates Suite recording handoffs.",
    }),
    sourceCheck({
      id: "pulse-review-export-marker",
      project: pulse,
      relativeFile: "apps/desktopapp/src/App.tsx",
      patterns: [
        "applyPulseRecordingHandoff",
        "accepted-highlight-export",
        "outputReadinessLabel",
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

function sourceCheck({ id, project, relativeFile, patterns, passSummary }) {
  if (!project) {
    return check(id, false, "Project is missing from apps.json.", null);
  }
  const filePath = join(appAbsolutePath(suiteRoot, project), relativeFile);
  if (!existsSync(filePath)) {
    return check(id, false, `${relativeFile} is missing.`, {
      path: relativePath(filePath),
    });
  }
  const source = readFileSync(filePath, "utf8");
  const missing = patterns.filter((pattern) => !source.includes(pattern));
  return check(
    id,
    missing.length === 0,
    missing.length === 0
      ? passSummary
      : `${relativeFile} is missing ${missing.join(", ")}.`,
    { path: relativePath(filePath), patterns },
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
