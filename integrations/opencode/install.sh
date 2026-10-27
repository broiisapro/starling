#!/usr/bin/env bash
# install.sh — install the Starling skill and the /swarm command into opencode.
#
# Idempotent: files that are already identical are reported as unchanged and
# left alone. bash 3.2 compatible.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SKILL_SRC="${REPO_ROOT}/skills/starling"
COMMAND_SRC="${SCRIPT_DIR}/commands/swarm.md"

usage() {
  cat <<'EOF'
usage: install.sh [--project | --global] [--dir <path>] [--dry-run]

Install the Starling Agent Skill and the opencode /swarm command.

  --project       install into <cwd>/.opencode (default)
  --global        install into ${XDG_CONFIG_HOME:-~/.config}/opencode
  --dir <path>    install into this config directory instead (contains
                  skills/ and commands/); relative paths resolve from cwd
  --dry-run       print what would be written, change nothing
  -h, --help      show this help

Installs:
  skills/starling/          (SKILL.md, reference/, scripts/, examples/)
  commands/swarm.md         (the /swarm <goal> command)

Re-run after editing the skill; unchanged files are left untouched.

examples:
  integrations/opencode/install.sh --project
  integrations/opencode/install.sh --global
EOF
}

scope="project"
base=""
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --project)
      if [ -n "${base}" ]; then
        printf 'error: choose one of --project, --global or --dir, not several.\n' >&2
        exit 2
      fi
      scope="project"
      shift
      ;;
    --global)
      if [ -n "${base}" ]; then
        printf 'error: choose one of --project, --global or --dir, not several.\n' >&2
        exit 2
      fi
      scope="global"
      shift
      ;;
    --dir)
      if [ "$#" -lt 2 ]; then
        printf 'error: --dir needs a path.\n' >&2
        exit 2
      fi
      base="$2"
      scope="custom"
      shift 2
      ;;
    --dir=*)
      base="${1#--dir=}"
      scope="custom"
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    *)
      printf 'error: unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ ! -f "${SKILL_SRC}/SKILL.md" ]; then
  printf 'error: skill source not found at %s\n' "${SKILL_SRC}" >&2
  printf '       Run this script from a Starling checkout (integrations/opencode/install.sh).\n' >&2
  exit 1
fi
if [ ! -f "${COMMAND_SRC}" ]; then
  printf 'error: command source not found at %s\n' "${COMMAND_SRC}" >&2
  exit 1
fi

if [ "${scope}" = "project" ]; then
  base="$(pwd)/.opencode"
elif [ "${scope}" = "global" ]; then
  if [ -z "${HOME:-}" ]; then
    printf 'error: HOME is not set; cannot install globally.\n' >&2
    exit 1
  fi
  base="${XDG_CONFIG_HOME:-${HOME}/.config}/opencode"
fi

if [ -z "${base}" ]; then
  printf 'error: empty install directory.\n' >&2
  exit 2
fi

case "${base}" in
  /*) ;;
  *) base="$(pwd)/${base}" ;;
esac
base="${base%/}"

skill_dst="${base}/skills/starling"
command_dst="${base}/commands/swarm.md"

printf 'Starling → opencode install (%s)\n' "${scope}"
printf '  source  %s\n' "${REPO_ROOT}"
printf '  base    %s\n' "${base}"
if [ "${dry_run}" -eq 1 ]; then
  printf '  dry-run; nothing will be written\n'
fi

# copy_tree <src> <dst> <label> — report unchanged / installed and file count.
copy_tree() {
  _src="$1"
  _dst="$2"
  _label="$3"
  if [ -d "${_dst}" ] && diff -rq -x '*.test.ts' -x '.DS_Store' "${_src}" "${_dst}" >/dev/null 2>&1; then
    _count="$(find "${_dst}" -type f | wc -l | tr -d ' ')"
    printf '  %-28s unchanged (%s files)\n' "${_label}" "${_count}"
    return 0
  fi
  if [ "${dry_run}" -eq 1 ]; then
    printf '  %-28s would install\n' "${_label}"
    return 0
  fi
  rm -rf "${_dst}"
  mkdir -p "$(dirname "${_dst}")"
  cp -R "${_src}" "${_dst}"
  # Tests are dev-only: keep them in the repo, out of installed skills.
  find "${_dst}" -name '*.test.ts' -delete 2>/dev/null || true
  find "${_dst}" -name '.DS_Store' -delete 2>/dev/null || true
  # Keep the wrappers executable even if the checkout lost their mode bits.
  find "${_dst}/scripts" -name '*.sh' -exec chmod +x {} + 2>/dev/null || true
  _count="$(find "${_dst}" -type f | wc -l | tr -d ' ')"
  printf '  %-28s installed (%s files)\n' "${_label}" "${_count}"
}

copy_file() {
  _src="$1"
  _dst="$2"
  _label="$3"
  if [ -f "${_dst}" ] && cmp -s "${_src}" "${_dst}"; then
    printf '  %-28s unchanged\n' "${_label}"
    return 0
  fi
  if [ "${dry_run}" -eq 1 ]; then
    printf '  %-28s would install\n' "${_label}"
    return 0
  fi
  mkdir -p "$(dirname "${_dst}")"
  cp "${_src}" "${_dst}"
  printf '  %-28s installed\n' "${_label}"
}

copy_tree "${SKILL_SRC}" "${skill_dst}" "skills/starling"
copy_file "${COMMAND_SRC}" "${command_dst}" "commands/swarm.md"

if [ "${dry_run}" -eq 1 ]; then
  printf 'Dry run complete; nothing changed.\n'
else
  printf 'Done. Reload opencode (`opencode reload`) or restart it, then run /swarm <goal>.\n'
fi
