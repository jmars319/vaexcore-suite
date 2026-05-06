import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

test("Windows suite README template uses a literal here-string with built timestamp replacement", () => {
  const source = readFileSync(join(suiteRoot, "suite/windows/Build-VaexcoreSuite.ps1"), "utf8");

  assert.match(source, /\$summary = @'\n# vaexcore Windows Suite/);
  assert.match(source, /Built: __BUILT_AT__/);
  assert.match(source, /'@\.Replace\("__BUILT_AT__", \$builtAt\)/);
  assert.doesNotMatch(source, /Built: \$\(Get-Date/);
});
