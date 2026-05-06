#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${ROOT_DIR}/dist/mac-suite"
SKIP_SMOKE=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --artifact-dir)
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    --skip-smoke)
      SKIP_SMOKE=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$SKIP_SMOKE" -ne 1 ]]; then
  "$ROOT_DIR/scripts/check-all.sh" --skip-package
fi

"$ROOT_DIR/scripts/dist-mac-suite.sh" --artifact-dir "$ARTIFACT_DIR"

echo "vaexcore suite release artifacts:"
find "$ARTIFACT_DIR" -maxdepth 1 -type f | sort
