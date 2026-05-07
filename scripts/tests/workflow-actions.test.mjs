import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loadSuiteConfig, suiteRoot } from "../lib/suite-config.mjs";

test("checked-in workflows do not use deprecated actions v4 tags", () => {
  const workflowFiles = workflowRoots().flatMap((root) => listWorkflowFiles(join(root, ".github/workflows")));
  assert.ok(workflowFiles.length >= 4, "expected suite and app workflow files");

  const offenders = workflowFiles.filter((file) => /uses:\s*actions\/[^@\s]+@v4\b/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("Suite CI keeps a native Windows launcher syntax job", () => {
  const source = readFileSync(join(suiteRoot, ".github/workflows/suite-ci.yml"), "utf8");

  assert.match(source, /windows-launchers:/);
  assert.match(source, /runs-on:\s*windows-latest/);
  assert.match(source, /node scripts\/check-windows-suite-scripts\.mjs --require-pwsh/);
});

function workflowRoots() {
  return [suiteRoot, ...loadSuiteConfig().apps.map((app) => join(suiteRoot, app.path))].filter((root) =>
    existsSync(join(root, ".github/workflows"))
  );
}

function listWorkflowFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => /\.(ya?ml)$/.test(file))
    .map((file) => join(dir, file));
}
