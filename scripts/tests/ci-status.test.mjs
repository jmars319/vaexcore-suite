import assert from "node:assert/strict";
import test from "node:test";
import { formatRunSummary, isGreenRun, latestWorkflowRun } from "../lib/ci-status.mjs";

test("latest workflow status uses the newest run after an intermediate failure", () => {
  const latest = latestWorkflowRun(
    [
      {
        workflowName: "Suite CI",
        status: "completed",
        conclusion: "failure",
        headSha: "26b686e88e2eda2553e22ebb450b7224ecfb4832",
        createdAt: "2026-05-06T20:33:24Z",
        url: "https://example.test/failure",
      },
      {
        workflowName: "Suite CI",
        status: "completed",
        conclusion: "success",
        headSha: "ba667ca76059db14b9d34fdd957573eab67fb49d",
        createdAt: "2026-05-06T20:36:29Z",
        url: "https://example.test/success",
      },
    ],
    "Suite CI"
  );

  assert.equal(isGreenRun(latest), true);
  assert.equal(formatRunSummary("suite", latest), "suite: success ba667ca https://example.test/success");
});
