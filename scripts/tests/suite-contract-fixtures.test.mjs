import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateJsonSchema } from "../lib/json-schema-lite.mjs";
import { suiteRoot } from "../lib/suite-config.mjs";

const heartbeatSchema = readJson("suite/schemas/discovery-heartbeat.schema.json");
const commandSchema = readJson("suite/schemas/suite-command.schema.json");
const handoffSchema = readJson("suite/schemas/pulse-recording-handoff.schema.json");
const markerSchema = readJson("suite/schemas/studio-marker-metadata.schema.json");

test("heartbeat fixtures document valid and invalid timestamp formats", () => {
  const valid = readJson("scripts/tests/fixtures/heartbeats/valid-studio.json");
  const invalid = readJson("scripts/tests/fixtures/heartbeats/invalid-pulse-epoch.json");

  assert.deepEqual(validateJsonSchema(heartbeatSchema, valid, { path: "valid-studio.json" }), []);
  assert.match(
    validateJsonSchema(heartbeatSchema, invalid, { path: "invalid-pulse-epoch.json" }).join("\n"),
    /startedAt.*date-time[\s\S]*updatedAt.*date-time/,
  );
});

test("suite command files validate against the command schema", () => {
  const suiteDir = mkdtempSync(join(tmpdir(), "vaexcore-command-smoke-"));
  const commandDir = join(suiteDir, "commands/vaexcore-pulse");
  mkdirSync(commandDir, { recursive: true });
  const command = {
    schemaVersion: 1,
    commandId: "open-review-1",
    sourceApp: "vaexcore-studio",
    sourceAppName: "vaexcore studio",
    targetApp: "vaexcore-pulse",
    command: "open-review",
    requestedAt: "2026-05-06T12:00:00Z",
    payload: {
      recordingSessionId: "rec_smoke",
    },
  };
  const commandPath = join(commandDir, `${command.commandId}.json`);
  writeFileSync(commandPath, `${JSON.stringify(command, null, 2)}\n`);

  const readBack = JSON.parse(readFileSync(commandPath, "utf8"));
  assert.deepEqual(validateJsonSchema(commandSchema, readBack, { path: "open-review-1.json" }), []);
});

test("suite command schema rejects non-object payloads", () => {
  assert.match(
    validateJsonSchema(commandSchema, {
      schemaVersion: 1,
      commandId: "bad-payload-1",
      sourceApp: "vaexcore-studio",
      sourceAppName: "vaexcore studio",
      targetApp: "vaexcore-console",
      command: "focus-ops",
      requestedAt: "2026-05-06T12:00:00Z",
      payload: "not-object",
    }).join("\n"),
    /payload must be object/,
  );
});

test("cross-app handoff, command, and marker fixtures round-trip through temp files", () => {
  const suiteDir = mkdtempSync(join(tmpdir(), "vaexcore-cross-app-"));
  const handoffDir = join(suiteDir, "handoffs");
  const commandDir = join(suiteDir, "commands/vaexcore-pulse");
  mkdirSync(handoffDir, { recursive: true });
  mkdirSync(commandDir, { recursive: true });
  const handoff = {
    schemaVersion: 1,
    requestId: "studio-recording-rec-smoke-1",
    sourceApp: "vaexcore-studio",
    sourceAppName: "vaexcore studio",
    targetApp: "vaexcore-pulse",
    requestedAt: "2026-05-06T12:00:00Z",
    recording: {
      sessionId: "rec_smoke",
      outputPath: "/tmp/rec_smoke.mkv",
      profileId: "profile_1080p",
      profileName: "1080p",
      stoppedAt: "2026-05-06T12:05:00Z",
    },
  };
  const handoffPath = join(handoffDir, "pulse-recording-intake.json");
  writeFileSync(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
  const pulseReadBack = JSON.parse(readFileSync(handoffPath, "utf8"));
  assert.deepEqual(validateJsonSchema(handoffSchema, pulseReadBack, { path: "pulse-recording-intake.json" }), []);

  const command = {
    schemaVersion: 1,
    commandId: "open-review-1",
    sourceApp: "vaexcore-studio",
    sourceAppName: "vaexcore studio",
    targetApp: "vaexcore-pulse",
    command: "open-review",
    requestedAt: "2026-05-06T12:00:01Z",
    payload: handoff,
  };
  const commandPath = join(commandDir, `${command.commandId}.json`);
  writeFileSync(commandPath, `${JSON.stringify(command, null, 2)}\n`);
  assert.deepEqual(validateJsonSchema(commandSchema, JSON.parse(readFileSync(commandPath, "utf8")), { path: "open-review-1.json" }), []);

  const marker = {
    contract: "vaexcore.studio.marker.v1",
    schemaVersion: 1,
    eventType: "console.chat.marker",
    source: {
      appId: "vaexcore-console",
      appName: "vaexcore console",
      workflow: "manual-chat-marker",
    },
    createdAt: "2026-05-06T12:00:02Z",
  };
  assert.deepEqual(validateJsonSchema(markerSchema, marker, { path: "studio-marker.json" }), []);
});

test("generated suite protocol files are current", () => {
  assert.doesNotThrow(() => {
    execFileSync("node", ["scripts/generate-suite-protocol.mjs", "--check"], {
      cwd: suiteRoot,
      stdio: "pipe",
    });
  });
});

function readJson(relativePath) {
  return JSON.parse(readFileSync(join(suiteRoot, relativePath), "utf8"));
}
