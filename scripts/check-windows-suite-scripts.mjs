#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { findLiteralColonVariableIssues } from "./lib/powershell-static-checks.mjs";
import { suiteRoot } from "./lib/suite-config.mjs";

const scripts = listPowerShellFiles(join(suiteRoot, "suite/windows"));
const interpolationIssues = scripts.flatMap((script) =>
  findLiteralColonVariableIssues(readFileSync(script, "utf8"), script)
);

if (interpolationIssues.length > 0) {
  for (const issue of interpolationIssues) {
    console.error(
      `${issue.filePath}:${issue.line}:${issue.column}: PowerShell variables followed by literal ':' must use braces: \${${issue.variableName}}:`
    );
  }
  process.exit(1);
}

const pwsh = findExecutable("pwsh");
if (!pwsh) {
  console.log(`PowerShell parser check skipped: pwsh is not installed; static guards passed for ${scripts.length} scripts.`);
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

console.log(`PowerShell static check passed: ${scripts.length} scripts`);

function listPowerShellFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listPowerShellFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".ps1")) {
      results.push(path);
    }
  }
  return results.sort();
}

function findExecutable(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const path = join(directory, name);
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

function escapePowerShellString(value) {
  return value.replaceAll("'", "''");
}
