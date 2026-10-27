#!/usr/bin/env bash
# run.sh — launch the flock, but only with a budget the human has accepted.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "${SCRIPT_DIR}/lib.sh"

usage() {
  cat <<'EOF'
usage: run.sh [--dry-run] [--budget <usd>] [--yes] [starling run flags] "<goal>"

Plan and run a goal through Starling. Every flag except --budget and --yes is
passed straight to `starling run`, so --repo, --max-parallel, --github,
--fully-open, --record and --no-dash all work.

Safety preflight (skipped by --dry-run):
  - reads budget.maxUsd from <repo>/starling.config.yaml
  - refuses to launch when no budget is configured, unless --yes is given
  - with --budget <usd>, also refuses when the configured budget is higher

options:
  --dry-run        plan only; launch no agents and spend nothing
  --budget <usd>   entry cap; must not exceed the configured budget.maxUsd
  --yes            accept a missing budget (never for unattended runs)
  -h, --help       show this help

examples:
  run.sh --dry-run --repo ../sky-todo "Add dark mode, search, CSV export"
  run.sh --repo ../sky-todo --record .starling/run.jsonl "Add dark mode and search"

exit codes: 0 ok · 2 usage or preflight refusal · 127 starling not found
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

dry_run=0
assume_yes=0
requested_budget=""
want_budget=0
forward=()

repo_dir="."
_prev=""
for _arg in "$@"; do
  case "${_prev}" in
    --repo) repo_dir="${_arg}" ;;
  esac
  case "${_arg}" in
    --repo=*) repo_dir="${_arg#--repo=}" ;;
  esac
  _prev="${_arg}"
done

for _arg in "$@"; do
  if [ "${want_budget}" -eq 1 ]; then
    requested_budget="${_arg}"
    want_budget=0
    continue
  fi
  case "${_arg}" in
    --budget)
      want_budget=1
      ;;
    --budget=*)
      requested_budget="${_arg#--budget=}"
      ;;
    --yes)
      assume_yes=1
      ;;
    --dry-run)
      dry_run=1
      forward[${#forward[@]}]="${_arg}"
      ;;
    *)
      forward[${#forward[@]}]="${_arg}"
      ;;
  esac
done

if [ "${want_budget}" -eq 1 ]; then
  printf 'error: --budget needs a value, e.g. --budget 2.50\n' >&2
  exit 2
fi

if [ -n "${requested_budget}" ] && ! is_number "${requested_budget}"; then
  printf 'error: --budget must be a number in USD, got %s\n' "${requested_budget}" >&2
  exit 2
fi

if [ "${#forward[@]}" -eq 0 ]; then
  printf 'error: run.sh needs a goal, e.g. run.sh "Add dark mode and search"\n' >&2
  usage >&2
  exit 2
fi

# Count a real goal, not flags or the values of flags. `--repo .` alone is usage.
positional=0
skip_value=0
for _arg in "${forward[@]}"; do
  if [ "${skip_value}" -eq 1 ]; then
    skip_value=0
    continue
  fi
  case "${_arg}" in
    --repo | --max-parallel | --record)
      skip_value=1
      ;;
    -*)
      ;;
    *)
      positional=$((positional + 1))
      ;;
  esac
done

if [ "${positional}" -eq 0 ]; then
  printf 'error: run.sh needs a goal, e.g. run.sh "Add dark mode and search"\n' >&2
  usage >&2
  exit 2
fi

if [ "${dry_run}" -eq 0 ]; then
  configured_budget="$(config_budget "${repo_dir}")"
  if [ -z "${configured_budget}" ] || ! is_number "${configured_budget}"; then
    if [ "${assume_yes}" -eq 1 ]; then
      printf 'warning: no budget.maxUsd in %s/starling.config.yaml; proceeding because --yes.\n' "${repo_dir}" >&2
    else
      printf 'error: refusing to launch without a budget.\n' >&2
      printf '       Add budget.maxUsd to %s/starling.config.yaml:\n\n' "${repo_dir}" >&2
      printf '         budget:\n           maxUsd: 5\n\n' >&2
      printf '       ...or run with --dry-run (free), or --yes to accept the CLI default.\n' >&2
      exit 2
    fi
  elif [ -n "${requested_budget}" ]; then
    if awk "BEGIN { exit !(${configured_budget} > ${requested_budget}) }"; then
      printf 'error: configured budget.maxUsd is %s but --budget caps the run at %s.\n' \
        "${configured_budget}" "${requested_budget}" >&2
      printf '       Lower budget.maxUsd in starling.config.yaml, or raise --budget.\n' >&2
      exit 2
    fi
  fi
fi

run_or_report "starling run" run "${forward[@]}"
