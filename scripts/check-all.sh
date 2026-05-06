#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAC_ARTIFACT_DIR="${VAEXCORE_CHECK_MAC_ARTIFACT_DIR:-${ROOT_DIR}/dist/mac-suite-check}"
SKIP_APP_SMOKE=0
SKIP_PACKAGE="${VAEXCORE_SKIP_MAC_PACKAGE:-0}"
MANIFEST_ONLY=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --skip-app-smoke)
      SKIP_APP_SMOKE=1
      shift
      ;;
    --skip-package)
      SKIP_PACKAGE=1
      shift
      ;;
    --manifest-only)
      MANIFEST_ONLY=1
      shift
      ;;
    --artifact-dir)
      MAC_ARTIFACT_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$MANIFEST_ONLY" -eq 1 ]]; then
  node "$ROOT_DIR/scripts/write-suite-manifest.mjs" --platform macOS --arch "$(uname -m)" --artifact-dir "$MAC_ARTIFACT_DIR"
  node "$ROOT_DIR/scripts/validate-release-manifest.mjs" "${MAC_ARTIFACT_DIR}/manifest.json"
  echo "vaexcore manifest check passed"
  exit 0
fi

(cd "$ROOT_DIR" && node --test scripts/tests/*.test.mjs && node scripts/validate-suite-config.mjs --require-local-repos && node scripts/check-suite-repos.mjs && node scripts/generate-suite-protocol.mjs --check && node scripts/smoke-suite-contracts.mjs && node scripts/check-windows-suite-scripts.mjs)

if [[ "$SKIP_APP_SMOKE" -eq 1 ]]; then
  echo "Skipping app smoke checks because --skip-app-smoke was passed."
else
  "$ROOT_DIR/scripts/smoke-all.sh"
fi

if [[ "$SKIP_PACKAGE" == "1" ]]; then
  echo "Skipping macOS staging package check."
else
  "$ROOT_DIR/scripts/dist-mac-suite.sh" --artifact-dir "$MAC_ARTIFACT_DIR"
fi

echo "vaexcore full check passed"
