#!/usr/bin/env bash
# status.sh — print the status of one Starling run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<'EOF'
usage: status.sh [runId]

Show a run's tasks, statuses, verdicts and metrics. With no runId, Starling
shows the most recent run.

options:
  -h, --help   show this help

examples:
  status.sh
  status.sh 01J8Z3K4M5N6P7Q8R9S0T1V2W3

exit codes: 0 ok · 2 usage · 127 starling not found · other: CLI failure
EOF
}

for _arg in "$@"; do
  case "${_arg}" in
    -h | --help)
      usage
      exit 0
      ;;
  esac
done

run_or_report "starling status" status "$@"
