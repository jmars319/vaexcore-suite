import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  appVersion,
  readJsonFile,
  suiteRoot,
} from "../suite-config.mjs";
import { validateJsonSchema } from "../json-schema-lite.mjs";
import { buildGoLiveReadiness } from "../../check-go-live-readiness.mjs";
import {
  outputTail,
  relativePath,
  runNode,
  slugify,
} from "./common.mjs";
import { readDesktopVersions } from "./desktop-versions.mjs";
import { buildPulseRecordingHandoffFixture } from "./fixtures.mjs";
import { gitRecords } from "./git-checks.mjs";

export function addGitCheck(report, config, options) {
  if (options.skipGit) {
    addCheck(
      report,
      "git-clean-and-pushed",
      "warn",
      "Skipped git cleanliness and pushed checks because --skip-git was passed.",
      null,
    );
    return;
  }
  const { records, errors } = gitRecords(config);
  addCheck(
    report,
    "git-clean-and-pushed",
    errors.length > 0 ? "fail" : "pass",
    errors.length > 0
      ? errors.join(" ")
      : "All local repositories are clean and pushed.",
    records,
  );
}

export function addVersionCheck(report, config, release) {
  const records = [];
  const errors = [];
  for (const app of config.apps) {
    const packageVersion = appVersion(suiteRoot, app);
    const compatibleVersion = release.compatibleApps?.[app.id];
    const desktopVersions = readDesktopVersions(app);
    records.push({
      app: app.id,
      packageVersion,
      compatibleVersion,
      desktopVersions,
    });
    if (packageVersion !== compatibleVersion) {
      errors.push(
        `${app.id} package version ${packageVersion} does not match release ${compatibleVersion}`,
      );
    }
    for (const [label, version] of Object.entries(desktopVersions)) {
      if (version && version !== compatibleVersion) {
        errors.push(
          `${app.id} ${label} version ${version} does not match release ${compatibleVersion}`,
        );
      }
    }
  }
  addCheck(
    report,
    "version-alignment",
    errors.length > 0 ? "fail" : "pass",
    errors.length > 0
      ? errors.join(" ")
      : "Release compatibility matches package and desktop versions.",
    records,
  );
}

export function addArtifactCheck(report, options) {
  const manifestPath = join(options.artifactDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    addCheck(
      report,
      "artifact-manifest",
      options.requireArtifacts ? "fail" : "warn",
      `No release manifest found at ${manifestPath}.`,
      { manifestPath },
    );
    return;
  }

  const command = [
    "scripts/check-release-artifacts.mjs",
    "--artifact-dir",
    options.artifactDir,
    ...(options.inspectArtifacts ? [] : ["--manifest-only"]),
  ];
  const result = runNode(command);
  addCheck(
    report,
    "artifact-manifest",
    result.ok ? "pass" : "fail",
    result.ok ? "Release artifact manifest validation passed." : result.output,
    { manifestPath, inspectArtifacts: options.inspectArtifacts },
  );
}

export function addAutomationBoundaryCheck(report) {
  const result = runNode(["scripts/check-automation-boundary.mjs", "--json"]);
  if (!result.ok) {
    addCheck(report, "automation-boundary", "fail", result.output, null);
    return;
  }
  const boundary = JSON.parse(result.output);
  for (const blocker of boundary.items
    .filter((item) => item.category === "manual-validation")
    .map((item) => ({
      id: item.id,
      app: item.app,
      nextValidation: item.nextValidation,
    }))) {
    addManualBlocker(report, blocker);
  }
  addCheck(
    report,
    "automation-boundary",
    "warn",
    boundary.codePlaceholders > 0
      ? `${boundary.codePlaceholders} intentional code placeholders and ${boundary.manualValidations} manual validation blockers remain tracked.`
      : `${boundary.manualValidations} manual validation blockers remain tracked.`,
    {
      codePlaceholders: boundary.codePlaceholders,
      manualValidations: boundary.manualValidations,
    },
  );
}

export async function addGoLiveReadinessCheck(report, options) {
  const timeoutMs = Number(options.args["go-live-timeout-ms"] ?? 750);
  const goLive = await buildGoLiveReadiness({ timeoutMs });
  for (const blocker of goLive.manualBlockers) {
    addManualBlocker(report, {
      id: blocker.id,
      app: blocker.owner,
      nextValidation: blocker.detail,
    });
  }
  const failed = goLive.checks.filter((item) => item.status === "fail");
  const warnings = goLive.checks.filter((item) => item.status === "warn");
  addCheck(
    report,
    "go-live-dry-run",
    failed.length > 0
      ? "fail"
      : warnings.length > 0 || goLive.manualBlockers.length > 0
        ? "warn"
        : "pass",
    failed.length > 0
      ? `${failed.length} go-live check(s) failed.`
      : `${goLive.summary.passed}/${goLive.checks.length} go-live checks passed with ${warnings.length} warning(s) and ${goLive.manualBlockers.length} manual blocker(s).`,
    goLive,
  );
}

export function addPulseIntakeReadinessCheck(report, config) {
  const pulse = config.apps.find((app) => app.id === "vaexcore-pulse");
  const schemaPath = join(
    suiteRoot,
    "suite/schemas/pulse-recording-handoff.schema.json",
  );
  const schema = readJsonFile(schemaPath);
  const legacyFixture = buildPulseRecordingHandoffFixture(false);
  const outputReadyFixture = buildPulseRecordingHandoffFixture(true);
  const errors = [
    ...validateJsonSchema(schema, legacyFixture, {
      path: "legacy-pulse-handoff",
    }),
    ...validateJsonSchema(schema, outputReadyFixture, {
      path: "output-ready-pulse-handoff",
    }),
  ];

  if (!pulse?.capabilities?.includes("studio.recording.intake")) {
    errors.push(
      "Pulse suite contract must include studio.recording.intake capability.",
    );
  }

  addCheck(
    report,
    "pulse-intake-readiness",
    errors.length > 0 ? "fail" : "pass",
    errors.length > 0
      ? errors.join(" ")
      : "Pulse handoff schema accepts legacy and output-ready Studio recording payloads.",
    {
      handoffFile: config.contract.handoffs.pulseRecordingIntakeFile,
      suiteCommand: "open-review",
      schemaPath: relativePath(schemaPath),
      outputReadyFields: Object.keys(outputReadyFixture.outputReady),
    },
  );
}

export function addSuiteStaticCheck(report) {
  const commands = [
    {
      id: "suite-config",
      args: ["scripts/validate-suite-config.mjs", "--require-local-repos"],
    },
    { id: "suite-services", args: ["scripts/check-suite-services.mjs"] },
    {
      id: "suite-protocol",
      args: ["scripts/generate-suite-protocol.mjs", "--check"],
    },
    {
      id: "suite-contract-smoke",
      args: ["scripts/smoke-suite-contracts.mjs"],
    },
  ];
  const results = commands.map((command) => {
    const result = runNode(command.args);
    return {
      id: command.id,
      status: result.ok ? "pass" : "fail",
      outputTail: outputTail(result.output),
    };
  });
  const failed = results.filter((result) => result.status === "fail");
  addCheck(
    report,
    "suite-static-checks",
    failed.length > 0 ? "fail" : "pass",
    failed.length > 0
      ? `${failed.length} Suite static check(s) failed.`
      : "Suite config, services, generated protocol, and contract smoke checks passed.",
    results,
  );
}

export function addWindowsHandoffPackCheck(report) {
  const planPath = join(suiteRoot, "suite/windows/windows-validation-plan.json");
  if (!existsSync(planPath)) {
    addCheck(
      report,
      "windows-handoff-pack",
      "fail",
      `Windows validation plan is missing at ${planPath}.`,
      { planPath },
    );
    return;
  }

  const plan = readJsonFile(planPath);
  const result = runNode(["scripts/check-windows-suite-scripts.mjs"]);
  for (const blocker of plan.manualBlockers ?? []) {
    const slug = slugify(blocker);
    addManualBlocker(report, {
      id: slug.startsWith("windows-") ? slug : `windows-${slug}`,
      app: "Windows Handoff",
      nextValidation: blocker,
    });
  }
  addCheck(
    report,
    "windows-handoff-pack",
    result.ok ? "warn" : "fail",
    result.ok
      ? "Windows handoff pack is machine-readable; Windows hardware validation remains separate and pending."
      : result.output,
    {
      planPath: relativePath(planPath),
      planStatus: plan.status,
      artifactDir: plan.artifactDir,
      validationStages: (plan.validationStages ?? []).map((stage) => ({
        id: stage.id,
        owner: stage.owner,
        status: stage.status,
      })),
      scriptCheck: result.ok ? "pass" : "fail",
    },
  );
}

export function addCiCheck(report, options) {
  if (options.skipRemote) {
    addCheck(
      report,
      "github-ci",
      "warn",
      "Skipped remote CI status because --skip-remote was passed.",
      null,
    );
    return;
  }
  const result = runNode(["scripts/check-ci-status.mjs", "--json"]);
  if (!result.ok) {
    addCheck(report, "github-ci", "fail", result.output, null);
    return;
  }
  const ci = JSON.parse(result.output);
  addCheck(
    report,
    "github-ci",
    ci.green ? "pass" : "fail",
    ci.green ? "Latest CI is green for all repos." : "Latest CI is not green.",
    ci,
  );
}

function addCheck(report, id, status, summary, details) {
  report.checks.push({ id, status, summary, details });
}

function addManualBlocker(report, blocker) {
  if (report.manualBlockers.some((item) => item.id === blocker.id)) {
    return;
  }
  report.manualBlockers.push(blocker);
}
