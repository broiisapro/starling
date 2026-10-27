#!/usr/bin/env bash
#
# teardown.sh — put the GitHub sandbox back to a clean slate.
#
#   bash tools/github-sandbox/teardown.sh
#
# Closes every Starling issue and PR in `<owner>/starling-sandbox` and deletes every `starling/*`
# branch (local and remote). It NEVER deletes the repo itself, its labels, or `main`.
#
# Env:
#   STARLING_SANDBOX_OWNER  owner login (default: the active `gh` account)
#   STARLING_SANDBOX_NAME   repo name     (default: starling-sandbox)
#   STARLING_SANDBOX_DIR    local clone used to delete branches (default: omitted = API only)
#
# Safe to re-run: an already-clean sandbox is a no-op. bash 3.2 compatible.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
say() { printf '%s\n' "$*" >&2; }

command -v gh >/dev/null 2>&1 || { say "error: gh is not installed"; exit 1; }
gh auth status >/dev/null 2>&1 || { say "error: gh is not authenticated; run 'gh auth login'"; exit 1; }

OWNER="${STARLING_SANDBOX_OWNER:-$(gh api user --jq .login)}"
NAME="${STARLING_SANDBOX_NAME:-starling-sandbox}"
REPO="$OWNER/$NAME"

if ! gh repo view "$REPO" --json name >/dev/null 2>&1; then
  say "Nothing to tear down: $REPO does not exist (teardown never creates or deletes repos)"
  exit 0
fi

failures=0

# ── PRs ───────────────────────────────────────────────────────────────────────
# `gh pr list --json` has no body filter, so ask for body + head ref and match the Starling
# marker or the `starling/` branch prefix locally.
prs="$(gh pr list --repo "$REPO" --state open --limit 200 --json number,headRefName,body \
  --jq '.[] | select(.headRefName | startswith("starling/")) | .number')"
for number in $prs; do
  if gh pr close "$number" --repo "$REPO" --comment "Sandbox teardown (Epic 43). 🐦" >/dev/null 2>&1; then
    say "Closed PR #$number"
  else
    say "warning: could not close PR #$number"
    failures=$((failures + 1))
  fi
done
# PRs from a task branch that was renamed out of the `starling/` namespace still carry the marker.
marked="$(gh pr list --repo "$REPO" --state open --limit 200 --json number,body \
  --jq '.[] | select(.body | contains("<!-- starling:")) | .number')"
for number in $marked; do
  case " $prs " in *" $number "*) continue ;; esac
  if gh pr close "$number" --repo "$REPO" --comment "Sandbox teardown (Epic 43). 🐦" >/dev/null 2>&1; then
    say "Closed PR #$number"
  else
    say "warning: could not close PR #$number"
    failures=$((failures + 1))
  fi
done

# ── issues ────────────────────────────────────────────────────────────────────
issues="$(gh issue list --repo "$REPO" --state open --label starling --limit 500 --json number --jq '.[].number')"
for number in $issues; do
  if gh issue close "$number" --repo "$REPO" --comment "Sandbox teardown (Epic 43). 🐦" >/dev/null 2>&1; then
    say "Closed issue #$number"
  else
    say "warning: could not close issue #$number"
    failures=$((failures + 1))
  fi
done
# An issue created before the `starling` label existed (or by an older tracker) still carries the
# hidden marker in its body, so close those too.
untagged="$(gh issue list --repo "$REPO" --state open --limit 500 --json number,body \
  --jq '.[] | select(.body | contains("<!-- starling:")) | .number')"
for number in $untagged; do
  case " $issues " in *" $number "*) continue ;; esac
  if gh issue close "$number" --repo "$REPO" --comment "Sandbox teardown (Epic 43). 🐦" >/dev/null 2>&1; then
    say "Closed issue #$number"
  else
    say "warning: could not close issue #$number"
    failures=$((failures + 1))
  fi
done

# ── branches ──────────────────────────────────────────────────────────────────
# `gh api` with an explicit paginator keeps this independent of any local clone.
remote_branches="$(gh api --paginate "repos/$REPO/branches?per_page=100" --jq '.[].name' 2>/dev/null \
  | grep '^starling/' || true)"
for branch in $remote_branches; do
  if gh api -X DELETE "repos/$REPO/git/refs/heads/$branch" >/dev/null 2>&1; then
    say "Deleted branch $branch"
  else
    say "warning: could not delete branch $branch"
    failures=$((failures + 1))
  fi
done

if [ -n "${STARLING_SANDBOX_DIR:-}" ] && [ -d "$STARLING_SANDBOX_DIR/.git" ]; then
  for branch in $(git -C "$STARLING_SANDBOX_DIR" for-each-ref --format='%(refname:short)' refs/heads \
    | grep '^starling/' || true); do
    git -C "$STARLING_SANDBOX_DIR" branch -D "$branch" >/dev/null 2>&1 || true
  done
fi

if [ "$failures" -ne 0 ]; then
  say "Teardown finished with $failures warning(s); the repo was not deleted."
  exit 1
fi
say "Sandbox clean: $REPO (repo kept)"
