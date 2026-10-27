#!/usr/bin/env bash
# replay-demo.sh — replay the bundled sky-todo run offline, with no models.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

FIXTURE="${REPO_ROOT}/fixtures/runs/sky-todo-launch-day.jsonl"

usage() {
  cat <<'EOF'
usage: replay-demo.sh [--speed <factor>]

Replay the recorded sky-todo launch-day run inside a Starling hub/dashboard.
Makes no network calls and needs no model: use it for demos and for checking
that the dashboard works.

options:
  --speed <factor>  playback multiplier (default: 4)
  -h, --help        show this help

examples:
  replay-demo.sh
  replay-demo.sh --speed 1

exit codes: 0 ok · 2 usage or missing fixture · 127 starling not found
EOF
}

speed="4"
want_speed=0

for _arg in "$@"; do
  case "${_arg}" in
    -h | --help)
      usage
      exit 0
      ;;
  esac
done

for _arg in "$@"; do
  if [ "${want_speed}" -eq 1 ]; then
    speed="${_arg}"
    want_speed=0
    continue
  fi
  case "${_arg}" in
    --speed)
      want_speed=1
      ;;
    --speed=*)
      speed="${_arg#--speed=}"
      ;;
    *)
      printf 'error: unknown argument: %s\n' "${_arg}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "${want_speed}" -eq 1 ]; then
  printf 'error: --speed needs a factor, e.g. --speed 4\n' >&2
  exit 2
fi

if ! is_number "${speed}" || [ "${speed}" = "0" ]; then
  printf 'error: --speed must be a positive number, got %s\n' "${speed}" >&2
  exit 2
fi

if [ ! -f "${FIXTURE}" ]; then
  printf 'error: demo recording not found at %s\n' "${FIXTURE}" >&2
  printf '       Run replay-demo.sh from a Starling checkout, or use `starling replay <file>` directly.\n' >&2
  exit 2
fi

run_or_report "starling replay" replay "${FIXTURE}" --speed "${speed}"
