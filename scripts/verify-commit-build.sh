#!/usr/bin/env bash

set -euo pipefail

BASE_REF="dev"
TARGET_REF="HEAD"
SKIP_BUILD=0
SKIP_INSTALL=0
SKIP_TYPECHECK=0

while (($# > 0)); do
  case "$1" in
    --base)
      BASE_REF="${2:-}"
      shift 2
      ;;
    --target)
      TARGET_REF="${2:-}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift 1
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift 1
      ;;
    --skip-typecheck)
      SKIP_TYPECHECK=1
      shift 1
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: scripts/verify-commit-build.sh [--base <ref>] [--target <ref>] [--skip-build] [--skip-install] [--skip-typecheck]" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BASE_REF" || -z "$TARGET_REF" ]]; then
  echo "base and target refs must be non-empty" >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TEMP_WORKTREES_DIR="${REPO_ROOT}/.worktrees"
VERIFY_WORKTREE="${TEMP_WORKTREES_DIR}/verify-commit-build-${TIMESTAMP}-$$"

mkdir -p "$TEMP_WORKTREES_DIR"

cleanup() {
  if [[ -d "$VERIFY_WORKTREE" ]]; then
    git -C "$REPO_ROOT" worktree remove --force "$VERIFY_WORKTREE" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

git -C "$REPO_ROOT" rev-parse --verify "$BASE_REF" >/dev/null
git -C "$REPO_ROOT" rev-parse --verify "$TARGET_REF" >/dev/null

COMMITS=()
while IFS= read -r line; do
  if [[ -n "$line" ]]; then
    COMMITS+=("$line")
  fi
done < <(git -C "$REPO_ROOT" rev-list --reverse "${BASE_REF}..${TARGET_REF}")
if ((${#COMMITS[@]} == 0)); then
  echo "No commits found in range ${BASE_REF}..${TARGET_REF}"
  exit 0
fi

git -C "$REPO_ROOT" worktree add --detach "$VERIFY_WORKTREE" "$TARGET_REF" >/dev/null

echo "Verifying ${#COMMITS[@]} commit(s) in ${BASE_REF}..${TARGET_REF}"
echo "Temporary worktree: ${VERIFY_WORKTREE}"

if ((SKIP_INSTALL == 0)); then
  echo
  echo "==> Installing dependencies in temporary worktree"
  make -C "$VERIFY_WORKTREE" install
fi

for COMMIT in "${COMMITS[@]}"; do
  SUBJECT="$(git -C "$REPO_ROOT" show -s --format='%h %s' "$COMMIT")"
  echo
  echo "==> $SUBJECT"
  git -C "$VERIFY_WORKTREE" checkout --detach "$COMMIT" >/dev/null
  if ((SKIP_TYPECHECK == 0)); then
    make -C "$VERIFY_WORKTREE" typecheck
  fi
  if ((SKIP_BUILD == 0)); then
    make -C "$VERIFY_WORKTREE" build
  fi
done

echo
echo "All commits passed verification in ${BASE_REF}..${TARGET_REF}"
