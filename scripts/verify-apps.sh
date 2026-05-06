#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUITE_DIR="${HOME}/Library/Application Support/vaexcore/suite"
status=0

check_app() {
  local app_name="$1"
  local expected_bundle="$2"
  local discovery_file="$3"
  local app_path="/Applications/${app_name}.app"
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
  actual_bundle="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$plist_path")"
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
  else
    echo "  heartbeat: ${heartbeat_path} not present yet"
  fi
}

echo "Verifying vaexcore app installation from ${ROOT_DIR}/suite/contract.json"
check_app "vaexcore studio" "com.vaexcore.studio" "vaexcore-studio.json"
check_app "vaexcore pulse" "com.vaexil.vaexcore.pulse" "vaexcore-pulse.json"
check_app "vaexcore console" "com.vaexil.vaexcore.console" "vaexcore-console.json"

if [[ "$status" -ne 0 ]]; then
  exit "$status"
fi

echo "vaexcore app installation verified."
