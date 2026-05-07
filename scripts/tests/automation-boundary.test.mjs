import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

test("automation boundary evidence stays current", () => {
  const output = execFileSync("node", ["scripts/check-automation-boundary.mjs", "--json"], {
    cwd: suiteRoot,
    encoding: "utf8",
  });
  const report = JSON.parse(output);

  assert.equal(report.ok, true);
  assert.ok(report.codePlaceholders >= 5);
  assert.ok(report.manualValidations >= 2);
  assert.ok(report.items.some((item) => item.id === "pulse-offline-stt-provider"));
  assert.ok(report.items.some((item) => item.id === "live-twitch-oauth-chat"));
});
