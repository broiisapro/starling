#!/usr/bin/env bash
# plan.sh — plan a goal with Starling. Read-only; JSON by default for agents.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<'EOF'
usage: plan.sh [--repo <path>] [--pretty] "<goal>"

Map the repo and print Starling's validated task plan (tasks, lanes, DAG,
validation issues). This writes nothing to the repository and spends nothing.

JSON is the default so an agent can parse it. --pretty leaves the CLI's human
output untouched.

options:
  --repo <path>   repository to plan against (default: current directory)
  --pretty        do not force --json
  -h, --help      show this help

examples:
  plan.sh "Add dark mode, live search, CSV export and fix the date bugs"
  plan.sh --repo ../sky-todo --pretty "Split the settings screen into tabs"

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

pretty=0
forward=()
for _arg in "$@"; do
  case "${_arg}" in
    --pretty)
      pretty=1
      ;;
    --json)
      # JSON is already the default; accept an explicit flag without duplicating it.
      ;;
    *)
      forward[${#forward[@]}]="${_arg}"
      ;;
  esac
done

if [ "${#forward[@]}" -eq 0 ]; then
  printf 'error: plan.sh needs a goal, e.g. plan.sh "Add dark mode and search"\n' >&2
  usage >&2
  exit 2
fi

if [ "${pretty}" -eq 1 ]; then
  run_or_report "starling plan" plan "${forward[@]}"
else
  run_or_report "starling plan" plan --json "${forward[@]}"
fi
