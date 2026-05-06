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

export function findExpandableHereStringFenceIssues(source, filePath = "<inline>") {
  const issues = [];
  const lines = source.split(/\r?\n/);
  let inExpandableHereString = false;

  lines.forEach((line, index) => {
    if (!inExpandableHereString) {
      inExpandableHereString = line.trimEnd().endsWith('@"');
      return;
    }

    if (line === '"@') {
      inExpandableHereString = false;
      return;
    }

    const fenceColumn = line.indexOf("```");
    if (fenceColumn !== -1) {
      issues.push({
        filePath,
        line: index + 1,
        column: fenceColumn + 1,
      });
    }
  });

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
