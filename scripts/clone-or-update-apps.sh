#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INCLUDE_SERVICES=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --include-services)
      INCLUDE_SERVICES=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

clone_or_update() {
  local name="$1"
  local repo="$2"
  local path="$3"
  local branch="$4"
  local remote_optional="${5:-false}"
  local target="${ROOT_DIR}/${path}"

  if [[ -d "${target}/.git" ]]; then
    echo "Updating ${name}..."
    if ! git -C "$target" remote get-url origin >/dev/null 2>&1; then
      if [[ "$remote_optional" == "true" ]]; then
        echo "Skipping ${name} fetch; origin is not configured yet."
        git -C "$target" checkout "$branch"
        return
      fi
      echo "Cannot update ${name}; origin is not configured." >&2
      exit 1
    fi
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

if [[ "$INCLUDE_SERVICES" -eq 1 ]]; then
  while IFS=$'\t' read -r name repo path branch remote_optional; do
    [[ -n "${name}" ]] || continue
    clone_or_update "$name" "$repo" "$path" "$branch" "$remote_optional"
  done < <(cd "$ROOT_DIR" && node scripts/print-suite-apps.mjs service-clone-tsv)
fi

echo "vaexcore app repos are current."
