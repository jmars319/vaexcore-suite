import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

test("smoke-all runs CI-equivalent app checks from the expected directories", () => {
  const source = readFileSync(join(suiteRoot, "scripts/smoke-all.sh"), "utf8");

  assert.match(source, /\(cd "\$ROOT_DIR\/studio" && npm run ci\)/);
  assert.match(source, /\(cd "\$ROOT_DIR\/pulse" && pnpm run ci\)/);
  assert.match(source, /\(cd "\$ROOT_DIR\/console\/VaexCore" && npm run ci\)/);
});
