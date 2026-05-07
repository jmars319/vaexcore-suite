#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { appAbsolutePath, appVersion, gitDirty, gitSha, loadSuiteConfig, readJsonFile, suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const artifactDir = resolve(args["artifact-dir"] ?? join(suiteRoot, "dist/mac-suite"));
const skipGit = Boolean(args["skip-git"]);
const skipRemote = Boolean(args["skip-remote"]);
const requireArtifacts = Boolean(args["require-artifacts"]);
const inspectArtifacts = Boolean(args["inspect-artifacts"]);
const check = Boolean(args.check);
const json = Boolean(args.json);
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
addCiCheck();

report.ok = report.checks.every((item) => item.status !== "fail");

const rendered = json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);
if (outputPath) {
  writeFileSync(outputPath, rendered);
}
process.stdout.write(rendered);

if (check && !report.ok) {
  process.exit(1);
}

function addGitCheck() {
  if (skipGit) {
    addCheck("git-clean-and-pushed", "warn", "Skipped git cleanliness and pushed checks because --skip-git was passed.", null);
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
      errors.push(`${repo.key} is on ${branch}; expected ${repo.expectedBranch}`);
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
      errors.push(`${app.id} package version ${packageVersion} does not match release ${compatibleVersion}`);
    }
    for (const [label, version] of Object.entries(desktopVersions)) {
      if (version && version !== compatibleVersion) {
        errors.push(`${app.id} ${label} version ${version} does not match release ${compatibleVersion}`);
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
  report.manualBlockers = boundary.items
    .filter((item) => item.category === "manual-validation")
    .map((item) => ({
      id: item.id,
      app: item.app,
      nextValidation: item.nextValidation,
    }));
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
  addCheck("github-ci", ci.green ? "pass" : "fail", ci.green ? "Latest CI is green for all repos." : "Latest CI is not green.", ci);
}

function addCheck(id, status, summary, details) {
  report.checks.push({ id, status, summary, details });
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
      versions.cargo = readFileSync(path, "utf8").match(/^version = "([^"]+)"/m)?.[1] ?? null;
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
    lines.push(`| ${item.id} | ${item.status} | ${escapeTable(item.summary)} |`);
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
