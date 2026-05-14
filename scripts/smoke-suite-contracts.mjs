#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSuiteConfig, suiteRoot } from "./lib/suite-config.mjs";
import { validateJsonSchema } from "./lib/json-schema-lite.mjs";

const { apps, contract } = loadSuiteConfig();
const now = "2026-05-06T12:00:00.000Z";

const schemas = {
  heartbeat: readSchema("discovery-heartbeat.schema.json"),
  command: readSchema("suite-command.schema.json"),
  handoff: readSchema("pulse-recording-handoff.schema.json"),
  markerMetadata: readSchema("studio-marker-metadata.schema.json"),
};

const errors = [];

for (const app of apps) {
  validate("heartbeat", schemas.heartbeat, {
    schemaVersion: contract.discovery.schemaVersion,
    appId: app.id,
    appName: app.name,
    bundleIdentifier: app.bundleId,
    version: "0.0.0",
    pid: 1234,
    startedAt: now,
    updatedAt: now,
    apiUrl: endpointOrigin(app.healthEndpoint),
    wsUrl: null,
    healthUrl: app.healthEndpoint,
    capabilities: app.capabilities,
    launchName: app.launchName,
    suiteSessionId: null,
    activity: "smoke",
    activityDetail: "suite contract smoke",
    localRuntime: {
      contractVersion: contract.discovery.schemaVersion,
      mode: "local-first",
      state: "ready",
      appStorageDir: "/tmp/vaexcore",
      suiteDir: "/tmp/vaexcore/suite",
      secureStorage: "local",
      secretStorageState: "ready",
      durableStorage: ["sqlite"],
      networkPolicy: "localhost-only",
      dependencies: [
        {
          name: "local-api",
          kind: "local-http-service",
          state: "reachable",
          detail: app.healthEndpoint,
        },
      ],
    },
  });
}

validate("suite command", schemas.command, {
  schemaVersion: contract.discovery.schemaVersion,
  commandId: "suite-command-smoke",
  sourceApp: "vaexcore-studio",
  sourceAppName: "vaexcore studio",
  targetApp: "vaexcore-pulse",
  command: "open-review",
  requestedAt: now,
  payload: { recordingSessionId: "rec_smoke" },
});

validate("pulse handoff", schemas.handoff, {
  schemaVersion: contract.discovery.schemaVersion,
  requestId: "studio-recording-rec-smoke-1",
  sourceApp: "vaexcore-studio",
  sourceAppName: "vaexcore studio",
  targetApp: "vaexcore-pulse",
  requestedAt: now,
  recording: {
    sessionId: "rec_smoke",
    outputPath: "/tmp/rec_smoke.mkv",
    profileId: "profile_1080p",
    profileName: "1080p",
    stoppedAt: now,
  },
  outputReady: {
    ready: true,
    state: "ready",
    detail: "Scene output handoff is ready for Pulse intake.",
    activeSceneId: "scene-main",
    activeSceneName: "Main scene",
    programPreviewFrameReady: true,
    compositorRenderPlanReady: true,
    outputPreflightReady: true,
    mediaPipelineReady: true,
    blockers: [],
    warnings: [],
  },
});

const markerMetadata = {
  contract: contract.markerContract.name,
  schemaVersion: contract.markerContract.schemaVersion,
  eventType: "console.chat.marker",
  source: {
    appId: "vaexcore-console",
    appName: "vaexcore console",
    workflow: "manual-chat-marker",
  },
  createdAt: now,
};

for (const field of contract.markerContract.requiredMetadataFields) {
  if (!Object.prototype.hasOwnProperty.call(markerMetadata, field)) {
    errors.push(`marker metadata smoke payload is missing contract-required field ${field}.`);
  }
}
validate("marker metadata", schemas.markerMetadata, markerMetadata);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

console.log("suite contract schema smoke passed");

function readSchema(filename) {
  return JSON.parse(readFileSync(join(suiteRoot, "suite/schemas", filename), "utf8"));
}

function validate(label, schema, payload) {
  for (const error of validateJsonSchema(schema, payload, { path: label })) {
    errors.push(error);
  }
}

function endpointOrigin(endpoint) {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.host}`;
}
