# Epic 44 — Auditor tuning

## Goal

Make the auditor **right**, especially about the dangerous direction: a false *pass*. A false fail
burns a retry; a false pass merges an unfinished task. This epic measured the auditor against a
12-case tuning set plus 4 held-out cases through the `opencode` profile (DeepSeek V4.1 Flash, no
DeepSeek API key), fixed what the measurement exposed, and made the auditor's model a
config-driven, per-profile decision. The local-model half of the original brief (Epic 28's bench,
locking in an Ollama model per laptop) is **built and verified against fakes only**; the real bench
runs in Epic 72 on a quiet machine (L31: no local model may load during this wave).

## How it works

### The measurement

`evals/auditor/cases/` holds the 12 tuning cases. `evals/auditor/cases-heldout/` holds the 4
generalisation cases that were written **before** any prompt edit and are never scored in the same
run. `evals/auditor/cases.ts` loads them through two different functions
(`loadAuditorCases` / `loadHeldOutAuditorCases`) so a prompt change cannot drift onto the held-out
set by accident, and `allAuditorCases()` is the only thing that sees both.

Two runners exist for the same answer key:

- `evals/run.ts auditor --impl real` — the shared harness. It now works for a real reviewer because
  `createAuditor({})` resolves a model from `STARLING_LLM_PROFILE` (see “model choice” below). It
  scores the 12 tuning cases and has no retry, which is why one provider hiccup shows up as a
  false fail in its output.
- `evals/auditor/run-real.ts --set seeded|heldout|all` — the auditor lane's runner. It records each
  verdict's own checks, retries a case **once** when the reviewer did not answer at all (a provider
  hiccup is not a judgment), counts those retries, and fails a run in which any case went unjudged.

Each case gets a real, throwaway Bun project (`evals/auditor/worktree.ts`) so the `tests` check
spawns a real command and the reviewer reads real output.

### The checks (auditor pipeline)

`lane` → `non-empty` → `tests` → **`missing-tests` (new)** → `lint` → `llm-review`.

`missing-tests` is the false-pass guard Epic 16 deferred: when the task's own definition of done
asks for tests (a DoD item that mentions tests/specs/coverage **without** a “passes/green” word),
the diff changes executable source and **no** test file changed, the audit fails deterministically.
It is deliberately narrow so a refactor, a docs task or a test-only task can never trip it. The
signal is also passed to the reviewer in the prompt, with the DoD item that demands the tests, so
the model fails for the same reason the check did.

### The reviewer policy (new)

A configured reviewer that does not answer now **fails** the audit (`llm-review` check false, fix
instruction: this is an infrastructure failure, do not rewrite working code, re-run the audit).
Before, an unreachable model left the check green, so a task with no deterministic failure merged
un-reviewed. A *deliberate* skip is unchanged: `llm: 'off'`, no profile configured, or an empty
diff still passes (the empty diff fails `non-empty` anyway).

### Model choice per profile (`packages/auditor/src/model-choice.ts`)

| profile | auditor | workers |
| --- | --- | --- |
| `opencode` | `opencode/opencode-go/deepseek-v4.1-flash` through the user's opencode server | same (opencode profile) |
| `local` | the recommended Ollama model for this laptop | Ollama |
| `mixed` (demo default; `deepseek` is an alias) | local **iff** `/api/tags` answers and the recommended tag is pulled, else `opencode` + a `log` warning | unchanged (DeepSeek) |

The auditor tag comes from `STARLING_AUDITOR_MODEL`, else `tools/local-models/results/recommendation.json`
for this laptop's RAM class (≥24 GB → `mbp`, else `air`), else `qwen3.8:27b-mlx` (the one model this
repo has measured, L24). `createAuditor()` stays synchronous and offline: the model is resolved
lazily on the first audit and only when a profile is set, so unit tests and the deterministic demo
never construct a provider.

## Measurements

Model for every real run: `opencode/opencode-go/deepseek-v4.1-flash` via the local opencode server.
Reports live in `evals/results/` (gitignored); the tables below are the record.

### Baseline — code at the start of this epic (Epic 16 prompt, five checks)

`STARLING_LLM_PROFILE=opencode bun evals/auditor/run-real.ts --set seeded --tag baseline` and
`--set heldout --tag baseline-heldout`:

| set | cases | accuracy | false-pass | false-fail | fix quality | lane |
| --- | --- | --- | --- | --- | --- | --- |
| seeded (tuning) | 12 | 0.833 | 0.000 | 0.500 | 1.000 | 1.000 |
| held-out | 4 | 1.000 | 0.000 | 0.000 | 0.833 | 1.000 |

Misses: `docs-only-task` (false fail) and `test-only-regression` (false fail). A second baseline
run of the same code scored 0.917 (only `test-only-regression` missed): the reviewer is not
perfectly deterministic even at `temperature: 0`, so every number here is one sample and the
baseline is reported as the worse of the two.

### Final — after the changes

`STARLING_LLM_PROFILE=opencode bun evals/auditor/run-real.ts --set seeded --tag final-seeded`:

| case | expect | verdict | fix | lane |
| --- | --- | --- | --- | --- |
| clean-tag-count-with-tests | pass | pass | - | ok |
| docs-only-task | pass | pass | - | ok |
| empty-diff | fail | fail | 1.00 | ok |
| failing-tests-due-badges | fail | fail | 1.00 | ok |
| internal-rename-existing-tests | pass | pass | - | ok |
| lane-violation-lockfile | fail | fail | 1.00 | ok |
| lane-violation-shared-renderer | fail | fail | 1.00 | ok |
| missing-tests-csv-export | fail | fail | 1.00 | ok |
| partial-csv-quoting | fail | fail | 1.00 | ok |
| scope-creep-refactor | fail | fail | 1.00 | ok |
| test-only-regression | pass | pass | - | ok |
| trivial-assertion-tests | fail | fail | 1.00 | ok |

`12 case(s) · accuracy 1.000 · false-pass 0.000 · false-fail 0.000 · fix 1.000 · lane 1.000 ·
reviewer-skipped 0 · retries 1 · PASS` (one provider hiccup, re-audited by the runner's retry).

Held-out, `--set heldout --tag final-heldout`:

| case | expect | verdict | fix |
| --- | --- | --- | --- |
| heldout-deleted-export | fail | fail | 1.00 |
| heldout-partial-deliverable | fail | fail | 1.00 |
| heldout-skipped-failing-test | fail | fail | 0.50 |
| heldout-type-only-refactor | pass | pass | - |

`4 case(s) · accuracy 1.000 · false-pass 0.000 · false-fail 0.000 · fix 0.833 · lane 1.000 ·
reviewer-skipped 0 · retries 0 · PASS`. Tuning did not move the held-out numbers at all (the
baseline was also 1.000/0.000/0.000), which is the point of holding them out.

The shared CLI on the same code (`bun evals/run.ts auditor --impl real`) scores
`0.917 · false-pass 0.000 · false-fail 0.250`: its single miss is `docs-only-task` on a provider
hiccup it has no retry for. The judgment is right; the harness is the weaker of the two.

### Deterministic-only diagnostic (no reviewer)

`bun evals/run.ts auditor --impl real` with no profile set (`llm: 'off'`):

`0.833 · false-pass 0.250 · false-fail 0.000`. The two false passes (`partial-csv-quoting`,
`trivial-assertion-tests`) are exactly the cases that need judgment, and `missing-tests-csv-export`
now fails deterministically instead of relying on the reviewer. This is the floor the checks alone
give you, and the reason a skipped reviewer must not be a pass.

### Changelog

| change | seeded accuracy | false-pass | false-fail | evidence |
| --- | --- | --- | --- | --- |
| baseline (Epic 16 prompt + 5 checks) | 0.833 | 0.000 | 0.500 | `docs-only-task`, `test-only-regression` false-fail |
| + deterministic `missing-tests` check (narrow DoD rule) | — | — | — | `missing-tests-csv-export` fails with no model (deterministic-only run); every refactor/docs/test-only case stays green |
| + DoD test-requirement signal in the prompt | 1.000 | 0.000 | 0.000 | the reviewer now fails `missing-tests-csv-export` for the DoD item the check named |
| + prompt rule: the artefact the DoD asks for is the deliverable | — | — | −0.500 | `docs-only-task` and `test-only-regression` pass in every tuned run |
| + prompt rule: the test tail is truncated, not evidence of a missing test | — | — | — | the two baseline false fails both cited the short `bun test` tail |
| + prompt rules for hollow tests (`.skip`, `expect(true)`) and removed exports | 1.000 | 0.000 | 0.000 | held-out stays 1.000/0.000 with no regression; `heldout-skipped-failing-test` fails for the `.skip` |
| + reviewer-unavailable now fails the audit | 0.000→ | 0.000 | — | seen in the wild: a dead opencode server made the whole held-out set a false pass (1.000) under the old policy |
| + `maxTokens` 1 400 → 2 000 | — | — | — | a truncated verdict surfaced as `LLM_BAD_JSON` once in 12 cases |
| final | 1.000 | 0.000 | 0.000 | `evals/results/auditor-2026-10-27-final-seeded.json` |

Changes landed together, so the middle rows are per-case attribution rather than isolated A/B
deltas; the two ends of the table are measured runs.

## Local-model path (prepared, not run — Epic 72)

Nothing here loaded a model: `bench --dry-run` starts an in-process fake Ollama, and the bench's
real path was never invoked. `tools/local-models/results/dryrun-epic44-local-path.txt` is the full
transcript. The chain proved end to end:

1. `bench.ts --dry-run` scored the scripted "smart" and "lazy" models, 12/12 vs 6/12, printed the
   miss report and a recommendation;
2. `recommend.ts` over a bench-shaped file wrote `recommendation.json`;
3. `chooseAuditorModel({ profile: 'local' })` and `{ profile: 'mixed' }` read it and routed the
   auditor (mixed kept `worker: deepseek`, local made it `ollama`);
4. `evals/auditor/local-path.test.ts` asserts the same chain in `bun run test`, offline: bench
   results → recommend → `recommendation.json` → the model each laptop would audit with, including
   the too-big-for-the-budget case and the unreadable-file fallback.

**Epic 72 runs exactly this** (one laptop at a time, nothing else running):

```bash
# 1. quiet-machine check, then the two or three candidates that are already pulled (≤ 20 GB)
ollama ps                                   # nothing of ours loaded
curl -s 127.0.0.1:11434/api/tags >/dev/null # daemon up
bun tools/local-models/bench.ts \
  --profile mbp \
  --models qwen3.8:27b-mlx,gpt-oss:20b \
  --think off --repeat 2

# 2. the decision file for this laptop (run in a directory that holds only THIS laptop's bench-*.json)
bun tools/local-models/recommend.ts --results tools/local-models/results --out tools/local-models/results/recommendation.json

# 3. confirm the auditor picks it up (no model load; /api/tags only)
STARLING_AUDITOR_PROFILE=mixed bun -e "import('./packages/auditor/src/index.ts').then(async m => console.log(await m.chooseAuditorModel({profile:'mixed'})))"

# 4. an offline scorecard of the same prompt against the bench cases, with the chosen model
STARLING_LLM_PROFILE=local bun evals/auditor/run-real.ts --set seeded --tag local-$(hostname -s)
```

Then commit `tools/local-models/results/bench-*.json` and `recommendation.json`, and re-run
`bun run test` (the local-path test reads real recommendations too).

## Key decisions & reasoning

- **A missing test the DoD asked for is a deterministic failure, not a judgment call.** The
  dangerous false passes in this set were "new behaviour, green suite, no test". A model can be
  talked out of that; a check cannot. It is narrow on purpose (a “passes/green” DoD item is a
  verification step, not a request for new tests) so it never fires on refactors, docs or test-only
  tasks, which are the false-fail traps in the same set.
- **A skipped reviewer fails the audit, but only when one was configured.** `llm: 'off'` and the
  no-profile demo stay pass-through, so offline usage and unit tests are unchanged. The cost is
  real: while the model endpoint is down, clean tasks fail too. That is the correct direction —
  un-reviewed work must never merge, and the engine's attempt budget turns it into a retry.
- **Held-out cases live in their own directory.** A boolean flag is too easy to overlook; a
  directory that the tuning runner does not load is a structural guarantee. It also keeps the
  shared `evals/run.ts` scoring exactly the 12 tuning cases it documents.
- **`mixed` changes only the auditor.** `applyProfile(config, 'local')` would have moved workers to
  Ollama; the demo default must keep workers on DeepSeek and make judgment local. Caught by a test
  that asserts `config.models.worker.provider === 'deepseek'` in mixed mode.
- **The bench's RAM probe is `/api/tags`, not `/api/ps`.** Listing tags needs no model load, so the
  `mixed` probe is safe to run on a busy laptop (L31). A wrong answer costs a fallback, not a 27B
  residency.
- **The eval retries a case once when the reviewer did not answer.** A provider hiccup is not a
  judgment; retries are counted in the report so a flaky run stays visible and a run with any
  unanswered case is marked FAIL.

## Interfaces for future epics

- `createAuditor(options)` now accepts `llm?: LLM | 'auto' | 'off'`, plus `bus`, `profile` and
  `env`. `'auto'` resolves the model from the routing profile on first use and logs the choice (and
  any fallback) as `log` events. Epic 49/40 should pass `{ llm: 'auto', bus }` when composing the
  real engine so the configured profile decides who audits.
- `chooseAuditorModel(opts) → { profile, model, config, local, warning? }` and
  `createLlmFor(choice, { env })` are exported from `@starling/auditor` for the CLI/server
  composition root (Epic 40/51).
- `localAuditorModel()`, `probeOllamaModel()`, `RECOMMENDATION_PATH` and
  `RECOMMENDED_LOCAL_AUDITOR_MODEL` are the contract with Epic 72's bench.
- `missingTestsSignal(definitionOfDone, changedFiles)` / `dodTestRequirements()` are exported and
  reused by the prompt; a future auditor UI can show the same signal.
- Evals: `evals/auditor/run-real.ts` is the supported real-model runner (`--set`, `--retries`,
  `--tag`, `--case`), and its report carries each verdict's checks.

## Deviations from plan

- **No local-model bench was run** (fix1 revision of the brief, L31). The deliverable became
  "prepare and verify the path offline"; the commands Epic 72 will run are above and the transcript
  is committed.
- **No `bench-*.json` or `recommendation.json` is committed from this epic.** A dry-run artifact
  would be fake measurements in the file the auditor reads at runtime; instead
  `dryrun-epic44-local-path.txt` is clearly labelled and `local-path.test.ts` covers the handoff.
- **The shared `evals/run.ts` was not edited** (not in this lane). It works for a real reviewer only
  because `createAuditor({})` now auto-resolves from `STARLING_LLM_PROFILE`; the lane's own runner
  carries the retry and per-check detail. A FIX REQUEST is in the handback.
- **The held-out cases were moved to `evals/auditor/cases-heldout/`** so the shared CLI keeps
  scoring 12 tuning cases (its own test asserted 12) without editing that lane's file.
- **The reviewer-unavailable policy changed behaviour shipped by Epic 16.** Documented above and in
  the handback as a deliberate, safety-direction change with an explicit escape hatch.

## Known limitations / deferred

- Fix-instruction quality on held-out is 0.833: `heldout-skipped-failing-test` produces a *better*
  instruction than the answer key's keyword check expects ("revert `test.skip` … do not disable the
  test") but never says “fix” or “implement”, so the keyword metric scores 0.5. The answer key was
  left untouched, since editing it after seeing the result would be tuning on held-out data.
- Single-sample measurement. The same code scored 0.833 and 0.917 on two baseline runs, so treat
  one-point differences as noise; `--retries` absorbs provider hiccups but not model variance.
- `mixed` probes only `/api/tags`: a tag can be listed while the daemon is too loaded to answer a
  completion. The first audit then fails (correctly) instead of falling back mid-run.
- `recommend.ts` does not filter bench files by their `profile` field, so a model measured on the
  32 GB laptop can win the 16 GB laptop's budget if it also fits there. Epic 72 must point
  `recommend.ts` at one laptop's results at a time (noted in the transcript and the handback).
- The auditor still runs the whole suite once per attempt (`bun test` in the worktree); incremental
  or scoped test selection is out of scope (Epic 49's loop owns attempt economics).
- No Ollama model was pulled, loaded, benchmarked or called by this epic. The daemon that happens to
  be running on this machine was never queried by any test, script or eval in this lane.
