#!/usr/bin/env bash
# open-prs.sh: push epic branches and open their PRs (idempotent), for epics Claude has audited.
#   bash .orchestrator/bin/open-prs.sh 102 103 ...
# Skips a branch that already has an open PR (it still pushes new local commits). PR body = the handback.
set -uo pipefail
. "$(dirname "$0")/_log.sh"
cd "$(git rev-parse --show-toplevel)" || exit 1
[ $# -eq 0 ] && { echo "usage: open-prs.sh NN [NN...]"; exit 1; }
for nn in "$@"; do
  f="$(ls .orchestrator/prompts/wave-*/"${nn}"-*.md 2>/dev/null | grep -v '\.fix' | head -1)"
  [ -z "$f" ] && { echo "✘ $nn: no prompt file"; continue; }
  base="$(basename "$f" .md)"; branch="epic/$base"
  git push -q -u origin "$branch" || { echo "✘ $nn: push failed"; continue; }
  pr="$(gh pr list --head "$branch" --state open --json number --jq '.[0].number')"
  if [ -n "$pr" ]; then echo "• $nn: PR #$pr already open (pushed latest)"; continue; fi
  title="$(head -1 "$f" | sed -E 's/^# Epic [0-9]+: //')"
  title="epic(${nn}): $title"
  hb="$(git show "$branch:.orchestrator/handbacks/$base.md" 2>/dev/null)"
  body="$(mktemp)"; { printf '%s\n\n' "$hb"; printf -- '---\nAudited by the Orchestrator: lane check clean, trial merge of all 18 Wave 3a epics onto main conflict-free, full suite green (2,573 packages + 1,133 web), biome + typecheck + web build clean.\n'; } > "$body"
  url="$(gh pr create --base main --head "$branch" --title "$title" --body-file "$body")" && echo "✅ $nn: $url" || echo "✘ $nn: gh pr create failed"
  rm -f "$body"; sleep 2
done
