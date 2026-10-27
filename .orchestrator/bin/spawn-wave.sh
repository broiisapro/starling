#!/usr/bin/env bash
# spawn-wave.sh — launch one opencode session per epic prompt, each in its own worktree.
#
#   .orchestrator/bin/spawn-wave.sh <wave> [--only 10,12,15] [--machine mbp|air] [--mode terminal|tmux|bg]
#                                          [--ui tui|run] [--resume] [--dry-run]
#
#   <wave>     number: runs every .orchestrator/prompts/wave-<wave>/NN-slug.md
#              or "checkpoint-C1" etc: runs .orchestrator/prompts/checkpoint-C1.md on main
#   --only     comma list of epic numbers to launch (default: all in the wave)
#   --machine  mbp|air: only launch epics assigned to this laptop in .orchestrator/epics.tsv
#   --mode     bg (default): headless background agents, logs in ../starling-wt/_logs/ (watch: watch-wave.sh <wave>)
#              terminal: one Terminal/iTerm window per agent · tmux: one tmux window per agent
#   --ui       tui: a real interactive opencode session per window (terminal/tmux modes only). The model comes from the
#              repo's opencode.json "model" key (newer opencode TUIs have no --model flag). Sessions are
#              normal opencode sessions, so they also show up in `opencode`'s session list.
#              run (default): headless `opencode run`, output tee'd to ../starling-wt/_logs/ (always used for bg)
#   --resume   instead of NN-slug.md, run the newest NN-slug.fixK.md for each selected epic (worktree must exist)
#   --dry-run  print what would happen
#
# Env: STARLING_DEV_MODEL (bootstrap-mbp.sh saves it in .orchestrator/local.env)
# Bash 3.2 compatible (macOS default shell).
set -euo pipefail
. "$(dirname "$0")/_log.sh"   # mirror output to ~/Code/starling-wt/_logs/commands/ for Claude

REPO_ROOT="$(git rev-parse --show-toplevel)"
[ -f "$REPO_ROOT/.orchestrator/local.env" ] && . "$REPO_ROOT/.orchestrator/local.env"
MODEL="${STARLING_DEV_MODEL:-deepseek/deepseek-v4.1-flash}"
ulimit -n 10240 2>/dev/null || true   # 20+ sessions need lots of file handles
WT_ROOT="$(cd "$REPO_ROOT/.." && pwd)/starling-wt"
LOG_DIR="$WT_ROOT/_logs"

WAVE="${1:-}"; shift || true
ONLY=""; MODE=""; UI=""; RESUME=0; DRY=0; MACHINE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2;;
    --machine) MACHINE="$2"; shift 2;;
    --mode) MODE="$2"; shift 2;;
    --ui) UI="$2"; shift 2;;
    --resume) RESUME=1; shift;;
    --dry-run) DRY=1; shift;;
    *) echo "unknown arg: $1"; exit 1;;
  esac
done
[ -z "$WAVE" ] && { sed -n '2,20p' "$0"; exit 1; }
[ -z "$MODE" ] && MODE=bg      # lightest: headless, no windows. Watch with watch-wave.sh, stop with stop-agents.sh
[ -z "$UI" ] && UI=run
[ "$MODE" = bg ] && UI=run

command -v opencode >/dev/null || { echo "opencode not found on PATH"; exit 1; }
mkdir -p "$LOG_DIR"
run() { if [ "$DRY" = 1 ]; then echo "  [dry] $*"; else eval "$@"; fi; }

# ── window tiling (terminal mode) ─────────────────────────────
SCREEN_W=1512; SCREEN_H=982
if [ "$MODE" = terminal ]; then
  b="$(osascript -e 'tell application "Finder" to get bounds of window of desktop' 2>/dev/null || true)"
  if [ -n "$b" ]; then SCREEN_W="$(echo "$b" | awk -F', ' '{print $3}')"; SCREEN_H="$(echo "$b" | awk -F', ' '{print $4}')"; fi
fi
bounds_for() { # $1=index (0-based) $2=total → "x1, y1, x2, y2"
  local i="$1" n="$2" top=28 cols rows cw ch c r
  cols=1; while [ $((cols*cols)) -lt "$n" ]; do cols=$((cols+1)); done
  rows=$(( (n + cols - 1) / cols ))
  cw=$(( SCREEN_W / cols )); ch=$(( (SCREEN_H - top) / rows ))
  if [ "$cw" -lt 560 ] || [ "$ch" -lt 340 ]; then   # too many to tile legibly → cascade
    local x=$(( 20 + (i % 12) * 40 + (i / 12) * 300 )) y=$(( top + (i % 12) * 40 ))
    echo "$x, $y, $((x+980)), $((y+640))"; return
  fi
  c=$(( i % cols )); r=$(( i / cols ))
  echo "$((c*cw)), $((top + r*ch)), $(((c+1)*cw)), $((top + (r+1)*ch))"
}

SESSION="starling-w${WAVE}"
launch() { # $1=name  $2=worktree  $3=prompt path (relative to repo)  $4=index  $5=total
  local name="$1" wt="$2" prompt="$3" idx="${4:-0}" total="${5:-1}"
  local script="$LOG_DIR/run-${name}.sh" cmd
  if [ "$UI" = tui ]; then
    cmd="OPENCODE_CONFIG_CONTENT='{\"model\":\"${MODEL}\"}' opencode --auto --prompt \"\$MSG\" ."
  else
    # Only flags proven by bootstrap's smoke test: run --model --auto
    cmd="opencode run --model \"${MODEL}\" --auto \"\$MSG\" 2>&1 | tee -a \"$LOG_DIR/${name}.log\""
  fi
  # A tiny per-epic launcher script avoids nested-quote hell and pins PATH (iTerm/tmux may not load your shell profile).
  cat > "$script" <<EOF
#!/usr/bin/env bash
export PATH="$PATH"
cd "$wt"
printf '\033]0;🐦 epic ${name}\007'
MSG="Your assignment is the file ${prompt} in this worktree. Read it completely, then read AGENTS.md and .orchestrator/ARCHITECTURE.md, then execute the assignment end to end. Do not stop to ask questions: decide, document, continue. Finish by opening the PR as AGENTS.md section 6 describes."
echo "=== \$(date) :: ${name} :: model ${MODEL} :: ui ${UI} ===" >> "$LOG_DIR/${name}.log"
${cmd}
echo; echo "--- epic ${name}: opencode exited at \$(date) ---"
osascript -e 'display notification "Agent for epic ${name} finished. Check its window / PR." with title "🐦 Starling" sound name "Glass"' >/dev/null 2>&1 || true
EOF
  chmod +x "$script"
  echo "🐦 launching ${name}  (${MODE}/${UI})"
  case "$MODE" in
    terminal)
      local bnds as="$LOG_DIR/open-${name}.applescript"
      bnds="$(bounds_for "$idx" "$total")"
      if [ "${TERM_PROGRAM:-}" = "iTerm.app" ]; then
        cat > "$as" <<EOF
tell application "iTerm"
  set w to (create window with default profile command "bash '$script'")
  set bounds of w to {${bnds}}
end tell
EOF
      else
        cat > "$as" <<EOF
tell application "Terminal"
  activate
  set t to do script "bash '$script'"
  set custom title of t to "🐦 epic ${name}"
  set bounds of front window to {${bnds}}
end tell
EOF
      fi
      run "osascript '$as' >/dev/null" || {
        echo "✘ macOS blocked opening a window. Allow it: System Settings → Privacy & Security → Automation → (your terminal app) → enable Terminal/iTerm and Finder. Then re-run with --only ${name%%-*}"
        exit 1; };;
    tmux)
      if ! tmux has-session -t "$SESSION" 2>/dev/null; then run "tmux new-session -d -s '$SESSION' -n hub -c '$REPO_ROOT'"; fi
      run "tmux new-window -t '$SESSION' -n '${name}' -c '$wt' 'bash $script; exec \$SHELL'";;
    *)
      run "nohup bash '$script' >/dev/null 2>&1 &";;
  esac
}

# Agents read .orchestrator/ARCHITECTURE.md etc. from origin/main, so publish orchestrator edits first.
if [ -n "$(git -C "$REPO_ROOT" status --porcelain -- .orchestrator AGENTS.md opencode.json .gitignore)" ]; then
  run "(cd '$REPO_ROOT' && git add -A -- \$(ls -d .orchestrator AGENTS.md opencode.json .gitignore 2>/dev/null))"
  run "git -C '$REPO_ROOT' commit -qm 'chore(orchestrator): prompts and plan for wave ${WAVE}'"
  run "git -C '$REPO_ROOT' pull -q --rebase origin main && git -C '$REPO_ROOT' push -q origin HEAD:main"
  echo "• published orchestrator changes to origin/main"
fi
run "git -C '$REPO_ROOT' fetch origin --quiet"

# ── checkpoint mode ───────────────────────────────────────────
case "$WAVE" in checkpoint-*)
  P=".orchestrator/prompts/${WAVE}.md"
  [ -f "$REPO_ROOT/$P" ] || { echo "missing $P"; exit 1; }
  WT="$WT_ROOT/integrator"
  if [ ! -d "$WT" ]; then run "git -C '$REPO_ROOT' worktree add --detach '$WT' origin/main"; fi
  run "git -C '$WT' checkout --detach origin/main --quiet"
  run "mkdir -p '$WT/.orchestrator/prompts' && cp '$REPO_ROOT/$P' '$WT/$P'"
  SESSION="starling-${WAVE}"; launch "$WAVE" "$WT" "$P" 0 1
  exit 0;;
esac

DIR=".orchestrator/prompts/wave-${WAVE}"
[ -d "$REPO_ROOT/$DIR" ] || { echo "no prompts in $DIR"; exit 1; }

# ── pass 1: select epics + prepare worktrees ──────────────────
NAMES=(); WTS=(); PROMPTS=()
for f in "$REPO_ROOT/$DIR"/[0-9][0-9]-*.md; do
  base="$(basename "$f" .md)"
  case "$base" in *.fix*) continue;; esac
  nn="${base%%-*}"
  if [ -n "$ONLY" ] && ! echo ",$ONLY," | grep -q ",$nn,"; then continue; fi
  if [ -n "$MACHINE" ]; then
    assigned="$(awk -F'\t' -v n="$nn" '$1==n {print $5}' "$REPO_ROOT/.orchestrator/epics.tsv")"
    [ "$assigned" != "$MACHINE" ] && continue
  fi
  branch="epic/${base}"; wt="$WT_ROOT/${base}"; prompt="$DIR/${base}.md"

  if [ "$RESUME" = 1 ]; then
    fix="$(ls "$REPO_ROOT/$DIR/${base}".fix*.md 2>/dev/null | sort | tail -1 || true)"
    [ -z "$fix" ] && { echo "skip ${base}: no fix prompt"; continue; }
    [ -d "$wt" ] || { echo "skip ${base}: worktree missing"; continue; }
    prompt="$DIR/$(basename "$fix")"
  else
    if [ -d "$wt" ]; then
      echo "♻️  ${base}: reusing existing worktree (close its old window first if that agent is still running)"
    elif git -C "$REPO_ROOT" show-ref --quiet "refs/heads/${branch}"; then
      run "git -C '$REPO_ROOT' worktree add '$wt' '${branch}'"
    else
      run "git -C '$REPO_ROOT' worktree add -b '${branch}' '$wt' origin/main"
    fi
    if [ -f "$REPO_ROOT/package.json" ]; then run "(cd '$wt' && bun install --silent >/dev/null 2>&1 || true)"; fi
  fi
  run "mkdir -p '$wt/$DIR' && cp '$REPO_ROOT/$prompt' '$wt/$prompt'"
  NAMES+=("$base"); WTS+=("$wt"); PROMPTS+=("$prompt")
done

TOTAL=${#NAMES[@]}
[ "$TOTAL" = 0 ] && { echo "nothing to launch"; exit 0; }

# ── pass 2: launch ────────────────────────────────────────────
i=0
while [ "$i" -lt "$TOTAL" ]; do
  launch "${NAMES[$i]}" "${WTS[$i]}" "${PROMPTS[$i]}" "$i" "$TOTAL"
  i=$((i+1))
  sleep 2   # stagger the API burst
done

echo "✨ ${TOTAL} starling(s) in the air."
case "$MODE" in
  terminal) echo "Each agent has its own window. Cmd-\` cycles windows; click into one to talk to that agent.";;
  tmux) echo "watch: tmux attach -t $SESSION   (Ctrl-b w to pick a window)";;
  *) echo "Running headless. Scoreboard: bash .orchestrator/bin/watch-wave.sh ${WAVE}   ·   stop: bash .orchestrator/bin/stop-agents.sh";;
esac
