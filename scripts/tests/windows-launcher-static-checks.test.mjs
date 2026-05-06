import assert from "node:assert/strict";
import test from "node:test";
import { findCmdLauncherIssues } from "../lib/windows-launcher-static-checks.mjs";

test("Windows launcher guard accepts suite cmd launchers", () => {
  const source = `@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-VaexcoreApp.ps1" "vaexcore studio"
if errorlevel 1 pause
`;

  assert.deepEqual(findCmdLauncherIssues(source, "Start-VaexcoreStudio.cmd"), []);
});

test("Windows launcher guard rejects unquoted script paths", () => {
  const issues = findCmdLauncherIssues(`@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File %~dp0Launch-VaexcoreSuite.ps1
`, "Start-VaexcoreSuite.cmd");

  assert.equal(issues.some((issue) => issue.message.includes("must quote %~dp0 paths")), true);
  assert.equal(issues.some((issue) => issue.message.includes("must pause")), true);
});
