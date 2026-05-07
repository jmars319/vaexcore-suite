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
const unknownArgs = process.argv.slice(2).filter((arg) => !["--require-pwsh"].includes(arg));
if (unknownArgs.length > 0) {
  console.error(`Unknown option: ${unknownArgs.join(", ")}`);
  process.exit(2);
}

const scripts = listFiles(join(suiteRoot, "suite/windows"), ".ps1");
const launchers = listFiles(join(suiteRoot, "suite/windows"), ".cmd");
const staticIssues = [
  ...scripts.flatMap((script) => {
  const source = readFileSync(script, "utf8");
  return [
    ...findLiteralColonVariableIssues(source, script).map((issue) => ({
      ...issue,
      message: `PowerShell variables followed by literal ':' must use braces: \${${issue.variableName}}:`,
    })),
    ...findExpandableHereStringFenceIssues(source, script).map((issue) => ({
      ...issue,
      message: "Markdown code fences use backticks; put them in single-quoted here-strings.",
    })),
  ];
  }),
  ...launchers.flatMap((launcher) => findCmdLauncherIssues(readFileSync(launcher, "utf8"), launcher)),
];

if (staticIssues.length > 0) {
  for (const issue of staticIssues) {
    console.error(`${issue.filePath}:${issue.line}:${issue.column}: ${issue.message}`);
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

console.log(`PowerShell static check passed: ${scripts.length} scripts and ${launchers.length} launchers`);

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
