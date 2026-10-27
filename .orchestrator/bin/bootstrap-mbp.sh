#!/usr/bin/env bash
# bootstrap-mbp.sh: ONE command to go from "folder with a plan" to "Wave 0 agents flying".
#   tools → GitHub login → DeepSeek in opencode → model check → git repo + GitHub push → doctor → launch Wave 0
# Safe to re-run: every step skips itself if it's already done.
# Usage (from the repo folder):   bash .orchestrator/bin/bootstrap-mbp.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"
REPO_NAME="${REPO_NAME:-starling}"
LOCAL_ENV=".orchestrator/local.env"

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✔\033[0m %s\n" "$1"; }
die()  { printf "\n\033[31m✘ %s\033[0m\n" "$1"; exit 1; }
with_timeout() { perl -e 'alarm shift; exec @ARGV' "$@"; }   # macOS has no `timeout`

echo "🐦 Starling bootstrap: $(scutil --get ComputerName 2>/dev/null || hostname) · $ROOT"

# ── 1. tools ──────────────────────────────────────────────────────────
step "1/7 Installing tools (skips anything you already have)"
command -v brew >/dev/null || die "Homebrew is missing. Install it from https://brew.sh, then re-run this command."
for f in gh tmux; do command -v "$f" >/dev/null && ok "$f" || { brew install "$f" && ok "$f installed"; }; done
if ! command -v bun >/dev/null; then
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"; export PATH="$BUN_INSTALL/bin:$PATH"
fi
command -v bun >/dev/null && ok "bun $(bun --version)" || die "bun failed to install"
if ! command -v opencode >/dev/null; then
  brew install opencode 2>/dev/null || brew install sst/tap/opencode 2>/dev/null || curl -fsSL https://opencode.ai/install | bash
  export PATH="$HOME/.opencode/bin:$PATH"
fi
command -v opencode >/dev/null && ok "opencode $(opencode --version 2>/dev/null | head -1)" || die "opencode failed to install"
ulimit -n 10240 2>/dev/null && ok "open-file limit raised to 10240 for this session"

# ── 2. GitHub ─────────────────────────────────────────────────────────
step "2/7 GitHub login"
if gh auth status >/dev/null 2>&1; then ok "already logged in as $(gh api user --jq .login)"
else
  echo "  A browser window will open. Approve the GitHub login, then come back here."
  gh auth login --web --git-protocol https --hostname github.com || die "GitHub login failed"
fi
gh auth setup-git >/dev/null 2>&1
GH_LOGIN="$(gh api user --jq .login)"
if [ -z "$(git config --get user.email)" ]; then
  GH_ID="$(gh api user --jq .id)"
  git config --global user.name "$(gh api user --jq '.name // .login')"
  git config --global user.email "${GH_ID}+${GH_LOGIN}@users.noreply.github.com"
  ok "git identity set from GitHub ($GH_LOGIN, noreply email)"
fi

# ── 3+4. find DeepSeek V4.1 Flash under ANY provider you're already logged into ──
# (Direct DeepSeek key, OpenCode Zen, OpenRouter… whatever your opencode already uses. No re-login unless nothing works.)
step "3/7 Looking for DeepSeek V4.1 Flash in your existing opencode login"
[ -f "$LOCAL_ENV" ] && . "$LOCAL_ENV"
MODEL="${STARLING_DEV_MODEL:-}"
find_model() {
  local all; all="$(opencode models 2>/dev/null | tr -d '\r')"
  # prefer: direct deepseek provider → anything else (zen / openrouter / …)
  echo "$all" | grep -iE '^deepseek/.*v4[.-]?1.*flash' | grep -viE 'think|reason' | head -1 && return
  echo "$all" | grep -iE 'deepseek.*v4[.-]?1.*flash' | grep -viE 'think|reason' | head -1
}
[ -z "$MODEL" ] && MODEL="$(find_model || true)"
if [ -z "$MODEL" ]; then
  echo "  opencode doesn't list a DeepSeek V4.1 Flash model under any provider you're logged into."
  echo "  DeepSeek-ish models it can see right now:"
  opencode models 2>/dev/null | grep -i deepseek | sed 's/^/    /' || echo "    (none)"
  printf "  Type one of the ids above to use it, or press Enter to log in to a provider now: "; read -r MODEL
  if [ -z "$MODEL" ]; then
    echo "  Pick DeepSeek (or the provider you normally use) and paste its key."
    opencode auth login || die "opencode login failed"
    MODEL="$(find_model || true)"
    [ -z "$MODEL" ] && { printf "  Still not auto-detected. Type the model id: "; read -r MODEL; }
  fi
fi
step "4/7 Model smoke test"
[ -z "$MODEL" ] && die "no model id"
echo "export STARLING_DEV_MODEL='$MODEL'" > "$LOCAL_ENV"
ok "using $MODEL (saved to $LOCAL_ENV, which is gitignored)"
echo "  Smoke test: asking it to say 'chirp' (up to 2 min)…"
OUT="$(with_timeout 120 opencode run --model "$MODEL" --auto "Reply with exactly one word: chirp" 2>&1)"
if echo "$OUT" | grep -qi chirp; then ok "DeepSeek answered 🐦"
else echo "$OUT" | tail -15; die "smoke test failed. Check the API key/credits, or that this opencode version supports --auto (opencode upgrade)"; fi

# ── 5. git + GitHub repo ─────────────────────────────────────────────
step "5/7 Git repo + GitHub ($GH_LOGIN/$REPO_NAME, public)"
grep -qx '.orchestrator/local.env' .gitignore 2>/dev/null || echo '.orchestrator/local.env' >> .gitignore
[ -d .git ] || { git init -b main >/dev/null && ok "git initialised"; }
git add -A
git diff --cached --quiet || { git commit -m "chore(orchestrator): plan, process, roadmap and wave-0 prompts" >/dev/null && ok "committed"; }
if git remote get-url origin >/dev/null 2>&1; then
  git push -u origin main >/dev/null 2>&1 && ok "pushed to $(git remote get-url origin)"
else
  gh repo create "$REPO_NAME" --public --source . --remote origin --push \
    --description "🐦 Starling: an open-weight swarm of coding agents that spreads across every laptop in the room" \
    || die "repo create failed. If '$REPO_NAME' already exists, re-run with REPO_NAME=starling-swarm"
  ok "created https://github.com/$GH_LOGIN/$REPO_NAME"
fi

# ── 6. doctor ────────────────────────────────────────────────────────
step "6/7 Dev doctor"
bash .orchestrator/bin/dev-doctor.sh || die "doctor found problems (see ✘ above)"

# ── 7. launch ────────────────────────────────────────────────────────
step "7/7 Launch Wave 0 (3 agents: foundation, demo app, repo ops)"
printf "  Launch now? [Y/n] "; read -r yn
case "$yn" in n|N) echo "  Later: bash .orchestrator/bin/spawn-wave.sh 0"; exit 0;; esac
bash .orchestrator/bin/spawn-wave.sh 0 || die "spawn failed"
printf "\n\033[1;32m✨ Wave 0 is flying.\033[0m  One Terminal window per agent just opened. Click into any of them to watch or talk to that agent.\n"
