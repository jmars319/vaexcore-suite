#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateJsonSchema } from "./lib/json-schema-lite.mjs";
import { expandedMacDirectory, loadSuiteConfig, suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const config = loadSuiteConfig();
const heartbeatDir = resolve(
  args.dir ?? expandedMacDirectory(config.contract.discovery.macOSDirectory),
);
const strictAge = Boolean(args["strict-age"]);
const maxAgeMs = Number(args["max-age-ms"] ?? config.contract.discovery.heartbeatStaleMs);
const schema = JSON.parse(readFileSync(join(suiteRoot, "suite/schemas/discovery-heartbeat.schema.json"), "utf8"));
const errors = [];

for (const app of config.apps) {
  const path = join(heartbeatDir, app.discoveryFile);
  if (!existsSync(path)) {
    errors.push(`Missing heartbeat for ${app.id}: ${path}`);
    continue;
  }

  let heartbeat;
  try {
    heartbeat = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`Invalid heartbeat JSON for ${app.id}: ${error.message}`);
    continue;
  }

  for (const error of validateJsonSchema(schema, heartbeat, { path: app.discoveryFile })) {
    errors.push(error);
  }

  expectEqual(heartbeat.appId, app.id, `${app.discoveryFile}.appId`);
  expectEqual(heartbeat.appName, app.name, `${app.discoveryFile}.appName`);
  expectEqual(heartbeat.bundleIdentifier, app.bundleId, `${app.discoveryFile}.bundleIdentifier`);
  expectEqual(heartbeat.launchName, app.launchName, `${app.discoveryFile}.launchName`);
  expectEqual(heartbeat.schemaVersion, config.contract.discovery.schemaVersion, `${app.discoveryFile}.schemaVersion`);
  for (const field of ["apiUrl", "wsUrl", "healthUrl"]) {
    const value = heartbeat[field];
    if (value !== null && value !== undefined && !isLocalRuntimeUrl(value)) {
      errors.push(`${app.discoveryFile}.${field} must be a localhost URL.`);
    }
  }

  if (strictAge) {
    const ageMs = Date.now() - statSync(path).mtimeMs;
    if (ageMs > maxAgeMs) {
      errors.push(`${app.discoveryFile} is stale: ${Math.round(ageMs)}ms old exceeds ${maxAgeMs}ms.`);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

console.log(`suite heartbeat validation passed: ${heartbeatDir}`);

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    errors.push(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

function isLocalRuntimeUrl(value) {
  return typeof value === "string" && (
    value.startsWith("http://127.0.0.1:") ||
    value.startsWith("http://localhost:") ||
    value.startsWith("ws://127.0.0.1:") ||
    value.startsWith("ws://localhost:")
  );
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}
