export function findLiteralColonVariableIssues(source, filePath = "<inline>") {
  const issues = [];
  const pattern = /(?<!`)\$([A-Za-z_][A-Za-z0-9_]*):(?=$|[^A-Za-z0-9_?])/g;

  for (const match of source.matchAll(pattern)) {
    issues.push({
      filePath,
      variableName: match[1],
      ...lineColumnForOffset(source, match.index ?? 0),
    });
  }

  return issues;
}

function lineColumnForOffset(source, offset) {
  const before = source.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: lines.at(-1).length + 1,
  };
}
