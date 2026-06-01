#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildRcDashboard } from "./lib/rc-dashboard/build.mjs";
import { renderMarkdown, writeDashboard } from "./lib/rc-dashboard/render.mjs";
import { suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const options = {
  outputDir: resolve(
    args["output-dir"] ?? join(suiteRoot, ".local/rc-dashboard"),
  ),
  artifactDir: resolve(
    args["artifact-dir"] ??
      join(suiteRoot, ".local/unsigned-rc-dry-run/artifacts"),
  ),
  skipRemote: Boolean(args["skip-remote"]),
  skipGit: Boolean(args["skip-git"]),
  full: Boolean(args.full),
  requireArtifacts: Boolean(args["require-artifacts"]),
  skipSmokes: Boolean(args["skip-smokes"]),
};

mkdirSync(options.outputDir, { recursive: true });

const dashboard = buildRcDashboard(options);
writeDashboard(dashboard, options.outputDir);

process.stdout.write(
  args.json ? `${JSON.stringify(dashboard, null, 2)}\n` : renderMarkdown(dashboard),
);

if (!dashboard.ok) {
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/rc-dashboard.mjs [options]

Options:
  --skip-remote         Do not query remote CI.
  --skip-git            Do not require clean/pushed git state.
  --skip-smokes         Do not run Studio/Pulse app smoke checks.
  --full                Run suite-status in full mode.
  --require-artifacts   Fail if unsigned RC artifacts are missing.
  --artifact-dir <dir>  Unsigned RC artifact directory. Defaults to .local/unsigned-rc-dry-run/artifacts.
  --output-dir <dir>    Dashboard output directory. Defaults to .local/rc-dashboard.
  --json                Print JSON instead of Markdown.
  --help                Show this help.
`);
}
