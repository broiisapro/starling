#!/usr/bin/env bash
# setup.sh — bring up Ollama and the one local model Starling audits with.
#
#   tools/local-models/setup.sh [--profile mbp|air] [--pull] [--host URL] [--json]
#
#   --profile  mbp (32 GB MacBook Pro) | air (16 GB MacBook Air).
#              Default: inferred from physical RAM (>= 24 GB → mbp).
#   --pull     also download the profile's primary model (idempotent: skipped
#              when the tag is already in `ollama list`).
#   --host     Ollama base URL. Default http://127.0.0.1:11434 (or $OLLAMA_HOST).
#   --json     print a one-line JSON summary at the end instead of the pretty block.
#
# Does four things, all idempotent:
#   1. installs Ollama (Homebrew) and starts the server if either is missing;
#   2. prints the hardware facts that decide which model fits;
#   3. prints the researched candidates for this profile (candidates.json);
#   4. with --pull, fetches the one primary model for the profile.
#
# Then: `bun tools/local-models/smoke.ts` to measure it.
# Bash 3.2 compatible (macOS default shell).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CANDIDATES="$HERE/candidates.json"

PROFILE=""
PULL=0
JSON=0
HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"
HOST="${HOST%/}"
case "$HOST" in http://*|https://*) ;; *) HOST="http://$HOST" ;; esac

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --pull) PULL=1; shift ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --json) JSON=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1 (try --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; Z=$'\033[0m'
else
  B=""; DIM=""; G=""; Y=""; R=""; C=""; Z=""
fi
step() { [ "$JSON" = 1 ] || printf '\n%s▶ %s%s\n' "$B$C" "$1" "$Z"; }
ok()   { [ "$JSON" = 1 ] || printf '  %s✔%s %s\n' "$G" "$Z" "$1"; }
info() { [ "$JSON" = 1 ] || printf '  %s·%s %s\n' "$DIM" "$Z" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$Z" "$1" >&2; }
die()  { printf '\n%s✘ %s%s\n' "$R" "$1" "$Z" >&2; exit 1; }

# ── hardware ──────────────────────────────────────────────────────────
[ "$(uname -s)" = Darwin ] || die "this script assumes macOS (sysctl hardware facts)"

CHIP="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)"
CPU_CORES="$(sysctl -n hw.ncpu 2>/dev/null || echo 0)"
MEM_BYTES="$(sysctl -n hw.memsize 2>/dev/null || echo 0)"
RAM_GB=$(( MEM_BYTES / 1073741824 ))
[ "$RAM_GB" -gt 0 ] || die "cannot read hw.memsize"
FREE_DISK="$(df -h / | awk 'NR==2 {print $4}')"
FREE_DISK_GB="$(df -g / | awk 'NR==2 {print $4}')"
MACOS="$(sw_vers -productVersion 2>/dev/null || echo unknown)"
HOSTNAME_S="$(scutil --get ComputerName 2>/dev/null || hostname)"

# ── profile ───────────────────────────────────────────────────────────
if [ -z "$PROFILE" ]; then
  if [ "$RAM_GB" -ge 24 ]; then PROFILE=mbp; else PROFILE=air; fi
  info "no --profile given; inferred '${PROFILE}' from ${RAM_GB} GB RAM"
fi
case "$PROFILE" in
  mbp) [ "$RAM_GB" -lt 24 ] && warn "profile 'mbp' on ${RAM_GB} GB of RAM: the 23 GB model will not leave room for opencode" ;;
  air) [ "$RAM_GB" -gt 24 ] && warn "profile 'air' on ${RAM_GB} GB of RAM: you can afford the mbp model" ;;
  *) die "unknown --profile '$PROFILE' (mbp|air)" ;;
esac

[ -f "$CANDIDATES" ] || die "missing $CANDIDATES"
command -v jq >/dev/null 2>&1 || die "jq is required to read candidates.json (brew install jq)"

MODEL="$(jq -r --arg p "$PROFILE" '.profiles[$p].primary' "$CANDIDATES")"
[ -n "$MODEL" ] && [ "$MODEL" != null ] || die "no primary model for profile '$PROFILE' in candidates.json"
# A 16 GB Air that turns out to be an 8 GB Air gets the 4B fallback instead.
if [ "$PROFILE" = air ] && [ "$RAM_GB" -lt 12 ]; then
  MODEL="qwen3.5:4b"
  info "only ${RAM_GB} GB of RAM: using the 4B fallback ${MODEL}"
fi

step "1/4 Hardware"
info "machine   ${HOSTNAME_S}  (${MACOS})"
info "chip      ${CHIP}  (${CPU_CORES} cores)"
info "memory    ${RAM_GB} GB  (${MEM_BYTES} bytes)"
info "disk      ${FREE_DISK} free (${FREE_DISK_GB} GiB)"
info "profile   ${PROFILE} → primary model ${B}${MODEL}${Z}"

# ── ollama ────────────────────────────────────────────────────────────
step "2/4 Ollama"
server_up() { curl -fsS -m 3 "$HOST/api/version" >/dev/null 2>&1; }

if command -v ollama >/dev/null 2>&1; then
  OLLAMA_VERSION="$(ollama --version 2>/dev/null | tail -1)"
  ok "ollama on PATH: ${OLLAMA_VERSION:-unknown version}"
else
  command -v brew >/dev/null 2>&1 || die "Ollama is missing and Homebrew is not installed. Install from https://ollama.com/download, then re-run."
  info "Ollama is missing: installing with Homebrew (brew install ollama)"
  brew install ollama || die "brew install ollama failed"
  ok "installed $(ollama --version 2>/dev/null | tail -1)"
fi

if server_up; then
  ok "server already running at ${HOST} ($(curl -fsS -m 3 "$HOST/api/version"))"
else
  info "server is down: starting it"
  if command -v brew >/dev/null 2>&1 && brew list --formula 2>/dev/null | grep -qx ollama; then
    brew services start ollama >/dev/null 2>&1 && info "started via 'brew services start ollama' (stays up across logins)"
  elif [ -d /Applications/Ollama.app ]; then
    open -a Ollama >/dev/null 2>&1 && info "started the Ollama.app menu-bar app"
  else
    mkdir -p "$HOME/.ollama"
    nohup ollama serve >>"$HOME/.ollama/serve.log" 2>&1 &
    info "started 'ollama serve' in the background (log: ~/.ollama/serve.log)"
  fi
  i=0
  while [ "$i" -lt 30 ]; do
    server_up && break
    sleep 1
    i=$((i + 1))
  done
  server_up || die "Ollama did not come up at ${HOST} within 30s"
  ok "server up at ${HOST} ($(curl -fsS -m 3 "$HOST/api/version"))"
fi

# ── candidates ────────────────────────────────────────────────────────
step "3/4 Candidates for '${PROFILE}' (from candidates.json)"
if [ "$JSON" = 0 ]; then
  jq -r --arg p "$PROFILE" '
    .profiles[$p].candidates[]
    | [ .tag, .params, (.downloadGb|tostring) + " GB", ((.contextLength/1024)|floor|tostring) + "K", .license,
        (if .tools then "tools" else "-" end), (if .jsonSchema then "json-schema" else "-" end) ]
    | @tsv' "$CANDIDATES" |
  awk -F'\t' '
    BEGIN { printf "  %-24s %-28s %-9s %-5s %-20s %s\n", "TAG", "PARAMS", "SIZE", "CTX", "LICENSE", "CAPS" }
    { printf "  %-24s %-28s %-9s %-5s %-20s %s %s\n", $1, $2, $3, $4, $5, $6, $7 }'
  printf '  %sprimary for this profile: %s%s\n' "$DIM" "$MODEL" "$Z"
  printf '  %sreason: %s%s\n' "$DIM" "$(jq -r --arg p "$PROFILE" '.profiles[$p].primaryWhy' "$CANDIDATES")" "$Z"
fi

# ── pull ──────────────────────────────────────────────────────────────
step "4/4 Model"
PULLED="already-present"
if ollama list 2>/dev/null | awk '{print $1}' | grep -Fxq "$MODEL"; then
  ok "${MODEL} is already pulled"
elif [ "$PULL" = 1 ]; then
  PULLED="pulled"
  info "pulling ${MODEL} (this is the slow part; ~$(jq -r --arg p "$PROFILE" --arg m "$MODEL" '.profiles[$p].candidates[] | select(.tag==$m) | .downloadGb' "$CANDIDATES") GB)"
  ollama pull "$MODEL" || die "ollama pull ${MODEL} failed"
  ok "${MODEL} pulled"
else
  PULLED="missing"
  warn "${MODEL} is not pulled. Re-run with --pull, or: ollama pull ${MODEL}"
fi

if ollama list 2>/dev/null | awk '{print $1}' | grep -Fxq "$MODEL"; then
  SIZE="$(ollama list 2>/dev/null | awk -v m="$MODEL" '$1 == m {print $3" "$4}')"
  ok "on disk: ${MODEL} (${SIZE})"
  HAVE=1
else
  HAVE=0
fi

if [ "$JSON" = 1 ]; then
  jq -n --arg host "$HOSTNAME_S" --arg chip "$CHIP" --argjson ram "$RAM_GB" --argjson cores "$CPU_CORES" \
        --arg disk "$FREE_DISK" --arg profile "$PROFILE" --arg model "$MODEL" --arg pulled "$PULLED" \
        --arg macos "$MACOS" \
        '{host:$host, chip:$chip, ramGb:$ram, cpuCores:$cores, freeDisk:$disk, macos:$macos, profile:$profile, model:$model, pull:$pulled}'
else
  step "Next"
  printf '  %s1.%s measure it:      %sbun tools/local-models/smoke.ts --model %s%s\n' "$B" "$Z" "$C" "$MODEL" "$Z"
  printf '  %s2.%s footprint:        %sollama ps%s while it is loaded (note the SIZE column)\n' "$B" "$Z" "$C" "$Z"
  printf '  %s3.%s wire it into config: models.auditor = { provider: ollama, model: %s }\n' "$B" "$Z" "$MODEL"
  if [ "$HAVE" = 1 ]; then
    printf '\n  %s🐦 local model ready.%s\n' "$G$B" "$Z"
  else
    printf '\n  %s🐦 not pulled yet — re-run with --pull.%s\n' "$Y$B" "$Z"
  fi
fi
