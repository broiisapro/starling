#!/usr/bin/env bash
# heavy.sh <command...> — run a heavy command (full test suite, typecheck, web build, Playwright) only when one of
# N machine-wide slots is free, so ~100 parallel agents don't all run `bun run test` at the same moment.
#
#   bash .orchestrator/bin/heavy.sh bun run test
#   bash .orchestrator/bin/heavy.sh bun run check
#
# Env: ORCH_HEAVY_SLOTS (default 10) · ORCH_LOCKS (default ~/Code/starling-wt/_locks)
# Stale slots (owner process gone) are reclaimed automatically. Bash 3.2 compatible.
SLOTS="${ORCH_HEAVY_SLOTS:-10}"
LOCKS="${ORCH_LOCKS:-$HOME/Code/starling-wt/_locks}"
mkdir -p "$LOCKS"
[ $# -eq 0 ] && { sed -n '2,10p' "$0"; exit 2; }
waited=0
while :; do
  i=1
  while [ "$i" -le "$SLOTS" ]; do
    d="$LOCKS/slot-$i"
    if mkdir "$d" 2>/dev/null; then
      echo $$ > "$d/pid"
      trap 'rm -rf "$d"' EXIT INT TERM
      [ "$waited" -gt 0 ] && echo "heavy.sh: got slot $i after ${waited}s" >&2
      "$@"
      exit $?
    fi
    p="$(cat "$d/pid" 2>/dev/null)"
    if [ -n "$p" ] && ! kill -0 "$p" 2>/dev/null; then rm -rf "$d"; continue; fi
    i=$((i+1))
  done
  [ "$waited" = 0 ] && echo "heavy.sh: all $SLOTS heavy slots busy (other agents are running their suites); waiting…" >&2
  sleep 10; waited=$((waited+10))
  if [ "$waited" -ge 600 ]; then echo "heavy.sh: waited 10 min, running anyway" >&2; "$@"; exit $?; fi
done
