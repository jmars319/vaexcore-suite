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
