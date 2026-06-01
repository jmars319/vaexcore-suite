import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loadSuiteConfig, suiteRoot } from "../lib/suite-config.mjs";

test("checked-in workflows do not use deprecated actions v4 tags", () => {
  const workflowFiles = workflowRoots().flatMap((root) => listWorkflowFiles(join(root, ".github/workflows")));
  assert.ok(workflowFiles.length >= 5, "expected suite, app, and service workflow files");

  const offenders = workflowFiles.filter((file) => /uses:\s*actions\/[^@\s]+@v4\b/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("Suite CI keeps a native Windows launcher syntax job", () => {
  const source = readFileSync(join(suiteRoot, ".github/workflows/suite-ci.yml"), "utf8");

  assert.match(source, /windows-launchers:/);
  assert.match(source, /runs-on:\s*windows-2025/);
  assert.match(source, /\.\\scripts\\clone-or-update-apps\.ps1/);
  assert.match(source, /node scripts\/check-suite-repos\.mjs/);
  assert.match(source, /node scripts\/check-windows-suite-scripts\.mjs --require-pwsh/);
  assert.match(source, /node --test scripts\/tests\/windows-manifest\.test\.mjs scripts\/tests\/windows-readme-template\.test\.mjs/);
});

test("Suite CI clones services for service-aware macOS checks", () => {
  const source = readFileSync(join(suiteRoot, ".github/workflows/suite-ci.yml"), "utf8");

  assert.doesNotMatch(source, /console\/VaexCore/);
  assert.match(source, /\(cd console && npm ci\)/);
  assert.match(source, /\(cd relay && npm ci\)/);
  assert.match(
    source,
    /Contract checks[\s\S]*\.\/scripts\/clone-or-update-apps\.sh --include-services/,
  );
  assert.match(
    source,
    /name:\s*Clone app repos for integration smoke[\s\S]*\.\/scripts\/clone-or-update-apps\.sh --include-services/,
  );
  assert.match(source, /Contract checks[\s\S]*node scripts\/check-suite-services\.mjs/);
  assert.match(
    source,
    /name:\s*Validate app repo branches and services[\s\S]*node scripts\/check-suite-services\.mjs/,
  );
});

test("Suite CI exposes integration smoke progress as named steps", () => {
  const source = readFileSync(join(suiteRoot, ".github/workflows/suite-ci.yml"), "utf8");

  for (const stepName of [
    "Prepare integration smoke logs",
    "Clone app repos for integration smoke",
    "Validate app repo branches and services",
    "Install Studio dependencies",
    "Install Pulse dependencies",
    "Install Console dependencies",
    "Install Relay dependencies",
    "Run suite config and contract smoke",
    "Check bot readiness",
    "Run Studio CI",
    "Run Pulse CI",
    "Run Console CI",
  ]) {
    assert.match(source, new RegExp(`name:\\s*${escapeRegExp(stepName)}`));
  }

  assert.doesNotMatch(
    source,
    /name:\s*Integration smoke\s*\n\s*shell:\s*bash\s*\n\s*run:\s*\|[\s\S]*scripts\/smoke-all\.sh/,
  );
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
  const console = readFileSync(join(suiteRoot, "console/.github/workflows/ci.yml"), "utf8");
  const relay = readFileSync(join(suiteRoot, "relay/.github/workflows/ci.yml"), "utf8");

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

  assert.match(relay, /name:\s*Relay CI/);
  assert.match(relay, /timeout-minutes:\s*15/);
  assert.match(relay, /cache:\s*npm/);
  assert.match(relay, /npm run ci/);
});

function workflowRoots() {
  const config = loadSuiteConfig();
  return [
    suiteRoot,
    ...config.apps.map((app) => join(suiteRoot, app.path)),
    ...config.services.map((service) => join(suiteRoot, service.path)),
  ].filter((root) => existsSync(join(root, ".github/workflows")));
}

function listWorkflowFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => /\.(ya?ml)$/.test(file))
    .map((file) => join(dir, file));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
