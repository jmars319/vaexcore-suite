#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAC_ARTIFACT_DIR="${VAEXCORE_CHECK_MAC_ARTIFACT_DIR:-${ROOT_DIR}/dist/mac-suite-check}"

(cd "$ROOT_DIR" && node scripts/validate-suite-config.mjs --require-local-repos)
"$ROOT_DIR/scripts/smoke-all.sh"

if [[ "${VAEXCORE_SKIP_MAC_PACKAGE:-0}" == "1" ]]; then
  echo "Skipping macOS staging package check because VAEXCORE_SKIP_MAC_PACKAGE=1."
else
  "$ROOT_DIR/scripts/dist-mac-suite.sh" --artifact-dir "$MAC_ARTIFACT_DIR"
fi

echo "vaexcore full check passed"
