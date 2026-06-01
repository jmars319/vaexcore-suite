import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { redactReportValue } from "../lib/redact-report.mjs";
import { suiteRoot } from "../lib/suite-config.mjs";

test("rc dashboard aggregates release-candidate code gates and app smokes", () => {
  const source = [
    "scripts/rc-dashboard.mjs",
    "scripts/lib/rc-dashboard/build.mjs",
    "scripts/lib/rc-dashboard/checks.mjs",
    "scripts/lib/rc-dashboard/project-git.mjs",
    "scripts/lib/rc-dashboard/render.mjs",
  ]
    .map((file) => readFileSync(join(suiteRoot, file), "utf8"))
    .join("\n");

  assert.match(source, /\.local\/rc-dashboard/);
  assert.match(source, /unsigned release candidate dashboard/);
  assert.match(source, /scripts\/suite-status\.mjs/);
  assert.match(source, /scripts\/print-ci-summary\.mjs/);
  assert.match(source, /scripts\/check-release-artifacts\.mjs/);
  assert.match(source, /smoke:media-recording/);
  assert.match(source, /smoke:studio-handoff/);
  assert.match(source, /smoke-capture-to-review\.mjs/);
  assert.match(source, /captureToReviewArtifactTrail/);
  assert.match(source, /Capture-To-Review Artifact Trail/);
  assert.match(source, /projectGitRecord/);
  assert.match(source, /consoleRelayReadinessSummary/);
  assert.match(source, /manualReleaseBlockers/);
  assert.match(source, /unsigned-macos-code-signing/);
  assert.match(source, /unsigned-macos-notarization/);
  assert.match(source, /unsigned-windows-signing/);
});

test("unsigned rc dry-run labels output honestly and writes local handoff paths", () => {
  const dryRunSource = readFileSync(
    join(suiteRoot, "scripts/unsigned-rc-dry-run.mjs"),
    "utf8",
  );
  const shellSource = readFileSync(
    join(suiteRoot, "scripts/release-dry-run.sh"),
    "utf8",
  );

  assert.match(dryRunSource, /unsigned release candidate/);
  assert.match(dryRunSource, /scripts\/release-dry-run\.sh/);
  assert.match(dryRunSource, /\.local\/unsigned-rc-dry-run/);
  assert.match(dryRunSource, /manualReleaseBlockers/);
  assert.match(dryRunSource, /--skip-git/);
  assert.match(dryRunSource, /Developer ID signing is not part/);
  assert.match(dryRunSource, /Apple notarization is not part/);
  assert.match(dryRunSource, /Windows signing is not part/);
  assert.match(dryRunSource, /Windows hardware validation is not part/);
  assert.match(dryRunSource, /not counted as unsigned RC code failures/);
  assert.match(shellSource, /HANDOFF_DIR/);
  assert.match(shellSource, /SKIP_GIT/);
  assert.match(shellSource, /--handoff-dir/);
  assert.match(shellSource, /\$HANDOFF_DIR/);
});

test("rc reports redact secret-like values before writing local artifacts", () => {
  const redacted = JSON.stringify(
    redactReportValue({
      token: "plain-token-value",
      nested: {
        authorization: "Bearer twitch-access-token-with-long-enough-value",
        detail:
          "TWITCH_CLIENT_SECRET=twitch-secret DISCORD_BOT_TOKEN=discord-token&secret=eventsub-secret Bot discord-live-token-with-long-enough-value",
      },
    }),
  );

  assert.equal(redacted.includes("plain-token-value"), false);
  assert.equal(
    redacted.includes("twitch-access-token-with-long-enough-value"),
    false,
  );
  assert.equal(redacted.includes("twitch-secret"), false);
  assert.equal(redacted.includes("discord-token"), false);
  assert.equal(redacted.includes("eventsub-secret"), false);
  assert.equal(
    redacted.includes("discord-live-token-with-long-enough-value"),
    false,
  );
  assert.match(redacted, /\[redacted\]/);
});
