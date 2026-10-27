## Epic 29 Handback — Evals harness (planner + auditor)

**Status:** Complete. Branch `epic/29-evals` @ 0c05c30. Closes #23.

**Delivered:**

- `evals/planner/cases/*.json` — 8 answer-key cases: all 5 `examples/sky-todo/demo-goals/*.expected.md` converted (`launch-day`, `launch-day-xl`, `quick-wins`, `conflict-bait`, `will-fail-audit`) plus 3 new cases on 2 hand-written synthetic RepoMaps (Express notes API ×2, Python todo CLI ×1). Each declares goal text, task-count range, keyword-group feature coverage, required/dependent features, required lane files, forbidden files and accepted validator error sets.
- `evals/planner/score.ts` — `scorePlan(plan, case, repoMap)` with six weighted checks: validator 0.20, task-count 0.10, feature-coverage 0.25, dependencies 0.15, lane-precision 0.20, definition-of-done 0.10. Perfect plan = 1.0.
- `evals/planner/validate.ts` — local validator (cycle, missing-dep, empty-lane, empty-dod, duplicate-key, lane-overlap) using core `globsOverlap`; overlap is only an error for tasks with no dependency path.
- `evals/planner/reference.ts` — one hand-written reference `Plan` per case, kept separate from the case JSON so the mock run self-checks the harness.
- `evals/auditor/cases/*.json` — 12 seeded diffs, 4 expected pass / 8 expected fail: clean feature, missing tests, `assert(true)` tests, lockfile lane violation, docs-only pass, failing tests, unrelated refactor, empty diff, rename-with-existing-tests pass, shared-renderer lane violation, partial CSV quoting, test-only regression pass.
- `evals/auditor/score.ts` — accuracy, false-pass rate, false-fail rate, fix-instruction keyword quality and lane detection; `reference.ts` + `input.ts` drive a real `AuditInput` shape.
- `evals/run.ts` — `bun evals/run.ts planner|auditor --impl mock|real [--case name] [--out path]`, fixed-width table + `evals/results/<suite>-<date>.json`, exit codes 0/1/2/64. `evals/real.ts` dynamically imports `@starling/planner` / `@starling/auditor` for Wave 2 (placeholders today → exit 2 with a clear message).
- 33 tests across 6 files: schema/answer-key validity, perfect and deliberately broken plans, validator cycles/overlap, auditor metric directions, answer-key consistency guards, and both mock CLI runs end to end.
- `docs/epic-29-evals.md` with exact exported signatures and a Wave 2 usage snippet.

**Key design decisions:**

- **Reference answers are separate from cases** — a case/reference drift fails the mock run instead of hiding in the answer key.
- **Validator reimplemented locally** — the planner is the system under test and a parallel Wave 1 sibling; core glob semantics keep both sides honest.
- **Only concurrent overlaps are errors** — a shared lane behind a dependency edge is legal because the DAG serialises it.
- **`conflict-bait` accepts both honest repairs** — 1 merged task with no errors, or 2 tasks with exactly `lane-overlap`.
- **Lexical keyword matching** — no model in the loop; cheap, deterministic, documented as the main limitation (Epic 48 can swap in embeddings behind `FeatureCoverage`).
- **False-pass is a first-class gate** — auditor pass requires accuracy ≥ 0.9 and false-pass ≤ 0.15, not accuracy alone.
- **Pass traps are intentional** — docs-only, rename-only and test-only diffs must pass, so a naive "tests added?" auditor is measurable.
- **No new dependencies** — `evals/` is outside the locked workspace, so `lib/core.ts`, `lib/core-testing.ts` and `lib/zod.ts` re-export core's public entries and the locked zod 4.6.7 copy by path.

**Verification (exact commands + results):**

- `bun install`: `Checked 133 installs across 192 packages (no changes) [14.00ms]`.
- `bun test evals`: `33 pass / 0 fail`, `127 expect() calls`, `Ran 33 tests across 6 files.`
- `bun run test` (root): `220 pass / 0 fail`, `915 expect() calls`, `Ran 220 tests across 43 files.`
- `bun run typecheck`: exit 0 (all `packages/*` and `apps/*`).
- `bunx tsc --noEmit -p evals`: clean (root typecheck does not loop `evals/`, root config is locked).
- `bunx biome check evals docs/epic-29-evals.md`: `Checked 48 files. No fixes applied.`
- `bun run check`: **fails only on pre-existing files outside this lane** — `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host.ts,ollama.ts,ollama.test.ts,smoke.ts}` and two `tools/local-models/results/*.json`. No `evals/**` diagnostics. (Also present on `origin/main` before this branch.)
- `bun evals/run.ts planner --impl mock`:

```
planner · impl=mock · 8 case(s)
case                                 score  validator  count  coverage  deps  lanes  dod
express-notes-auth-search            1.000         ok     ok        ok    ok     ok   ok
express-notes-pagination-rate-limit  1.000         ok     ok        ok    ok     ok   ok
python-cli-json-config               1.000         ok     ok        ok    ok     ok   ok
sky-todo-conflict-bait               1.000         ok     ok        ok    ok     ok   ok
sky-todo-launch-day-xl               1.000         ok     ok        ok    ok     ok   ok
sky-todo-launch-day                  1.000         ok     ok        ok    ok     ok   ok
sky-todo-quick-wins                  1.000         ok     ok        ok    ok     ok   ok
sky-todo-will-fail-audit             1.000         ok     ok        ok    ok     ok   ok
8 case(s) · mean 1.000 · min 1.000 · threshold 0.85 · PASS
```

- `bun evals/run.ts auditor --impl mock`:

```
auditor · impl=mock · 12 case(s)
case                            expect  verdict   fix  lane
clean-tag-count-with-tests        pass     pass     -    ok
docs-only-task                    pass     pass     -    ok
empty-diff                        fail     fail  1.00    ok
failing-tests-due-badges          fail     fail  1.00    ok
internal-rename-existing-tests    pass     pass     -    ok
lane-violation-lockfile           fail     fail  1.00    ok
lane-violation-shared-renderer    fail     fail  1.00    ok
missing-tests-csv-export          fail     fail  1.00    ok
partial-csv-quoting               fail     fail  1.00    ok
scope-creep-refactor              fail     fail  1.00    ok
test-only-regression              pass     pass     -    ok
trivial-assertion-tests           fail     fail  1.00    ok
12 case(s) · accuracy 1.000 · false-pass 0.000 · false-fail 0.000 · fix 1.000 · lane 1.000 · PASS
```

- `bun evals/run.ts planner --impl real` and `... auditor --impl real`: exit 2 with `@starling/planner does not export createPlanner()/planner yet. --impl real is Wave 2 (Epic 48)` (and the auditor equivalent) — expected for Wave 1 placeholders.
- No network, Ollama, opencode, GitHub or model call was made by any test; all runs are in-process or spawned `bun` processes.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none.

**Deliberately deferred / out of scope:**

- Running the real planner/auditor (Wave 2 / Epics 44 and 48); `--impl real` is an adapter only.
- Tuning planner/auditor prompts or models.
- Applying auditor patches with `git apply`; cases carry the diff as evidence, not as a runnable fixture.
- Embedding/semantic feature matching, transitive dependency credit, verbose per-check console output.

**Open questions / flagged tradeoffs:**

- Should `evals/` become a Bun workspace at checkpoint C1? The path-based core/zod shims work from a clean clone with no extra install, but a real `@starling/core` dependency would be cleaner. Root `workspaces` is orchestrator-owned, so this is left as a C1 decision.
- The local validator treats only `severity: 'error'` as failure. If the real planner emits `lane-overlap` as a warn after repair, evals will treat the plan as clean — intentional, but worth confirming when Epic 48 lands.
- `conflict-bait` accepts either a 1-task repair or 2 overlapping tasks because its own expected file calls both acceptable; if the demo later fixes one answer, tighten `taskCount` and `validator.anyOf`.
