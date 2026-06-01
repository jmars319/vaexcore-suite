#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== vaexcore suite: maintainability =="
node "${ROOT_DIR}/scripts/audit-maintainability.mjs" --strict

for app_dir in console pulse relay studio; do
  echo "== vaexcore/${app_dir}: maintainability =="
  (cd "${ROOT_DIR}/${app_dir}" && npm run audit:maintainability && npm run budget:bundle)
done
