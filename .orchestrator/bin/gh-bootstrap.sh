#!/usr/bin/env bash
# gh-bootstrap.sh — set up the GitHub side of the Starling swarm build.
#
#   .orchestrator/bin/gh-bootstrap.sh [--repo OWNER/NAME] [--dry-run] [--quiet] [--refresh]
#
# Idempotent: safe to re-run any time the Orchestrator adds epics to
# .orchestrator/epics.tsv. Nothing is duplicated; existing labels are updated in
# place, existing milestones are left alone, and an issue whose title already
# exists is skipped (never edited) and only recorded.
#
# --refresh additionally rewrites the *body* of issues that already exist, so a
#           formatting fix in this script can be rolled out to the whole sheet
#           without touching issue numbers. Off by default.
#
# What it does, in order:
#   1. labels     — epic, wave-0…3, machine:mbp|air, checkpoint, contract-request,
#                   bug, hacktoberfest, good first issue, lane:<top-level path>
#   2. milestones — Wave 0 … Wave 3
#   3. issues     — one per row of .orchestrator/epics.tsv, titled "Epic NN: <title>"
#   4. index      — .orchestrator/issues.tsv (nn<TAB>number<TAB>url, sorted by nn)
#   5. settings   — description, topics, squash-merge only, delete branch on merge
#
# Bash 3.2 compatible (macOS ships 3.2): no associative arrays, no ${var,,},
# no mapfile. Requires an authenticated `gh` (gh auth status) with admin on the repo.
set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || exit 1

EPICS_TSV=".orchestrator/epics.tsv"
ISSUES_TSV=".orchestrator/issues.tsv"
REPO=""
DRY=0
QUIET=0
REFRESH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --quiet) QUIET=1; shift ;;
    --refresh) REFRESH=1; shift ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1 (try --help)" >&2; exit 2 ;;
  esac
done

# ── output helpers ────────────────────────────────────────────────────
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; Z=$'\033[0m'
else
  B=""; DIM=""; G=""; Y=""; R=""; C=""; Z=""
fi
step() { printf '\n%s▶ %s%s\n' "$B$C" "$1" "$Z"; }
ok()   { [ "$QUIET" = 1 ] || printf '  %s✔%s %s\n' "$G" "$Z" "$1"; }
skip() { [ "$QUIET" = 1 ] || printf '  %s·%s %s\n' "$DIM" "$Z" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$Z" "$1" >&2; }
die()  { printf '\n%s✘ %s%s\n' "$R" "$1" "$Z" >&2; exit 1; }

FAILED=0
fail() { warn "$1"; FAILED=$((FAILED + 1)); }

run() { # run a command, honouring --dry-run
  if [ "$DRY" = 1 ]; then
    printf '  %s[dry] %s%s\n' "$DIM" "$*" "$Z"
    return 0
  fi
  "$@"
}

# ── 0. preflight ──────────────────────────────────────────────────────
[ -f "$EPICS_TSV" ] || die "missing $EPICS_TSV (run from the repo root)"
command -v gh >/dev/null 2>&1 || die "gh is not installed (brew install gh)"

step "0/5 Preflight"
gh auth status >/dev/null 2>&1 || die "gh is not authenticated. Run 'gh auth login' first."
if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null)"
  [ -n "$REPO" ] || die "cannot resolve the repo. Pass --repo OWNER/NAME."
fi
GH_LOGIN="$(gh api user --jq .login 2>/dev/null || echo '?')"
ok "gh authenticated as ${B}${GH_LOGIN}${Z}, target repo ${B}${REPO}${Z}"
[ "$DRY" = 1 ] && warn "dry run: nothing will be written to GitHub"
[ -s "$ISSUES_TSV" ] && ok "found a previous $(basename "$ISSUES_TSV") ($(grep -c . "$ISSUES_TSV" 2>/dev/null || echo 0) rows) — will be rebuilt"

# ── lane keys ─────────────────────────────────────────────────────────
# "packages/core, fixtures" → "packages fixtures"
# A top-level lane is the first path segment of each comma-separated glob.
# Free-text extras in the sheet ("per sheet", "agents", "GitHub") are not
# paths and are dropped; root-level files (README.md, CHANGELOG.md) fold to
# "root" and ".github/" becomes "github" so the label set stays small.
lane_keys() {
  echo "$1" | tr ',' '\n' | while IFS= read -r raw; do
    tok="$(echo "$raw" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    [ -z "$tok" ] && continue
    case "$tok" in
      */) key="$(echo "$tok" | cut -d/ -f1 | sed -e 's/^\.//')" ;;
      .github|.github/*) key=github ;;
      */*) key="$(echo "$tok" | cut -d/ -f1 | sed -e 's/^\.//')" ;;
      root|README.md|CHANGELOG.md|LICENSE|AGENTS.md) key=root ;;
      *) key="" ;;
    esac
    # A bare word that happens to be a real top-level dir ("fixtures") counts too.
    if [ -z "$key" ]; then
      case " apps docs evals examples fixtures integrations packages skills tools " in
        *" $tok "*) key="$tok" ;;
      esac
    fi
    [ -n "$key" ] && echo "$key"
  done | sort -u | tr '\n' ' '
}

# Every distinct top-level lane in the sheet, sorted.
ALL_LANES=""
while IFS=$'\t' read -r nn slug title wave machine lane depends; do
  [ "$nn" = "nn" ] && continue
  [ -z "$nn" ] && continue
  ALL_LANES="$ALL_LANES $(lane_keys "$lane")"
done < "$EPICS_TSV"
ALL_LANES="$(echo "$ALL_LANES" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ')"
[ -n "$ALL_LANES" ] || die "no lanes derived from $EPICS_TSV"
ok "lanes: $(echo "$ALL_LANES" | tr ' ' '\n' | grep -c .) top-level labels"

# ── 1. labels ─────────────────────────────────────────────────────────
step "1/5 Labels (create or update colour + description)"
LABELS='epic|5319E7|One epic = one branch = one worktree = one PR
wave-0|0E8A16|Wave 0 — foundation: contracts, repo ops, demo target
wave-1|1D76DB|Wave 1 — the product, ~23 epics in parallel lanes
wave-2|FBCA04|Wave 2 — integration, e2e, polish
wave-3|B60205|Wave 3 — release, docs, bug bash
machine:mbp|C5DEF5|Assigned to the MacBook Pro M5 Pro (32 GB)
machine:air|D4C5F9|Assigned to the MacBook Air M2 (16 GB)
checkpoint|F9D0C4|Integrator checkpoint: merge, test, tag
contract-request|BFDADC|Needs a change to frozen contracts, ports or root config
bug|D73A4A|Something is not working
hacktoberfest|FF7518|Hacktoberfest 2026
good first issue|7057FF|Good for newcomers — seeded in Epic 67'

for lane in $ALL_LANES; do
  LABELS="$LABELS
lane:${lane}|D8E2F0|Lane label: this epic may only write inside its own top-level path"
done

CREATED_L=0; UPDATED_L=0
while IFS='|' read -r lname lcolor ldesc; do
  [ -z "$lname" ] && continue
  if [ "$DRY" = 1 ]; then
    run gh label create "$lname" --color "$lcolor" --description "$ldesc" --force
    continue
  fi
  existed="$(gh label list --search "$lname" --json name --jq ".[] | select(.name == \"$lname\") | .name" 2>/dev/null)"
  if gh label create "$lname" --color "$lcolor" --description "$ldesc" --force >/dev/null 2>&1; then
    if [ -n "$existed" ]; then UPDATED_L=$((UPDATED_L + 1)); else CREATED_L=$((CREATED_L + 1)); fi
  else
    fail "label '$lname'"
  fi
done <<EOF
$LABELS
EOF
ok "labels: ${CREATED_L} created, ${UPDATED_L} updated in place, $(echo "$LABELS" | grep -c .) total"

# ── 2. milestones ─────────────────────────────────────────────────────
step "2/5 Milestones (Wave 0 … Wave 3)"
EXISTING_MS=""
if [ "$DRY" = 0 ]; then
  EXISTING_MS="$(gh api "repos/${REPO}/milestones?state=all&per_page=100" --jq '.[].title' 2>/dev/null)"
fi
MS_CREATED=0
for w in 0 1 2 3; do
  mtitle="Wave ${w}"
  if echo "$EXISTING_MS" | grep -Fxq "$mtitle"; then
    skip "milestone '${mtitle}' already exists"
    continue
  fi
  if run gh api "repos/${REPO}/milestones" -f title="$mtitle" -f state=open --jq .title >/dev/null 2>&1; then
    MS_CREATED=$((MS_CREATED + 1))
  else
    fail "milestone '${mtitle}'"
  fi
done
ok "milestones: ${MS_CREATED} created"

# ── 3. issues ─────────────────────────────────────────────────────────
step "3/5 Issues (one per row of ${EPICS_TSV})"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/starling-gh.XXXXXX")" || die "mktemp failed"
trap 'rm -rf "$TMP"' EXIT

# Seed the key→number index from a previous run so depends-on links resolve.
: > "$TMP/index.tsv"
if [ -s "$ISSUES_TSV" ]; then
  awk -F'\t' 'NF>=2 && $1 != "nn" {print $1"\t"$2}' "$ISSUES_TSV" >> "$TMP/index.tsv"
fi

# Snapshot every existing issue so we can find numbers for skipped ones.
: > "$TMP/existing.tsv"
if [ "$DRY" = 0 ]; then
  gh issue list --state all --limit 1000 --json number,title,url \
    --jq '.[] | "\(.number)\t\(.title)\t\(.url)"' > "$TMP/existing.tsv" 2>/dev/null || true
fi

CREATED_I=0; SKIPPED_I=0; REFRESHED_I=0
: > "$TMP/rows.tsv"

dep_label() { # "00,02,C1" → "#12, #14, checkpoint C1"
  out=""
  if [ -z "$1" ] || [ "$1" = "-" ]; then echo "—"; return; fi
  for d in $(echo "$1" | tr ',' ' '); do
    if [ -z "$d" ] || [ "$d" = "-" ]; then continue; fi
    case "$d" in
      C1|C2) item="checkpoint ${d}" ;;
      *)
        num="$(awk -F'\t' -v k="$d" '$1 == k {print $2; exit}' "$TMP/index.tsv")"
        if [ -n "$num" ]; then item="#${num}"; else item="epic ${d}"; fi
        ;;
    esac
    if [ -z "$out" ]; then out="$item"; else out="$out, $item"; fi
  done
  [ -z "$out" ] && out="—"
  echo "$out"
}

while IFS=$'\t' read -r nn slug title wave machine lane depends; do
  [ "$nn" = "nn" ] && continue
  [ -z "$nn" ] && continue
  full_title="Epic ${nn}: ${title}"
  prompt=".orchestrator/prompts/wave-${wave}/${nn}-${slug}.md"
  if [ -f "$prompt" ]; then
    prompt_state="written"
    prompt_line="\`${prompt}\`"
  else
    prompt_state="pending"
    prompt_line="\`${prompt}\` — prompt written when the wave is scheduled"
  fi
  branch="epic/${nn}-${slug}"
  keys="$(lane_keys "$lane")"

  body="$TMP/body-${nn}.md"
  {
    echo "**Epic ${nn} · wave ${wave} · ${title}**"
    echo
    echo "| field | value |"
    echo "|---|---|"
    echo "| lane | \`${lane}\` |"
    echo "| machine | \`${machine}\` |"
    echo "| depends on | $(dep_label "$depends") |"
    echo "| prompt | ${prompt_line} |"
    echo "| branch | \`${branch}\` |"
    echo "| worktree | \`../starling-wt/${nn}-${slug}\` |"
    echo "| doc | \`docs/epic-${nn}-${slug}.md\` |"
    echo "| handback | \`.orchestrator/handbacks/${nn}-${slug}.md\` |"
    echo
    echo "## Definition of done (checklist)"
    echo
    echo "- [ ] prompt written"
    echo "- [ ] spawned"
    echo "- [ ] PR open"
    echo "- [ ] audited"
    echo "- [ ] merged"
    echo "- [ ] tagged \`epic-${nn}-complete\`"
    echo
    echo "<details><summary>Lane rules</summary>"
    echo
    echo "May create or modify files **only** inside \`${lane}\`, plus \`docs/epic-${nn}-${slug}.md\`"
    echo "and \`.orchestrator/handbacks/${nn}-${slug}.md\`. Reads anything. Never edits frozen"
    echo "contracts, root config, \`AGENTS.md\` or \`.orchestrator/\` outside the handback."
    echo "Needs a contract change? Open a **contract-request** issue instead of making it."
    echo
    echo "</details>"
  } > "$body"

  if [ "$DRY" = 0 ]; then
    existing_num="$(awk -F'\t' -v t="$full_title" '$2 == t {print $1"\t"$3; exit}' "$TMP/existing.tsv")"
  else
    existing_num=""
  fi

  if [ -n "$existing_num" ]; then
    num="$(echo "$existing_num" | cut -f1)"
    url="$(echo "$existing_num" | cut -f2)"
    SKIPPED_I=$((SKIPPED_I + 1))
    if [ "$REFRESH" = 1 ] && [ "$DRY" = 0 ]; then
      if gh issue edit "$num" --body-file "$body" >/dev/null 2>&1; then
        REFRESHED_I=$((REFRESHED_I + 1))
        ok "${full_title}  → #${num} (body refreshed)"
      else
        fail "refresh body of #${num}"
      fi
    else
      skip "${full_title}  → #${num} (exists)"
    fi
  else
    # Build the label set: epic + wave + machine + one per top-level lane.
    set -- --title "$full_title" --body-file "$body" --label epic --label "wave-${wave}" --label "machine:${machine}"
    for k in $keys; do set -- "$@" --label "lane:${k}"; done
    if [ "$DRY" = 1 ]; then
      run gh issue create "$@" --milestone "Wave ${wave}"
      url=""; num=""
    else
      url="$(gh issue create "$@" --milestone "Wave ${wave}" 2>"$TMP/err-${nn}.txt")"
      sleep "${GH_CREATE_SLEEP:-2}"   # GitHub secondary rate limit on content creation
      if [ -z "$url" ]; then
        fail "issue '${full_title}': $(head -2 "$TMP/err-${nn}.txt" | tr '\n' ' ')"
        continue
      fi
      num="${url##*/}"
      CREATED_I=$((CREATED_I + 1))
      ok "${full_title}  → #${num}  ${DIM}${prompt_state}${Z}"
    fi
  fi

  if [ -n "$num" ]; then
    printf '%s\t%s\t%s\n' "$nn" "$num" "$url" >> "$TMP/rows.tsv"
    printf '%s\t%s\n' "$nn" "$num" >> "$TMP/index.tsv"
  fi
done < "$EPICS_TSV"

ok "issues: ${CREATED_I} created, ${SKIPPED_I} already existed"

# ── 4. issues.tsv index ───────────────────────────────────────────────
step "4/5 Write ${ISSUES_TSV}"
if [ "$DRY" = 1 ]; then
  skip "dry run: ${ISSUES_TSV} not written"
else
  {
    printf 'nn\tnumber\turl\n'
    sort -n -k1,1 "$TMP/rows.tsv"
  } > "$ISSUES_TSV.tmp" && mv "$ISSUES_TSV.tmp" "$ISSUES_TSV"
  ok "$(grep -c . "$ISSUES_TSV") lines (including the header) → ${ISSUES_TSV}"
fi

# ── 5. repo settings ──────────────────────────────────────────────────
step "5/5 Repo settings"
DESC='🐦 Starling: an open-weight swarm of coding agents that spreads across every laptop in the room'
TOPICS="hacktoberfest open-source-ai open-weight opencode deepseek coding-agents multi-agent bun"
# `gh repo edit` can only *enable* merge methods (there is no --disable-* flag),
# so the "squash only" half goes through the REST API.
set -- --description "$DESC" --enable-squash-merge --delete-branch-on-merge --enable-issues
for t in $TOPICS; do set -- "$@" --add-topic "$t"; done
TOPIC_N="$(echo "$TOPICS" | wc -w | tr -d ' ')"
if run gh repo edit "$REPO" "$@" >/dev/null; then
  ok "description, ${TOPIC_N} topics, delete-branch-on-merge, issues on"
else
  fail "gh repo edit (need admin on ${REPO})"
fi
if run gh api -X PATCH "repos/${REPO}" \
      -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
      -F delete_branch_on_merge=true -F has_issues=true >/dev/null; then
  ok "squash-merge only (merge commits + rebase merges disabled)"
else
  fail "gh api PATCH repos/${REPO} (merge settings)"
fi

# ── summary ───────────────────────────────────────────────────────────
step "Summary"
printf '  repo          %s\n' "$REPO"
printf '  labels        %s created, %s updated\n' "$CREATED_L" "$UPDATED_L"
printf '  milestones    %s created\n' "$MS_CREATED"
printf '  issues        %s created, %s skipped, %s refreshed\n' "$CREATED_I" "$SKIPPED_I" "$REFRESHED_I"
printf '  index         %s\n' "$ISSUES_TSV"
if [ "$FAILED" -gt 0 ]; then
  printf '\n%s✘ %s step(s) failed — fix and re-run (the script is idempotent)%s\n' "$R" "$FAILED" "$Z" >&2
  exit 1
fi
printf '\n%s✨ GitHub side is ready. Next: .orchestrator/bin/spawn-wave.sh 0%s\n' "$G" "$Z"
