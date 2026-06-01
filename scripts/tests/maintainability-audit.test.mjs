import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

test("suite-root maintainability audit is wired into local verify", () => {
  const justfile = readFileSync(join(suiteRoot, "justfile"), "utf8");
  const checkScript = readFileSync(
    join(suiteRoot, "scripts/check-maintainability.sh"),
    "utf8",
  );
  const config = JSON.parse(
    readFileSync(
      join(suiteRoot, "scripts/maintainability.config.json"),
      "utf8",
    ),
  );

  assert.match(justfile, /check-maintainability\.sh/);
  assert.match(checkScript, /audit-maintainability\.mjs" --strict/);
  assert.ok(
    config.assetBudgets.some(
      (budget) => budget.file === "suite/windows/assets/vaexcore-suite.ico",
    ),
  );
  assert.ok(
    config.assetBudgets.some(
      (budget) => budget.file === "suite/windows/assets/vaexcore-suite.jpg",
    ),
  );
});
