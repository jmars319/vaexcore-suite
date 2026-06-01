import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  appAbsolutePath,
  readJsonFile,
  suiteRoot,
} from "../suite-config.mjs";
import {
  outputTail,
  parseJsonOutput,
  readOptionalJson,
  relativeToSuite,
  runCommand,
} from "./common.mjs";

export function suiteStatusCheck(options) {
  const suiteStatusDir = join(options.outputDir, "suite-status");
  const result = runCommand("node", [
    "scripts/suite-status.mjs",
    "--output-dir",
    suiteStatusDir,
    "--json",
    ...(options.skipRemote ? ["--skip-remote"] : []),
    ...(options.skipGit ? ["--skip-git"] : []),
    ...(options.full ? ["--full"] : []),
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

export function releaseReadinessRecord(options) {
  const reportPath = join(
    options.outputDir,
    "suite-status/release-readiness-report.json",
  );
  const report = readOptionalJson(reportPath);
  return {
    output: relativeToSuite(reportPath),
    report,
  };
}

export function ciSummaryCheck(options) {
  if (options.skipRemote) {
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

export function appSmokeChecks(config, options) {
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
  const captureToReviewSmoke = smokeJsonCommandCheck(
    "capture-to-review-smoke",
    "Capture-to-review smoke",
    "node",
    [
      "scripts/smoke-capture-to-review.mjs",
      "--output",
      join(options.outputDir, "capture-to-review-smoke.json"),
      "--json",
    ],
    join(options.outputDir, "capture-to-review-smoke.json"),
  );
  return { studioMediaSmoke, pulseHandoffSmoke, captureToReviewSmoke };
}

export function skippedSmokeCheck(id) {
  return {
    id,
    label: id,
    status: "warn",
    summary: "Skipped smoke check because --skip-smokes was passed.",
    details: null,
  };
}

export function artifactManifestCheck(options) {
  const manifestPath = join(options.artifactDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      id: "artifact-manifest",
      label: "Unsigned artifact manifest",
      status: options.requireArtifacts ? "fail" : "warn",
      summary: `No unsigned RC artifact manifest found at ${relativeToSuite(manifestPath)}.`,
      details: {
        manifestPath: relativeToSuite(manifestPath),
        artifactDir: relativeToSuite(options.artifactDir),
        fileCount: 0,
      },
    };
  }

  const result = runCommand("node", [
    "scripts/check-release-artifacts.mjs",
    "--artifact-dir",
    options.artifactDir,
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

export function manualReleaseBlockers(releaseReadiness) {
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

export function consoleRelayReadinessSummary(suiteStatusReport) {
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

function smokeJsonCommandCheck(id, label, command, argsForCommand, outputPath) {
  const result = runCommand(command, argsForCommand);
  const report = parseJsonOutput(result.stdout) ?? readOptionalJson(outputPath);
  const status =
    !result.ok || !report?.ok
      ? "fail"
      : report.summary?.warnCount > 0
        ? "warn"
        : "pass";
  return {
    id,
    label,
    status,
    summary:
      status === "pass"
        ? `${label} passed.`
        : status === "warn"
          ? `${label} passed with warning(s).`
          : `${label} failed.`,
    durationMs: result.durationMs,
    details: {
      output: relativeToSuite(outputPath),
      summary: report?.summary ?? null,
      artifactTrail: report?.artifactTrail
        ? {
            status: report.artifactTrail.status,
            summary: report.artifactTrail.summary,
            outputs: report.artifactTrail.outputs,
          }
        : null,
      stdoutTail: outputTail(result.stdout),
      stderrTail: outputTail(result.stderr),
    },
    report,
  };
}
