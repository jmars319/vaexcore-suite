export function findCmdLauncherIssues(source, filePath = "<inline>") {
  const issues = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const meaningfulLines = lines
    .map((line, index) => ({ line, lineNumber: index + 1, trimmed: line.trim() }))
    .filter((entry) => entry.trimmed.length > 0);

  if (meaningfulLines.at(0)?.trimmed.toLowerCase() !== "@echo off") {
    issues.push(issue(filePath, meaningfulLines.at(0)?.lineNumber ?? 1, 1, "launcher must start with @echo off"));
  }

  if (!meaningfulLines.some((entry) => entry.trimmed.toLowerCase() === "setlocal")) {
    issues.push(issue(filePath, 1, 1, "launcher must use setlocal before invoking PowerShell"));
  }

  for (const entry of meaningfulLines) {
    if (countUnescapedQuotes(entry.line) % 2 !== 0) {
      issues.push(issue(filePath, entry.lineNumber, entry.line.indexOf('"') + 1, "launcher line has unbalanced quotes"));
    }
  }

  const hiddenWscriptInvocation = meaningfulLines.find((entry) =>
    /^start\s+""\s+"%SystemRoot%\\System32\\wscript\.exe"\s+"%~dp0[^"]+\.vbs"\s*$/i.test(
      entry.trimmed
    )
  );
  if (!hiddenWscriptInvocation) {
    issues.push(
      issue(
        filePath,
        1,
        1,
        'launcher must invoke wscript.exe with a quoted "%~dp0...vbs" hidden launcher'
      )
    );
  }

  for (const entry of meaningfulLines) {
    if (entry.line.includes("%~dp0") && !/"%~dp0[^"]+"/i.test(entry.line)) {
      issues.push(issue(filePath, entry.lineNumber, entry.line.indexOf("%~dp0") + 1, "launcher must quote %~dp0 paths"));
    }
  }

  if (
    meaningfulLines.some((entry) =>
      /^powershell\.exe\s+-NoProfile\s+-ExecutionPolicy\s+Bypass\s+-File\b/i.test(entry.trimmed)
    )
  ) {
    issues.push(issue(filePath, 1, 1, "launcher must not show a PowerShell console window"));
  }

  return issues;
}

function issue(filePath, line, column, message) {
  return { filePath, line, column, message };
}

function countUnescapedQuotes(line) {
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"' && line[index + 1] === '"') {
      index += 1;
      continue;
    }
    if (line[index] === '"') {
      count += 1;
    }
  }
  return count;
}
