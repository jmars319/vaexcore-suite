#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  appAbsolutePath,
  appVersion,
  gitDirty,
  loadSuiteConfig,
  readJsonFile,
  suiteRoot,
} from "./lib/suite-config.mjs";
import { validateJsonSchema } from "./lib/json-schema-lite.mjs";
import { buildGoLiveReadiness } from "./check-go-live-readiness.mjs";

const args = parseArgs(process.argv.slice(2));
const artifactDir = resolve(
  args["artifact-dir"] ?? join(suiteRoot, "dist/mac-suite"),
);
const skipGit = Boolean(args["skip-git"]);
const skipRemote = Boolean(args["skip-remote"]);
const requireArtifacts = Boolean(args["require-artifacts"]);
const inspectArtifacts = Boolean(args["inspect-artifacts"]);
const check = Boolean(args.check);
const json = Boolean(args.json) || args.format === "json";
const outputPath = args.output ? resolve(args.output) : null;
const config = loadSuiteConfig();
const release = readJsonFile(join(suiteRoot, "suite/release.json"));

const report = {
  generatedAt: new Date().toISOString(),
  artifactDir,
  checks: [],
  manualBlockers: [],
  ok: true,
};

addGitCheck();
addVersionCheck();
addArtifactCheck();
addAutomationBoundaryCheck();
await addGoLiveReadinessCheck();
addPulseIntakeReadinessCheck();
addSuiteStaticCheck();
addWindowsHandoffPackCheck();
addCiCheck();

report.ok = report.checks.every((item) => item.status !== "fail");

const redactedReport = redact(report);
const rendered = json
  ? `${JSON.stringify(redactedReport, null, 2)}\n`
  : renderMarkdown(redactedReport);
if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered);
}
process.stdout.write(rendered);

if (check && !report.ok) {
  process.exit(1);
}

function addGitCheck() {
  if (skipGit) {
    addCheck(
      "git-clean-and-pushed",
      "warn",
      "Skipped git cleanliness and pushed checks because --skip-git was passed.",
      null,
    );
    return;
  }
  const { records, errors } = gitRecords();
  addCheck(
    "git-clean-and-pushed",
    errors.length > 0 ? "fail" : "pass",
    errors.length > 0 ? errors.join(" ") : "All local repositories are clean and pushed.",
    records,
  );
}

function gitRecords() {
  const repos = [
    { key: "suite", path: suiteRoot, expectedBranch: "main" },
    ...config.apps.map((app) => ({
      key: app.id,
      path: appAbsolutePath(suiteRoot, app),
      expectedBranch: app.branch,
    })),
  ];
  const records = [];
  const errors = [];
  for (const repo of repos) {
    const branch = git(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"], true);
    const dirty = gitDirty(repo.path);
    const head = git(repo.path, ["rev-parse", "HEAD"], true);
    const upstreamHead = git(repo.path, ["rev-parse", "@{u}"], true);
    const record = {
      key: repo.key,
      branch,
      head,
      clean: dirty === false,
      pushed: Boolean(head && upstreamHead && head === upstreamHead),
    };
    records.push(record);
    if (branch !== repo.expectedBranch) {
      errors.push(
        `${repo.key} is on ${branch}; expected ${repo.expectedBranch}`,
      );
    }
    if (dirty) {
      errors.push(`${repo.key} has uncommitted changes`);
    }
    if (!record.pushed) {
      errors.push(`${repo.key} local HEAD is not pushed`);
    }
  }
  return { records, errors };
}

function addVersionCheck() {
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
    "version-alignment",
    errors.length > 0 ? "fail" : "pass",
    errors.length > 0 ? errors.join(" ") : "Release compatibility matches package and desktop versions.",
    records,
  );
}

function addArtifactCheck() {
  const manifestPath = join(artifactDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    addCheck(
      "artifact-manifest",
      requireArtifacts ? "fail" : "warn",
      `No release manifest found at ${manifestPath}.`,
      { manifestPath },
    );
    return;
  }

  const command = [
    "scripts/check-release-artifacts.mjs",
    "--artifact-dir",
    artifactDir,
    ...(inspectArtifacts ? [] : ["--manifest-only"]),
  ];
  const result = runNode(command);
  addCheck(
    "artifact-manifest",
    result.ok ? "pass" : "fail",
    result.ok ? "Release artifact manifest validation passed." : result.output,
    { manifestPath, inspectArtifacts },
  );
}

function addAutomationBoundaryCheck() {
  const result = runNode(["scripts/check-automation-boundary.mjs", "--json"]);
  if (!result.ok) {
    addCheck("automation-boundary", "fail", result.output, null);
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
    addManualBlocker(blocker);
  }
  addCheck(
    "automation-boundary",
    "warn",
    `${boundary.codePlaceholders} intentional code placeholders and ${boundary.manualValidations} manual validation blockers remain tracked.`,
    {
      codePlaceholders: boundary.codePlaceholders,
      manualValidations: boundary.manualValidations,
    },
  );
}

async function addGoLiveReadinessCheck() {
  const timeoutMs = Number(args["go-live-timeout-ms"] ?? 750);
  const goLive = await buildGoLiveReadiness({ timeoutMs });
  for (const blocker of goLive.manualBlockers) {
    addManualBlocker({
      id: blocker.id,
      app: blocker.owner,
      nextValidation: blocker.detail,
    });
  }
  const failed = goLive.checks.filter((item) => item.status === "fail");
  const warnings = goLive.checks.filter((item) => item.status === "warn");
  addCheck(
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

function addPulseIntakeReadinessCheck() {
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
    errors.push("Pulse suite contract must include studio.recording.intake capability.");
  }

  addCheck(
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

function addSuiteStaticCheck() {
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
    "suite-static-checks",
    failed.length > 0 ? "fail" : "pass",
    failed.length > 0
      ? `${failed.length} Suite static check(s) failed.`
      : "Suite config, services, generated protocol, and contract smoke checks passed.",
    results,
  );
}

function addWindowsHandoffPackCheck() {
  const planPath = join(suiteRoot, "suite/windows/windows-validation-plan.json");
  if (!existsSync(planPath)) {
    addCheck(
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
    addManualBlocker({
      id: slug.startsWith("windows-") ? slug : `windows-${slug}`,
      app: "Windows Handoff",
      nextValidation: blocker,
    });
  }
  addCheck(
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

function addCiCheck() {
  if (skipRemote) {
    addCheck("github-ci", "warn", "Skipped remote CI status because --skip-remote was passed.", null);
    return;
  }
  const result = runNode(["scripts/check-ci-status.mjs", "--json"]);
  if (!result.ok) {
    addCheck("github-ci", "fail", result.output, null);
    return;
  }
  const ci = JSON.parse(result.output);
  addCheck(
    "github-ci",
    ci.green ? "pass" : "fail",
    ci.green ? "Latest CI is green for all repos." : "Latest CI is not green.",
    ci,
  );
}

function addCheck(id, status, summary, details) {
  report.checks.push({ id, status, summary, details });
}

function addManualBlocker(blocker) {
  if (report.manualBlockers.some((item) => item.id === blocker.id)) {
    return;
  }
  report.manualBlockers.push(blocker);
}

function buildPulseRecordingHandoffFixture(includeOutputReady) {
  const fixture = {
    schemaVersion: 1,
    requestId: "studio-recording-rec-smoke-1",
    sourceApp: "vaexcore-studio",
    sourceAppName: "vaexcore studio",
    targetApp: "vaexcore-pulse",
    requestedAt: "2026-05-06T12:00:00Z",
    recording: {
      sessionId: "rec_smoke",
      outputPath: "/tmp/rec_smoke.mkv",
      profileId: "profile_1080p",
      profileName: "1080p",
      stoppedAt: "2026-05-06T12:05:00Z",
    },
  };
  if (includeOutputReady) {
    fixture.outputReady = {
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
    };
  }
  return fixture;
}

function readDesktopVersions(app) {
  const appRoot = appAbsolutePath(suiteRoot, app);
  const versions = {};
  const tauriCandidates = [
    join(appRoot, "apps/desktop/src-tauri/tauri.conf.json"),
    join(appRoot, "apps/desktopapp/src-tauri/tauri.conf.json"),
  ];
  for (const path of tauriCandidates) {
    if (existsSync(path)) {
      versions.tauri = JSON.parse(readFileSync(path, "utf8")).version ?? null;
    }
  }
  const cargoCandidates = [
    join(appRoot, "apps/desktop/src-tauri/Cargo.toml"),
    join(appRoot, "apps/desktopapp/src-tauri/Cargo.toml"),
  ];
  for (const path of cargoCandidates) {
    if (existsSync(path)) {
      versions.cargo =
        readFileSync(path, "utf8").match(/^version = "([^"]+)"/m)?.[1] ??
        null;
    }
  }
  return versions;
}

function renderMarkdown(readiness) {
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

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function outputTail(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-12)
    .join("\n");
}

function relativePath(path) {
  return path.startsWith(suiteRoot) ? path.slice(suiteRoot.length + 1) : path;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function runNode(argsForNode) {
  try {
    return {
      ok: true,
      output: execFileSync("node", argsForNode, {
        cwd: suiteRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (error) {
    return { ok: false, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
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
