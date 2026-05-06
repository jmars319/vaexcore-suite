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

while IFS=$'\t' read -r name repo path branch; do
  clone_or_update "$name" "$repo" "$path" "$branch"
done < <(cd "$ROOT_DIR" && node scripts/print-suite-apps.mjs clone-tsv)

echo "vaexcore app repos are current."
