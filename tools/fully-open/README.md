# Fully-open mode — every role on local open-weight models

Starling's promise is that a goal can become a merged change **without a token leaving the laptop**.
`STARLING_LLM_PROFILE=local` (or `starling run … --fully-open`) is that promise: planner, workers,
resolver, auditor, summarizer and writer all run on one Ollama model, and the cost meter reads
exactly `$0.00` because every call is a loopback call.

It is slower than DeepSeek. It is also the strongest open-source story, and it is one flag away from
the demo default.

| Profile    | planner        | worker / resolver | auditor / summarizer / writer |
| ---------- | -------------- | ----------------- | ----------------------------- |
| `deepseek` | DeepSeek       | DeepSeek          | Ollama (local)                |
| `opencode` | opencode → any | opencode → any    | opencode → any                |
| `mixed`    | opencode       | opencode          | Ollama **if available**, else opencode |
| `local`    | Ollama         | opencode → Ollama | Ollama                        |

`mixed` is the demo default because it keeps the two places where a cheap model hurts (planning and
diff-writing) on DeepSeek while moving the high-volume judging and prose to the laptop. `local` is
`--fully-open`.

### Status on this branch

`@starling/llm` resolves all four profiles today (`resolveLLMProfile`, `createLLMFromEnv`), and the
`mixed` fallback probes Ollama lazily at call time. What is **not** on `main` yet:

- the CLI's real composition (Epic 40) — until it lands, `starling run` is the mock engine, so the
  `starling` lines below are marked "(after Epic 40)";
- a `run --profile` flag and `describeProfile()` in `starling doctor` — filed as a FIX REQUEST in
  `.orchestrator/handbacks/51-fully-open.md`;
- the exports needed to import the new helpers from `@starling/llm`'s root (same FIX REQUEST).

`STARLING_LLM_PROFILE` and the recommendation file already work for anything that calls
`createLLMFromEnv()`.

## Why workers still go through opencode in `local`

Workers are not an HTTP call: a worker is an opencode **session** with tools, a worktree and a
permission model. So `models.worker` is `{ provider: 'ollama', model: 'qwen3.8:27b-mlx' }`, which the
runner sends to opencode as `providerID: 'ollama'`, `id: 'qwen3.8:27b-mlx'`. opencode then calls
Ollama on `http://localhost:11434/v1`. Same weights, same laptop, no cloud — a different road.

The router (planner/auditor/summarizer/writer) calls that same Ollama endpoint directly as an
OpenAI-compatible provider. One model serves both paths.

## Files

| File                  | What it is                                                                 |
| --------------------- | -------------------------------------------------------------------------- |
| `opencode-ollama.json`| A **project-level** opencode config that declares the `ollama` provider and the model. Copy or merge it into the target repo's `opencode.json`. Never edit `~/.config/opencode/opencode.json`. |
| `smoke.sh`            | The L31-gated end-to-end smoke: quiet window → one tiny task → tokens/s → unload. `--dry-run` prints the plan and calls nothing. |
| `check-config.ts`     | `bun tools/fully-open/check-config.ts` — validates the JSON against the compiled-in local profile; used by the test, handy by hand. |
| `check-config.test.ts`| Guards the JSON shape, the package/settings v2 fields and the default model. |
| `results/`            | Smoke reports (`smoke-<host>-<model>-<ts>.json`), created by `smoke.sh`.   |

Profile *resolution* lives in the product, not here:
`@starling/llm`'s `packages/llm/src/profiles.ts` (`applyProfile`, `resolveProfile`),
`profiles-recommend.ts` (`chooseLocalModel`) and `profiles-probe.ts` (`probeOllama`).

## opencode investigation (2.1.2, checked 2026-10-27)

The installed CLI is **opencode v2.1.2** (a background service; `serve` is the "v2 API and web
server"). Findings that shaped this config:

1. **Config discovery is project-first.** `opencode.json` in the working directory is read and shown
   by `opencode debug config` (a `type: "document"` entry with its absolute path). The user's global
   files (`~/.config/opencode/opencode.json`, `opencode.jsonc`) are merged underneath. Setting
   `OPENCODE_CONFIG` did *not* add an extra document on 2.1.2, so this repo uses the project file.
2. **v2 spells it `providers` (plural).** `https://opencode.ai/config.json` (the `$schema` opencode
   itself points at) has `providers: Record<string, Config.ProviderEncoded>`; the v1 `provider`
   (singular, with `npm` + `options.baseURL`) is still in the schema marked `deprecated`. The v2
   provider entry has `name`, `env`, `package`, `compatibility`, `settings`, `headers`, `body` and
   `models`; there is **no top-level `options.baseURL`** any more. `settings` is an open bag, so a
   non-default Ollama URL goes in `providers.ollama.settings.baseURL` — verify with `opencode models`
   after changing it.
3. **A model ref is `providerID/modelID`.** The v2 config normalises the string `model` field into
   `{ providerID, model }`; Starling stores the string form and splits it on the first `/`.
4. **Ollama is auto-detected on the default port.** With Ollama running, `opencode models` lists
   `ollama/qwen3.8:27b-mlx` even with no provider config at all. The checked-in JSON therefore only
   has to *pin* that provider and the model (and to keep working on a machine where auto-detection
   is off, e.g. a custom port or a fresh install).
5. **Tool calls need context.** opencode's own Ollama docs suggest raising `num_ctx` to 16k–32k when
   a local model is weak at tools. `qwen3.8:27b-mlx` runs with a 32k context in Ollama 0.40.8 on the
   M5 Pro; the auditor path needs no tools, the worker path does.
6. **`--standalone` is the safe one-shot.** `opencode run --standalone --auto --format json -m
   ollama/<tag> "<prompt>"` starts a private server for the call instead of touching the shared
   background service, which is what several parallel agents use.

## Use it

```bash
# 1. Ollama, with the model the benchmark recommends (default: qwen3.8:27b-mlx)
ollama pull qwen3.8:27b-mlx

# 2. Fully local, one flag (or STARLING_LLM_PROFILE=local)  [after Epic 40]
starling run "add a footer stat showing done/total" --repo ../sky-todo --fully-open

# 3. The demo default: mixed, local auditor when Ollama answers  [after Epic 40]
starling run "add a footer stat showing done/total" --repo ../sky-todo

# 4. See what a profile resolves to, without a model load
STARLING_LLM_PROFILE=local starling doctor   # once the CLI prints describeProfile() [FIX REQUEST]

# 5. Prove the opencode→Ollama path (see L31 below before running)
tools/fully-open/smoke.sh --dry-run
tools/fully-open/smoke.sh
```

Environment knobs (all optional):

| Variable                 | Effect                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| `STARLING_LLM_PROFILE`   | `deepseek` \| `opencode` \| `mixed` \| `local`; `fully-open` is an alias for `local`. |
| `STARLING_LOCAL_MODEL`   | Force the Ollama tag, beating the benchmark recommendation.            |
| `STARLING_LOCAL_PROFILE` | `mbp` \| `air` — which recommendation row to read (default: RAM ≥ 24 GB → `mbp`). |
| `OLLAMA_URL`             | Where `smoke.sh` probes and unloads (default `http://127.0.0.1:11434`). |

## Recommended model (and where the number comes from)

`tools/local-models/results/recommendation.json`, written by Epic 28's bench, is the source of
truth per laptop: `{ "mbp": { "auditor": …, "summarizer": … }, "air": { … } }`. Starling uses the
`auditor` pick for reasoning roles and the `summarizer` pick for prose roles.

If the file is missing (fresh clone), malformed, or has no row for this host, the built-in default is
**`qwen3.8:27b-mlx`** — measured on the M5 Pro at ~18 GB resident, ~18 tok/s warm, and correct on the
auditor probe (`tools/local-models/results/smoke-*.json`, `docs/epic-28-local-bench.md`). A missing
file is a log line, never an error: `--fully-open` must work on day one.

## L31 memory rails

Local models are 18 GB of wired memory. Twenty parallel opencode sessions plus a 27B model is how a
32 GB Mac reaches 4 % free RAM, so `smoke.sh` refuses to load anything unless **both** hold:

- `pgrep -f opencode | wc -l` ≤ **3** (macOS `pgrep` has no `-c`, so the script counts lines);
- at least **22 GB** free, computed from `vm_stat` as
  `(free + inactive + speculative) × page_size`.

It polls every **60 s** for up to **90 min** and then gives up (`exit 3`, status `deferred`) without
loading a model. `--force` overrides the rails for a machine you know is idle. `--dry-run` measures
the rails and prints every command a real run would execute — it makes **no Ollama request**, starts
**no opencode process** and writes **no config**, so it is safe on a laptop with twenty agents on it.

Before any load, `smoke.sh` also checks that `opencode models` lists `ollama/<tag>` **from the
generated project config** — a config typo should cost a second, not a 20-minute model load. The
generated file is derived from `opencode-ollama.json`, so the unit test's verdict applies to what the
smoke actually uses: one template, one source of truth.

`bun tools/fully-open/check-config.ts` runs the same checks by hand (non-zero exit on drift). It
imports `LOCAL_DEFAULT_MODEL` / `LOCAL_BASE_URL` from `@starling/llm`'s `profiles.ts` by relative path
on purpose: if the compiled-in default changes, the shipped JSON must change with it.

`memory_pressure`'s "free percentage" is much more optimistic than the GB count because it treats
inactive and purgeable pages as available; the script prints both but **gates on GB**, which is the
conservative number. Symptom of ignoring it: swap, then a run that takes ten minutes per audit.

## Reading a smoke report

```json
{
  "status": "ok",
  "mode": "opencode",
  "model": "qwen3.8:27b-mlx",
  "rails": { "opencodeProcesses": 2, "freeGb": 23.4, "minFreeGb": 22 },
  "task": { "wallMs": 41000, "changedFiles": 2 },
  "completion": { "wallMs": 5828, "completionTokens": 102, "tokensPerSec": 17.5 }
}
```

`task` is the one-shot on a fresh sky-todo; `changedFiles: 0` fails the smoke, because a provider
that answers but cannot edit is not "fully open". `completion` is measured against the
OpenAI-compatible endpoint both opencode's provider and the router use, after the opencode call has
warmed the model — that is the honest steady-state number.
Time-to-first-token is deliberately not reported here; Epic 28's bench measures it (streamed) and
this script does not pretend to.

## Troubleshooting

- **`model not found` from opencode** — the tag in `opencode-ollama.json` must equal `ollama list`
  exactly (`qwen3.8:27b-mlx`, no `:latest` guessing).
- **`opencode models` does not show `ollama/…`** — Ollama is not running, or it is on a non-default
  host. Start `ollama serve`, then set `providers.ollama.settings.baseURL` and re-check.
- **Audits fail with `LLM_BAD_JSON`** — the local model produced prose instead of JSON. The router
  already repairs twice; a smaller model may need `temperature: 0` (the auditor does) and a longer
  context. This is the known cost of the smallest laptops.
- **The run is very slow but works** — expected. `local` is for the open-weight story, not for
  throughput; `mixed` exists for the demo.
