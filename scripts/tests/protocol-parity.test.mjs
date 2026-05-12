import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { loadSuiteConfig, suiteRoot } from "../lib/suite-config.mjs";

test("generated TypeScript and Rust suite protocols match the contract", () => {
  const config = loadSuiteConfig();
  const generatedFiles = [
    join(suiteRoot, "suite/generated/suite-protocol.ts"),
    join(suiteRoot, "studio/apps/desktop/src-tauri/src/suite_protocol.rs"),
    join(suiteRoot, "pulse/apps/desktopapp/src-tauri/src/suite_protocol.rs"),
    join(suiteRoot, "console/desktop/shared/src/suiteProtocol.ts"),
  ];
  const contents = generatedFiles.map((path) => [path, readFileSync(path, "utf8")]);

  for (const app of config.apps) {
    for (const [path, content] of contents) {
      assert.match(content, stringPattern(app.id), `${path} contains ${app.id}`);
      assert.match(content, stringPattern(app.bundleId), `${path} contains ${app.bundleId}`);
      assert.match(content, stringPattern(app.launchName), `${path} contains ${app.launchName}`);
      assert.match(content, stringPattern(app.discoveryFile), `${path} contains ${app.discoveryFile}`);
    }
  }
});

function stringPattern(value) {
  return new RegExp(escapeRegExp(JSON.stringify(value).slice(1, -1)));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
