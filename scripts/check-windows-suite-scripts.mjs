#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { delimiter, join } from "node:path";
import { suiteRoot } from "./lib/suite-config.mjs";

const pwsh = findExecutable("pwsh");
if (!pwsh) {
  console.log("PowerShell static check skipped: pwsh is not installed.");
  process.exit(0);
}

const scripts = listPowerShellFiles(join(suiteRoot, "suite/windows"));
for (const script of scripts) {
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
