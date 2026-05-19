#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  appAbsolutePath,
  loadSuiteConfig,
  readJsonFile,
  suiteRoot,
} from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const full = Boolean(args.full);
const skipRemote = Boolean(args["skip-remote"]);
const skipGit = Boolean(args["skip-git"]);
const json = Boolean(args.json);
const outputDir = resolve(args["output-dir"] ?? join(suiteRoot, ".local"));
mkdirSync(outputDir, { recursive: true });

const report = await buildSuiteStatus();
writeReport(report);
process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));

if (!report.ok) {
  process.exit(1);
}

async function buildSuiteStatus() {
  const config = loadSuiteConfig();
  const generatedAt = new Date().toISOString();
  const projects = [
    {
      id: "suite",
      name: "vaexcore suite",
      kind: "suite",
      path: ".",
      branch: "main",
    },
    ...config.apps.map((app) => projectRecord("app", app)),
    ...config.services.map((service) => projectRecord("service", service)),
  ];
  const groups = [];

  groups.push({
    id: "suite-static",
    title: "Suite Static Gates",
    checks: [
      commandCheck("suite-config", "Suite config", "node", [
        "scripts/validate-suite-config.mjs",
        "--require-local-repos",
      ]),
      commandCheck("suite-repos", "Suite app repos", "node", [
        "scripts/check-suite-repos.mjs",
      ]),
      commandCheck("suite-services", "Suite service repos", "node", [
        "scripts/check-suite-services.mjs",
      ]),
      commandCheck("suite-protocol", "Generated protocol", "node", [
        "scripts/generate-suite-protocol.mjs",
        "--check",
      ]),
      commandCheck("suite-contracts", "Suite contracts", "node", [
        "scripts/smoke-suite-contracts.mjs",
      ]),
      commandCheck("automation-boundary", "Automation boundary", "node", [
        "scripts/check-automation-boundary.mjs",
      ]),
      commandCheck("windows-handoff", "Windows handoff static check", "node", [
        "scripts/check-windows-suite-scripts.mjs",
      ]),
    ],
  });

  groups.push({
    id: "release-readiness",
    title: "Release Readiness",
    checks: [releaseReadinessCheck()],
  });

  groups.push({
    id: "bot-readiness",
    title: "Console And Relay Bot Readiness",
    checks: [botReadinessCheck()],
  });

  groups.push({
    id: "packaging-handoff",
    title: "Packaging And Handoff Bundle",
    checks: [releaseHandoffBundleCheck()],
  });

  groups.push({
    id: "studio-pulse-handoff",
    title: "Studio And Pulse Handoff",
    checks: [studioPulseHandoffCheck()],
  });

  if (full) {
    groups.push({
      id: "full-app-ci",
      title: "Full App CI Smoke",
      checks: [
        commandCheck("smoke-all", "Suite smoke-all", "bash", [
          "scripts/smoke-all.sh",
        ]),
      ],
    });
  }

  const checks = groups.flatMap((group) => group.checks);
  const failCount = checks.filter((check) => check.status === "fail").length;
  const warnCount = checks.filter((check) => check.status === "warn").length;

  return redact({
    schemaVersion: 1,
    generatedAt,
    mode: full ? "full" : "fast",
    ok: failCount === 0,
    summary: {
      status:
        failCount > 0
          ? "blocked"
          : warnCount > 0
            ? "ready-with-warnings"
            : "code-ready",
      failCount,
      warnCount,
      passCount: checks.filter((check) => check.status === "pass").length,
      checkCount: checks.length,
    },
    output: {
      json: relativeToSuite(join(outputDir, "suite-status.json")),
      markdown: relativeToSuite(join(outputDir, "suite-status.md")),
    },
    projects,
    groups: groups.map((group) => ({
      ...group,
      status: groupStatus(group.checks),
    })),
  });
}

function projectRecord(kind, project) {
  return {
    id: project.id,
    name: project.name,
    kind,
    path: project.path,
    branch: project.branch,
    packageManager: project.packageManager ?? null,
    checkCommand: project.checkCommand ?? null,
  };
}

function releaseReadinessCheck() {
  const outputPath = join(outputDir, "release-readiness-report.json");
  const result = runCommand("node", [
    "scripts/release-readiness-report.mjs",
    ...(skipGit ? ["--skip-git"] : []),
    ...(skipRemote ? ["--skip-remote"] : []),
    "--json",
    "--output",
    outputPath,
  ]);
  if (!result.ok) {
    return commandResultCheck(
      "release-readiness-report",
      "Release readiness report",
      result,
    );
  }
  const report = JSON.parse(readFileSync(outputPath, "utf8"));
  const failCount = report.checks.filter((item) => item.status === "fail").length;
  const warnCount = report.checks.filter((item) => item.status === "warn").length;
  return {
    id: "release-readiness-report",
    label: "Release readiness report",
    status: report.ok ? (warnCount ? "warn" : "pass") : "fail",
    summary: report.ok
      ? `${report.checks.length - failCount}/${report.checks.length} checked gates pass with ${warnCount} warning(s).`
      : `${failCount} checked release gate(s) failed.`,
    durationMs: result.durationMs,
    details: {
      output: relativeToSuite(outputPath),
      manualBlockerCount: report.manualBlockers.length,
      warningCount: warnCount,
      failCount,
    },
  };
}

function botReadinessCheck() {
  const result = runCommand("node", ["scripts/check-bot-readiness.mjs"]);
  if (!result.ok) {
    return commandResultCheck("bot-readiness", "Bot readiness", result);
  }
  const reportPath = join(suiteRoot, ".local/bot-readiness-report.json");
  const report = existsSync(reportPath) ? readJsonFile(reportPath) : null;
  return {
    id: "bot-readiness",
    label: "Bot readiness",
    status: "pass",
    summary: report
      ? `${report.summary.failedCommandCount} failed command(s), ${report.summary.failedCheckCount} failed static check(s), ${report.summary.todoCount} app-check TODO(s), ${report.summary.warnCount} warning(s).`
      : "Bot readiness command passed.",
    durationMs: result.durationMs,
    details: {
      output: relativeToSuite(reportPath),
      summary: report?.summary ?? null,
    },
  };
}

function releaseHandoffBundleCheck() {
  const handoffDir = join(outputDir, "release-handoff");
  const result = runCommand("node", [
    "scripts/write-release-handoff-bundle.mjs",
    ...(skipGit ? ["--skip-git"] : []),
    ...(skipRemote ? ["--skip-remote"] : []),
    "--output-dir",
    handoffDir,
  ]);
  if (!result.ok) {
    return commandResultCheck(
      "release-handoff-bundle",
      "Release handoff bundle",
      result,
    );
  }
  const summaryPath = join(handoffDir, "handoff-summary.json");
  const summary = existsSync(summaryPath) ? readJsonFile(summaryPath) : null;
  return {
    id: "release-handoff-bundle",
    label: "Release handoff bundle",
    status: summary?.ok ? "pass" : "warn",
    summary: summary?.ok
      ? "Release handoff bundle generated."
      : "Release handoff bundle generated with warnings.",
    durationMs: result.durationMs,
    details: {
      output: relativeToSuite(summaryPath),
      artifacts: summary?.artifacts ?? null,
      ciSummary: summary?.ciSummary ?? null,
    },
  };
}

function studioPulseHandoffCheck() {
  const outputPath = join(outputDir, "studio-pulse-handoff-smoke.json");
  const result = runCommand("node", [
    "scripts/smoke-studio-pulse-handoff.mjs",
    "--json",
    "--output",
    outputPath,
  ]);
  if (!result.ok) {
    return commandResultCheck(
      "studio-pulse-handoff",
      "Studio/Pulse handoff smoke",
      result,
    );
  }
  const report = JSON.parse(readFileSync(outputPath, "utf8"));
  return {
    id: "studio-pulse-handoff",
    label: "Studio/Pulse handoff smoke",
    status: report.ok ? "pass" : "fail",
    summary: report.ok
      ? "Studio/Pulse handoff contract, source writer, intake, and export marker checks passed."
      : "Studio/Pulse handoff smoke failed.",
    durationMs: result.durationMs,
    details: {
      output: relativeToSuite(outputPath),
      checkCount: report.checks.length,
    },
  };
}

function commandCheck(id, label, command, argsForCommand) {
  return commandResultCheck(id, label, runCommand(command, argsForCommand));
}

function commandResultCheck(id, label, result) {
  return {
    id,
    label,
    status: result.ok ? "pass" : "fail",
    summary: result.ok ? `${label} passed.` : `${label} failed.`,
    durationMs: result.durationMs,
    details: {
      stdoutTail: outputTail(result.stdout),
      stderrTail: outputTail(result.stderr),
    },
  };
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

function writeReport(report) {
  const jsonPath = join(outputDir, "suite-status.json");
  const markdownPath = join(outputDir, "suite-status.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(report));
}

function renderMarkdown(report) {
  const lines = [
    "# vaexcore Suite Status",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `Overall: ${report.summary.status}`,
    `Checked gates: ${report.summary.passCount} pass, ${report.summary.warnCount} warn, ${report.summary.failCount} fail`,
    "",
    "| Group | Status | Checks |",
    "| --- | --- | --- |",
  ];
  for (const group of report.groups) {
    lines.push(
      `| ${group.title} | ${group.status} | ${group.checks.length} |`,
    );
  }
  lines.push("", "## Checks", "");
  for (const group of report.groups) {
    lines.push(`### ${group.title}`, "");
    lines.push("| Check | Status | Summary |");
    lines.push("| --- | --- | --- |");
    for (const check of group.checks) {
      lines.push(
        `| ${check.id} | ${check.status} | ${escapeTable(check.summary)} |`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function groupStatus(checks) {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

function outputTail(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-12)
    .join("\n");
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function relativeToSuite(path) {
  return resolve(path).startsWith(suiteRoot)
    ? resolve(path).slice(suiteRoot.length + 1)
    : path;
}

function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
      .replace(/(token|secret|authorization)=([^&\s]+)/gi, "$1=[redacted]");
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|authorization|stream_key/i.test(key)
          ? "[redacted]"
          : redact(item),
      ]),
    );
  }
  return value;
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
  console.log(`Usage: node scripts/suite-status.mjs [options]

Options:
  --skip-remote        Do not query remote CI.
  --skip-git           Do not check git cleanliness/pushed state.
  --full               Run the heavier smoke-all app CI pass.
  --json               Print JSON instead of Markdown.
  --output-dir <path>  Output directory. Defaults to .local.
  --help               Show this help.
`);
}
