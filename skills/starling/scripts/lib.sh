#!/usr/bin/env bash
# lib.sh — shared helpers for the Starling skill scripts. Sourced, never executed.
#
# bash 3.2 compatible (macOS default): no associative arrays, no mapfile,
# no globstar, no ${var,,}. Keep every path quoted.

# Resolve symlinks well enough for `bash path/to/script` and for an installed
# copy under .opencode/skills/starling/scripts/.
_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_ROOT="$(cd "$_LIB_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_ROOT/../.." && pwd)"

# find_bun — print a Bun executable, or fail quietly.
find_bun() {
  if [ -n "${BUN_BIN:-}" ] && [ -x "${BUN_BIN}" ]; then
    printf '%s\n' "${BUN_BIN}"
    return 0
  fi
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi
  if [ -n "${HOME:-}" ] && [ -x "${HOME}/.bun/bin/bun" ]; then
    printf '%s\n' "${HOME}/.bun/bin/bun"
    return 0
  fi
  return 1
}

# resolve_starling — set STARLING_MODE / STARLING_BIN_PATH / STARLING_SCRIPT.
# Order: $STARLING_BIN, PATH, this checkout with bun, bunx starling.
resolve_starling() {
  STARLING_MODE=""
  STARLING_BIN_PATH=""
  STARLING_SCRIPT=""

  if [ -n "${STARLING_BIN:-}" ]; then
    if [ ! -x "${STARLING_BIN}" ]; then
      printf 'error: STARLING_BIN is set to %s but is not executable\n' "${STARLING_BIN}" >&2
      printf '       hint: point it at the starling binary, or unset it to use PATH / bunx.\n' >&2
      exit 127
    fi
    STARLING_MODE="exe"
    STARLING_BIN_PATH="${STARLING_BIN}"
    return 0
  fi

  if command -v starling >/dev/null 2>&1; then
    STARLING_MODE="exe"
    STARLING_BIN_PATH="$(command -v starling)"
    return 0
  fi

  if [ -f "${REPO_ROOT}/apps/cli/src/index.ts" ]; then
    if _bun="$(find_bun)"; then
      STARLING_MODE="bun"
      STARLING_BIN_PATH="${_bun}"
      STARLING_SCRIPT="${REPO_ROOT}/apps/cli/src/index.ts"
      return 0
    fi
  fi

  if command -v bunx >/dev/null 2>&1; then
    STARLING_MODE="bunx"
    STARLING_BIN_PATH="$(command -v bunx)"
    return 0
  fi

  if _bun="$(find_bun)"; then
    STARLING_MODE="bunx"
    STARLING_BIN_PATH="${_bun}"
    return 0
  fi

  printf 'error: starling not found.\n' >&2
  printf '       Looked for: $STARLING_BIN, `starling` on PATH, %s/apps/cli/src/index.ts (with bun),\n' "${REPO_ROOT}" >&2
  printf '       and `bunx starling`.\n' >&2
  printf '       Install Starling or run from a checkout; see %s/reference/troubleshooting.md\n' "${SKILL_ROOT}" >&2
  exit 127
}

# run_starling <starling args...>
run_starling() {
  if [ -z "${STARLING_MODE:-}" ]; then
    resolve_starling
  fi
  case "${STARLING_MODE}" in
    exe)
      "${STARLING_BIN_PATH}" "$@"
      ;;
    bun)
      "${STARLING_BIN_PATH}" "${STARLING_SCRIPT}" "$@"
      ;;
    bunx)
      case "$(basename "${STARLING_BIN_PATH}")" in
        bunx) "${STARLING_BIN_PATH}" starling "$@" ;;
        *) "${STARLING_BIN_PATH}" x starling "$@" ;;
      esac
      ;;
    *)
      printf 'error: internal: unknown starling mode %s\n' "${STARLING_MODE}" >&2
      exit 1
      ;;
  esac
}

# run_or_report <label> <starling args...> — forward the CLI exit code with a hint.
run_or_report() {
  _label="$1"
  shift
  _rc=0
  run_starling "$@" || _rc=$?
  if [ "${_rc}" -ne 0 ]; then
    printf 'error: %s failed (exit %s).\n' "${_label}" "${_rc}" >&2
    printf '       Run with --help, or see reference/troubleshooting.md for exit codes.\n' >&2
    exit "${_rc}"
  fi
}

# config_budget <repo-dir> — print budget.maxUsd from starling.config.yaml, or nothing.
config_budget() {
  _cfg="$1/starling.config.yaml"
  if [ ! -f "${_cfg}" ]; then
    return 0
  fi
  awk '
    /^[[:space:]]*budget:[[:space:]]*$/ { in_budget = 1; next }
    in_budget && /^[^[:space:]#]/ { in_budget = 0 }
    in_budget && /^[[:space:]]+maxUsd:[[:space:]]*/ {
      value = $0
      sub(/^[^:]*:[[:space:]]*/, "", value)
      sub(/[[:space:]]*#.*$/, "", value)
      gsub(/["\047]/, "", value)
      print value
      exit
    }
  ' "${_cfg}"
}

# is_number <value> — integer or decimal, no sign.
is_number() {
  case "$1" in
    '' | *[!0-9.]* | *.*.* | . | *.) return 1 ;;
    *) return 0 ;;
  esac
}
