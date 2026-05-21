#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  appAbsolutePath,
  loadSuiteConfig,
  readJsonFile,
  suiteRoot,
} from "./lib/suite-config.mjs";
import { redactReportValue } from "./lib/redact-report.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const outputDir = resolve(
  args["output-dir"] ?? join(suiteRoot, ".local/rc-dashboard"),
);
const artifactDir = resolve(
  args["artifact-dir"] ??
    join(suiteRoot, ".local/unsigned-rc-dry-run/artifacts"),
);
const skipRemote = Boolean(args["skip-remote"]);
const skipGit = Boolean(args["skip-git"]);
const full = Boolean(args.full);
const requireArtifacts = Boolean(args["require-artifacts"]);
const skipSmokes = Boolean(args["skip-smokes"]);
const json = Boolean(args.json);

mkdirSync(outputDir, { recursive: true });

const dashboard = buildRcDashboard();
writeDashboard(dashboard);

process.stdout.write(
  json ? `${JSON.stringify(dashboard, null, 2)}\n` : renderMarkdown(dashboard),
);

if (!dashboard.ok) {
  process.exit(1);
}

function buildRcDashboard() {
  const config = loadSuiteConfig();
  const generatedAt = new Date().toISOString();
  const projects = projectGitRecords(config);
  const suiteStatus = suiteStatusCheck();
  const releaseReadiness = releaseReadinessRecord();
  const ciSummary = ciSummaryCheck();
  const studioMediaSmoke = smokeCommandCheck(
    "studio-media-recording",
    "Studio media recording smoke",
    appAbsolutePath(
      suiteRoot,
      config.apps.find((app) => app.id === "vaexcore-studio"),
    ),
    "npm",
    ["run", "smoke:media-recording"],
  );
  const pulseHandoffSmoke = smokeCommandCheck(
    "pulse-studio-handoff",
    "Pulse Studio handoff/export smoke",
    appAbsolutePath(
      suiteRoot,
      config.apps.find((app) => app.id === "vaexcore-pulse"),
    ),
    "pnpm",
    ["run", "smoke:studio-handoff"],
  );
  const artifactManifest = artifactManifestCheck();
  const manualBlockers = manualReleaseBlockers(releaseReadiness.report);
  const checks = [
    projectStatusCheck(projects),
    suiteStatus,
    ciSummary,
    skipSmokes ? skippedSmokeCheck("studio-media-recording") : studioMediaSmoke,
    skipSmokes ? skippedSmokeCheck("pulse-studio-handoff") : pulseHandoffSmoke,
    artifactManifest,
  ];
  const failCount = checks.filter((check) => check.status === "fail").length;
  const warnCount = checks.filter((check) => check.status === "warn").length;

  return redactReportValue({
    schemaVersion: 1,
    generatedAt,
    reportType: "unsigned release candidate dashboard",
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
      manualBlockerCount: manualBlockers.length,
    },
    output: {
      json: relativeToSuite(join(outputDir, "rc-dashboard.json")),
      markdown: relativeToSuite(join(outputDir, "rc-dashboard.md")),
    },
    inputs: {
      artifactDir: relativeToSuite(artifactDir),
      suiteStatusOutputDir: relativeToSuite(join(outputDir, "suite-status")),
    },
    projects,
    latestCiSummary: ciSummary.details,
    suiteChecks: suiteStatus.details,
    consoleRelayReadiness: consoleRelayReadinessSummary(suiteStatus.report),
    studioMediaSmoke,
    pulseHandoffExportSmoke: pulseHandoffSmoke,
    artifactManifest,
    manualReleaseBlockers: manualBlockers,
    checks,
  });
}

function projectGitRecords(config) {
  if (skipGit) {
    return [
      {
        id: "suite",
        kind: "suite",
        path: ".",
        expectedBranch: "main",
        status: "warn",
        summary: "Skipped git status because --skip-git was passed.",
      },
      ...config.apps.map((app) => skippedProjectRecord("app", app)),
      ...config.services.map((service) =>
        skippedProjectRecord("service", service),
      ),
    ];
  }

  const records = [
    projectGitRecord("suite", {
      id: "suite",
      path: ".",
      branch: "main",
      name: "vaexcore suite",
    }),
    ...config.apps.map((app) => projectGitRecord("app", app)),
    ...config.services.map((service) => projectGitRecord("service", service)),
  ];
  return records;
}

function projectGitRecord(kind, project) {
  const repoPath =
    project.id === "suite" ? suiteRoot : appAbsolutePath(suiteRoot, project);
  const expectedBranch = project.branch ?? "main";
  const branch = git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"], true);
  const head = git(repoPath, ["rev-parse", "HEAD"], true);
  const upstream = git(repoPath, ["rev-parse", "@{u}"], true);
  const statusShort = git(repoPath, ["status", "--short"], true);
  const clean = statusShort.trim().length === 0;
  const pushed = Boolean(head && upstream && head === upstream);
  const status = branch === expectedBranch && clean && pushed ? "pass" : "fail";
  return {
    id: project.id,
    name: project.name,
    kind,
    path: project.path,
    expectedBranch,
    branch,
    head,
    upstream: upstream || null,
    clean,
    pushed,
    status,
    summary:
      status === "pass"
        ? "Clean, on expected branch, and pushed."
        : "Project branch, cleanliness, or upstream state needs attention.",
  };
}

function skippedProjectRecord(kind, project) {
  return {
    id: project.id,
    name: project.name,
    kind,
    path: project.path,
    expectedBranch: project.branch ?? "main",
    status: "warn",
    summary: "Skipped git status because --skip-git was passed.",
  };
}

function projectStatusCheck(projects) {
  const failed = projects.filter((project) => project.status === "fail");
  const warned = projects.filter((project) => project.status === "warn");
  return {
    id: "project-git-status",
    label: "App and service git status",
    status: failed.length > 0 ? "fail" : warned.length > 0 ? "warn" : "pass",
    summary:
      failed.length > 0
        ? `${failed.length} app/service repo(s) are stale, dirty, or not pushed.`
        : warned.length > 0
          ? "Project git status was skipped."
          : "All app/service repos are clean, pushed, and on their expected branches.",
    details: {
      failCount: failed.length,
      warnCount: warned.length,
    },
  };
}

function suiteStatusCheck() {
  const suiteStatusDir = join(outputDir, "suite-status");
  const result = runCommand("node", [
    "scripts/suite-status.mjs",
    "--output-dir",
    suiteStatusDir,
    "--json",
    ...(skipRemote ? ["--skip-remote"] : []),
    ...(skipGit ? ["--skip-git"] : []),
    ...(full ? ["--full"] : []),
  ]);
  const report =
    parseJsonOutput(result.stdout) ??
    readOptionalJson(join(suiteStatusDir, "suite-status.json"));
  return {
    id: "suite-status",
    label: "Suite code gates",
    status:
      result.ok && report?.ok
        ? report.summary.warnCount
          ? "warn"
          : "pass"
        : "fail",
    summary:
      result.ok && report?.ok
        ? `${report.summary.passCount}/${report.summary.checkCount} Suite gates passed with ${report.summary.warnCount} warning(s).`
        : "Suite status has failing code gates.",
    durationMs: result.durationMs,
    report,
    details: {
      output: relativeToSuite(join(suiteStatusDir, "suite-status.json")),
      mode: report?.mode ?? null,
      summary: report?.summary ?? null,
      stderrTail: outputTail(result.stderr),
    },
  };
}

function releaseReadinessRecord() {
  const reportPath = join(
    outputDir,
    "suite-status/release-readiness-report.json",
  );
  const report = readOptionalJson(reportPath);
  return {
    output: relativeToSuite(reportPath),
    report,
  };
}

function ciSummaryCheck() {
  if (skipRemote) {
    return {
      id: "latest-ci-summary",
      label: "Latest CI summary",
      status: "warn",
      summary: "Skipped remote CI summary because --skip-remote was passed.",
      details: { skipped: true },
    };
  }

  const result = runCommand("node", ["scripts/print-ci-summary.mjs", "--json"]);
  const parsed = parseJsonOutput(result.stdout);
  const green =
    result.ok && Array.isArray(parsed?.repositories)
      ? parsed.repositories.every((repo) => repo.green)
      : false;
  return {
    id: "latest-ci-summary",
    label: "Latest CI summary",
    status: green ? "pass" : "fail",
    summary: green
      ? "Latest CI summary is green."
      : "Latest CI summary is not green.",
    durationMs: result.durationMs,
    details: {
      repositories: parsed?.repositories ?? [],
      stderrTail: outputTail(result.stderr),
    },
  };
}

function smokeCommandCheck(id, label, cwd, command, argsForCommand) {
  if (!cwd) {
    return {
      id,
      label,
      status: "fail",
      summary: `${label} cannot run because the app path is missing.`,
      details: null,
    };
  }
  const result = runCommand(command, argsForCommand, { cwd });
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

function skippedSmokeCheck(id) {
  return {
    id,
    label: id,
    status: "warn",
    summary: "Skipped smoke check because --skip-smokes was passed.",
    details: null,
  };
}

function artifactManifestCheck() {
  const manifestPath = join(artifactDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      id: "artifact-manifest",
      label: "Unsigned artifact manifest",
      status: requireArtifacts ? "fail" : "warn",
      summary: `No unsigned RC artifact manifest found at ${relativeToSuite(manifestPath)}.`,
      details: {
        manifestPath: relativeToSuite(manifestPath),
        artifactDir: relativeToSuite(artifactDir),
        fileCount: 0,
      },
    };
  }

  const result = runCommand("node", [
    "scripts/check-release-artifacts.mjs",
    "--artifact-dir",
    artifactDir,
    "--manifest-only",
  ]);
  const manifest = readJsonFile(manifestPath);
  return {
    id: "artifact-manifest",
    label: "Unsigned artifact manifest",
    status: result.ok ? "pass" : "fail",
    summary: result.ok
      ? "Unsigned RC artifact manifest validates."
      : "Unsigned RC artifact manifest failed validation.",
    durationMs: result.durationMs,
    details: {
      manifestPath: relativeToSuite(manifestPath),
      artifactCount: manifest.artifacts?.length ?? 0,
      artifacts: (manifest.artifacts ?? []).map((artifact) => ({
        file: artifact.file,
        sha256: artifact.sha256,
        size: artifact.size,
      })),
      stderrTail: outputTail(result.stderr),
      stdoutTail: outputTail(result.stdout),
    },
  };
}

function manualReleaseBlockers(releaseReadiness) {
  const blockers = [
    ...(releaseReadiness?.manualBlockers ?? []),
    {
      id: "unsigned-macos-code-signing",
      app: "Release",
      nextValidation:
        "Developer ID signing is not included in this code-only unsigned RC dry run.",
    },
    {
      id: "unsigned-macos-notarization",
      app: "Release",
      nextValidation:
        "Apple notarization is not included in this code-only unsigned RC dry run.",
    },
    {
      id: "unsigned-windows-signing",
      app: "Release",
      nextValidation:
        "Windows signing is not included in this code-only unsigned RC dry run.",
    },
  ];
  const byId = new Map();
  for (const blocker of blockers) {
    byId.set(blocker.id, blocker);
  }
  return [...byId.values()];
}

function consoleRelayReadinessSummary(suiteStatusReport) {
  const botGroup = suiteStatusReport?.groups?.find(
    (group) => group.id === "bot-readiness",
  );
  const botCheck = botGroup?.checks?.find(
    (check) => check.id === "bot-readiness",
  );
  return {
    status: botGroup?.status ?? "unknown",
    summary: botCheck?.summary ?? "Console/Relay readiness was not available.",
    details: botCheck?.details?.summary ?? null,
  };
}

function writeDashboard(dashboard) {
  const jsonPath = join(outputDir, "rc-dashboard.json");
  const markdownPath = join(outputDir, "rc-dashboard.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(dashboard, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(dashboard));
}

function renderMarkdown(dashboard) {
  const lines = [
    "# vaexcore RC Dashboard",
    "",
    `Generated: ${dashboard.generatedAt}`,
    `Type: ${dashboard.reportType}`,
    `Overall: ${dashboard.summary.status}`,
    `Checked gates: ${dashboard.summary.passCount} pass, ${dashboard.summary.warnCount} warn, ${dashboard.summary.failCount} fail`,
    `Manual release blockers: ${dashboard.summary.manualBlockerCount}`,
    "",
    "| Gate | Status | Summary |",
    "| --- | --- | --- |",
  ];

  for (const check of dashboard.checks) {
    lines.push(
      `| ${check.id} | ${check.status} | ${escapeTable(check.summary)} |`,
    );
  }

  lines.push("", "## Projects", "");
  lines.push("| Project | Kind | Status | SHA |");
  lines.push("| --- | --- | --- | --- |");
  for (const project of dashboard.projects) {
    lines.push(
      `| ${project.id} | ${project.kind} | ${project.status} | ${String(project.head ?? "skipped").slice(0, 12)} |`,
    );
  }

  lines.push("", "## Manual Release Blockers", "");
  for (const blocker of dashboard.manualReleaseBlockers) {
    lines.push(`- ${blocker.id} (${blocker.app}): ${blocker.nextValidation}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
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

function readOptionalJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseJsonOutput(output) {
  const text = String(output ?? "").trim();
  if (!text) {
    return null;
  }
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function outputTail(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-14)
    .join("\n");
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function relativeToSuite(path) {
  const resolved = resolve(path);
  return resolved.startsWith(suiteRoot)
    ? relative(suiteRoot, resolved).replaceAll("\\", "/")
    : resolved;
}

function git(repoPath, argsForGit, allowFailure = false) {
  try {
    return execFileSync("git", ["-C", repoPath, ...argsForGit], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (error) {
    if (allowFailure) {
      return "";
    }
    throw error;
  }
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
  console.log(`Usage: node scripts/rc-dashboard.mjs [options]

Options:
  --skip-remote         Do not query remote CI.
  --skip-git            Do not require clean/pushed git state.
  --skip-smokes         Do not run Studio/Pulse app smoke checks.
  --full                Run suite-status in full mode.
  --require-artifacts   Fail if unsigned RC artifacts are missing.
  --artifact-dir <dir>  Unsigned RC artifact directory. Defaults to .local/unsigned-rc-dry-run/artifacts.
  --output-dir <dir>    Dashboard output directory. Defaults to .local/rc-dashboard.
  --json                Print JSON instead of Markdown.
  --help                Show this help.
`);
}
