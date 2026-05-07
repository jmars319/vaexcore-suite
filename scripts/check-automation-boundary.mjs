#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { suiteRoot } from "./lib/suite-config.mjs";

const args = parseArgs(process.argv.slice(2));
const json = Boolean(args.json);
const boundaryPath = resolve(args.file ?? join(suiteRoot, "suite/automation-boundary.json"));
const errors = [];
const warnings = [];
const boundary = readBoundary(boundaryPath);

if (boundary.schemaVersion !== 1) {
  errors.push("suite/automation-boundary.json schemaVersion must be 1");
}
if (!Array.isArray(boundary.items) || boundary.items.length === 0) {
  errors.push("suite/automation-boundary.json items must be a non-empty array");
}

const ids = new Set();
for (const item of boundary.items ?? []) {
  validateItem(item, ids);
}

const result = {
  path: boundaryPath,
  total: boundary.items?.length ?? 0,
  codePlaceholders: (boundary.items ?? []).filter((item) => item.category === "intentional-placeholder").length,
  manualValidations: (boundary.items ?? []).filter((item) => item.category === "manual-validation").length,
  errors,
  warnings,
  ok: errors.length === 0,
  items: boundary.items ?? [],
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const item of result.items) {
    console.log(`${item.id}: ${item.status} (${item.app})`);
  }
  console.log(
    `automation boundary check ${result.ok ? "passed" : "failed"}: ${result.total} items, ${result.codePlaceholders} code placeholders, ${result.manualValidations} manual validations`,
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`error: ${error}`);
  }
  process.exit(1);
}

function readBoundary(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing automation boundary file: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function validateItem(item, ids) {
  for (const field of ["id", "app", "category", "status", "automationLimit", "nextValidation"]) {
    if (typeof item[field] !== "string" || item[field].trim() === "") {
      errors.push(`${item.id ?? "(missing id)"}.${field} must be a non-empty string`);
    }
  }
  if (item.id) {
    if (ids.has(item.id)) {
      errors.push(`duplicate automation boundary id: ${item.id}`);
    }
    ids.add(item.id);
  }
  if (!["intentional-placeholder", "manual-validation"].includes(item.category)) {
    errors.push(`${item.id}.category must be intentional-placeholder or manual-validation`);
  }
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
    errors.push(`${item.id}.evidence must be a non-empty array`);
    return;
  }
  for (const [index, evidence] of item.evidence.entries()) {
    const label = `${item.id}.evidence[${index}]`;
    if (typeof evidence.path !== "string" || evidence.path.trim() === "") {
      errors.push(`${label}.path must be a non-empty string`);
      continue;
    }
    const evidencePath = resolve(suiteRoot, evidence.path);
    if (!existsSync(evidencePath)) {
      errors.push(`${label}.path does not exist: ${evidence.path}`);
      continue;
    }
    if (typeof evidence.contains === "string" && !readFileSync(evidencePath, "utf8").includes(evidence.contains)) {
      errors.push(`${label}.contains was not found in ${evidence.path}`);
    }
  }
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
