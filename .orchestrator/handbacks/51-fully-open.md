## Epic 51 Handback — Fully-open mode (all roles local)

**Status:** Complete for this wave (the live local-model smoke is deferred to Epic 72 by instruction).
Branch `epic/51-fully-open` (six commits; rebased on `origin/main` before pushing).

**Delivered:**

- **Profiles** (`packages/llm/src/profiles.ts`): `LLM_PROFILES` is now
  `['opencode','deepseek','local','mixed']`; `parseProfile` accepts the `fully-open` alias and throws
  `StarlingError('CONFIG_INVALID')` on anything else; `resolveProfile(config, profile, options)` is
  pure and returns `{ config, warnings, notes, localRoles, opencodeRoles }`; `applyProfile` and
  `describeProfile` are the config-only and human-readable views. `local` routes all six roles to
  Ollama (workers/resolver via opencode's `ollama` providerID), `mixed` keeps
  planner/worker/resolver on opencode and sends auditor/summarizer/writer local, with an explicit
  fallback table and warning when Ollama is unavailable.
- **Model choice** (`packages/llm/src/profiles-recommend.ts`): `chooseLocalModel` with precedence
  `STARLING_LOCAL_MODEL` → `tools/local-models/results/recommendation.json` (per-laptop row:
  `auditor` pick for reasoning, `summarizer` pick for prose) → the compiled-in `qwen3.8:27b-mlx`;
  `hostProfile` from `STARLING_LOCAL_PROFILE` or RAM (≥ 24 GB → `mbp`); a missing/malformed file is a
  warning + note, never an error. `readRecommendation`, `parseRecommendation`,
  `RECOMMENDATION_RELATIVE_PATH` exported.
- **Availability probe** (`packages/llm/src/profiles-probe.ts`): `probeOllama` against Ollama's
  native `/api/tags` with a 1.5 s timeout; distinguishes `local-unavailable` (daemon down/timeout/
  garbage) from `local-model-missing` (daemon up, tag not pulled); never throws.
- **Env wiring** (`packages/llm/src/env.ts`): `resolveLLMProfile` (sync, never touches Ollama),
  `reportProfile` (EventBus `log` events + `onWarning`), `opencodeFallbackConfig`,
  `createLLMFromEnv` with a lazy `mixed` probe cached for `MIXED_PROBE_TTL_MS` (60 s) so a run starts
  even when Ollama is slow and a mid-run `ollama pull` is picked up.
- **opencode side** (`tools/fully-open/`): `opencode-ollama.json` (v2 shape: `providers.ollama` with
  `package`, `settings.baseURL`, `models.<tag>.modelID`, `capabilities.tools`, `limit.context`),
  `README.md` (installed-opencode investigation, usage, env knobs, L31 rails, troubleshooting),
  `check-config.ts` (+ `check-config.test.ts`) which validates the JSON against the compiled-in
  profile and runs as a CLI, and `smoke.sh` for Epic 72 (`--dry-run` plan, L31 quiet window,
  throwaway project config derived from the checked-in JSON, one tool-requiring task, tokens/s,
  `keep_alive: 0`, exit 4 when the model answered but used no tool).
- Tests: 103 in `packages/llm` (100 pass / 3 live-skip), 12 in `tools/fully-open` — covering profile
  routing, unknown-profile rejection, non-mutation, provider existence for every profile, the
  worker↔opencode `ollama` id, mixed fallback (daemon down, model missing, TTL re-probe, preflight,
  `skipLocalProbe`), probe timeouts/garbage/HTTP errors, recommendation precedence and
  missing/malformed files, host detection, and config drift.

**Key design decisions:**

- **Workers are local through opencode, not through the router.** A worker is an opencode session, so
  `models.worker = { provider: 'ollama', model: '<tag>' }` is forwarded as
  `providerID`/`modelID`. One tag, one laptop, no cloud, and the cost meter can still say `$0.00`
  honestly (opencode itself is *not* marked local, because it may proxy to a paid model).
- **`mixed` is local-first at resolution time, runtime-decided at call time.** Resolution is
  synchronous and side-effect free (used by `doctor` and tests), so it cannot probe. The lazy,
  60-s-cached probe in `createLLMFromEnv` makes the decision where it belongs and publishes a
  `log`/`warn` event when it falls back.
- **Probe the tag, not the port.** A port-only check produces a run that dies on the first audit with
  a 404, which is worse than falling back.
- **Mirror the benchmark as a file, not a call.** `recommendation.json` is read synchronously and
  tolerated when absent; `--fully-open` must work on a fresh clone before anyone benchmarks a laptop.
- **Check the opencode config in a unit test.** The config is the single most fragile part of the
  promise (a missing `package` yields `provider.no-route`, a missing `modelID` silently drops the
  entry), and it can be guarded without a model on disk.

**Verification (exact commands + results):**

- `bun install` (worktree): `Checked 162 installs across 221 packages (no changes)` — clean.
- `bun test packages/llm`: `100 pass, 3 skip, 0 fail, 363 expect() calls; Ran 103 tests across 11 files`.
- `bun test tools/fully-open`: `12 pass, 0 fail, 25 expect() calls; Ran 12 tests across 1 file`.
- `bash -n tools/fully-open/smoke.sh` → exit 0. `tools/fully-open/smoke.sh --dry-run` → prints the
  8-step plan, the resolved tag (`qwen3.8:27b-mlx`), the recommendation path and the live rail
  measurements (`31 opencode processes`, `7.6 GB free` → `rails: defer`), then exits 0 with
  `dry run complete — nothing was loaded and Ollama was not contacted.`
- `bun tools/fully-open/check-config.ts --file <generated> --model qwen3.8:27b-mlx` → `ok`: the config
  `smoke.sh` derives from the checked-in template passes the same checks as the template itself.
- `bun run test` (root):
  - packages/apps/cli/server/skills/integrations/tools/evals: `1412 pass, 4 skip, 0 fail, 6471 expect() calls; Ran 1416 tests across 166 files`
  - apps/web: `426 pass, 0 fail, 3527 expect() calls; Ran 426 tests across 39 files`
- `bun run check`: exit 0 — `biome check .` clean on 715 files, `tsc --noEmit` clean for every workspace.
- **No Ollama was touched by this session** (no `ollama` command, no request to `127.0.0.1:11434`, no
  model load). An earlier revision of `smoke.sh` on this branch probed `/api/tags` during
  `--dry-run`; the shipped revision exits before that call. `tools/fully-open/results/` holds one
  `dry-run` report as evidence of the rails, not of a load.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. **FIX REQUESTS:**

1. `packages/llm/src/index.ts` (not in this lane; consumers can only import the package root) — export
   the new surface so the CLI, engine and auditor can use it:

   ```ts
   export { createLLMFromEnv, opencodeFallbackConfig, reportProfile, resolveLLMProfile } from './env';
   export type { EnvProfileOptions } from './env';
   export type { LocalHostProfile, LocalModelChoice } from './profiles-recommend';
   export {
     chooseLocalModel, hostProfile, parseRecommendation, readRecommendation,
     RECOMMENDATION_RELATIVE_PATH,
   } from './profiles-recommend';
   export type { OllamaProbe, OllamaProbeOptions } from './profiles-probe';
   export { nativeOllamaUrl, probeOllama } from './profiles-probe';
   export type { ProfileResolution, ProfileWarning, ProfileWarningCode } from './profiles';
   export {
     describeProfile, LOCAL_BASE_URL, LOCAL_PROVIDER, MIXED_CLOUD_ROLES, MIXED_LOCAL_ROLES,
     resolveProfile,
   } from './profiles';
   ```

   Why: `starling doctor` should print `describeProfile(resolveLLMProfile())`, and Epic 44 wants
   `opencodeFallbackConfig` instead of a second fallback table. Without the exports those callers
   must deep-import `@starling/llm/src/...`, which the package `exports` map forbids.
2. `apps/cli` (Epic 40/22) — `starling run … --profile <name>` / `--fully-open` mapping to
   `STARLING_LLM_PROFILE`, and the `doctor` lines above. `smoke.sh` probes `run --help` for
   `--profile` and uses the real harness the day it exists.
3. Two **test-only** edits outside the literal lane, made because adding `mixed` changes the public
   constant and the `local` default model: `packages/llm/src/index.test.ts` (expected
   `LLM_PROFILES`) and `packages/llm/src/routing.test.ts` (expected local model + hermetic
   `skipRecommendation`). No production file outside the lane was modified.

**Deliberately deferred / out of scope:**

- The real fully-local run (one tiny task, tokens/s, memory) — Epic 72 "local model day", per L31
  revised. `smoke.sh` is written, `bash -n`-clean and dry-run-clean, and is not run here.
- Pulling/recommending any model > 20 GB; `recommendation.json` is absent on this machine and the
  built-in default is used.
- The auditor's own model-choice logic (Epic 44) — this epic only publishes the names
  (`MIXED_LOCAL_ROLES`/`MIXED_CLOUD_ROLES`, warning codes) and the fallback helper.
- Perch-lent inference (Wave 3 stretch).

**Open questions / flagged tradeoffs:**

- **Two sessions worked in this worktree.** Another session on `epic/51-fully-open` was editing
  `tools/fully-open/**` concurrently (the opencode config investigation, the smoke report, README
  wording). The final files are the merged result; the first four commits on this branch hold parts
  of both. Nothing was force-pushed and no work was discarded, but the commit boundaries are not as
  clean as usual.
- `mixed` can move a *single* call to opencode mid-run if Ollama flaps; the warning is logged but the
  dashboard metric ("local vs API calls") does not yet distinguish a fallback from a deliberate
  route.
- `limit.context: 32768` in the opencode config is a deliberate ceiling for tool calling on a 27B
  model; the model's native window is larger and a future epic may raise it per role.
