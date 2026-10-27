#!/usr/bin/env bash
# stop-agents.sh: stop headless agents.   stop-agents.sh          → stop ALL running agents
#                                         stop-agents.sh 02 15    → stop only those epics
# macOS-safe (BSD pgrep has no -E, so we filter `ps` output instead).
set -u
. "$(dirname "$0")/_log.sh"   # mirror output to ~/Code/starling-wt/_logs/commands/ for Claude
if [ $# -eq 0 ]; then pat='_logs/run-[0-9a-z]'; else pat="_logs/run-($(echo "$@" | tr ' ' '|'))-"; fi
pids="$(ps -axo pid=,command= | grep -E "$pat" | grep -v -E 'grep|stop-agents' | awk '{print $1}')"
[ -z "$pids" ] && { echo "no matching agents running"; exit 0; }
for p in $pids; do
  echo "  stopping $(ps -o command= -p "$p" | cut -c1-110)"
  for c in $(pgrep -P "$p"); do pkill -TERM -P "$c" 2>/dev/null; kill -TERM "$c" 2>/dev/null; done
  kill -TERM "$p" 2>/dev/null
done
sleep 3
left="$(ps -axo pid=,command= | grep -E "$pat" | grep -v -E 'grep|stop-agents' | awk '{print $1}')"
[ -n "$left" ] && { echo "  force-killing leftovers: $left"; for p in $left; do pkill -KILL -P "$p" 2>/dev/null; kill -KILL "$p" 2>/dev/null; done; }
echo "done. Worktrees and commits are untouched; relaunch with spawn-wave.sh (fresh) or --resume (fix prompt)."
