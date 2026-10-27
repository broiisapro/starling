# Epic 51 — Fully-open mode (all roles on local open-weight models)

## Goal

Make "one goal in, a murmuration out — with no token leaving the laptop" a real, testable routing
mode. That means three things:

1. a `local` profile where **every** role (planner, workers, resolver, auditor, summarizer, writer)
   runs on one Ollama model, including the coding workers, which are opencode sessions rather than
   HTTP calls;
2. a `mixed` profile — the demo default — that keeps planning and diff-writing on DeepSeek via
   opencode and sends the high-volume judging and prose to the laptop **when Ollama is reachable and
   the model is pulled**, falling back to opencode with a warning otherwise;
3. the plumbing that makes those two honest: which model to pick per laptop, whether Ollama is
   actually usable, and what opencode needs in its config to reach it.

This revision of the epic (fix1) **did not run a local model**. Twenty-plus agents share this
machine; ARCHITECTURE §7 L31 forbids Ollama this wave. Everything that needs a live model is built,
unit-tested against in-process fakes, and wired into a smoke script for Epic 72 ("local model day").

## How it works

### Profiles (`packages/llm/src/profiles.ts`)

`STARLING_LLM_PROFILE` selects one of four routing tables; `fully-open` is accepted as an alias for
`local`, and an unknown value is a `CONFIG_INVALID` error rather than a silent fallback.

| Profile    | planner | worker / resolver     | auditor / summarizer / writer        |
| ---------- | ------- | --------------------- | ------------------------------------ |
| `deepseek` | deepseek | deepseek             | ollama (the config default)           |
| `opencode` | opencode → whatever the user's opencode server is logged into | | |
| `mixed`    | opencode | opencode             | ollama **if available**, else opencode |
| `local`    | ollama   | ollama via opencode  | ollama                                |

`resolveProfile(config, profile, options)` is pure (never mutates its input) and returns the new
config **plus** the warnings, notes, and which roles end up local vs. through opencode.
`applyProfile` is the config-only convenience wrapper; `describeProfile` renders one line per role for
`starling doctor` and the dashboard.

Two details are worth stating because they are easy to get wrong:

- **Workers are "local" through a different road.** A worker is an opencode session with tools, so
  `models.worker` is `{ provider: 'ollama', model: '<tag>' }`: the runner forwards that as opencode's
  `providerID`/`modelID`, and opencode calls the same Ollama on the same port. Same weights, same
  laptop, no cloud.
- **A local model is not automatically free.** Only an OpenAI-compatible provider on a loopback host
  is `local: true`/`costUsd: 0`; the opencode server is local but proxies upstream, so it stays
  billable. The cost meter therefore reads `$0.00` for `local` — and only for `local`.

### Which local model (`packages/llm/src/profiles-recommend.ts`)

Precedence: `STARLING_LOCAL_MODEL` → `tools/local-models/results/recommendation.json` for this
laptop's profile → the compiled-in `qwen3.8:27b-mlx`.

The host profile is `STARLING_LOCAL_PROFILE` if set, else RAM (≥ 24 GB → `mbp`, otherwise `air`),
matching the two laptops in ARCHITECTURE §1. The recommendation's `auditor` pick is used for the
reasoning roles and its `summarizer` pick for the prose roles — judging a diff is harder than writing
a PR body, so benchmarking two roles is the point. A missing, malformed or partial file is a warning
and a note, never an error: `--fully-open` has to work on a fresh clone before anyone has benchmarked
anything.

### Is Ollama usable (`packages/llm/src/profiles-probe.ts`)

`probeOllama()` asks Ollama's native `/api/tags` (not `/v1/models`) with a 1.5 s timeout and answers
`ok`, `reachable`, `models`, `hasModel`, a warning `code`, and a log-safe `detail`. It never throws.

"Available" deliberately means **both** "the daemon answers" and "the chosen tag is present".
Checking only the port produces a run that dies on the first audit with a 404 — worse than falling
back.

### Wiring (`packages/llm/src/env.ts`)

- `resolveLLMProfile(opts)` is synchronous and side-effect free: it reads config and the
  recommendation file, and never touches Ollama. This is what `starling doctor` should call.
- `createLLMFromEnv(opts)` builds the `LLM` client. For `mixed` it wraps the client so the first call
  to a local role probes Ollama (result cached for `MIXED_PROBE_TTL_MS` = 60 s). If the daemon is
  down or the tag is missing, that call and every later one go to opencode and a `log`/`warn` event
  is published (and `onWarning` is called for callers without an `EventBus`). Probing lazily means a
  run never fails to *start* because Ollama was slow, and a model pulled mid-run is picked up without
  a restart.
- `opencodeFallbackConfig(config, roles)` is exported so the auditor (Epic 44) can reuse exactly the
  same fallback table instead of inventing a second one.

### opencode's side (`tools/fully-open/`)

`opencode-ollama.json` is a **project-level** opencode config. Findings from the installed CLI
(opencode **2.1.2**, 2026-10-27):

1. v2 spells the key **`providers`** (plural) and dropped `provider` (singular) and
   `options.baseURL`. A provider entry has `name`, `package`, `settings`, `models`; a model entry has
   `modelID`, `capabilities`, `limit`.
2. opencode 2.x ships a built-in `opencode.provider.ollama` plugin whose origin is
   `http://127.0.0.1:11434`; it discovers tags from `/api/tags` (+ `/api/show` for context/tools) and
   merges them into `providers.ollama`. So on the default port it works with **no** provider block;
   the checked-in JSON *pins* the provider (non-default port, disabled auto-detection) and seeds the
   recommended tag so a worker can start before discovery finishes.
3. The provider client is `@opencode/ai/providers/openai-compatible`, and the OpenAI-compatible base
   URL is `…/v1` while discovery strips that suffix.
4. Config discovery is project-first: `opencode.json` in the working directory, with the user's
   global config merged underneath. We never edit the global file.
5. `opencode run --standalone` starts a private server for one call instead of touching the shared
   background service that twenty agents are using on this machine.

`check-config.ts` validates the JSON against the compiled-in profile (provider id, package, base URL,
model key/`modelID`, tool capability, default model) and is exercised by `check-config.test.ts`; it
also runs by hand and exits non-zero on drift.

`smoke.sh` is the end-to-end proof for Epic 72: L31 quiet window (≤ 3 `opencode` processes, ≥ 22 GB
free) → throwaway project config derived from the same JSON → one tiny task → `starling run
--profile local` when the real CLI composition is on main, otherwise `opencode run --standalone -m
ollama/<tag>` → verify the model actually used a tool (the starling path must change the worktree,
the opencode path must write `LOCAL_SMOKE.md`; otherwise exit 4, "answered but did not use tools") →
measure tokens/s on the OpenAI-compatible endpoint → unload (`keep_alive: 0`). `--dry-run` prints that
plan and exits before any network call, any opencode process or any config write.

## Key decisions & reasoning

- **`mixed` moves the auditor, summarizer *and* writer; planner/worker/resolver stay on opencode.**
  A wrong plan or a wrong diff costs more than a token bill; judging a diff and writing a PR body are
  high-volume and tolerant. The names are published in `MIXED_LOCAL_ROLES` / `MIXED_CLOUD_ROLES` so
  Epic 44 can agree rather than duplicate.
- **Local-first when availability is unknown (`mixed`).** Resolution cannot probe (it is sync, used
  by `doctor` and tests), so the default is "stay local and let the runtime decide". The fallback is
  a *runtime* behaviour, not a config rewrite.
- **Probe the tag, not the port.** Cheap, and it removes the most common demo failure.
- **Probe lazily with a 60 s TTL.** No startup stall; a mid-run `ollama pull` is picked up.
- **One Ollama model for every role, with an optional smaller prose model.** A second 4 B model
  doubles the memory pressure for a job (PR bodies) where quality barely matters; the recommendation
  file can still name one.
- **Ship the opencode config as a file, not a plugin.** It is reviewable, diffable, and the test can
  assert on it. Generating it from code would hide the drift the checker exists to catch.
- **Never import `@starling/llm` from `tools/fully-open`.** `tools/` is not a workspace package, so
  the checker imports `profiles.ts` by relative path; a relative import keeps the drift test honest
  without adding a dependency.

## Interfaces for future epics

- `parseProfile(value)` → `LLMProfileName`; `resolveProfile(config, profile, options)` →
  `{ profile, config, warnings, notes, localRoles, opencodeRoles }`; `applyProfile(...)`;
  `describeProfile(resolution)` → `string[]`.
- `resolveLLMProfile(opts)` (sync), `createLLMFromEnv(opts)`, `reportProfile(resolution, opts)`,
  `opencodeFallbackConfig(config, roles)`.
- `probeOllama({ baseUrl, model, fetch, timeoutMs })` → `OllamaProbe`; `nativeOllamaUrl(url)`.
- `chooseLocalModel(opts)` → `{ model, smallModel, host, source, warnings }`;
  `readRecommendation(opts)`, `parseRecommendation(raw)`, `hostProfile(opts)`,
  `RECOMMENDATION_RELATIVE_PATH`.
- Warning codes shared with the auditor: `'local-unavailable' | 'local-model-missing'`.
- Env: `STARLING_LLM_PROFILE` (`deepseek|opencode|mixed|local|fully-open`), `STARLING_LOCAL_MODEL`,
  `STARLING_LOCAL_PROFILE` (`mbp|air`).
- Epic 44 (auditor): use `models.auditor` + `opencodeFallbackConfig(config, ['auditor'])` and the two
  warning codes; do not add a second probe.
- Epic 40/22 (engine/CLI): call `createLLMFromEnv()` once per run; add `--profile`/`--fully-open` as a
  setter for `STARLING_LLM_PROFILE` and print `describeProfile()` from `starling doctor`.
- Epic 72 (local model day): run `bash -n tools/fully-open/smoke.sh`, then
  `tools/fully-open/smoke.sh --dry-run`, then the real run, and commit the report from
  `tools/fully-open/results/`.

## Deviations from plan

- The live fully-local smoke was **deferred to Epic 72**, by instruction (L31 revised: no Ollama this
  wave). The rails are in the script, not in this session.
- Two test files inside `packages/llm` are outside the literal lane
  (`src/index.test.ts`, `src/routing.test.ts`): adding `mixed` to the exported `LLM_PROFILES` and
  changing the `local` default model makes the old assertions fail. Test-only edits, no production
  file outside the lane was touched. Listed in the handback as well.
- The `local` profile names workers `{ provider: 'ollama' }` rather than a separate
  `opencode-ollama` provider id: opencode's providerID for local Ollama *is* `ollama`, so one string
  serves both the router and the runner.

## Known limitations / deferred

- **No live numbers.** Tokens/second, verdict quality and merge success on a real local model are
  unmeasured here; Epic 28's bench remains the only measurement source, and Epic 72 will run the
  smoke.
- **`mixed` falls back per call, not per run.** A flapping Ollama can send an auditor call to
  opencode mid-run; the warning makes it visible, but the dashboard does not yet surface it as a
  metric.
- **The fallback changes the model, not the prompt.** A worker prompt written for DeepSeek is reused
  unchanged; on a very small local model, lint-quality output may still pass the auditor's command
  checks while being stylistically poor.
- **No `starling doctor` line yet.** `describeProfile()` exists but the CLI is Epic 40's lane; until
  it calls it, users see warnings only through the event log.
- **opencode config is not validated by opencode in CI.** The checker mirrors the v2 schema by hand;
  `opencode debug config` on the real machine is the final word, and `smoke.sh` checks it there.
