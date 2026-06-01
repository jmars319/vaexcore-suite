#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { suiteRoot } from "./lib/suite-config.mjs";

const strict = process.argv.includes("--strict");
const configPath = join(suiteRoot, "scripts/maintainability.config.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const sourceExtensions = new Set(config.sourceExtensions ?? []);
const styleExtensions = new Set([".css", ".scss", ".sass", ".less"]);
const excludedPathPrefixes = (config.excludedPathPrefixes ?? []).map((item) =>
  normalizePath(item),
);
const generatedPathPatterns = (config.generatedPathPatterns ?? []).map((item) =>
  normalizePath(item),
);
const blockedImportPatterns = (config.blockedImportPatterns ?? []).map((item) =>
  normalizePath(item),
);

const trackedFiles = gitTrackedFiles();
const sourceFiles = trackedFiles.filter((file) => {
  if (!sourceExtensions.has(extname(file))) {
    return false;
  }
  if (excludedPathPrefixes.some((prefix) => file.startsWith(prefix))) {
    return false;
  }
  return (config.sourceRoots ?? []).some((root) => file.startsWith(`${root}/`));
});

const violations = [];
const warnings = [];
const records = sourceFiles.map((file) => ({
  file,
  ext: extname(file),
  lines: lineCount(join(suiteRoot, file)),
}));

checkLineBudgets(records);
checkGeneratedArtifacts(trackedFiles);
checkBlockedImports(records);
checkAssetBudgets();
checkVerificationWiring();
checkWorkflowHygiene();
checkIgnoredOutputPolicy();

const largest = [...records].sort((a, b) => b.lines - a.lines).slice(0, 10);
console.log(`${config.label}: scanned ${records.length} suite-owned source files`);
console.log("Largest suite-owned files:");
for (const record of largest) {
  console.log(`  ${record.lines.toString().padStart(4, " ")}  ${record.file}`);
}

if (warnings.length > 0) {
  console.warn("\nWarnings:");
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}
if (violations.length > 0) {
  console.error("\nMaintainability violations:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}
if (strict && warnings.length > 0) {
  console.error("\nStrict maintainability mode treats warnings as failures.");
  process.exit(1);
}

console.log("Suite-root maintainability audit passed.");

function checkLineBudgets(recordsToCheck) {
  for (const record of recordsToCheck) {
    const budget = lineBudgetFor(record);
    if (record.lines > budget) {
      violations.push(`${record.file} has ${record.lines} lines; budget is ${budget}.`);
    } else if (budget - record.lines <= Number(config.nearLineBudgetWarningLines ?? 0)) {
      warnings.push(`${record.file} is near its line budget: ${record.lines}/${budget}.`);
    }
  }
}

function lineBudgetFor(record) {
  const specific = Number(config.specificFileLineBudgets?.[record.file] ?? 0);
  if (specific > 0) {
    return specific;
  }
  if (styleExtensions.has(record.ext)) {
    return Number(config.maxStyleFileLines ?? 400);
  }
  if (/^scripts\/(rc-dashboard|release-readiness-report)\.mjs$/.test(record.file)) {
    return Number(config.maxCliEntrypointLines ?? 160);
  }
  if (record.file === "scripts/lib/suite-config.mjs") {
    return Number(config.maxCompatibilityBarrelLines ?? 80);
  }
  if (record.file === "suite/windows/Build-VaexcoreSuite.ps1") {
    return Number(config.maxPowerShellEntrypointLines ?? 120);
  }
  if (record.file.startsWith("suite/windows/build-modules/")) {
    return Number(config.maxPowerShellModuleLines ?? 400);
  }
  return Number(config.maxImplementationFileLines ?? 525);
}

function checkGeneratedArtifacts(files) {
  const generated = files.filter((file) =>
    generatedPathPatterns.some((pattern) => pathMatchesPattern(file, pattern)),
  );
  if (generated.length > 0) {
    violations.push(
      `generated/runtime artifacts are tracked: ${generated.slice(0, 12).join(", ")}`,
    );
  }
}

function checkBlockedImports(recordsToCheck) {
  for (const record of recordsToCheck.filter((item) => [".mjs", ".js", ".cjs"].includes(item.ext))) {
    const contents = readFileSync(join(suiteRoot, record.file), "utf8");
    for (const specifier of importSpecifiers(contents)) {
      const hit = blockedImportPatterns.find((pattern) =>
        normalizePath(specifier).includes(pattern),
      );
      if (hit) {
        violations.push(`${record.file} imports generated/dependency output: ${specifier}`);
      }
    }
  }
}

function checkAssetBudgets() {
  for (const budget of config.assetBudgets ?? []) {
    const file = normalizePath(budget.file);
    const absolute = join(suiteRoot, file);
    if (!existsSync(absolute)) {
      violations.push(`asset budget references missing file: ${file}`);
      continue;
    }
    const bytes = statSync(absolute).size;
    const maxBytes = Number(budget.maxKb) * 1024;
    if (bytes > maxBytes) {
      violations.push(`${file} is ${(bytes / 1024).toFixed(1)} KiB; budget is ${Number(budget.maxKb).toFixed(1)} KiB.`);
    } else if (maxBytes - bytes <= Number(config.nearAssetBudgetWarningKb ?? 0) * 1024) {
      warnings.push(`${file} is near its asset budget: ${(bytes / 1024).toFixed(1)}/${Number(budget.maxKb).toFixed(1)} KiB.`);
    }
  }
}

function checkVerificationWiring() {
  const justfile = readFileSync(join(suiteRoot, "justfile"), "utf8");
  const checkScript = readFileSync(join(suiteRoot, "scripts/check-maintainability.sh"), "utf8");
  if (!/check-maintainability\.sh/.test(justfile)) {
    violations.push("just verify must run scripts/check-maintainability.sh.");
  }
  if (!/audit-maintainability\.mjs/.test(checkScript)) {
    violations.push("scripts/check-maintainability.sh must run the suite-root maintainability audit.");
  }
}

function checkWorkflowHygiene() {
  for (const workflow of config.requiredWorkflowTimeouts ?? []) {
    const source = readFileSync(join(suiteRoot, workflow), "utf8");
    if (!/timeout-minutes:\s*\d+/.test(source)) {
      violations.push(`${workflow} is missing an explicit job timeout.`);
    }
  }
  const secretScan = readFileSync(
    join(suiteRoot, ".github/workflows/secret-scan.yml"),
    "utf8",
  );
  if (!/actions\/checkout@v6/.test(secretScan)) {
    violations.push("Secret Scan must use actions/checkout@v6.");
  }
}

function checkIgnoredOutputPolicy() {
  const gitignore = readFileSync(join(suiteRoot, ".gitignore"), "utf8");
  for (const required of config.requiredIgnoredPaths ?? []) {
    if (!gitignore.includes(required)) {
      violations.push(`.gitignore must keep ${required} ignored.`);
    }
  }
}

function gitTrackedFiles() {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: suiteRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .map(normalizePath);
}

function lineCount(file) {
  return readFileSync(file, "utf8").split(/\r?\n/).length;
}

function importSpecifiers(contents) {
  return [
    ...contents.matchAll(
      /\bfrom\s+["']([^"']+)["']|import\(["']([^"']+)["']\)|import\s+["']([^"']+)["']/g,
    ),
  ]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? "").replaceAll("\\", "/"))
    .filter(Boolean);
}

function pathMatchesPattern(file, pattern) {
  if (pattern.startsWith("*.")) {
    return file.endsWith(pattern.slice(1));
  }
  return file === pattern || file.includes(pattern);
}

function normalizePath(value) {
  return String(value).replaceAll("\\", "/");
}
