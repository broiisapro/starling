## Epic 44 Handback — Auditor tuning

**Status:** Complete (real local-model bench deliberately deferred to Epic 72 per the fix1 revision). Branch `epic/44-auditor-tuning` @ see PR head.

**Delivered:**
- `packages/auditor/src/model-choice.ts` — profile → auditor model: `opencode` (DeepSeek through the user's opencode server), `local` (recommended Ollama model), `mixed` (demo default; auditor local only when `/api/tags` answers and the tag is pulled, else `opencode` + `log` warning). Exports `chooseAuditorModel`, `createLlmFor`, `localAuditorModel`, `probeOllamaModel`, `parseAuditorProfile`, `defaultLlmMode`, `RECOMMENDATION_PATH`, `RECOMMENDED_LOCAL_AUDITOR_MODEL`.
- `createAuditor({ llm })` now takes `LLM | 'auto' | 'off'` (plus `bus`, `profile`, `env`); `'auto'` resolves lazily from the profile so construction stays synchronous and offline. `STARLING_AUDITOR_PROFILE` / `STARLING_LLM_PROFILE` opt in; no profile means fully deterministic.
- New deterministic check `missing-tests` (`missingTestsSignal`, `dodTestRequirements`, `missingTestsDetail`): a DoD that explicitly asks for tests + executable source changed + no test file ⇒ fail, with a fix instruction naming the DoD item and the colocated test path. Signal is also in the reviewer prompt.
- Reviewer-availability policy: a configured reviewer that does not answer now fails `llm-review` (with an “infrastructure, do not rewrite code” fix instruction) instead of silently passing. Deliberate skips (`'off'`, no profile, empty diff) are unchanged.
- `AUDITOR_SYSTEM_PROMPT` v2: judge the artefact the DoD asks for (docs/test/type-only tasks), the test tail is truncated output not evidence, hollow tests (`.skip`, `expect(true)`) prove nothing, deleting a public export is a behaviour change. `LLM_MAX_TOKENS` 1 400 → 2 000.
- Evals: `evals/auditor/run-real.ts` (real reviewer, `--set seeded|heldout|all`, `--retries`, `--tag`, `--case`; report includes each verdict's checks, reviewer-skipped count and retry count), `evals/auditor/run-real.test.ts`, `evals/auditor/local-path.test.ts` (bench → recommend → model-choice, offline).
- Held-out cases live in `evals/auditor/cases-heldout/` (4 files) with `loadHeldOutAuditorCases()` / `allAuditorCases()`; the tuning set stays 12 and the shared CLI keeps scoring it.
- `tools/local-models/results/dryrun-epic44-local-path.txt` — the committed transcript of the offline bench → recommend → model-choice verification.
- Tests: `packages/auditor` 109 green (new `model-choice.test.ts`, missing-tests coverage in `diff.test.ts` / `auditor.test.ts`), `evals/auditor` 23 green.

**Key design decisions:**
- Missing tests the DoD asked for = deterministic failure, not reviewer judgment — the dangerous false pass is “green suite, no test”; a check cannot be talked out of it. Narrow rule (“passes/green” DoD items excluded) so refactors/docs/test-only tasks are untouched.
- A skipped reviewer fails the audit — un-reviewed work must never merge. Cost: clean tasks fail while the endpoint is down; the engine’s attempt budget makes it a retry. Escape hatch: `llm: 'off'`.
- `mixed` overrides only the auditor — applying the `local` profile wholesale would have moved workers off DeepSeek (caught by a test asserting `worker.provider === 'deepseek'`).
- Held-out in a separate directory, not a flag — a directory the tuning runner never loads is a stronger guarantee than a boolean.
- One retry in the eval when the reviewer did not answer — a provider hiccup is not a judgment; retries are counted and any unanswered case fails the run.
- Probe is `/api/tags` (no model load) — safe on a loaded laptop under L31.

**Verification (exact commands + results):**
- `bun install` — clean (`Checked 163 installs across 221 packages`).
- Baseline, original code: `STARLING_LLM_PROFILE=opencode bun evals/auditor/run-real.ts --set seeded --tag baseline` → `accuracy 0.833 · false-pass 0.000 · false-fail 0.500 · fix 1.000 · lane 1.000` (MISS: docs-only-task, test-only-regression); `--set heldout` → `1.000 · 0.000 · 0.000 · fix 0.833`.
- Final: `bun evals/auditor/run-real.ts --set seeded --tag final-seeded` → `accuracy 1.000 · false-pass 0.000 · false-fail 0.000 · fix 1.000 · lane 1.000 · reviewer-skipped 0 · retries 1 · PASS`; `--set heldout --tag final-heldout` → `1.000 · 0.000 · 0.000 · fix 0.833 · reviewer-skipped 0 · PASS` (no regression on held-out).
- Shared CLI, same code: `STARLING_LLM_PROFILE=opencode bun evals/run.ts auditor --impl real` → `12 case(s) · accuracy 0.917 · false-pass 0.000 · false-fail 0.250 · fix 0.958 · lane 1.000 · PASS` (single miss `docs-only-task` from a provider hiccup; this harness has no retry).
- Deterministic-only: no profile → `0.833 · false-pass 0.250 · false-fail 0.000` (the two judgment cases; floor the checks alone give).
- `bun tools/local-models/bench.ts --profile mbp --models qwen3.8:27b-mlx,qwen3.8:27b-mlx-lazy --think off --dry-run` → 12/12 vs 6/12, recommendation printed, nothing written; `recommend.ts` → `recommendation.json`; `chooseAuditorModel` → `{"profile":"mixed","auditor":{"provider":"ollama","model":"qwen3.8:27b-mlx"},"worker":{"provider":"deepseek","model":"deepseek-v4.1-flash"}}`. Full transcript committed.
- **No Ollama was touched by this lane**: no `ollama pull/run/serve/ps`, no call to `127.0.0.1:11434` from any test, eval or script, and the dry run uses `tools/local-models/fake-ollama.ts`.
- `bun run test` (root): packages half `1396 pass / 0 fail / 4 skip` (`Ran 1396 tests across 164 files`); web half `426 pass / 0 fail` (`Ran 426 tests across 39 files`).
- `bun run check`: clean (`Checked 713 files`, per-workspace `tsc --noEmit` loop passed).
- `bunx tsc --noEmit -p evals/tsconfig.json`: clean.

**Dependencies added:** `@starling/llm@workspace:*` in `packages/auditor` (for `applyProfile`/`createLLM` in `model-choice.ts`).

**CONTRACT REQUESTS:** none (no change to `packages/core`).

**FIX REQUESTS:**
- `evals/real.ts` (Epic 29 lane): `instantiate()` calls `createAuditor({})`, so `bun evals/run.ts auditor --impl real` only sees a reviewer when a profile env var is set, and it has no retry. It now works for real runs because `createAuditor({})` auto-resolves from `STARLING_LLM_PROFILE`; please (a) document that env requirement next to `loadRealAuditor`, and (b) consider delegating to `evals/auditor/run-real.ts` so the shared CLI gets the provider-hiccup retry and per-check detail.
- `tools/local-models/recommend.ts` (Epic 28 lane): `readBenchResults` merges every `bench-*.json` in a directory and ignores each result’s `profile` field, so a model measured on the 32 GB laptop can be recommended for the 16 GB laptop. Please filter results by the requested profile (or by a `--profile` flag) before ranking.
- `apps/cli/src/compose.ts` (Epic 40 lane): when the real composition lands, construct the auditor as `createAuditor({ llm: 'auto', bus })` so `STARLING_AUDITOR_PROFILE`/`STARLING_LLM_PROFILE` decides the reviewer and the fallback warning reaches the event stream.

**Deliberately deferred / out of scope:**
- The real local-model bench and `recommendation.json` (Epic 72). No `bench-*.json` or `recommendation.json` is committed from this epic on purpose: a dry-run artifact would put fake measurements in the file the auditor reads at runtime.
- Engine fix-loop behaviour on a reviewer outage (Epic 49): this epic makes the audit fail; what the loop does with it is that lane’s decision.
- Planner evals (Epic 48), models > 20 GB, Ollama pulls.

**Open questions / flagged tradeoffs:**
- Reviewer outage now fails clean tasks too. Deliberate (never merge un-reviewed work) and reversible via `llm: 'off'`/profile configuration, but it couples task success to provider availability; worth watching in the first real runs.
- Fix-instruction quality on held-out is 0.833 because `heldout-skipped-failing-test` says “revert `test.skip` … do not disable the test” and never the literal word “fix”/“implement”. The answer key was left untouched rather than tuned on held-out data.
- The eval is single-sample and the model is not deterministic at `temperature: 0` (0.833 vs 0.917 on two identical baseline runs). Treat one-case differences as noise; Epic 72 or a future eval epic may want `--repeat N` per case.
