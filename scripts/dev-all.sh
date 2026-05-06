#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  jobs -p | xargs -r kill
}
trap cleanup EXIT INT TERM

echo "Starting vaexcore apps:"
echo "- studio desktop dev: http://127.0.0.1:1420"
echo "- pulse desktop dev:  http://127.0.0.1:1421"
echo "- console setup:      http://127.0.0.1:3434"

(cd "$ROOT_DIR/studio" && npm run dev) &
(cd "$ROOT_DIR/pulse" && pnpm run dev:desktop) &
(cd "$ROOT_DIR/console/VaexCore" && npm run setup) &

wait
