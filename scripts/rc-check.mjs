#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { redactReportValue } from "./lib/redact-report.mjs";
import { readJsonFile, suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const outputDir = resolve(args["output-dir"] ?? join(suiteRoot, ".local/rc-check"));
const skipRemote = Boolean(args["skip-remote"]);
const skipGit = Boolean(args["skip-git"]);
const full = Boolean(args.full);
const json = Boolean(args.json);

mkdirSync(outputDir, { recursive: true });

const summary = buildRcCheck();
writeSummary(summary);

process.stdout.write(json ? `${JSON.stringify(summary, null, 2)}\n` : renderMarkdown(summary));

if (!summary.ok) {
  process.exit(1);
}

function buildRcCheck() {
  const generatedAt = new Date().toISOString();
  const unsignedDir = join(outputDir, "unsigned-rc-dry-run");
  const artifactDir = join(unsignedDir, "artifacts");
  const handoffDir = join(unsignedDir, "release-handoff");
  const dashboardDir = join(outputDir, "rc-dashboard");
  const suiteStatusDir = join(outputDir, "suite-status");
  const releaseReadinessPath = join(outputDir, "release-readiness-report.json");

  const unsignedDryRun = runJsonGate({
    id: "unsigned-rc-dry-run",
    label: "Unsigned RC dry run",
    command: "node",
    args: [
      "scripts/unsigned-rc-dry-run.mjs",
      "--output-dir",
      unsignedDir,
      "--artifact-dir",
      artifactDir,
      "--handoff-dir",
      handoffDir,
      ...(skipRemote ? ["--skip-remote"] : []),
      ...(skipGit ? ["--skip-git"] : []),
      "--json",
    ],
    outputPath: join(unsignedDir, "summary.json"),
    statusFromReport: (report) => (report?.ok ? "pass" : "fail"),
    summaryFromReport: (report) =>
      report?.ok
        ? "Unsigned release candidate artifacts and handoff bundle generated."
        : "Unsigned release candidate dry run is blocked.",
  });

  const rcDashboard = runJsonGate({
    id: "rc-dashboard",
    label: "RC dashboard",
    command: "node",
    args: [
      "scripts/rc-dashboard.mjs",
      "--output-dir",
      dashboardDir,
      "--artifact-dir",
      artifactDir,
      "--require-artifacts",
      ...(skipRemote ? ["--skip-remote"] : []),
      ...(skipGit ? ["--skip-git"] : []),
      ...(full ? ["--full"] : []),
      "--json",
    ],
    outputPath: join(dashboardDir, "rc-dashboard.json"),
    statusFromReport: reportStatus,
    summaryFromReport: (report) =>
      report?.ok
        ? `RC dashboard generated with ${report.summary?.warnCount ?? 0} warning(s).`
        : "RC dashboard has failing code gates or stale app/service state.",
  });

  const suiteStatus = runJsonGate({
    id: "suite-status",
    label: "Suite status",
    command: "node",
    args: [
      "scripts/suite-status.mjs",
      "--output-dir",
      suiteStatusDir,
      ...(skipRemote ? ["--skip-remote"] : []),
      ...(skipGit ? ["--skip-git"] : []),
      ...(full ? ["--full"] : []),
      "--json",
    ],
    outputPath: join(suiteStatusDir, "suite-status.json"),
    statusFromReport: reportStatus,
    summaryFromReport: (report) =>
      report?.ok
        ? `${report.summary?.passCount ?? 0}/${report.summary?.checkCount ?? 0} Suite status gate(s) passed.`
        : "Suite status has failing code gates.",
  });

  const releaseReadiness = runJsonGate({
    id: "release-readiness",
    label: "Release readiness",
    command: "node",
    args: [
      "scripts/release-readiness-report.mjs",
      ...(skipRemote ? ["--skip-remote"] : []),
      ...(skipGit ? ["--skip-git"] : []),
      "--json",
      "--output",
      releaseReadinessPath,
    ],
    outputPath: releaseReadinessPath,
    statusFromReport: releaseReadinessStatus,
    summaryFromReport: (report) => {
      const warnCount = (report?.checks ?? []).filter((item) => item.status === "warn").length;
      const failCount = (report?.checks ?? []).filter((item) => item.status === "fail").length;
      return report?.ok
        ? `Release readiness generated with ${warnCount} warning(s).`
        : `${failCount} release readiness gate(s) failed.`;
    },
  });

  const ciSummary = ciSummaryGate();
  const gates = [unsignedDryRun, rcDashboard, suiteStatus, releaseReadiness, ciSummary];
  const failCount = gates.filter((gate) => gate.status === "fail").length;
  const warnCount = gates.filter((gate) => gate.status === "warn").length;
  const rcReport = rcDashboard.report;

  return redactReportValue({
    schemaVersion: 1,
    generatedAt,
    reportType: "capture-to-review release candidate check",
    ok: failCount === 0,
    summary: {
      status:
        failCount > 0
          ? "blocked"
          : warnCount > 0
            ? "ready-with-warnings"
            : "code-ready",
      passCount: gates.filter((gate) => gate.status === "pass").length,
      warnCount,
      failCount,
      manualBlockerCount: manualBlockers([
        unsignedDryRun.report,
        rcDashboard.report,
        releaseReadiness.report,
      ]).length,
    },
    output: {
      json: relativeToSuite(join(outputDir, "summary.json")),
      markdown: relativeToSuite(join(outputDir, "summary.md")),
    },
    inputs: {
      skipRemote,
      skipGit,
      full,
      outputDir: relativeToSuite(outputDir),
      artifactDir: relativeToSuite(artifactDir),
      handoffDir: relativeToSuite(handoffDir),
    },
    gates,
    appServiceState: {
      projects: rcReport?.projects ?? [],
      failedProjects: (rcReport?.projects ?? []).filter(
        (project) => project.status === "fail",
      ),
    },
    readinessLines: {
      studioMediaSmoke: summarizeNestedCheck(rcReport?.studioMediaSmoke),
      pulseHandoffExportSmoke: summarizeNestedCheck(
        rcReport?.pulseHandoffExportSmoke,
      ),
      captureToReviewSmoke: summarizeNestedCheck(rcReport?.captureToReviewSmoke),
      consoleRelayReadiness: rcReport?.consoleRelayReadiness ?? null,
      artifactManifest: summarizeNestedCheck(rcReport?.artifactManifest),
    },
    manualReleaseBlockers: manualBlockers([
      unsignedDryRun.report,
      rcDashboard.report,
      releaseReadiness.report,
    ]),
  });
}

function runJsonGate(options) {
  const result = runCommand(options.command, options.args);
  const report = parseJsonOutput(result.stdout) ?? readOptionalJson(options.outputPath);
  const status = result.ok
    ? options.statusFromReport(report)
    : report?.ok
      ? "fail"
      : "fail";
  return {
    id: options.id,
    label: options.label,
    status,
    summary: result.ok
      ? options.summaryFromReport(report)
      : `${options.label} command failed.`,
    durationMs: result.durationMs,
    output: relativeToSuite(options.outputPath),
    command: {
      ok: result.ok,
      stdoutTail: outputTail(result.stdout),
      stderrTail: outputTail(result.stderr),
    },
    report,
  };
}

function ciSummaryGate() {
  if (skipRemote) {
    return {
      id: "latest-ci-summary",
      label: "Latest CI summary",
      status: "warn",
      summary: "Skipped remote CI summary because --skip-remote was passed.",
      durationMs: 0,
      output: null,
      command: { ok: true, stdoutTail: "", stderrTail: "" },
      report: { repositories: [], skipped: true },
    };
  }

  const result = runCommand("node", ["scripts/print-ci-summary.mjs", "--json"]);
  const report = parseJsonOutput(result.stdout);
  const repositories = Array.isArray(report?.repositories)
    ? report.repositories
    : [];
  const green = result.ok && repositories.length > 0 && repositories.every((repo) => repo.green);
  return {
    id: "latest-ci-summary",
    label: "Latest CI summary",
    status: green ? "pass" : "fail",
    summary: green
      ? "Latest GitHub CI summary is green."
      : "Latest GitHub CI summary is not green.",
    durationMs: result.durationMs,
    output: null,
    command: {
      ok: result.ok,
      stdoutTail: outputTail(result.stdout),
      stderrTail: outputTail(result.stderr),
    },
    report,
  };
}

function reportStatus(report) {
  if (!report?.ok) return "fail";
  return report.summary?.warnCount > 0 ? "warn" : "pass";
}

function releaseReadinessStatus(report) {
  if (!report?.ok) return "fail";
  return (report.checks ?? []).some((item) => item.status === "warn")
    ? "warn"
    : "pass";
}

function summarizeNestedCheck(check) {
  if (!check) {
    return {
      status: "unknown",
      summary: "Check was not reported.",
    };
  }
  return {
    id: check.id ?? null,
    label: check.label ?? null,
    status: check.status ?? "unknown",
    summary: check.summary ?? "",
    durationMs: check.durationMs ?? null,
  };
}

function manualBlockers(reports) {
  const byId = new Map();
  for (const report of reports) {
    for (const blocker of report?.manualReleaseBlockers ?? report?.manualBlockers ?? []) {
      if (blocker?.id) {
        byId.set(blocker.id, blocker);
      }
    }
  }
  return [...byId.values()];
}

function runCommand(command, argsForCommand) {
  const started = Date.now();
  try {
    const stdout = execFileSync(command, argsForCommand, {
      cwd: suiteRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: true,
      durationMs: Date.now() - started,
      stdout,
      stderr: "",
    };
  } catch (error) {
    return {
      ok: false,
      durationMs: Date.now() - started,
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? error),
    };
  }
}

function writeSummary(summary) {
  const jsonPath = join(outputDir, "summary.json");
  const markdownPath = join(outputDir, "summary.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(summary));
}

function renderMarkdown(summary) {
  const lines = [
    "# vaexcore RC Check",
    "",
    `Generated: ${summary.generatedAt}`,
    `Type: ${summary.reportType}`,
    `Overall: ${summary.summary.status}`,
    `Gates: ${summary.summary.passCount} pass, ${summary.summary.warnCount} warn, ${summary.summary.failCount} fail`,
    `Manual release blockers: ${summary.summary.manualBlockerCount}`,
    "",
    "| Gate | Status | Summary |",
    "| --- | --- | --- |",
  ];

  for (const gate of summary.gates) {
    lines.push(`| ${gate.id} | ${gate.status} | ${escapeTable(gate.summary)} |`);
  }

  lines.push("", "## Cross-App Readiness", "");
  lines.push("| Area | Status | Summary |");
  lines.push("| --- | --- | --- |");
  for (const [key, line] of Object.entries(summary.readinessLines)) {
    const status = line?.status ?? "unknown";
    const detail = line?.summary ?? "Not reported.";
    lines.push(`| ${key} | ${status} | ${escapeTable(detail)} |`);
  }

  lines.push("", "## App And Service State", "");
  lines.push("| Project | Kind | Status | SHA |");
  lines.push("| --- | --- | --- | --- |");
  for (const project of summary.appServiceState.projects) {
    lines.push(
      `| ${project.id} | ${project.kind} | ${project.status} | ${String(project.head ?? "skipped").slice(0, 12)} |`,
    );
  }

  lines.push("", "## Manual Release Blockers", "");
  for (const blocker of summary.manualReleaseBlockers) {
    lines.push(`- ${blocker.id} (${blocker.app}): ${blocker.nextValidation}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function parseJsonOutput(output) {
  const text = String(output ?? "").trim();
  if (!text) return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function readOptionalJson(path) {
  if (!path || !existsSync(path)) return null;
  return readJsonFile(path);
}

function outputTail(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-16)
    .join("\n");
}

function relativeToSuite(path) {
  const resolved = resolve(path);
  return resolved.startsWith(suiteRoot)
    ? relative(suiteRoot, resolved).replaceAll("\\", "/")
    : resolved;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
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
  console.log(`Usage: node scripts/rc-check.mjs [options]

Options:
  --skip-remote        Do not query remote CI.
  --skip-git           Do not require clean/pushed git state in child checks.
  --full               Run heavier app CI/smoke gates where supported.
  --output-dir <dir>   Output directory. Defaults to .local/rc-check.
  --json               Print JSON instead of Markdown.
  --help               Show this help.
`);
}
