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

test("Suite CI uploads integration smoke debug artifacts on failure", () => {
  const source = readFileSync(join(suiteRoot, ".github/workflows/suite-ci.yml"), "utf8");

  assert.match(source, /actions\/upload-artifact@v5/);
  assert.match(source, /if:\s*failure\(\)/);
  assert.match(source, /integration-smoke\.log/);
  assert.match(source, /pulse-service-bundle\.json/);
});

test("app CI workflows set timeouts and cache dependency stores", () => {
  const studio = readFileSync(join(suiteRoot, "studio/.github/workflows/ci.yml"), "utf8");
  const pulse = readFileSync(join(suiteRoot, "pulse/.github/workflows/ci.yml"), "utf8");
  const console = readFileSync(join(suiteRoot, "console/VaexCore/.github/workflows/ci.yml"), "utf8");

  assert.match(studio, /timeout-minutes:\s*25/);
  assert.match(studio, /rust-toolchain\.toml/);
  assert.match(studio, /actions\/cache@v5/);

  assert.match(pulse, /timeout-minutes:\s*25/);
  assert.match(pulse, /pnpm store path --silent/);
  assert.match(pulse, /pulse-pnpm/);
  assert.match(pulse, /rust-toolchain\.toml/);
  assert.match(pulse, /actions\/cache@v5/);
  assert.match(pulse, /pnpm run check:service-bundle/);

  assert.match(console, /timeout-minutes:\s*15/);
  assert.match(console, /cache:\s*npm/);
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
