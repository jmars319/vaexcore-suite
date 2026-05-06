import assert from "node:assert/strict";
import test from "node:test";
import { findLiteralColonVariableIssues } from "../lib/powershell-static-checks.mjs";

test("PowerShell static guard catches variables before literal colons", () => {
  const issues = findLiteralColonVariableIssues('Write-Host "  $Name: $($file.Name)"', "fixture.ps1");

  assert.deepEqual(issues, [
    {
      filePath: "fixture.ps1",
      variableName: "Name",
      line: 1,
      column: 15,
    },
  ]);
});

test("PowerShell static guard accepts braced variables and scoped variables", () => {
  const issues = findLiteralColonVariableIssues(`
Write-Host "  \${Name}: $($file.Name)"
$PowerShellExe = Join-Path $env:SystemRoot "System32"
`);

  assert.deepEqual(issues, []);
});
