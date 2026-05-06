#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

copy_app() {
  local source_app="$1"
  local app_name="$2"
  local target_app="/Applications/${app_name}.app"

  if [[ ! -d "$source_app" ]]; then
    echo "Missing ${app_name}.app at ${source_app}" >&2
    return 1
  fi

  rm -rf "$target_app"
  ditto "$source_app" "$target_app"
  rm -rf "$source_app"
  echo "Installed ${target_app}"
}

find_built_app() {
  local search_dir="$1"
  local app_name="$2"

  find "$search_dir" -type d -name "${app_name}.app" -print -quit
}

echo "Building vaexcore studio..."
(cd "$ROOT_DIR/studio" && npm run tauri -w apps/desktop -- build --bundles app)
studio_app="$(find_built_app "$ROOT_DIR/studio/target/release/bundle" "vaexcore studio")"
copy_app "$studio_app" "vaexcore studio"

echo "Building vaexcore pulse..."
(cd "$ROOT_DIR/pulse" && pnpm app:build)
pulse_app="$(find_built_app "$ROOT_DIR/pulse/release" "vaexcore pulse")"
copy_app "$pulse_app" "vaexcore pulse"

echo "Building vaexcore console..."
(cd "$ROOT_DIR/console/VaexCore" && npm run app:build)
console_app="$(find_built_app "$ROOT_DIR/console/VaexCore/release" "vaexcore console")"
copy_app "$console_app" "vaexcore console"

"$ROOT_DIR/scripts/verify-apps.sh"

echo "All vaexcore apps are installed in /Applications."
