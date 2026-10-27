#!/usr/bin/env bash
# dev-doctor.sh: checks a laptop is ready to run swarm waves. Run on BOTH the MacBook Pro and the Air.
set -u
. "$(dirname "$0")/_log.sh"   # mirror output to ~/Code/starling-wt/_logs/commands/ for Claude
ok()   { printf "  \033[32m✔\033[0m %s\n" "$1"; }
bad()  { printf "  \033[31m✘\033[0m %s\n     → %s\n" "$1" "$2"; FAIL=1; }
warn() { printf "  \033[33m!\033[0m %s\n     → %s\n" "$1" "$2"; }
FAIL=0
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
[ -f "$ROOT/.orchestrator/local.env" ] && . "$ROOT/.orchestrator/local.env"
echo "🐦 Starling dev doctor — $(scutil --get ComputerName 2>/dev/null || hostname)"

command -v git >/dev/null && {
  v=$(git --version | awk '{print $3}'); major=${v%%.*}; rest=${v#*.}; minor=${rest%%.*}
  if [ "$major" -gt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -ge 38 ]; }; then ok "git $v"; else bad "git $v is too old (need ≥ 2.38 for merge-tree --write-tree)" "brew install git"; fi
} || bad "git missing" "xcode-select --install"
command -v bun >/dev/null && ok "bun $(bun --version)" || bad "bun missing" "curl -fsSL https://bun.sh/install | bash"
command -v opencode >/dev/null && ok "opencode $(opencode --version 2>/dev/null | head -1)" || bad "opencode missing" "brew install sst/tap/opencode  (or: curl -fsSL https://opencode.ai/install | bash)"
command -v gh >/dev/null && { gh auth status >/dev/null 2>&1 && ok "gh authenticated" || bad "gh not logged in" "gh auth login"; } || bad "gh missing" "brew install gh"
command -v tmux >/dev/null && ok "tmux $(tmux -V | awk '{print $2}')" || warn "tmux missing (spawn-wave falls back to background mode)" "brew install tmux"
command -v ollama >/dev/null && ok "ollama present" || warn "ollama missing (needed on the MBP for audits; Epic 02 can install it)" "brew install ollama"

MODEL="${STARLING_DEV_MODEL:-deepseek/deepseek-v4.1-flash}"
if command -v opencode >/dev/null; then
  if opencode models 2>/dev/null | grep -qx "$MODEL"; then ok "opencode knows $MODEL"
  else
    found=$(opencode models 2>/dev/null | grep -i deepseek | head -5 | tr '\n' ' ')
    bad "opencode doesn't list $MODEL" "run 'opencode auth login' → DeepSeek, then 'opencode models deepseek'. Seen: ${found:-none}. If the id differs: export STARLING_DEV_MODEL=<id>"
  fi
fi

mem=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824 ))
echo "  ℹ RAM ${mem} GB · suggested max opencode sessions on this machine: $(( mem >= 32 ? 22 : (mem >= 24 ? 16 : (mem >= 16 ? 12 : 6)) ))"
ulimit -n 2>/dev/null | awk '{ if ($1 < 4096) print "  ! open-file limit " $1 " is low for 20+ sessions → run: ulimit -n 10240 (add to ~/.zshrc)"; else print "  ✔ open-file limit " $1 }'

git rev-parse --show-toplevel >/dev/null 2>&1 && {
  git remote get-url origin >/dev/null 2>&1 && ok "repo remote: $(git remote get-url origin)" || bad "no origin remote" "gh repo create starling --public --source . --push"
}
[ "$FAIL" = 0 ] && echo "✨ ready to fly" || { echo "fix the ✘ items above"; exit 1; }
