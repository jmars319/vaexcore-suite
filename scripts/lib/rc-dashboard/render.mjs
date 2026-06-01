import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { escapeTable } from "./common.mjs";

export function writeDashboard(dashboard, outputDir) {
  const jsonPath = join(outputDir, "rc-dashboard.json");
  const markdownPath = join(outputDir, "rc-dashboard.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(dashboard, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(dashboard));
}

export function renderMarkdown(dashboard) {
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

  if (dashboard.captureToReviewArtifactTrail) {
    const trail = dashboard.captureToReviewArtifactTrail;
    lines.push("", "## Capture-To-Review Artifact Trail", "");
    lines.push(`Status: ${trail.status}`);
    lines.push(`Summary: ${trail.summary}`);
    lines.push(
      `Studio result: ${trail.studioRecording?.resultPath ?? "not available"}`,
    );
    lines.push(
      `Handoff fixture: ${trail.handoffFixture?.path ?? "not available"}`,
    );
    lines.push(
      `Pulse export summary: ${trail.outputs?.pulseExportSummary ?? "not available"}`,
    );
  }

  lines.push("", "## Manual Release Blockers", "");
  for (const blocker of dashboard.manualReleaseBlockers) {
    lines.push(`- ${blocker.id} (${blocker.app}): ${blocker.nextValidation}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}
