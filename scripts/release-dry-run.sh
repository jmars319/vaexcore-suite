#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${VAEXCORE_RELEASE_DRY_RUN_DIR:-${ROOT_DIR}/dist/release-dry-run}"
SKIP_REMOTE=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --artifact-dir)
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    --skip-remote)
      SKIP_REMOTE=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

(
  cd "$ROOT_DIR"
  node --test scripts/tests/*.test.mjs
  node scripts/validate-suite-config.mjs --require-local-repos
  node scripts/check-suite-repos.mjs
  node scripts/generate-suite-protocol.mjs --check
  node scripts/smoke-suite-contracts.mjs
  node scripts/check-automation-boundary.mjs
  node scripts/check-windows-suite-scripts.mjs
)

if [[ "$SKIP_REMOTE" -eq 1 ]]; then
  echo "Skipping remote preflight and CI status checks because --skip-remote was passed."
else
  (
    cd "$ROOT_DIR"
    node scripts/release-preflight.mjs
    node scripts/check-ci-status.mjs --require-green
    node scripts/print-ci-summary.mjs
  )
fi

node "$ROOT_DIR/scripts/write-dry-run-artifacts.mjs" --artifact-dir "$ARTIFACT_DIR" --clean
node "$ROOT_DIR/scripts/write-suite-manifest.mjs" --platform macOS --arch "$(uname -m)" --artifact-dir "$ARTIFACT_DIR"
node "$ROOT_DIR/scripts/check-release-artifacts.mjs" --artifact-dir "$ARTIFACT_DIR" --manifest-only
node "$ROOT_DIR/scripts/release-readiness-report.mjs" --skip-remote --artifact-dir "$ARTIFACT_DIR" --require-artifacts --check

echo "vaexcore release dry-run passed"
