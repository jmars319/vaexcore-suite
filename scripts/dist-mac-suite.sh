#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARTIFACT_DIR="${ROOT_DIR}/dist/mac-suite"
SKIP_BUILD=0
KEEP_STAGING=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --artifact-dir)
      ARTIFACT_DIR="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --keep-staging)
      KEEP_STAGING=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

STAGING_DIR="${ARTIFACT_DIR}/staging/Applications"
rm -rf "$ARTIFACT_DIR"
mkdir -p "$STAGING_DIR"

install_args=(--dest "$STAGING_DIR" --keep-artifacts --no-verify)
if [[ "$SKIP_BUILD" -eq 1 ]]; then
  install_args+=(--skip-build)
fi
"$ROOT_DIR/scripts/install-apps.sh" "${install_args[@]}"

while IFS=$'\t' read -r app_id launch_name version; do
  app_path="${STAGING_DIR}/${launch_name}.app"
  if [[ ! -d "$app_path" ]]; then
    echo "Missing staged app: ${app_path}" >&2
    exit 1
  fi
  zip_name="${app_id}-${version}-mac-$(uname -m).zip"
  zip_path="${ARTIFACT_DIR}/${zip_name}"
  (cd "$STAGING_DIR" && ditto -c -k --sequesterRsrc --keepParent "${launch_name}.app" "$zip_path")
  shasum -a 256 "$zip_path" >"${zip_path}.sha256"
  echo "Packaged ${zip_path}"
done < <(cd "$ROOT_DIR" && node scripts/print-suite-apps.mjs macos-launch-names-tsv)

if [[ "$KEEP_STAGING" -ne 1 ]]; then
  rm -rf "${ARTIFACT_DIR}/staging"
fi

node "$ROOT_DIR/scripts/write-suite-manifest.mjs" \
  --platform macOS \
  --arch "$(uname -m)" \
  --artifact-dir "$ARTIFACT_DIR"
node "$ROOT_DIR/scripts/validate-release-manifest.mjs" "${ARTIFACT_DIR}/manifest.json"
node "$ROOT_DIR/scripts/inspect-mac-artifacts.mjs" --artifact-dir "$ARTIFACT_DIR"

echo "macOS suite artifacts are ready in ${ARTIFACT_DIR}."
