#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSuiteConfig, suiteRoot } from "./lib/suite-config.mjs";

const defaultTimeoutMs = 1500;

export async function buildGoLiveReadiness(options = {}) {
  const config = options.config ?? loadSuiteConfig();
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? globalThis.fetch;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const checks = [];

  checks.push(
    await studioOutputReadiness({
      config,
      env,
      fetcher,
      timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
    }),
  );
  checks.push(
    await consoleBotReadiness({
      config,
      env,
      fetcher,
      timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
    }),
  );
  checks.push(
    await relayServiceReadiness({
      config,
      env,
      fetcher,
      timeoutMs: options.timeoutMs ?? defaultTimeoutMs,
    }),
  );

  const manualBlockers = knownManualBlockers();
  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");

  return redact({
    schemaVersion: 1,
    generatedAt,
    ok: failed.length === 0,
    status: failed.length
      ? "blocked"
      : manualBlockers.length
        ? "ready_with_manual_blockers"
        : warnings.length
          ? "ready_with_warnings"
          : "ready",
    checks,
    manualBlockers,
    summary: {
      passed: checks.filter((check) => check.status === "pass").length,
      warnings: warnings.length,
      failed: failed.length,
      manualBlockers: manualBlockers.length,
    },
  });
}

export function renderMarkdown(report) {
  const lines = [
    "# vaexcore Go-Live Readiness",
    "",
    `Generated: ${report.generatedAt}`,
    `Overall: ${report.status}`,
    "",
    "| Check | Status | Summary |",
    "| --- | --- | --- |",
  ];
  for (const check of report.checks) {
    lines.push(`| ${check.id} | ${check.status} | ${escapeTable(check.summary)} |`);
  }
  if (report.manualBlockers.length > 0) {
    lines.push("", "## Manual Blockers", "");
    for (const blocker of report.manualBlockers) {
      lines.push(`- ${blocker.id} (${blocker.owner}): ${blocker.detail}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function studioOutputReadiness({ config, env, fetcher, timeoutMs }) {
  const studio = config.apps.find((app) => app.id === "vaexcore-studio");
  if (!studio) {
    return fail("studio-output-readiness", "Studio is missing from suite contract.");
  }
  const studioOrigin = originFromEndpoint(studio.healthEndpoint);
  const outputJobEndpoint =
    env.VAEXCORE_STUDIO_OUTPUT_JOB_URL ?? `${studioOrigin}/output/job`;
  const readinessEndpoint =
    env.VAEXCORE_STUDIO_OUTPUT_READINESS_URL ??
    `${studioOrigin}/scene-runtime/readiness-report`;
  const outputJobResponse = await fetchJson(fetcher, outputJobEndpoint, {
    token: env.VAEXCORE_STUDIO_TOKEN,
    timeoutMs,
  });
  if (outputJobResponse.ok) {
    return studioOutputJobCheck(outputJobEndpoint, unwrapApiResponse(outputJobResponse.body));
  }

  const readinessResponse = await fetchJson(fetcher, readinessEndpoint, {
    token: env.VAEXCORE_STUDIO_TOKEN,
    timeoutMs,
  });
  if (!readinessResponse.ok) {
    return warn(
      "studio-output-readiness",
      `Studio output job was not reachable at ${outputJobEndpoint}.`,
      {
        outputJobEndpoint,
        readinessEndpoint,
        outputJobError: outputJobResponse.error,
        readinessError: readinessResponse.error,
      },
    );
  }
  const body = unwrapApiResponse(readinessResponse.body);
  if (body?.output_job) {
    return studioOutputJobCheck(readinessEndpoint, body.output_job, {
      fallback: "scene-runtime-readiness-report",
      outputJobEndpoint,
      outputJobError: outputJobResponse.error,
    });
  }
  const output = body?.output_ready;
  if (!output) {
    return fail(
      "studio-output-readiness",
      "Studio readiness response did not include output_ready.",
      {
        endpoint: readinessEndpoint,
        outputJobEndpoint,
        outputJobError: outputJobResponse.error,
      },
    );
  }
  return {
    id: "studio-output-readiness",
    app: "vaexcore-studio",
    status: output.ready ? "pass" : output.state === "blocked" ? "fail" : "warn",
    summary: output.detail,
    details: {
      endpoint: readinessEndpoint,
      outputJobEndpoint,
      fallback: "scene-runtime-readiness-report",
      state: output.state,
      activeScene: output.active_scene_name,
      programPreviewFrameReady: Boolean(output.program_preview_frame_ready),
      compositorRenderPlanReady: Boolean(output.compositor_render_plan_ready),
      outputPreflightReady: Boolean(output.output_preflight_ready),
      mediaPipelineReady: Boolean(output.media_pipeline_ready),
      blockers: output.blockers ?? [],
      warnings: output.warnings ?? [],
    },
  };
}

function studioOutputJobCheck(endpoint, job, extraDetails = {}) {
  if (!job?.state) {
    return fail(
      "studio-output-readiness",
      "Studio output job response did not include a job state.",
      { endpoint, ...extraDetails },
    );
  }
  if (job.state === "idle") {
    return warn(
      "studio-output-readiness",
      "Studio is running but no output job has been prepared.",
      studioOutputJobDetails(endpoint, job, extraDetails),
    );
  }
  if (job.state === "cancelled") {
    return warn(
      "studio-output-readiness",
      job.detail || "Studio prepared output job was cancelled.",
      studioOutputJobDetails(endpoint, job, extraDetails),
    );
  }
  if (job.state === "preparing") {
    return warn(
      "studio-output-readiness",
      job.detail || "Studio output job is still preparing.",
      studioOutputJobDetails(endpoint, job, extraDetails),
    );
  }
  return {
    id: "studio-output-readiness",
    app: "vaexcore-studio",
    status: job.state === "ready" ? "pass" : "fail",
    summary:
      job.detail ??
      (job.state === "ready"
        ? "Studio prepared output job is ready."
        : "Studio prepared output job is blocked."),
    details: studioOutputJobDetails(endpoint, job, extraDetails),
  };
}

function studioOutputJobDetails(endpoint, job, extraDetails = {}) {
  return {
    endpoint,
    ...extraDetails,
    state: job.state,
    activeScene: job.active_scene_name ?? null,
    recordingProfile: job.recording_profile_name ?? null,
    outputPathPreview: job.output_path_preview ?? null,
    streamDestinationCount: job.stream_destination_count ?? job.stream_destination_ids?.length ?? 0,
    sceneOutputReady: Boolean(job.scene_output_ready),
    mediaPipelineReady: Boolean(job.media_pipeline_ready),
    outputPreflightReady: Boolean(job.output_preflight_ready),
    recordingTargetReady: Boolean(job.recording_target_ready),
    streamTargetsReady: Boolean(job.stream_targets_ready),
    blockers: job.blockers ?? [],
    warnings: job.warnings ?? [],
  };
}

async function consoleBotReadiness({ config, env, fetcher, timeoutMs }) {
  const consoleApp = config.apps.find((app) => app.id === "vaexcore-console");
  if (!consoleApp) {
    return fail("console-bot-readiness", "Console is missing from suite contract.");
  }
  const endpoint =
    env.VAEXCORE_CONSOLE_BOT_READINESS_URL ??
    `${originFromEndpoint(consoleApp.healthEndpoint)}/api/bot/completion`;
  const response = await fetchJson(fetcher, endpoint, { timeoutMs });
  if (!response.ok) {
    return warn(
      "console-bot-readiness",
      `Console bot readiness was not reachable at ${endpoint}.`,
      { endpoint, error: response.error },
    );
  }
  const body = unwrapApiResponse(response.body);
  const status = body?.status ?? "unknown";
  const label = body?.statusLabel ?? status;
  const sections = Array.isArray(body?.sections) ? body.sections : [];
  const incomplete = sections.filter((section) => section.complete === false);
  return {
    id: "console-bot-readiness",
    app: "vaexcore-console",
    status: status === "ready" ? "pass" : status === "blocked" ? "fail" : "warn",
    summary:
      body?.statusDetail ??
      `${label}; ${body?.completionPercent ?? 0}% complete with ${incomplete.length} incomplete section(s).`,
    details: {
      endpoint,
      state: label,
      completionPercent: body?.completionPercent ?? null,
      incompleteSections: incomplete.map((section) => ({
        key: section.key,
        title: section.title,
        state: section.state,
        nextAction: section.nextAction,
      })),
      nextActions: body?.nextActions ?? [],
    },
  };
}

async function relayServiceReadiness({ config, env, fetcher, timeoutMs }) {
  const relay = config.services.find((service) => service.id === "vaexcore-relay");
  if (!relay) {
    return fail("relay-service-readiness", "Relay is missing from suite service contract.");
  }
  const endpoint = env.VAEXCORE_RELAY_READINESS_URL;
  if (!endpoint) {
    return {
      id: "relay-service-readiness",
      app: "vaexcore-relay",
      status:
        relay.deployment === "cloudflare-worker" && relay.remoteOptional === true
          ? "pass"
          : "fail",
      summary:
        relay.deployment === "cloudflare-worker"
          ? "Relay is registered as the remote Cloudflare Worker service; live readiness requires explicit Relay credentials."
          : "Relay service metadata is not configured as a Cloudflare Worker.",
      details: {
        deployment: relay.deployment,
        remoteOptional: relay.remoteOptional,
        optionalLiveEndpointEnv: "VAEXCORE_RELAY_READINESS_URL",
      },
    };
  }

  const response = await fetchJson(fetcher, endpoint, {
    token: env.VAEXCORE_RELAY_TOKEN,
    timeoutMs,
  });
  if (!response.ok) {
    return warn("relay-service-readiness", `Relay readiness was not reachable at ${endpoint}.`, {
      endpoint,
      error: response.error,
    });
  }
  const body = unwrapApiResponse(response.body);
  const ready = Boolean(body?.ready ?? body?.ok ?? body?.connected);
  return {
    id: "relay-service-readiness",
    app: "vaexcore-relay",
    status: ready ? "pass" : "warn",
    summary: ready
      ? "Relay live readiness endpoint responded ready."
      : "Relay live readiness endpoint responded but did not report ready.",
    details: { endpoint, response: body },
  };
}

async function fetchJson(fetcher, endpoint, { token, timeoutMs }) {
  try {
    const response = await fetcher(endpoint, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, body };
    }
    return { ok: true, body };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function unwrapApiResponse(body) {
  return body && typeof body === "object" && "data" in body ? body.data : body;
}

function originFromEndpoint(endpoint) {
  return new URL(endpoint).origin;
}

function knownManualBlockers() {
  return [
    {
      id: "twitch-live-credentials",
      owner: "Console + Relay",
      detail:
        "Complete Twitch callback, bot OAuth, broadcaster OAuth, EventSub registration, test send, and Chat Bot user-list confirmation.",
    },
    {
      id: "discord-live-credentials",
      owner: "Console + Relay",
      detail:
        "Set Discord Worker secrets, accept the Interactions Endpoint, register slash commands, and test suggestion plus announcement commands.",
    },
    {
      id: "windows-hardware-validation",
      owner: "Studio + Suite",
      detail:
        "Run Windows capture, camera, microphone, encoder, installer, and launcher validation on Windows hardware.",
    },
  ];
}

function pass(id, summary, details = null) {
  return { id, status: "pass", summary, details };
}

function warn(id, summary, details = null) {
  return { id, status: "warn", summary, details };
}

function fail(id, summary, details = null) {
  return { id, status: "fail", summary, details };
}

function redact(value) {
  if (typeof value === "string") {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
      .replace(/(token|secret|authorization)=([^&\s]+)/gi, "$1=[redacted]");
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /token|secret|authorization|stream_key/i.test(key) ? "[redacted]" : redact(item),
      ]),
    );
  }
  return value;
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ");
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildGoLiveReadiness();
  const asJson = Boolean(args.json) || args.format === "json";
  const rendered = asJson ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report);
  if (args.output) {
    writeFileSync(resolve(String(args.output)), rendered);
  }
  process.stdout.write(rendered);
  if (args.check && !report.ok) {
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
