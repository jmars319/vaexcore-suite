import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGoLiveReadiness,
  renderMarkdown,
} from "../check-go-live-readiness.mjs";
import { loadSuiteConfig } from "../lib/suite-config.mjs";

test("go-live readiness aggregates app contracts and manual blockers", async () => {
  const report = await buildGoLiveReadiness({
    config: loadSuiteConfig(),
    generatedAt: "2026-05-13T12:00:00.000Z",
    fetcher: fakeFetch({
      "http://127.0.0.1:51287/output/job": {
        ok: true,
        data: {
          id: "output_job_ready",
          state: "ready",
          detail: "Prepared output job is ready.",
          active_scene_name: "Main",
          recording_profile_name: "Default Local Recording",
          output_path_preview: "~/Movies/vaexcore/test.mkv",
          stream_destination_count: 0,
          scene_output_ready: true,
          media_pipeline_ready: true,
          output_preflight_ready: true,
          recording_target_ready: true,
          stream_targets_ready: true,
          blockers: [],
          warnings: [],
        },
      },
      "http://127.0.0.1:51287/scene-runtime/readiness-report": {
        ok: true,
        data: {
          output_ready: {
            ready: false,
            state: "ready",
            active_scene_name: "Main",
            program_preview_frame_ready: true,
            compositor_render_plan_ready: true,
            output_preflight_ready: true,
            media_pipeline_ready: true,
            detail: "Fallback should not be used.",
            blockers: [],
            warnings: [],
          },
        },
      },
      "http://127.0.0.1:3434/api/bot/completion": {
        ok: true,
        status: "needs-credentials",
        statusLabel: "needs credentials",
        statusDetail: "Twitch OAuth remains.",
        completionPercent: 72,
        sections: [
          {
            key: "twitch-credentials",
            title: "Twitch credentials",
            state: "needs credentials",
            complete: false,
            nextAction: "Complete OAuth.",
          },
        ],
        nextActions: ["Complete OAuth."],
      },
    }),
  });

  assert.equal(report.ok, true);
  assert.equal(report.status, "ready_with_manual_blockers");
  assert.equal(
    report.checks.find((check) => check.id === "studio-output-readiness")
      ?.status,
    "pass",
  );
  assert.equal(
    report.checks.find((check) => check.id === "console-bot-readiness")
      ?.status,
    "warn",
  );
  assert.equal(
    report.checks.find((check) => check.id === "relay-service-readiness")
      ?.status,
    "pass",
  );
  assert.ok(
    report.manualBlockers.some(
      (blocker) => blocker.id === "windows-hardware-validation",
    ),
  );

  const markdown = renderMarkdown(report);
  assert.match(markdown, /vaexcore Go-Live Readiness/);
  assert.match(markdown, /console-bot-readiness/);
});

test("go-live readiness warns when Studio is not running", async () => {
  const report = await buildGoLiveReadiness({
    config: loadSuiteConfig(),
    generatedAt: "2026-05-13T12:00:00.000Z",
    fetcher: fakeFetch({
      "http://127.0.0.1:3434/api/bot/completion": {
        ok: true,
        status: "ready",
        statusLabel: "ready",
        statusDetail: "Bot setup code readiness is complete.",
        completionPercent: 100,
        sections: [],
        nextActions: [],
      },
    }),
  });

  const studio = report.checks.find((check) => check.id === "studio-output-readiness");
  assert.equal(studio?.status, "warn");
  assert.match(studio?.summary ?? "", /output job was not reachable/);
});

test("go-live readiness warns when Studio has no prepared output job", async () => {
  const report = await buildGoLiveReadiness({
    config: loadSuiteConfig(),
    generatedAt: "2026-05-13T12:00:00.000Z",
    fetcher: fakeFetch({
      "http://127.0.0.1:51287/output/job": {
        ok: true,
        data: {
          id: "output-job-idle",
          state: "idle",
          detail: "No output job has been prepared.",
          blockers: [],
          warnings: [],
        },
      },
      "http://127.0.0.1:3434/api/bot/completion": {
        ok: true,
        status: "ready",
        statusLabel: "ready",
        statusDetail: "Bot setup code readiness is complete.",
        completionPercent: 100,
        sections: [],
        nextActions: [],
      },
    }),
  });

  const studio = report.checks.find((check) => check.id === "studio-output-readiness");
  assert.equal(studio?.status, "warn");
  assert.match(studio?.summary ?? "", /no output job has been prepared/);
});

test("go-live readiness fails when the prepared Studio output job is blocked", async () => {
  const report = await buildGoLiveReadiness({
    config: loadSuiteConfig(),
    generatedAt: "2026-05-13T12:00:00.000Z",
    fetcher: fakeFetch({
      "http://127.0.0.1:51287/output/job": {
        ok: true,
        data: {
          id: "output_job_blocked",
          state: "blocked",
          detail: "1 output job blocker must be resolved.",
          active_scene_name: "Main",
          recording_profile_name: "Default Local Recording",
          output_path_preview: "~/Movies/vaexcore/test.mkv",
          stream_destination_count: 1,
          scene_output_ready: false,
          media_pipeline_ready: true,
          output_preflight_ready: false,
          recording_target_ready: true,
          stream_targets_ready: false,
          blockers: ["Scene output readiness is blocked."],
          warnings: [],
        },
      },
      "http://127.0.0.1:3434/api/bot/completion": {
        ok: true,
        status: "ready",
        statusLabel: "ready",
        statusDetail: "Bot setup code readiness is complete.",
        completionPercent: 100,
        sections: [],
        nextActions: [],
      },
    }),
  });

  const studio = report.checks.find((check) => check.id === "studio-output-readiness");
  assert.equal(studio?.status, "fail");
  assert.equal(report.ok, false);
});

test("go-live readiness redacts optional Relay response details", async () => {
  const report = await buildGoLiveReadiness({
    config: loadSuiteConfig(),
    generatedAt: "2026-05-13T12:00:00.000Z",
    env: {
      VAEXCORE_RELAY_READINESS_URL: "https://relay.example/readiness",
      VAEXCORE_RELAY_TOKEN: "actual-token-value",
    },
    fetcher: fakeFetch({
      "http://127.0.0.1:51287/scene-runtime/readiness-report": {
        ok: true,
        data: {
          output_ready: {
            ready: false,
            state: "degraded",
            active_scene_name: "Main",
            program_preview_frame_ready: true,
            compositor_render_plan_ready: true,
            output_preflight_ready: false,
            media_pipeline_ready: true,
            detail: "One warning remains.",
            blockers: [],
            warnings: ["Stream key requires live confirmation."],
          },
        },
      },
      "http://127.0.0.1:3434/api/bot/completion": {
        ok: true,
        status: "ready",
        statusLabel: "ready",
        statusDetail: "Bot setup code readiness is complete.",
        completionPercent: 100,
        sections: [],
        nextActions: [],
      },
      "https://relay.example/readiness": {
        ok: true,
        token: "relay-secret",
        nested: { authorization: "Bearer abc123" },
      },
    }),
  });

  const payload = JSON.stringify(report);
  assert.equal(payload.includes("relay-secret"), false);
  assert.equal(payload.includes("actual-token-value"), false);
  assert.equal(payload.includes("abc123"), false);
});

function fakeFetch(responses) {
  return async (url) => {
    if (!responses[url]) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
      });
    }
    return new Response(JSON.stringify(responses[url]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}
