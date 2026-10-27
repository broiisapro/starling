#!/usr/bin/env bash
# Fully-open smoke test — one tiny task, zero cloud.
#
#   tools/fully-open/smoke.sh [--dry-run] [--model TAG] [--max-wait SECONDS] [--poll SECONDS]
#                             [--force] [--keep-loaded] [--out FILE]
#
# What it does
#   1. Resolves the local model (STARLING_LOCAL_MODEL → tools/local-models/results/recommendation.json
#      → the compiled-in default qwen3.8:27b-mlx) and the laptop profile (mbp/air).
#   2. Waits for ARCHITECTURE §7 **L31** quiet window: ≤ 3 `opencode` processes and ≥ 22 GB free.
#      `--force` skips the wait; `--dry-run` only reports, and touches nothing outside this process.
#   3. Writes a *project-level* opencode config (`providers.ollama`, see opencode-ollama.json) into a
#      throwaway directory — never the user's global config.
#   4. Drives the opencode → Ollama provider with one one-shot prompt that has to write a file, so a
#      pass proves tools work and not merely that the model can chat. When `starling run --profile`
#      exists on main (Epic 40), it runs that instead, so the whole harness is exercised.
#   5. Measures the same prompt against Ollama's OpenAI-compatible endpoint (what the router and
#      opencode's provider both speak) to report honest tokens/second, then unloads the model.
#   6. Writes tools/fully-open/results/smoke-<host>-<model>-<ts>.json.
#
# --dry-run prints the plan of action, the resolved model/profile/config path and the L31 readings,
# makes no network call and loads no model. That is the mode to use on a busy machine.
#
# Exit codes: 0 ok · 1 failed · 2 usage · 3 deferred (quiet window never arrived) · 4 partial
# (the model answered but did not use tools — the file was not written).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESULTS_DIR="$ROOT/tools/fully-open/results"
RECOMMENDATION="$ROOT/tools/local-models/results/recommendation.json"
STARLING_CLI="$ROOT/apps/cli/src/index.ts"
SKY_TODO="$ROOT/examples/sky-todo"

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
MIN_FREE_GB="${STARLING_MIN_FREE_GB:-22}"
MAX_OPENCODE="${STARLING_MAX_OPENCODE:-3}"
POLL_SECONDS=60
MAX_WAIT_SECONDS=5400
MODEL="${STARLING_LOCAL_MODEL:-}"
OUT=""
DRY_RUN=0
FORCE=0
KEEP_LOADED=0
LOADED=0
PROMPT='Create a file named LOCAL_SMOKE.md in the current directory containing exactly one line: # local bird. Do not do anything else.'
SMOKE_FILE="LOCAL_SMOKE.md"

usage() {
  sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="${2:?--model needs a tag}"; shift 2 ;;
    --max-wait) MAX_WAIT_SECONDS="${2:?--max-wait needs seconds}"; shift 2 ;;
    --poll) POLL_SECONDS="${2:?--poll needs seconds}"; shift 2 ;;
    --out) OUT="${2:?--out needs a path}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    --keep-loaded) KEEP_LOADED=1; shift ;;
    -h|--help) usage 0 ;;
    *) echo "unknown flag: $1" >&2; usage 2 ;;
  esac
done

now_ms() { bun -e 'console.log(Date.now())'; }
log() { printf '%s\n' "$*"; }

# ── JSON without a hard jq dependency ────────────────────────────────────────
# jget <file> <dot.path> — prints a string raw, or compact JSON for objects/arrays; empty on miss.
jget() {
  bun -e '
    const [file, path] = process.argv.slice(1);
    try {
      const data = JSON.parse(await Bun.file(file).text());
      const value = path.split(".").reduce((node, key) => (node == null ? undefined : node[key]), data);
      if (value === undefined || value === null) process.exit(0);
      console.log(typeof value === "string" ? value : JSON.stringify(value));
    } catch {}
  ' "$1" "$2"
}

# ── host + model resolution (mirrors packages/llm/src/profiles-recommend.ts) ──
mem_gb() {
  local bytes
  if bytes="$(sysctl -n hw.memsize 2>/dev/null)"; then
    printf '%d' $((bytes / 1073741824))
  else
    awk '/MemTotal/ { printf "%d", $2 / 1048576 }' /proc/meminfo
  fi
}

host_profile() {
  local forced="${STARLING_LOCAL_PROFILE:-}"
  case "$forced" in
    mbp|air) printf '%s' "$forced"; return ;;
  esac
  if [ "$(mem_gb)" -ge 24 ]; then printf 'mbp'; else printf 'air'; fi
}

resolve_model() {
  if [ -n "$MODEL" ]; then printf '%s' "$MODEL"; return; fi
  local host pick
  host="$(host_profile)"
  pick="$(jget "$RECOMMENDATION" "$host.auditor")"
  if [ -n "$pick" ]; then printf '%s' "$pick"; else printf 'qwen3.8:27b-mlx'; fi
}

# ── L31 rails ────────────────────────────────────────────────────────────────
opencode_count() { { pgrep -f opencode 2>/dev/null || true; } | wc -l | tr -d ' '; }

# Free RAM as macOS counts it: free + inactive + speculative pages (what a model can claim without
# swapping). `memory_pressure`'s percentage is reported too, for the log, but the gate is GB.
free_gb() {
  if command -v vm_stat >/dev/null 2>&1; then
    vm_stat | awk '
      /page size of/ { for (i = 1; i <= NF; i++) if ($i == "of") page = $(i + 1) + 0 }
      /Pages free/ { gsub(/\./, "", $3); free = $3 + 0 }
      /Pages inactive/ { gsub(/\./, "", $3); inactive = $3 + 0 }
      /Pages speculative/ { gsub(/\./, "", $3); speculative = $3 + 0 }
      END { printf "%.1f", (free + inactive + speculative) * page / 1073741824 }
    '
  else
    awk '/MemAvailable/ { printf "%.1f", $2 / 1048576 }' /proc/meminfo
  fi
}

free_pct() {
  if command -v memory_pressure >/dev/null 2>&1; then
    memory_pressure 2>/dev/null | awk -F': ' '/free percentage/ { gsub(/%/, "", $2); printf "%d", $2 + 0 }'
  else
    awk '/MemTotal/ { total = $2 } /MemAvailable/ { avail = $2 } END { printf "%d", avail * 100 / total }' \
      /proc/meminfo
  fi
}

rails_ok() {
  local procs free
  procs="$(opencode_count)"
  free="$(free_gb)"
  [ "$procs" -le "$MAX_OPENCODE" ] || return 1
  awk -v f="$free" -v m="$MIN_FREE_GB" 'BEGIN { exit !(f >= m) }'
}

report_rails() {
  log "  opencode processes: $(opencode_count) (need ≤ $MAX_OPENCODE)"
  log "  free memory:        $(free_gb) GB ($(free_pct)% per memory_pressure) (need ≥ $MIN_FREE_GB GB)"
}

# ── project-level opencode config (never the user's global config) ────────────
# Derived from tools/fully-open/opencode-ollama.json, the file check-config.test.ts guards, so the
# smoke exercises exactly what the unit test approves. `modelID` and `package` are both required by
# opencode 2.1.2 — see the README before dropping either; a custom OLLAMA_URL rewrites baseURL.
write_project_config() { # <dir>
  mkdir -p "$1"
  MODEL_FILE="$MODEL" OLLAMA_V1="$OLLAMA_V1" TEMPLATE="$ROOT/tools/fully-open/opencode-ollama.json" bun -e '
    const template = await Bun.file(process.env.TEMPLATE).json();
    const model = process.env.MODEL_FILE;
    const provider = template.providers.ollama;
    const seed = Object.values(provider.models)[0] ?? {
      capabilities: { tools: true, temperature: true, input: ["text", "image"], output: ["text"] },
      limit: { context: 32768, output: 8192 },
    };
    provider.settings = { ...provider.settings, baseURL: process.env.OLLAMA_V1 };
    provider.models = { [model]: { ...seed, modelID: model, name: `${model} (local)` } };
    template.model = `ollama/${model}`;
    await Bun.write(`${process.argv[1]}/opencode.json`, `${JSON.stringify(template, null, 2)}\n`);
  ' "$1"
}

unload_model() {
  curl -s --max-time 30 "$OLLAMA_URL/api/generate" \
    -H 'content-type: application/json' \
    -d "$(MODEL_UNLOAD="$MODEL" bun -e 'console.log(JSON.stringify({ model: process.env.MODEL_UNLOAD, keep_alive: 0 }))')" \
    >/dev/null 2>&1 || true
}

# write_report <status> <detail> <mode> <started> <finished> <opencode-ms> <chars> <tokens> <completion-ms> <file-written>
write_report() {
  local status="$1" detail="$2" mode="$3" started="$4" finished="$5" oc_ms="$6" chars="$7"
  local tokens="$8" comp_ms="$9" written="${10}"
  local stamp path
  stamp="$(date +%Y%m%dT%H%M%S)"
  if [ -z "$OUT" ]; then
    mkdir -p "$RESULTS_DIR"
    path="$RESULTS_DIR/smoke-$(hostname -s | tr ' ' '-')-$(printf '%s' "$MODEL" | tr '/:' '--')-$stamp.json"
  else
    mkdir -p "$(dirname "$OUT")"
    path="$OUT"
  fi
  STATUS="$status" DETAIL="$detail" MODE="$mode" MODEL="$MODEL" HOST_PROFILE="$(host_profile)" \
  HOST_NAME="$(hostname)" MEM_GB="$(mem_gb)" STARTED="$started" FINISHED="$finished" \
  OC_MS="$oc_ms" CHARS="$chars" TOKENS="$tokens" COMP_MS="$comp_ms" WRITTEN="$written" \
  OLLAMA_URL="$OLLAMA_URL" PROCS="$(opencode_count)" FREE_GB="$(free_gb)" FREE_PCT="$(free_pct)" \
  MAX_OPENCODE="$MAX_OPENCODE" MIN_FREE_GB="$MIN_FREE_GB" SMOKE_FILE="$SMOKE_FILE" \
  WORK="$WORK" OUT_PATH="$path" bun -e '
    const env = process.env;
    const num = (value) => (value === "" || value === undefined ? null : Number(value));
    const ms = num(env.COMP_MS);
    const tokens = num(env.TOKENS);
    const report = {
      kind: "starling.fully-open.smoke",
      schemaVersion: 1,
      status: env.STATUS,
      detail: env.DETAIL,
      startedAt: new Date(Number(env.STARTED)).toISOString(),
      finishedAt: new Date(Number(env.FINISHED)).toISOString(),
      host: { name: env.HOST_NAME, profile: env.HOST_PROFILE, memGb: num(env.MEM_GB) },
      model: env.MODEL,
      mode: env.MODE,
      ollama: { url: env.OLLAMA_URL },
      rails: {
        maxOpencode: num(env.MAX_OPENCODE),
        opencodeProcesses: num(env.PROCS),
        freeGb: num(env.FREE_GB),
        freePercent: num(env.FREE_PCT),
        minFreeGb: num(env.MIN_FREE_GB),
      },
      workDir: env.WORK,
      opencode: { wallMs: num(env.OC_MS), textChars: num(env.CHARS) },
      tools: { file: env.SMOKE_FILE, fileWritten: env.WRITTEN === "yes" },
      completion: {
        wallMs: ms,
        completionTokens: tokens,
        tokensPerSec: ms !== null && ms > 0 && tokens !== null ? Number((tokens / (ms / 1000)).toFixed(2)) : null,
      },
    };
    await Bun.write(env.OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`wrote ${env.OUT_PATH}`);
  '
}

# ── main ─────────────────────────────────────────────────────────────────────
MODEL="$(resolve_model)"
OLLAMA_V1="$OLLAMA_URL/v1"
WORK="$(mktemp -d "${TMPDIR%/}/starling-fully-open.XXXXXX")"
cleanup() {
  if [ "$LOADED" -eq 1 ] && [ "$KEEP_LOADED" -ne 1 ]; then unload_model; fi
}
trap cleanup EXIT

log "🐦 fully-open smoke — model $MODEL on $(host_profile), ollama $OLLAMA_URL"

# ── dry run: describe exactly what a real run would do, touch nothing ─────────
if [ "$DRY_RUN" -eq 1 ]; then
  log ""
  log "PLAN OF ACTION (dry run — no network call, no model load)"
  log "  1. read    $RECOMMENDATION for host $(host_profile)"
  log "             resolved model: $MODEL  (STARLING_LOCAL_MODEL wins when set)"
  log "  2. gate    L31: ≤ $MAX_OPENCODE opencode processes and ≥ $MIN_FREE_GB GB free"
  report_rails
  log "  3. write   $WORK/opencode.json  (providers.ollama → $OLLAMA_V1, modelID $MODEL)"
  if [ -f "$STARLING_CLI" ] && bun "$STARLING_CLI" run --help 2>&1 | grep -q -- '--profile'; then
    log "  4. run     starling run \"add a footer stat showing done/total tasks\" --profile local"
    log "             in a copy of examples/sky-todo ($SKY_TODO)"
    log "  5. measure the run's own token usage and elapsed time"
  else
    log "  4. run     opencode run --standalone --auto -m ollama/$MODEL  (Epic 40's --profile is not on main)"
    log "             prompt: $PROMPT"
    log "  5. check   $WORK/$SMOKE_FILE exists (proves the model used tools)"
  fi
  log "  6. measure one non-streamed completion on $OLLAMA_V1/chat/completions for tokens/second"
  log "  7. unload  $MODEL via keep_alive:0 (unless --keep-loaded)"
  log "  8. write   $RESULTS_DIR/smoke-<host>-<model>-<ts>.json"
  log ""
  log "dry run complete — nothing was loaded and Ollama was not contacted."
  rm -rf "$WORK"
  exit 0
fi

report_rails

if ! curl -s --max-time 5 "$OLLAMA_URL/api/tags" -o "$WORK/tags-before.json"; then
  log "✘ Ollama is not answering at $OLLAMA_URL — start it with 'ollama serve'."
  write_report "failed" "ollama unreachable" "none" "$(now_ms)" "$(now_ms)" 0 0 0 0 no
  exit 1
fi

# L31: wait for the quiet window. Polling forever would break the "never stop" rule, so cap it.
if ! rails_ok; then
  if [ "$FORCE" -eq 1 ]; then
    log "! --force: skipping the L31 quiet window (this may swap or OOM the laptop)"
  else
    log "… waiting for the L31 quiet window (poll ${POLL_SECONDS}s, max ${MAX_WAIT_SECONDS}s)"
    waited=0
    until rails_ok; do
      if [ "$waited" -ge "$MAX_WAIT_SECONDS" ]; then
        log "✘ no quiet window after ${waited}s — deferring the live smoke (nothing was loaded)."
        report_rails
        write_report "deferred" "L31 quiet window did not arrive within ${MAX_WAIT_SECONDS}s" "none" \
          "$(now_ms)" "$(now_ms)" 0 0 0 0 no
        exit 3
      fi
      sleep "$POLL_SECONDS"
      waited=$((waited + POLL_SECONDS))
      log "  ${waited}s: $(opencode_count) opencode · $(free_gb) GB free"
    done
  fi
fi

STARTED="$(now_ms)"
STATUS="ok"
DETAIL=""
MODE="opencode-run"
OC_MS=0
CHARS=0
TOKENS=0
COMP_MS=0
WRITTEN="no"

write_project_config "$WORK"
log "  project config → $WORK/opencode.json"

# Preferred path: the real harness, when Epic 40's `--profile` flag is on main.
if [ -f "$STARLING_CLI" ] && bun "$STARLING_CLI" run --help 2>&1 | grep -q -- '--profile'; then
  MODE="starling-run"
  log "→ starling run --profile local (one task, fresh sky-todo copy)"
  REPO="$WORK/sky-todo"
  cp -R "$SKY_TODO" "$REPO"
  # A fresh, committed repo: `starling run` needs a base branch and a clean tree.
  git -C "$REPO" init -q
  git -C "$REPO" add -A
  git -C "$REPO" commit -qm "smoke: fresh sky-todo"
  LOADED=1
  OC_START="$(now_ms)"
  if ( cd "$REPO" && STARLING_LLM_PROFILE=local STARLING_LOCAL_MODEL="$MODEL" \
        bun "$STARLING_CLI" run "add a footer stat showing done/total tasks" --repo . --profile local --no-dash ); then
    OC_MS=$(( $(now_ms) - OC_START ))
    # The harness merges into an integration branch, so "tools worked" means the worktree changed.
    if [ -f "$REPO/$SMOKE_FILE" ] || [ "$(git -C "$REPO" diff --name-only | wc -l | tr -d ' ')" -gt 0 ]; then
      WRITTEN="yes"
    else
      STATUS="partial"; DETAIL="starling run finished but changed nothing"
    fi
  else
    STATUS="failed"; DETAIL="starling run --profile local exited non-zero"
  fi
else
  log "→ opencode run --standalone -m ollama/$MODEL (Epic 40's --profile is not on main yet)"
  LOADED=1
  OC_START="$(now_ms)"
  if ( cd "$WORK" && opencode run --standalone --auto --format json -m "ollama/$MODEL" "$PROMPT" ) \
      >"$WORK/opencode.out" 2>"$WORK/opencode.err"; then
    OC_MS=$(( $(now_ms) - OC_START ))
    CHARS="$(wc -c <"$WORK/opencode.out" | tr -d ' ')"
    if [ -f "$WORK/$SMOKE_FILE" ]; then
      WRITTEN="yes"
    else
      STATUS="partial"; DETAIL="the model answered but did not write $SMOKE_FILE (no tool use)"
    fi
  else
    STATUS="failed"; DETAIL="opencode run failed (see $WORK/opencode.err)"
    OC_MS=$(( $(now_ms) - OC_START ))
  fi
fi

# Honest tokens/second on the endpoint both opencode's provider and the router call, now warm.
if [ "$STATUS" != "failed" ]; then
  request="$(MODEL_CHAT="$MODEL" PROMPT_CHAT="$PROMPT" bun -e '
    console.log(JSON.stringify({
      model: process.env.MODEL_CHAT,
      messages: [{ role: "user", content: process.env.PROMPT_CHAT }],
      temperature: 0,
      max_tokens: 64,
      stream: false,
    }));
  ')"
  COMP_MS="$(curl -s --max-time 300 "$OLLAMA_V1/chat/completions" \
      -H 'content-type: application/json' -d "$request" \
      -o "$WORK/completion.json" -w '%{time_total}' | awk '{ printf "%.0f", $1 * 1000 }')"
  TOKENS="$(jget "$WORK/completion.json" 'usage.completion_tokens')"
  [ -n "$TOKENS" ] || TOKENS=0
fi

FINISHED="$(now_ms)"
log ""
log "status: $STATUS ${DETAIL:+($DETAIL)}"
log "  opencode one-shot: ${OC_MS} ms, ${CHARS} bytes of output, tools used: $WRITTEN"
log "  tokens/s:          $(awk -v t="$TOKENS" -v ms="$COMP_MS" 'BEGIN { if (ms > 0) printf "%.2f (%d tokens in %d ms)", t / (ms / 1000), t, ms; else print "n/a" }')"
log "  ollama after:      $(curl -s --max-time 5 "$OLLAMA_URL/api/ps" | bun -e 'try { const d = await Bun.stdin.json(); console.log((d.models ?? []).map((m) => m.name).join(", ") || "nothing loaded"); } catch { console.log("?") }')"

write_report "$STATUS" "${DETAIL:-}" "$MODE" "$STARTED" "$FINISHED" "$OC_MS" "$CHARS" "$TOKENS" "$COMP_MS" "$WRITTEN"
case "$STATUS" in
  ok) exit 0 ;;
  partial) exit 4 ;;
  *) exit 1 ;;
esac
