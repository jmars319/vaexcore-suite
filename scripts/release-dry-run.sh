#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${VAEXCORE_RELEASE_DRY_RUN_DIR:-${ROOT_DIR}/dist/release-dry-run}"
HANDOFF_DIR="${VAEXCORE_RELEASE_DRY_RUN_HANDOFF_DIR:-${ROOT_DIR}/.local/release-handoff}"
SKIP_REMOTE=0
SKIP_GIT=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --artifact-dir)
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    --handoff-dir)
      HANDOFF_DIR="$2"
      shift 2
      ;;
    --skip-remote)
      SKIP_REMOTE=1
      shift
      ;;
    --skip-git)
      SKIP_GIT=1
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
  node scripts/check-suite-services.mjs
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
RELEASE_READINESS_ARGS=(--skip-remote --artifact-dir "$ARTIFACT_DIR" --require-artifacts)
HANDOFF_ARGS=(--skip-remote --artifact-dir "$ARTIFACT_DIR" --output-dir "$HANDOFF_DIR" --require-artifacts)
if [[ "$SKIP_GIT" -eq 1 ]]; then
  RELEASE_READINESS_ARGS+=(--skip-git)
  HANDOFF_ARGS+=(--skip-git)
fi
node "$ROOT_DIR/scripts/release-readiness-report.mjs" "${RELEASE_READINESS_ARGS[@]}" --check
node "$ROOT_DIR/scripts/write-release-handoff-bundle.mjs" "${HANDOFF_ARGS[@]}"

echo "vaexcore release dry-run passed"
