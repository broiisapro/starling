#!/usr/bin/env bash
#
# make-demo-repo.sh [target-dir]
#
# Copies examples/sky-todo into a fresh git repo that Starling can run against.
# - default target: ${TMPDIR:-/tmp}/sky-todo-<timestamp>
# - never copies .starling-answers/ or demo-goals/*.expected.md
# - git init -b main, bun install, one commit: "chore: initial sky-todo"
# - prints the absolute path of the repo on the last line
#
# Idempotent: re-running with the same target rebuilds it from scratch, but only
# if the target looks like a repo this script created (or is empty/missing).
# Otherwise it refuses to delete anything.
#
# bash 3.2 compatible (macOS default): no mapfile, no associative arrays, no
# globstar, no ${var,,}.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/../sky-todo" && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"
TARGET="${1:-$TMP_ROOT/sky-todo-$TIMESTAMP}"

# Make a relative target absolute before we cd anywhere.
case "$TARGET" in
  /*) ;;
  *) TARGET="$(pwd)/$TARGET" ;;
esac
# Drop a trailing slash, except for "/".
TARGET="${TARGET%/}"
[ -n "$TARGET" ] || TARGET="/"

BUN_BIN="${BUN_BIN:-}"
if [ -z "$BUN_BIN" ]; then
  BUN_BIN="$(command -v bun 2>/dev/null || true)"
fi
if [ -z "$BUN_BIN" ] && [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi

say() { printf '%s\n' "$*" >&2; }

if [ ! -d "$SOURCE_DIR" ]; then
  say "error: source app not found at $SOURCE_DIR"
  exit 1
fi

# --- idempotency guard -------------------------------------------------------
if [ -e "$TARGET" ] && [ ! -d "$TARGET" ]; then
  say "error: $TARGET exists and is not a directory"
  exit 1
fi

if [ -d "$TARGET" ]; then
  # `ls -A` is the portable way to ask "is this directory non-empty?" without
  # relying on find's -maxdepth support.
  if [ -n "$(ls -A "$TARGET" 2>/dev/null || true)" ]; then
    if [ -d "$TARGET/.git" ] && \
       [ "$(git -C "$TARGET" log -1 --pretty=%s 2>/dev/null || true)" = "chore: initial sky-todo" ]; then
      say "Replacing existing demo repo at $TARGET"
      rm -rf "$TARGET"
    else
      say "error: $TARGET is not empty and was not created by this script."
      say "       Refusing to delete it. Pass a new path, or remove it yourself."
      exit 1
    fi
  fi
fi

mkdir -p "$TARGET"

# --- copy (excluding the answer keys and build output) -----------------------
# BSD tar (macOS) and GNU tar both understand --exclude with a leading ./.
(
  cd "$SOURCE_DIR"
  tar -cf - \
    --exclude='./.starling-answers' \
    --exclude='./demo-goals/*.expected.md' \
    --exclude='./node_modules' \
    --exclude='./dist' \
    --exclude='./.git' \
    --exclude='./.DS_Store' \
    .
) | (
  cd "$TARGET"
  tar -xf -
)

# --- git ---------------------------------------------------------------------
if [ ! -d "$TARGET/.git" ]; then
  git -C "$TARGET" init -q -b main
fi

# Fill in an identity only when the machine has none configured, so the demo
# works on a fresh laptop without touching the user's global git config.
if ! git -C "$TARGET" config user.email >/dev/null 2>&1; then
  git -C "$TARGET" config user.email "demo@sky-todo.local"
  git -C "$TARGET" config user.name "Sky Todo Demo"
fi

# --- install -----------------------------------------------------------------
if [ "${SKY_TODO_SKIP_INSTALL:-0}" = "1" ]; then
  say "Skipping bun install (SKY_TODO_SKIP_INSTALL=1)"
elif [ -n "$BUN_BIN" ]; then
  say "Installing dependencies with $BUN_BIN"
  ( cd "$TARGET" && "$BUN_BIN" install --silent )
else
  say "warning: bun was not found on PATH; run 'bun install' in $TARGET before the demo"
fi

# --- commit ------------------------------------------------------------------
git -C "$TARGET" add -A
if git -C "$TARGET" diff --cached --quiet; then
  say "Nothing to commit (target already at baseline)"
else
  git -C "$TARGET" commit -q -m "chore: initial sky-todo"
fi

printf '%s\n' "$TARGET"
