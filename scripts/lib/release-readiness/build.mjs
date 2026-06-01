import { join } from "node:path";
import { loadSuiteConfig, readJsonFile, suiteRoot } from "../suite-config.mjs";
import {
  addArtifactCheck,
  addAutomationBoundaryCheck,
  addCiCheck,
  addGitCheck,
  addGoLiveReadinessCheck,
  addPulseIntakeReadinessCheck,
  addSuiteStaticCheck,
  addVersionCheck,
  addWindowsHandoffPackCheck,
} from "./checks.mjs";

export async function buildReleaseReadinessReport(options) {
  const config = loadSuiteConfig();
  const release = readJsonFile(join(suiteRoot, "suite/release.json"));
  const report = {
    generatedAt: new Date().toISOString(),
    artifactDir: options.artifactDir,
    checks: [],
    manualBlockers: [],
    ok: true,
  };

  addGitCheck(report, config, options);
  addVersionCheck(report, config, release);
  addArtifactCheck(report, options);
  addAutomationBoundaryCheck(report);
  await addGoLiveReadinessCheck(report, options);
  addPulseIntakeReadinessCheck(report, config);
  addSuiteStaticCheck(report);
  addWindowsHandoffPackCheck(report);
  addCiCheck(report, options);

  report.ok = report.checks.every((item) => item.status !== "fail");
  return report;
}
