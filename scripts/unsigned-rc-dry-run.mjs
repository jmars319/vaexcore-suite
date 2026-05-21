#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { readJsonFile, suiteRoot } from "./lib/suite-config.mjs";
import { redactReportValue } from "./lib/redact-report.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const outputDir = resolve(
  args["output-dir"] ?? join(suiteRoot, ".local/unsigned-rc-dry-run"),
);
const artifactDir = resolve(
  args["artifact-dir"] ?? join(outputDir, "artifacts"),
);
const handoffDir = resolve(
  args["handoff-dir"] ?? join(outputDir, "release-handoff"),
);
const skipRemote = Boolean(args["skip-remote"]);
const skipGit = Boolean(args["skip-git"]);
const json = Boolean(args.json);

mkdirSync(outputDir, { recursive: true });

const dryRun = runReleaseDryRun();
const summary = buildSummary(dryRun);
writeSummary(summary);

process.stdout.write(
  json ? `${JSON.stringify(summary, null, 2)}\n` : renderMarkdown(summary),
);

if (!summary.ok) {
  process.exit(1);
}

function runReleaseDryRun() {
  const started = Date.now();
  try {
    const stdout = execFileSync(
      "bash",
      [
        "scripts/release-dry-run.sh",
        "--artifact-dir",
        artifactDir,
        "--handoff-dir",
        handoffDir,
        ...(skipRemote ? ["--skip-remote"] : []),
        ...(skipGit ? ["--skip-git"] : []),
      ],
      {
        cwd: suiteRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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

function buildSummary(dryRun) {
  const manifestPath = join(artifactDir, "manifest.json");
  const handoffSummaryPath = join(handoffDir, "handoff-summary.json");
  const manifest = existsSync(manifestPath) ? readJsonFile(manifestPath) : null;
  const handoffSummary = existsSync(handoffSummaryPath)
    ? readJsonFile(handoffSummaryPath)
    : null;
  const manifestOk = Boolean(manifest?.artifacts?.length);
  const handoffOk = handoffSummary?.ok === true;

  return redactReportValue({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseType: "unsigned release candidate",
    ok: dryRun.ok && manifestOk && handoffOk,
    unsigned: true,
    status:
      dryRun.ok && manifestOk && handoffOk
        ? "unsigned-rc-generated"
        : "blocked",
    output: {
      json: relativeToSuite(join(outputDir, "summary.json")),
      markdown: relativeToSuite(join(outputDir, "summary.md")),
    },
    paths: {
      outputDir: relativeToSuite(outputDir),
      artifactDir: relativeToSuite(artifactDir),
      handoffDir: relativeToSuite(handoffDir),
      manifest: relativeToSuite(manifestPath),
      handoffSummary: relativeToSuite(handoffSummaryPath),
    },
    command: {
      ok: dryRun.ok,
      durationMs: dryRun.durationMs,
      stdoutTail: outputTail(dryRun.stdout),
      stderrTail: outputTail(dryRun.stderr),
    },
    packageInputs: {
      suite: manifest?.suite ?? null,
      release: manifest?.release ?? null,
      apps: manifest?.apps ?? [],
    },
    artifacts: {
      status: manifestOk ? "pass" : "fail",
      count: manifest?.artifacts?.length ?? 0,
      files: (manifest?.artifacts ?? []).map((artifact) => ({
        file: artifact.file,
        size: artifact.size,
        sha256: artifact.sha256,
      })),
    },
    sidecars: {
      handoffSummary: handoffSummary
        ? {
            ok: handoffSummary.ok,
            files: handoffSummary.files,
            artifacts: handoffSummary.artifacts,
            releaseReadiness: handoffSummary.releaseReadiness,
            ciSummary: handoffSummary.ciSummary,
          }
        : null,
    },
    manualReleaseBlockers: [
      {
        id: "unsigned-macos-code-signing",
        app: "Release",
        nextValidation:
          "Developer ID signing is not part of this unsigned release candidate dry run.",
      },
      {
        id: "unsigned-macos-notarization",
        app: "Release",
        nextValidation:
          "Apple notarization is not part of this unsigned release candidate dry run.",
      },
      {
        id: "unsigned-windows-signing",
        app: "Release",
        nextValidation:
          "Windows signing is not part of this unsigned release candidate dry run.",
      },
    ],
  });
}

function writeSummary(summary) {
  const jsonPath = join(outputDir, "summary.json");
  const markdownPath = join(outputDir, "summary.md");
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(markdownPath, renderMarkdown(summary));
}

function renderMarkdown(summary) {
  const lines = [
    "# vaexcore Unsigned RC Dry Run",
    "",
    `Generated: ${summary.generatedAt}`,
    `Release type: ${summary.releaseType}`,
    `Overall: ${summary.status}`,
    `Artifacts: ${summary.artifacts.count}`,
    "",
    "| Area | Status | Detail |",
    "| --- | --- | --- |",
    `| release dry run | ${summary.command.ok ? "pass" : "fail"} | ${summary.command.durationMs}ms |`,
    `| artifact manifest | ${summary.artifacts.status} | ${summary.paths.manifest} |`,
    `| handoff bundle | ${summary.sidecars.handoffSummary?.ok ? "pass" : "fail"} | ${summary.paths.handoffSummary} |`,
    "",
    "## Manual Release Blockers",
    "",
  ];

  for (const blocker of summary.manualReleaseBlockers) {
    lines.push(`- ${blocker.id} (${blocker.app}): ${blocker.nextValidation}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function outputTail(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-16)
    .join("\n");
}

function relativeToSuite(path) {
  const resolved = resolve(path);
  return resolved.startsWith(suiteRoot)
    ? relative(suiteRoot, resolved).replaceAll("\\", "/")
    : resolved;
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
  console.log(`Usage: node scripts/unsigned-rc-dry-run.mjs [options]

Options:
  --skip-remote        Do not query remote CI.
  --skip-git           Do not require clean/pushed git state inside release readiness.
  --artifact-dir <dir> Artifact output directory. Defaults to .local/unsigned-rc-dry-run/artifacts.
  --handoff-dir <dir>  Handoff bundle directory. Defaults to .local/unsigned-rc-dry-run/release-handoff.
  --output-dir <dir>   Summary output directory. Defaults to .local/unsigned-rc-dry-run.
  --json               Print JSON instead of Markdown.
  --help               Show this help.
`);
}
