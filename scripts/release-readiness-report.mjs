#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { buildReleaseReadinessReport } from "./lib/release-readiness/build.mjs";
import { redact } from "./lib/release-readiness/common.mjs";
import { renderMarkdown } from "./lib/release-readiness/render.mjs";
import { suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const options = {
  args,
  artifactDir: resolve(
    args["artifact-dir"] ?? join(suiteRoot, "dist/mac-suite"),
  ),
  skipGit: Boolean(args["skip-git"]),
  skipRemote: Boolean(args["skip-remote"]),
  requireArtifacts: Boolean(args["require-artifacts"]),
  inspectArtifacts: Boolean(args["inspect-artifacts"]),
};
const check = Boolean(args.check);
const json = Boolean(args.json) || args.format === "json";
const outputPath = args.output ? resolve(args.output) : null;

const report = await buildReleaseReadinessReport(options);
const redactedReport = redact(report);
const rendered = json
  ? `${JSON.stringify(redactedReport, null, 2)}\n`
  : renderMarkdown(redactedReport);

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered);
}
process.stdout.write(rendered);

if (check && !report.ok) {
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
