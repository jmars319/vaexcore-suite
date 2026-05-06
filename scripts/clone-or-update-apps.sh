#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

clone_or_update() {
  local name="$1"
  local repo="$2"
  local path="$3"
  local branch="$4"
  local target="${ROOT_DIR}/${path}"

  if [[ -d "${target}/.git" ]]; then
    echo "Updating ${name}..."
    git -C "$target" fetch origin
    git -C "$target" checkout "$branch"
    git -C "$target" pull --ff-only origin "$branch"
    return
  fi

  if [[ -e "$target" ]]; then
    echo "Cannot clone ${name}; ${target} exists but is not a git repo." >&2
    exit 1
  fi

  echo "Cloning ${name}..."
  mkdir -p "$(dirname "$target")"
  git clone --branch "$branch" "$repo" "$target"
}

clone_or_update "vaexcore studio" "https://github.com/jmars319/vaexcore-studio" "studio" "main"
clone_or_update "vaexcore pulse" "https://github.com/jmars319/vaexcore-pulse" "pulse" "main"
clone_or_update "vaexcore console" "https://github.com/jmars319/vaexcore-console" "console/VaexCore" "main"

echo "vaexcore app repos are current."

