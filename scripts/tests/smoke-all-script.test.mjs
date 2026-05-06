import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { suiteRoot } from "../lib/suite-config.mjs";

test("smoke-all runs CI-equivalent app checks from the expected directories", () => {
  const source = readFileSync(join(suiteRoot, "scripts/smoke-all.sh"), "utf8");

  assert.match(source, /\(cd "\$ROOT_DIR\/studio" && npm run prepare:sidecars && npm run check:sidecars && cargo fmt --all -- --check && cargo test -p vaexcore-api && cargo test -p vaexcore-studio-desktop && npm run typecheck\)/);
  assert.match(source, /\(cd "\$ROOT_DIR\/pulse" && pnpm run lint && pnpm --filter @vaexcore\/pulse-desktopapp typecheck && pnpm run smoke:studio\)/);
  assert.match(source, /\(cd "\$ROOT_DIR\/pulse\/apps\/desktopapp\/src-tauri" && cargo fmt --all -- --check && cargo test\)/);
  assert.match(source, /\(cd "\$ROOT_DIR\/console\/VaexCore" && npm run typecheck && npm run smoke:studio\)/);
});
