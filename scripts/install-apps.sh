#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="/Applications"
KEEP_ARTIFACTS=0
SKIP_BUILD=0
SKIP_VERIFY=0
STRICT_HEARTBEAT=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dest)
      DEST_DIR="$2"
      shift 2
      ;;
    --keep-artifacts)
      KEEP_ARTIFACTS=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --no-verify)
      SKIP_VERIFY=1
      shift
      ;;
    --strict-heartbeat)
      STRICT_HEARTBEAT=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

copy_app() {
  local source_app="$1"
  local app_name="$2"
  local target_app="${DEST_DIR}/${app_name}.app"

  if [[ ! -d "$source_app" ]]; then
    echo "Missing ${app_name}.app at ${source_app}" >&2
    return 1
  fi

  mkdir -p "$DEST_DIR"
  rm -rf "$target_app"
  ditto "$source_app" "$target_app"
  if [[ "$KEEP_ARTIFACTS" -ne 1 ]]; then
    rm -rf "$source_app"
  fi
  echo "Installed ${target_app}"
}

find_built_app() {
  local search_dir="$1"
  local app_name="$2"

  find "$search_dir" -type d -name "${app_name}.app" -print -quit
}

while IFS=$'\t' read -r app_id app_name app_path build_command launch_name artifact_search_dir macos_path; do
  app_dir="${ROOT_DIR}/${app_path}"
  search_dir="${app_dir}/${artifact_search_dir}"
  if [[ "$SKIP_BUILD" -eq 1 ]]; then
    echo "Skipping build for ${app_name}."
  else
    echo "Building ${app_name}..."
    (cd "$app_dir" && bash -lc "$build_command")
  fi
  built_app="$(find_built_app "$search_dir" "$launch_name")"
  copy_app "$built_app" "$launch_name"
done < <(cd "$ROOT_DIR" && node scripts/print-suite-apps.mjs mac-build-tsv)

if [[ "$SKIP_VERIFY" -ne 1 ]]; then
  verify_args=(--dest "$DEST_DIR")
  if [[ "$STRICT_HEARTBEAT" -eq 1 ]]; then
    verify_args+=(--strict-heartbeat)
  fi
  "$ROOT_DIR/scripts/verify-apps.sh" "${verify_args[@]}"
fi

echo "All vaexcore apps are installed in ${DEST_DIR}."
