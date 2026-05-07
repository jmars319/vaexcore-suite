import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

test("release-suite gates packaging behind smoke, preflight, CI, and environment checks", () => {
  const source = readFileSync(join(suiteRoot, "scripts/release-suite.sh"), "utf8");

  assertBefore(source, 'scripts/check-all.sh" --skip-package', "scripts/release-preflight.mjs");
  assertBefore(source, "scripts/release-preflight.mjs", "scripts/check-ci-status.mjs");
  assertBefore(source, "scripts/check-ci-status.mjs", "scripts/check-release-env.mjs");
  assertBefore(source, "scripts/check-release-env.mjs", "scripts/dist-mac-suite.sh");
});

test("release dry-run validates local gates, CI status, manifest, and static artifacts", () => {
  const source = readFileSync(join(suiteRoot, "scripts/release-dry-run.sh"), "utf8");

  assertBefore(source, "scripts/validate-suite-config.mjs", "scripts/release-preflight.mjs");
  assertBefore(source, "scripts/release-preflight.mjs", "scripts/check-ci-status.mjs");
  assertBefore(source, "scripts/check-ci-status.mjs", "scripts/print-ci-summary.mjs");
  assertBefore(source, "scripts/write-dry-run-artifacts.mjs", "scripts/write-suite-manifest.mjs");
  assertBefore(source, "scripts/write-suite-manifest.mjs", "scripts/check-release-artifacts.mjs");
  assert.match(source, /--manifest-only/);
});

function assertBefore(source, first, second) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${first} is present`);
  assert.notEqual(secondIndex, -1, `${second} is present`);
  assert.ok(firstIndex < secondIndex, `${first} runs before ${second}`);
}
