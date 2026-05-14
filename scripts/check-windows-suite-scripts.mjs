#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import {
  findExpandableHereStringFenceIssues,
  findLiteralColonVariableIssues,
} from "./lib/powershell-static-checks.mjs";
import { suiteRoot } from "./lib/suite-config.mjs";
import { findCmdLauncherIssues } from "./lib/windows-launcher-static-checks.mjs";

const requirePwsh = process.argv.includes("--require-pwsh");
const unknownArgs = process.argv
  .slice(2)
  .filter((arg) => !["--require-pwsh"].includes(arg));
if (unknownArgs.length > 0) {
  console.error(`Unknown option: ${unknownArgs.join(", ")}`);
  process.exit(2);
}

const scripts = listFiles(join(suiteRoot, "suite/windows"), ".ps1");
const launchers = listFiles(join(suiteRoot, "suite/windows"), ".cmd");
const validationPlanPath = join(
  suiteRoot,
  "suite/windows/windows-validation-plan.json",
);
const staticIssues = [
  ...validateWindowsValidationPlan(validationPlanPath),
  ...scripts.flatMap((script) => {
    const source = readFileSync(script, "utf8");
    return [
      ...findLiteralColonVariableIssues(source, script).map((issue) => ({
        ...issue,
        message: `PowerShell variables followed by literal ':' must use braces: \${${issue.variableName}}:`,
      })),
      ...findExpandableHereStringFenceIssues(source, script).map((issue) => ({
        ...issue,
        message:
          "Markdown code fences use backticks; put them in single-quoted here-strings.",
      })),
    ];
  }),
  ...launchers.flatMap((launcher) =>
    findCmdLauncherIssues(readFileSync(launcher, "utf8"), launcher),
  ),
];

if (staticIssues.length > 0) {
  for (const issue of staticIssues) {
    console.error(
      `${issue.filePath}:${issue.line}:${issue.column}: ${issue.message}`,
    );
  }
  process.exit(1);
}

const pwsh = findExecutable("pwsh");
if (!pwsh) {
  const message = `PowerShell parser check skipped: pwsh is not installed; static guards passed for ${scripts.length} scripts and ${launchers.length} launchers.`;
  if (requirePwsh) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}

for (const script of scripts) {
  console.log(`Checking PowerShell syntax: ${script}`);
  const command = [
    "$tokens = $null",
    "$errors = $null",
    `[System.Management.Automation.Language.Parser]::ParseFile('${escapePowerShellString(script)}', [ref] $tokens, [ref] $errors) | Out-Null`,
    "if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }",
  ].join("; ");
  execFileSync(pwsh, ["-NoProfile", "-NonInteractive", "-Command", command], {
    stdio: "inherit",
  });
}

console.log(
  `PowerShell static check passed: ${scripts.length} scripts and ${launchers.length} launchers`,
);

function listFiles(dir, extension) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFiles(path, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      results.push(path);
    }
  }
  return results.sort();
}

function validateWindowsValidationPlan(path) {
  if (!existsSync(path)) {
    return [planIssue(path, "Windows validation plan JSON is missing.")];
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return [
      planIssue(
        path,
        `Windows validation plan JSON is invalid: ${error instanceof Error ? error.message : error}`,
      ),
    ];
  }

  const issues = [];
  if (plan.schemaVersion !== 1) {
    issues.push(
      planIssue(path, "Windows validation plan schemaVersion must be 1."),
    );
  }
  if (plan.status !== "mac-code-ready-windows-hardware-pending") {
    issues.push(
      planIssue(
        path,
        "Windows validation plan status must separate Mac code readiness from Windows hardware validation.",
      ),
    );
  }
  if (!plan.validationPolicy?.windowsHardwareValidationRequired) {
    issues.push(
      planIssue(path, "Windows hardware validation must be marked required."),
    );
  }
  if (!Array.isArray(plan.manualBlockers) || plan.manualBlockers.length === 0) {
    issues.push(
      planIssue(path, "Windows validation plan must list manual blockers."),
    );
  }
  if (
    !Array.isArray(plan.validationStages) ||
    plan.validationStages.length === 0
  ) {
    issues.push(
      planIssue(path, "Windows validation plan must include validation stages."),
    );
  }
  for (const command of plan.prerequisiteCommands ?? []) {
    const scriptName = String(command.command ?? "").match(
      /\.\\suite\\windows\\([^ ]+\.ps1)/i,
    )?.[1];
    if (!scriptName) {
      issues.push(
        planIssue(
          path,
          `Validation command ${command.id ?? "(unknown)"} must reference a Windows PowerShell script.`,
        ),
      );
      continue;
    }
    const scriptPath = join(suiteRoot, "suite/windows", scriptName);
    if (!existsSync(scriptPath)) {
      issues.push(
        planIssue(
          path,
          `Validation command ${command.id ?? scriptName} references missing script ${scriptName}.`,
        ),
      );
    }
  }

  return issues;
}

function planIssue(filePath, message) {
  return {
    filePath,
    line: 1,
    column: 1,
    message,
  };
}

function findExecutable(name) {
  const extensions =
    process.platform === "win32" && extname(name) === ""
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")]
      : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    for (const extension of extensions) {
      const path = join(directory, `${name}${extension}`);
      if (existsSync(path)) {
        return path;
      }
    }
  }
  return null;
}

function escapePowerShellString(value) {
  return value.replaceAll("'", "''");
}
