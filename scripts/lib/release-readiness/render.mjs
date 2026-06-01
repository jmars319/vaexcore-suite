import { escapeTable } from "./common.mjs";

export function renderMarkdown(readiness) {
  const lines = [
    "# vaexcore Release Readiness",
    "",
    `Generated: ${readiness.generatedAt}`,
    `Artifact dir: ${readiness.artifactDir}`,
    `Overall: ${readiness.ok ? "ready for the checked gates" : "blocked"}`,
    "",
    "| Check | Status | Summary |",
    "| --- | --- | --- |",
  ];
  for (const item of readiness.checks) {
    lines.push(
      `| ${item.id} | ${item.status} | ${escapeTable(item.summary)} |`,
    );
  }
  if (readiness.manualBlockers.length > 0) {
    lines.push("", "## Manual Validation Blockers", "");
    for (const blocker of readiness.manualBlockers) {
      lines.push(`- ${blocker.id} (${blocker.app}): ${blocker.nextValidation}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}
