#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== vaexcore suite config =="
(cd "$ROOT_DIR" && node --test scripts/tests/*.test.mjs && node scripts/validate-suite-config.mjs --require-local-repos && node scripts/check-suite-repos.mjs && node scripts/generate-suite-protocol.mjs --check && node scripts/smoke-suite-contracts.mjs)

echo "== vaexcore studio =="
(cd "$ROOT_DIR/studio" && npm run ci)

echo "== vaexcore pulse =="
(cd "$ROOT_DIR/pulse" && pnpm run ci)

echo "== vaexcore console =="
(cd "$ROOT_DIR/console/VaexCore" && npm run ci)

echo "vaexcore integration smoke passed"
