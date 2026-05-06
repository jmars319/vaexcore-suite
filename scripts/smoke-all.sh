#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== vaexcore suite config =="
(cd "$ROOT_DIR" && node scripts/validate-suite-config.mjs --require-local-repos && node scripts/smoke-suite-contracts.mjs)

echo "== vaexcore studio =="
(cd "$ROOT_DIR/studio" && cargo test -p vaexcore-api && npm run typecheck)

echo "== vaexcore pulse =="
(cd "$ROOT_DIR/pulse" && pnpm --filter @vaexcore/pulse-desktopapp typecheck && pnpm run smoke:studio)

echo "== vaexcore console =="
(cd "$ROOT_DIR/console/VaexCore" && npm run typecheck && npm run smoke:studio)

echo "vaexcore integration smoke passed"
