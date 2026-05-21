import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

test("suite status aggregates credential-free release command center checks", () => {
  const source = readFileSync(join(suiteRoot, "scripts/suite-status.mjs"), "utf8");

  assert.match(source, /scripts\/validate-suite-config\.mjs/);
  assert.match(source, /scripts\/check-suite-repos\.mjs/);
  assert.match(source, /scripts\/check-suite-services\.mjs/);
  assert.match(source, /scripts\/release-readiness-report\.mjs/);
  assert.match(source, /scripts\/check-bot-readiness\.mjs/);
  assert.match(source, /scripts\/write-release-handoff-bundle\.mjs/);
  assert.match(source, /scripts\/smoke-studio-pulse-handoff\.mjs/);
  assert.match(source, /scripts\/smoke-all\.sh/);
  assert.match(source, /\.local/);
  assert.match(source, /redact/);
});

test("studio pulse handoff smoke verifies the cross-app handoff path", () => {
  const source = readFileSync(
    join(suiteRoot, "scripts/smoke-studio-pulse-handoff.mjs"),
    "utf8",
  );

  assert.match(source, /pulse-recording-handoff\.schema\.json/);
  assert.match(source, /handoff_recording_to_pulse/);
  assert.match(source, /write_pulse_recording_handoff/);
  assert.match(source, /consume_pulse_recording_handoff/);
  assert.match(source, /accepted-highlight-export/);
  assert.match(source, /outputReady/);
});

test("capture-to-review smoke runs Studio recording into Pulse review export", () => {
  const source = readFileSync(
    join(suiteRoot, "scripts/smoke-capture-to-review.mjs"),
    "utf8",
  );

  assert.match(source, /smoke:media-recording/);
  assert.match(source, /smoke-studio-handoff-review-export\.ts/);
  assert.match(source, /completionState/);
  assert.match(source, /verificationState/);
  assert.match(source, /artifactTrail/);
  assert.match(source, /pulse-accepted-export-summary\.json/);
  assert.match(source, /acceptedOnly/);
  assert.match(source, /\.local\/capture-to-review-smoke\.json/);
});
