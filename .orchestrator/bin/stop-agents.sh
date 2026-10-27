#!/usr/bin/env bash
# stop-agents.sh: stop headless agents.   stop-agents.sh          → stop ALL running agents
#                                         stop-agents.sh 02 15    → stop only those epics
set -u
if [ $# -eq 0 ]; then pat="_logs/run-"; else pat="_logs/run-($(echo "$@" | tr ' ' '|'))-"; fi
pids="$(pgrep -f -E "$pat" || true)"
[ -z "$pids" ] && { echo "no matching agents running"; exit 0; }
ps -o pid=,command= -p $(echo $pids | tr ' ' ',') | sed 's/^/  stopping /' | cut -c1-120
for p in $pids; do pkill -TERM -P "$p" 2>/dev/null; kill -TERM "$p" 2>/dev/null; done
sleep 2; echo "done. Their worktrees and commits are untouched; relaunch with spawn-wave.sh (fresh) or --resume (fix prompt)."
