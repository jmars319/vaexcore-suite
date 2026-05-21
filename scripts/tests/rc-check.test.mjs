import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

test("rc check orchestrates the unsigned release-candidate command surface", () => {
  const source = readFileSync(join(suiteRoot, "scripts/rc-check.mjs"), "utf8");

  assert.match(source, /\.local\/rc-check/);
  assert.match(source, /scripts\/unsigned-rc-dry-run\.mjs/);
  assert.match(source, /scripts\/rc-dashboard\.mjs/);
  assert.match(source, /scripts\/suite-status\.mjs/);
  assert.match(source, /scripts\/release-readiness-report\.mjs/);
  assert.match(source, /scripts\/print-ci-summary\.mjs/);
  assert.match(source, /--require-artifacts/);
  assert.match(source, /studioMediaSmoke/);
  assert.match(source, /pulseHandoffExportSmoke/);
  assert.match(source, /captureToReviewSmoke/);
  assert.match(source, /captureToReviewArtifactTrail/);
  assert.match(source, /consoleRelayReadiness/);
  assert.match(source, /manualReleaseBlockers/);
});

test("rc check writes redacted summary artifacts and treats manual blockers separately", () => {
  const source = readFileSync(join(suiteRoot, "scripts/rc-check.mjs"), "utf8");

  assert.match(source, /redactReportValue/);
  assert.match(source, /summary\.json/);
  assert.match(source, /summary\.md/);
  assert.match(source, /ready-with-warnings/);
  assert.match(source, /manualBlockerCount/);
  assert.match(source, /failedProjects/);
});
