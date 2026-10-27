#!/usr/bin/env bash
#
# make-demo-repo.sh [<example-name>] [<target-dir>]
#
# Copies one of the demo targets under examples/ into a fresh git repo that
# Starling can run against.
#
#   make-demo-repo.sh                       sky-todo -> ${TMPDIR}/sky-todo-<timestamp>
#   make-demo-repo.sh py-ledger             py-ledger -> ${TMPDIR}/py-ledger-<timestamp>
#   make-demo-repo.sh sky-todo ./demo       sky-todo -> ./demo
#   make-demo-repo.sh ./demo                legacy form: sky-todo -> ./demo
#   make-demo-repo.sh --list                show the available targets
#
# Guarantees for every target:
# - never copies .starling-answers/ or demo-goals/*.expected.md
# - git init -b main and exactly one commit: "chore: initial <example>"
# - installs dependencies when the toolchain is present (bun / Python 3.12+ venv)
# - runs the baseline test suite and fails loudly if it is not green
# - prints the absolute path of the repo on the last line
#
# Python targets get a .venv (git-ignored). Activate it before running Starling,
# so the auditor's `pytest` command resolves:
#
#   cd "$(make-demo-repo.sh py-ledger)" && source .venv/bin/activate
#
# Environment:
#   BUN_BIN                bun binary (default: bun on PATH, else ~/.bun/bin/bun)
#   PYTHON_BIN             Python 3.12+ interpreter for the venv
#   DEMO_SKIP_INSTALL=1    skip dependency installation for every target
#   DEMO_SKIP_TESTS=1      skip the baseline test run
#   SKY_TODO_SKIP_INSTALL=1, PY_LEDGER_SKIP_INSTALL=1   per-target spellings
#
# Idempotent: re-running with the same target rebuilds it from scratch, but only
# if the target looks like a repo this script created (or is empty/missing).
# Otherwise it refuses to delete anything.
#
# bash 3.2 compatible (macOS default): no mapfile, no associative arrays, no
# globstar, no ${var,,}.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXAMPLES_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TMP_ROOT="${TMPDIR:-/tmp}"
TMP_ROOT="${TMP_ROOT%/}"

say() { printf '%s\n' "$*" >&2; }

usage() {
  cat <<'USAGE'
Usage: make-demo-repo.sh [<example-name>] [<target-dir>]

  <example-name>  a folder under examples/ (default: sky-todo)
  <target-dir>    where to build the repo (default: $TMPDIR/<example>-<timestamp>)

The first argument may also be a target directory (legacy form): anything that
is not a folder under examples/ is treated as the path. That keeps
`make-demo-repo.sh /tmp/demo` working for sky-todo.

Options:
  -h, --help      this text
  --list          list the available demo targets
USAGE
}

is_example() {
  [ -n "$1" ] || return 1
  case "$1" in
    */*) return 1 ;;                 # paths are never example names
  esac
  [ "$1" != "scripts" ] || return 1
  [ -d "$EXAMPLES_ROOT/$1" ] || return 1
  # A target is a project, not just any directory.
  [ -f "$EXAMPLES_ROOT/$1/package.json" ] || [ -f "$EXAMPLES_ROOT/$1/pyproject.toml" ]
}

list_examples() {
  say "Demo targets under $EXAMPLES_ROOT:"
  for dir in "$EXAMPLES_ROOT"/*/; do
    name="$(basename "$dir")"
    [ "$name" != "scripts" ] || continue
    if [ -f "$dir/package.json" ]; then
      kind="TypeScript, bun test"
    elif [ -f "$dir/pyproject.toml" ]; then
      kind="Python 3.12, pytest"
    else
      continue
    fi
    if [ "$name" = "sky-todo" ]; then
      say "  $name  (default)  $kind"
    else
      say "  $name            $kind"
    fi
  done
}

# --- arguments ---------------------------------------------------------------
EXAMPLE="sky-todo"
TARGET=""

if [ $# -gt 0 ]; then
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --list)
      list_examples
      exit 0
      ;;
    -*)
      say "error: unknown option: $1"
      usage >&2
      exit 2
      ;;
  esac

  if is_example "$1"; then
    EXAMPLE="$1"
    shift
    if [ $# -gt 0 ]; then
      TARGET="$1"
      shift
    fi
  else
    # Legacy form: the first argument is the target directory (sky-todo).
    TARGET="$1"
    shift
  fi
fi

if [ $# -gt 0 ]; then
  say "error: too many arguments. Run with --help for usage."
  exit 2
fi

SOURCE_DIR="$EXAMPLES_ROOT/$EXAMPLE"
COMMIT_MESSAGE="chore: initial $EXAMPLE"

if [ -z "$TARGET" ]; then
  TARGET="$TMP_ROOT/$EXAMPLE-$TIMESTAMP"
fi

# Make a relative target absolute before we cd anywhere.
case "$TARGET" in
  /*) ;;
  *) TARGET="$(pwd)/$TARGET" ;;
esac
# Drop a trailing slash, except for "/".
TARGET="${TARGET%/}"
[ -n "$TARGET" ] || TARGET="/"

# --- toolchain ---------------------------------------------------------------
BUN_BIN="${BUN_BIN:-}"
if [ -z "$BUN_BIN" ]; then
  BUN_BIN="$(command -v bun 2>/dev/null || true)"
fi
if [ -z "$BUN_BIN" ] && [ -x "$HOME/.bun/bin/bun" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi

# Python 3.12 or newer; 3.12 is preferred when it is installed.
PYTHON312=""
for candidate in "${PYTHON_BIN:-}" python3.12 python3; do
  [ -n "$candidate" ] || continue
  if command -v "$candidate" >/dev/null 2>&1 && \
     "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' \
       >/dev/null 2>&1; then
    PYTHON312="$candidate"
    break
  fi
done

# --- checks ------------------------------------------------------------------
if [ ! -d "$SOURCE_DIR" ]; then
  say "error: no demo target at $SOURCE_DIR"
  say "       run with --list to see the targets"
  exit 1
fi

if [ -e "$TARGET" ] && [ ! -d "$TARGET" ]; then
  say "error: $TARGET exists and is not a directory"
  exit 1
fi

if [ -d "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null || true)" ]; then
  LAST_SUBJECT="$(git -C "$TARGET" log -1 --pretty=%s 2>/dev/null || true)"
  case "$LAST_SUBJECT" in
    "chore: initial "*) ;;
    *)
      say "error: $TARGET is not empty and was not created by this script."
      say "       Refusing to delete it. Pass a new path, or remove it yourself."
      exit 1
      ;;
  esac
  say "Replacing existing demo repo at $TARGET"
  rm -rf "$TARGET"
fi

mkdir -p "$TARGET"

# --- copy (excluding answer keys, build output and caches) -------------------
# BSD tar (macOS) and GNU tar both understand --exclude with a leading ./.
(
  cd "$SOURCE_DIR"
  tar -cf - \
    --exclude='./.starling-answers' \
    --exclude='./demo-goals/*.expected.md' \
    --exclude='./node_modules' \
    --exclude='./dist' \
    --exclude='./.venv' \
    --exclude='./.git' \
    --exclude='./.DS_Store' \
    --exclude='./.pytest_cache' \
    --exclude='./.ruff_cache' \
    --exclude='./__pycache__' \
    --exclude='./*/__pycache__' \
    --exclude='./*/*/__pycache__' \
    --exclude='./*.egg-info' \
    --exclude='./src/*.egg-info' \
    --exclude='*.pyc' \
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
  git -C "$TARGET" config user.email "demo@starling.local"
  git -C "$TARGET" config user.name "Starling Demo"
fi

# --- install -----------------------------------------------------------------
skip_install() {
  [ "${DEMO_SKIP_INSTALL:-0}" = "1" ] && return 0
  case "$EXAMPLE" in
    sky-todo) [ "${SKY_TODO_SKIP_INSTALL:-0}" = "1" ] && return 0 ;;
    py-ledger) [ "${PY_LEDGER_SKIP_INSTALL:-0}" = "1" ] && return 0 ;;
  esac
  return 1
}

install_dependencies() {
  if skip_install; then
    say "Skipping dependency installation (DEMO_SKIP_INSTALL=1 or per-target variable)"
    return 0
  fi

  case "$EXAMPLE" in
    sky-todo)
      if [ -n "$BUN_BIN" ]; then
        say "Installing dependencies with $BUN_BIN"
        ( cd "$TARGET" && "$BUN_BIN" install --silent )
      else
        say "warning: bun was not found on PATH; run 'bun install' in $TARGET before the demo"
      fi
      ;;
    py-ledger)
      if [ -z "$PYTHON312" ]; then
        say "warning: Python 3.12+ was not found — skipping the virtualenv."
        say "         Install Python 3.12, then run in $TARGET:"
        say "           python3.12 -m venv .venv && .venv/bin/pip install -e '.[dev]'"
        return 0
      fi
      say "Creating .venv with $PYTHON312"
      if ! ( cd "$TARGET" && "$PYTHON312" -m venv .venv ); then
        say "warning: python -m venv failed — skipping the virtualenv."
        return 0
      fi
      say "Installing py-ledger and its dev dependencies into .venv"
      if ! ( cd "$TARGET" && ./.venv/bin/pip install --quiet --disable-pip-version-check -e '.[dev]' ); then
        say "warning: pip install failed (offline?). The repo is usable;"
        say "         install pytest in $TARGET/.venv before running Starling."
      fi
      ;;
    *)
      say "No install step for $EXAMPLE"
      ;;
  esac
}

install_dependencies

# --- one commit ---------------------------------------------------------------
git -C "$TARGET" add -A
if git -C "$TARGET" diff --cached --quiet; then
  say "Nothing to commit (target already at baseline)"
else
  git -C "$TARGET" commit -q -m "$COMMIT_MESSAGE"
fi

# --- verify: the baseline must be green --------------------------------------
if [ "${DEMO_SKIP_TESTS:-0}" = "1" ]; then
  say "Skipping the baseline test run (DEMO_SKIP_TESTS=1)"
else
  case "$EXAMPLE" in
    sky-todo)
      if [ -n "$BUN_BIN" ]; then
        say "Running the baseline tests (bun test)"
        if ! ( cd "$TARGET" && "$BUN_BIN" test >"$TARGET/.demo-test.log" 2>&1 ); then
          say "error: the baseline test suite failed. See $TARGET/.demo-test.log"
          exit 1
        fi
        grep -E '^[[:space:]]*[0-9]+ (pass|fail)' "$TARGET/.demo-test.log" >&2 || true
        rm -f "$TARGET/.demo-test.log"
      else
        say "warning: bun not found — cannot verify the baseline tests"
      fi
      ;;
    py-ledger)
      if [ -x "$TARGET/.venv/bin/python" ]; then
        say "Running the baseline tests (pytest)"
        if ! ( cd "$TARGET" && ./.venv/bin/python -m pytest >"$TARGET/.demo-test.log" 2>&1 ); then
          say "error: the baseline test suite failed. See $TARGET/.demo-test.log"
          exit 1
        fi
        grep -E '[0-9]+ (passed|failed)' "$TARGET/.demo-test.log" | tail -1 >&2 || true
        rm -f "$TARGET/.demo-test.log"
      else
        say "warning: no .venv — cannot verify the baseline tests"
      fi
      ;;
  esac

  # The log file lived inside the repo; make sure the tree is still clean.
  DIRTY="$(git -C "$TARGET" status --porcelain)"
  if [ -n "$DIRTY" ]; then
    say "warning: the demo repo has uncommitted files:"
    printf '%s\n' "$DIRTY" >&2
  fi
fi

if [ "$EXAMPLE" = "py-ledger" ] && [ -f "$TARGET/.venv/bin/activate" ]; then
  say "Activate the virtualenv before running Starling (the auditor calls 'pytest'):"
  say "  cd $TARGET && source .venv/bin/activate"
fi

printf '%s\n' "$TARGET"
