#!/usr/bin/env bash
# close-epic.sh: merge approved epics and tag them, in the order given.
#   bash .orchestrator/bin/close-epic.sh 00 01
# For each epic: removes its worktree (refuses if it has uncommitted work), squash-merges its PR,
# deletes the branch, pulls main, tags `epic-NN-complete` on the merge commit, and pushes the tag.
# Only run this for epics Claude has approved.
set -uo pipefail
. "$(dirname "$0")/_log.sh"   # mirror output to ~/Code/starling-wt/_logs/commands/ for Claude
cd "$(git rev-parse --show-toplevel)" || exit 1
ROOT="$(pwd)"; WT_ROOT="$(cd .. && pwd)/starling-wt"
REBASE=0
if [ "${1:-}" = "--rebase" ]; then REBASE=1; shift; fi   # rebase each branch onto latest main first; on conflicting hunks keep main's side (-X ours). Only when Claude says so.
[ $# -eq 0 ] && { echo "usage: close-epic.sh [--rebase] NN [NN...]"; exit 1; }

# keep orchestrator tooling edits from blocking pulls
if [ -n "$(git status --porcelain -- .orchestrator AGENTS.md opencode.json .gitignore)" ]; then
  git add -A -- $(ls -d .orchestrator AGENTS.md opencode.json .gitignore 2>/dev/null) && git commit -qm "chore(orchestrator): sync plan and tooling" && git push -q origin main && echo "• committed + pushed orchestrator file changes first"
fi

for nn in "$@"; do
  f="$(ls .orchestrator/prompts/wave-*/"${nn}"-*.md 2>/dev/null | grep -v '\.fix' | head -1)"
  [ -z "$f" ] && { echo "✘ $nn: no prompt file found"; continue; }
  base="$(basename "$f" .md)"; branch="epic/$base"; wt="$WT_ROOT/$base"
  pr="$(gh pr list --head "$branch" --state open --json number --jq '.[0].number')"
  [ -z "$pr" ] && { echo "✘ $nn: no open PR for $branch"; continue; }
  if [ "$REBASE" = 1 ]; then
    [ -d "$wt" ] || git worktree add -q "$wt" "$branch"
    git fetch -q origin
    if git -C "$wt" rebase -q -X ours origin/main && git -C "$wt" push -q --force-with-lease origin HEAD; then
      echo "• rebased $base onto latest main"; sleep 5
    else
      git -C "$wt" rebase --abort 2>/dev/null; echo "✘ $nn: rebase failed; skipped (tell Claude)"; continue
    fi
  fi
  if [ -d "$wt" ]; then
    git worktree remove "$wt" || { echo "✘ $nn: worktree has uncommitted changes; skipped (tell Claude)"; continue; }
  fi
  echo "🐦 merging $base (PR #$pr)…"
  gh pr merge "$pr" --squash --delete-branch || { sleep 10; gh pr merge "$pr" --squash --delete-branch; } || { echo "✘ $nn: merge failed (conflict?). Tell Claude."; continue; }
  git pull -q --ff-only origin main || { echo "✘ could not fast-forward main"; exit 1; }
  title="$(gh pr view "$pr" --json title --jq .title)"
  git tag -a "epic-${nn}-complete" -m "${title} (PR #${pr})" HEAD && git push -q origin "epic-${nn}-complete"
  echo "✅ $base merged as $(git rev-parse --short HEAD), tagged epic-${nn}-complete"
done
git worktree prune
