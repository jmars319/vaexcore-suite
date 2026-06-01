import { join } from "node:path";
import { redactReportValue } from "../redact-report.mjs";
import { loadSuiteConfig } from "../suite-config.mjs";
import { relativeToSuite } from "./common.mjs";
import {
  appSmokeChecks,
  artifactManifestCheck,
  ciSummaryCheck,
  consoleRelayReadinessSummary,
  manualReleaseBlockers,
  releaseReadinessRecord,
  skippedSmokeCheck,
  suiteStatusCheck,
} from "./checks.mjs";
import { projectGitRecords, projectStatusCheck } from "./project-git.mjs";

export function buildRcDashboard(options) {
  const config = loadSuiteConfig();
  const generatedAt = new Date().toISOString();
  const projects = projectGitRecords(config, options);
  const suiteStatus = suiteStatusCheck(options);
  const releaseReadiness = releaseReadinessRecord(options);
  const ciSummary = ciSummaryCheck(options);
  const { studioMediaSmoke, pulseHandoffSmoke, captureToReviewSmoke } =
    appSmokeChecks(config, options);
  const artifactManifest = artifactManifestCheck(options);
  const manualBlockers = manualReleaseBlockers(releaseReadiness.report);
  const checks = [
    projectStatusCheck(projects),
    suiteStatus,
    ciSummary,
    options.skipSmokes
      ? skippedSmokeCheck("studio-media-recording")
      : studioMediaSmoke,
    options.skipSmokes
      ? skippedSmokeCheck("pulse-studio-handoff")
      : pulseHandoffSmoke,
    options.skipSmokes
      ? skippedSmokeCheck("capture-to-review-smoke")
      : captureToReviewSmoke,
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
      json: relativeToSuite(join(options.outputDir, "rc-dashboard.json")),
      markdown: relativeToSuite(join(options.outputDir, "rc-dashboard.md")),
    },
    inputs: {
      artifactDir: relativeToSuite(options.artifactDir),
      suiteStatusOutputDir: relativeToSuite(
        join(options.outputDir, "suite-status"),
      ),
    },
    projects,
    latestCiSummary: ciSummary.details,
    suiteChecks: suiteStatus.details,
    consoleRelayReadiness: consoleRelayReadinessSummary(suiteStatus.report),
    studioMediaSmoke,
    pulseHandoffExportSmoke: pulseHandoffSmoke,
    captureToReviewSmoke,
    captureToReviewArtifactTrail:
      captureToReviewSmoke.report?.artifactTrail ?? null,
    artifactManifest,
    manualReleaseBlockers: manualBlockers,
    checks,
  });
}
