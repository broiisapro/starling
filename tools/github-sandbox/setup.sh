#!/usr/bin/env bash
#
# setup.sh — create (or reuse) the private GitHub sandbox repo for Epic 43.
#
#   bash tools/github-sandbox/setup.sh
#
# - creates `<owner>/starling-sandbox` with `gh repo create --private` when it does not exist
# - pushes a fresh sky-todo demo repo (examples/scripts/make-demo-repo.sh) to `main` when the
#   sandbox is empty (a reused sandbox is left alone so a second e2e run keeps working)
# - prints the repo URL as the last line of stdout (progress goes to stderr)
#
# Env:
#   STARLING_SANDBOX_OWNER  owner login (default: the active `gh` account)
#   STARLING_SANDBOX_NAME   repo name     (default: starling-sandbox)
#   STARLING_SANDBOX_RESET  1 = force `main` back to the demo baseline, even when non-empty
#
# Never deletes anything. Safe to re-run. bash 3.2 compatible (macOS default).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MAKE_DEMO="$ROOT/examples/scripts/make-demo-repo.sh"

say() { printf '%s\n' "$*" >&2; }
die() { say "error: $*"; exit 1; }

command -v gh >/dev/null 2>&1 || die "gh is not installed (brew install gh)"
command -v git >/dev/null 2>&1 || die "git is not installed"
[ -f "$MAKE_DEMO" ] || die "demo-repo script not found at $MAKE_DEMO"

if ! gh auth status >/dev/null 2>&1; then
  die "gh is not authenticated; run 'gh auth login' first"
fi

OWNER="${STARLING_SANDBOX_OWNER:-$(gh api user --jq .login)}"
NAME="${STARLING_SANDBOX_NAME:-starling-sandbox}"
REPO="$OWNER/$NAME"
URL="https://github.com/$REPO"

if gh repo view "$REPO" --json name >/dev/null 2>&1; then
  say "Reusing $REPO"
else
  say "Creating private repo $REPO"
  gh repo create "$REPO" \
    --private \
    --description "Sandbox for Starling GitHub-mode end-to-end checks (safe to reset)" >/dev/null
fi

visibility="$(gh repo view "$REPO" --json visibility --jq .visibility)"
if [ "$visibility" != "PRIVATE" ]; then
  die "$REPO is $visibility; Epic 43 requires a private sandbox. Refusing to push."
fi

has_main=0
if git ls-remote --exit-code --heads "https://github.com/$REPO.git" main >/dev/null 2>&1; then
  has_main=1
fi

if [ "$has_main" = "1" ] && [ "${STARLING_SANDBOX_RESET:-0}" != "1" ]; then
  say "main already exists; leaving the sandbox contents alone (set STARLING_SANDBOX_RESET=1 to reset)"
else
  work="$(mktemp -d "${TMPDIR:-/tmp}/starling-sandbox-seed.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
  demo="$work/sky-todo"
  say "Building a fresh sky-todo demo repo"
  # The sandbox only needs commits and branches; installing node_modules would just add minutes.
  SKY_TODO_SKIP_INSTALL="${SKY_TODO_SKIP_INSTALL:-1}" bash "$MAKE_DEMO" "$demo" >/dev/null

  if git -C "$demo" remote get-url origin >/dev/null 2>&1; then
    git -C "$demo" remote set-url origin "https://github.com/$REPO.git"
  else
    git -C "$demo" remote add origin "https://github.com/$REPO.git"
  fi
  say "Pushing the demo baseline to main"
  git -C "$demo" push --force origin main >/dev/null 2>&1
fi

say "Sandbox ready: $URL"
printf '%s\n' "$URL"
