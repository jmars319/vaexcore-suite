import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

test("Windows suite README template uses a literal here-string with built timestamp replacement", () => {
  const source = readFileSync(join(suiteRoot, "suite/windows/Build-VaexcoreSuite.ps1"), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  const artifactSource = readFileSync(
    join(suiteRoot, "suite/windows/build-modules/Artifacts.ps1"),
    "utf8",
  ).replaceAll("\r\n", "\n");

  assert.match(source, /build-modules/);
  assert.match(artifactSource, /\$summary = @'\n# vaexcore Windows Suite/);
  assert.match(artifactSource, /Built: __BUILT_AT__/);
  assert.match(artifactSource, /suite\\windows-validation-plan\.json/);
  assert.match(artifactSource, /'@\.Replace\("__BUILT_AT__", \$builtAt\)/);
  assert.doesNotMatch(artifactSource, /Built: \$\(Get-Date/);
});
