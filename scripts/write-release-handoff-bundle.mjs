#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readJsonFile, suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const artifactDir = resolve(
  args["artifact-dir"] ?? join(suiteRoot, "dist/release-dry-run"),
);
const outputDir = resolve(
  args["output-dir"] ?? join(suiteRoot, ".local/release-handoff"),
);
const skipRemote = Boolean(args["skip-remote"]);
const skipGit = Boolean(args["skip-git"]);
const requireArtifacts = Boolean(args["require-artifacts"]);

assertInsideSuite(outputDir, "release handoff output directory");
mkdirSync(outputDir, { recursive: true });

const report = buildBundleReport();
writeFileSync(
  join(outputDir, "handoff-summary.json"),
  `${JSON.stringify(redact(report), null, 2)}\n`,
);
writeFileSync(join(outputDir, "handoff-summary.md"), renderMarkdown(report));

if (!report.ok) {
  process.exit(1);
}

function buildBundleReport() {
  const generatedAt = new Date().toISOString();
  const manifestPath = join(artifactDir, "manifest.json");
  const artifactManifest = existsSync(manifestPath)
    ? readJsonFile(manifestPath)
    : null;
  const artifactFiles = listArtifactFiles(artifactDir);
  const artifactValidation = validateArtifacts(manifestPath);
  const releaseReadiness = writeReleaseReadinessReports();
  const ciSummary = writeCiSummary();
  const ok =
    (!requireArtifacts || Boolean(artifactManifest)) &&
    artifactValidation.status !== "fail" &&
    releaseReadiness.status !== "fail" &&
    ciSummary.status !== "fail";

  return {
    schemaVersion: 1,
    generatedAt,
    ok,
    artifactDir,
    outputDir,
    files: {
      releaseReadinessJson: relativeToSuite(
        join(outputDir, "release-readiness.json"),
      ),
      releaseReadinessMarkdown: relativeToSuite(
        join(outputDir, "release-readiness.md"),
      ),
      ciSummaryJson: relativeToSuite(join(outputDir, "ci-summary.json")),
      artifactManifestJson: relativeToSuite(
        join(outputDir, "artifact-manifest.json"),
      ),
    },
    artifacts: {
      status: artifactManifest
        ? artifactValidation.status
        : requireArtifacts
          ? "fail"
          : "warn",
      manifestPath: relativeToSuite(manifestPath),
      fileCount: artifactFiles.length,
      files: artifactFiles,
      validation: artifactValidation,
    },
    releaseReadiness,
    ciSummary,
  };
}

function validateArtifacts(manifestPath) {
  if (!existsSync(manifestPath)) {
    return {
      status: requireArtifacts ? "fail" : "warn",
      summary: `No release manifest found at ${manifestPath}.`,
      outputTail: "",
    };
  }
  const result = runNode([
    "scripts/check-release-artifacts.mjs",
    "--artifact-dir",
    artifactDir,
    "--manifest-only",
  ]);
  const manifest = readJsonFile(manifestPath);
  writeFileSync(
    join(outputDir, "artifact-manifest.json"),
    `${JSON.stringify(redact(manifest), null, 2)}\n`,
  );
  return {
    status: result.ok ? "pass" : "fail",
    summary: result.ok
      ? "Release artifact manifest validation passed."
      : "Release artifact manifest validation failed.",
    outputTail: outputTail(result.output),
  };
}

function writeReleaseReadinessReports() {
  const baseArgs = [
    "scripts/release-readiness-report.mjs",
    ...(skipGit ? ["--skip-git"] : []),
    ...(skipRemote ? ["--skip-remote"] : []),
    "--artifact-dir",
    artifactDir,
    ...(requireArtifacts ? ["--require-artifacts"] : []),
  ];
  const jsonPath = join(outputDir, "release-readiness.json");
  const markdownPath = join(outputDir, "release-readiness.md");
  const jsonResult = runNode([
    ...baseArgs,
    "--json",
    "--output",
    jsonPath,
  ]);
  const markdownResult = runNode([
    ...baseArgs,
    "--format",
    "markdown",
    "--output",
    markdownPath,
  ]);

  if (!jsonResult.ok || !markdownResult.ok || !existsSync(jsonPath)) {
    return {
      status: "fail",
      summary: "Release readiness report generation failed.",
      outputTail: outputTail(`${jsonResult.output}\n${markdownResult.output}`),
    };
  }

  const readiness = JSON.parse(readFileSync(jsonPath, "utf8"));
  return {
    status: readiness.ok ? readinessStatus(readiness.checks) : "fail",
    summary: readiness.ok
      ? "Release readiness report generated."
      : "Release readiness report has failing checked gates.",
    ok: readiness.ok,
    warningCount: readiness.checks.filter((item) => item.status === "warn")
      .length,
    failCount: readiness.checks.filter((item) => item.status === "fail")
      .length,
    manualBlockerCount: readiness.manualBlockers.length,
  };
}

function writeCiSummary() {
  const outputPath = join(outputDir, "ci-summary.json");
  if (skipRemote) {
    const skipped = {
      skipped: true,
      summary: "Skipped remote CI status because --skip-remote was passed.",
    };
    writeFileSync(outputPath, `${JSON.stringify(skipped, null, 2)}\n`);
    return {
      status: "warn",
      summary: skipped.summary,
      skipped: true,
    };
  }

  const result = runNode(["scripts/print-ci-summary.mjs", "--json"]);
  if (!result.ok) {
    return {
      status: "fail",
      summary: "CI summary generation failed.",
      outputTail: outputTail(result.output),
    };
  }
  writeFileSync(outputPath, redact(result.output));
  const parsed = JSON.parse(result.output);
  const green = parsed.repositories?.every((repo) => repo.green) ?? false;
  return {
    status: green ? "pass" : "fail",
    summary: green ? "Latest CI is green." : "Latest CI is not green.",
    skipped: false,
    repositoryCount: parsed.repositories?.length ?? 0,
  };
}

function listArtifactFiles(path) {
  if (!existsSync(path)) {
    return [];
  }
  return readdirSync(path)
    .map((file) => {
      const filePath = join(path, file);
      const stats = statSync(filePath);
      return {
        file,
        size: stats.isFile() ? stats.size : null,
        kind: stats.isDirectory() ? "directory" : "file",
      };
    })
    .sort((left, right) => left.file.localeCompare(right.file));
}

function readinessStatus(checks) {
  return checks.some((item) => item.status === "warn") ? "warn" : "pass";
}

function renderMarkdown(report) {
  const lines = [
    "# vaexcore Release Handoff Bundle",
    "",
    `Generated: ${report.generatedAt}`,
    `Overall: ${report.ok ? "ready for checked gates" : "blocked"}`,
    `Artifact dir: ${report.artifactDir}`,
    "",
    "| Area | Status | Summary |",
    "| --- | --- | --- |",
    `| artifacts | ${report.artifacts.status} | ${escapeTable(report.artifacts.validation.summary)} |`,
    `| release-readiness | ${report.releaseReadiness.status} | ${escapeTable(report.releaseReadiness.summary)} |`,
    `| ci-summary | ${report.ciSummary.status} | ${escapeTable(report.ciSummary.summary)} |`,
    "",
    "## Files",
    "",
  ];
  for (const [label, path] of Object.entries(report.files)) {
    lines.push(`- ${label}: ${path}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
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

function outputTail(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-12)
    .join("\n");
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function assertInsideSuite(path, label) {
  const relativePath = relative(suiteRoot, path);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`Refusing to use ${label} outside suite root: ${path}`);
  }
}

function relativeToSuite(path) {
  return resolve(path).startsWith(suiteRoot)
    ? resolve(path).slice(suiteRoot.length + 1)
    : path;
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
  console.log(`Usage: node scripts/write-release-handoff-bundle.mjs [options]

Options:
  --artifact-dir <path>  Release artifact directory.
  --output-dir <path>    Handoff output directory. Defaults to .local/release-handoff.
  --skip-remote          Do not fetch remote CI status.
  --skip-git             Do not check git cleanliness/pushed state.
  --require-artifacts    Fail when the release artifact manifest is missing.
  --help                 Show this help.
`);
}
