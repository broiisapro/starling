#!/usr/bin/env bash
# watch-wave.sh — live scoreboard for a wave. Run it in a spare Terminal tab and leave it open.
#   bash .orchestrator/bin/watch-wave.sh <wave> [--every 20]
# Shows, per epic: agent alive?, commits so far, last commit, uncommitted files, PR status.
# Pops a macOS notification (with a chirp) when an agent opens its PR, and when the whole wave is ready.
set -uo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
WT_ROOT="$(cd "$REPO_ROOT/.." && pwd)/starling-wt"
WAVE="${1:-}"; shift || true
EVERY=20
while [ $# -gt 0 ]; do case "$1" in --every) EVERY="$2"; shift 2;; *) shift;; esac; done
[ -z "$WAVE" ] && { echo "usage: watch-wave.sh <wave> [--every 20]"; exit 1; }
DIR="$REPO_ROOT/.orchestrator/prompts/wave-${WAVE}"
SEEN="$WT_ROOT/_logs/.seen-prs-w${WAVE}"; mkdir -p "$WT_ROOT/_logs"; touch "$SEEN"

notify() { osascript -e "display notification \"$2\" with title \"🐦 Starling\" subtitle \"$1\" sound name \"Glass\"" >/dev/null 2>&1 || true; }
ago() { local s=$(( $(date +%s) - $1 )); if [ $s -lt 90 ]; then echo "${s}s"; elif [ $s -lt 5400 ]; then echo "$((s/60))m"; else echo "$((s/3600))h"; fi; }

while true; do
  PRS="$(gh pr list --state all --limit 200 --json headRefName,number,state,url \
          --jq '.[] | "\(.headRefName)\t\(.number)\t\(.state)\t\(.url)"' 2>/dev/null || true)"
  clear
  printf "🐦 Wave %s · %s · refresh %ss · Ctrl-C to quit\n\n" "$WAVE" "$(date '+%H:%M:%S')" "$EVERY"
  printf "%-24s %-9s %-7s %-6s %-44s %s\n" "EPIC" "AGENT" "COMMITS" "DIRTY" "LAST COMMIT" "PR"
  printf "%-24s %-9s %-7s %-6s %-44s %s\n" "────" "─────" "───────" "─────" "───────────" "──"
  total=0; withpr=0
  for f in "$DIR"/[0-9][0-9]-*.md; do
    base="$(basename "$f" .md)"; case "$base" in *.fix*) continue;; esac
    total=$((total+1)); wt="$WT_ROOT/$base"; branch="epic/$base"
    if pgrep -f "_logs/run-${base}.sh" >/dev/null 2>&1; then alive="🟢 working"; else alive="⚪ idle"; fi
    commits="-"; dirty="-"; last="(no worktree)"
    if [ -d "$wt" ]; then
      commits="$(git -C "$wt" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
      dirty="$(git -C "$wt" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
      if [ "$commits" != 0 ]; then
        last="$(git -C "$wt" log -1 --format='%s' | cut -c1-34) ($(ago "$(git -C "$wt" log -1 --format=%ct)"))"
      else last="(none yet)"; fi
    fi
    pr="$(echo "$PRS" | awk -F'\t' -v b="$branch" '$1==b {print "#"$2" "$3; exit}')"
    url="$(echo "$PRS" | awk -F'\t' -v b="$branch" '$1==b {print $4; exit}')"
    if [ -n "$pr" ]; then
      withpr=$((withpr+1)); pr="✅ $pr"
      grep -qx "$branch" "$SEEN" || { echo "$branch" >> "$SEEN"; notify "Epic ${base%%-*} opened its PR" "$url"; }
    else pr="…"; fi
    printf "%-24s %-9s %-7s %-6s %-44s %s\n" "$base" "$alive" "$commits" "$dirty" "$last" "$pr"
    log="$WT_ROOT/_logs/${base}.log"
    if [ -f "$log" ] && [ -z "${url:-}" ]; then   # still in flight → show what it's doing right now
      act="$(tail -c 4000 "$log" | sed $'s/\x1b\\[[0-9;?]*[A-Za-z]//g' | tr -d '\r' | grep -v '^[[:space:]]*$' | tail -1 | cut -c1-110)"
      printf "   %s↳ %s (log %s ago)\n" "" "$act" "$(ago "$(stat -f %m "$log" 2>/dev/null || date +%s)")"
    fi
  done
  echo
  if [ "$total" -gt 0 ] && [ "$withpr" = "$total" ]; then
    echo "✨ Every epic in wave $WAVE has a PR. Tell Claude: \"Wave $WAVE PRs are up\"."
    grep -qx "ALL" "$SEEN" || { echo ALL >> "$SEEN"; notify "Wave $WAVE ready for review" "All $total PRs are open. Tell Claude!"; }
  else
    echo "$withpr / $total PRs open. 🟢 = agent process still running · DIRTY = files changed but not committed yet"
  fi
  sleep "$EVERY"
done
