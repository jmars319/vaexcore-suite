#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR=""
STRICT_HEARTBEAT=0
status=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --dest)
      DEST_DIR="$2"
      shift 2
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

suite_info="$(cd "$ROOT_DIR" && node scripts/print-suite-apps.mjs macos-suite-info-tsv)"
IFS=$'\t' read -r SUITE_DIR HEARTBEAT_STALE_MS <<<"$suite_info"

check_app() {
  local app_id="$1"
  local app_name="$2"
  local expected_bundle="$3"
  local discovery_file="$4"
  local contract_app_path="$5"
  local app_path="$contract_app_path"
  if [[ -n "$DEST_DIR" ]]; then
    app_path="${DEST_DIR}/$(basename "$contract_app_path")"
  fi
  local plist_path="${app_path}/Contents/Info.plist"

  if [[ ! -d "$app_path" ]]; then
    echo "Missing ${app_path}" >&2
    status=1
    return
  fi

  if [[ ! -f "$plist_path" ]]; then
    echo "Missing ${plist_path}" >&2
    status=1
    return
  fi

  local actual_bundle
  if ! actual_bundle="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$plist_path")"; then
    echo "Could not read bundle id for ${app_name} from ${plist_path}" >&2
    status=1
    return
  fi
  if [[ "$actual_bundle" != "$expected_bundle" ]]; then
    echo "Bundle id mismatch for ${app_name}: expected ${expected_bundle}, got ${actual_bundle}" >&2
    status=1
  else
    echo "Verified ${app_name}.app (${actual_bundle})"
  fi

  local heartbeat_path="${SUITE_DIR}/${discovery_file}"
  if [[ -f "$heartbeat_path" ]]; then
    local modified
    local age_seconds
    modified="$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$heartbeat_path")"
    age_seconds="$(($(date +%s) - $(stat -f "%m" "$heartbeat_path")))"
    echo "  heartbeat: ${heartbeat_path} (${modified}, ${age_seconds}s old)"
    if [[ "$STRICT_HEARTBEAT" -eq 1 ]] && (( age_seconds * 1000 > HEARTBEAT_STALE_MS )); then
      echo "  heartbeat stale for ${app_id}: ${age_seconds}s old exceeds ${HEARTBEAT_STALE_MS}ms" >&2
      status=1
    fi
  else
    echo "  heartbeat: ${heartbeat_path} not present yet"
    if [[ "$STRICT_HEARTBEAT" -eq 1 ]]; then
      status=1
    fi
  fi
}

echo "Verifying vaexcore app installation from ${ROOT_DIR}/suite/contract.json"
while IFS=$'\t' read -r app_id app_name bundle_id discovery_file macos_path; do
  check_app "$app_id" "$app_name" "$bundle_id" "$discovery_file" "$macos_path"
done < <(cd "$ROOT_DIR" && node scripts/print-suite-apps.mjs macos-verify-tsv)

if [[ "$status" -ne 0 ]]; then
  exit "$status"
fi

echo "vaexcore app installation verified."
