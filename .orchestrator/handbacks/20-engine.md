## Epic 20 Handback — Engine state machine

**Status:** Complete. Branch `epic/20-engine` @ `3e5802c` (engine code; docs follow). Closes #14.

**Delivered:**
- `createEngine(deps: EngineDeps): EngineApi` (`packages/engine/src/engine.ts`) with `start`, `cancel`,
  `abortTask`, `getRun`, `listRuns`, `waitForFinish`, plus the §8 mirror in `src/handshake.ts`.
- Full ARCHITECTURE §4 lifecycle: `run.created` → `repomap.ready` → `plan.created` (issues included) →
  dry-run stop → `tracker.syncPlan` → integration branch → dispatch → audit → fix loop → merge queue →
  `run.finished` → `tracker.openFinalPR`.
- `src/transitions.ts`: explicit `TaskStatus` table, terminal/active sets, `assertTaskTransition`
  (throws `StarlingError('INVALID_ARGUMENT')` in strict mode, logs and ignores in production).
- Dispatch with `maxParallel` **and** real node capacity; engine-authoritative `activeSessions` so the
  scheduler cannot over-subscribe a lagging perch; local vs git-bundle repos per node kind.
- Per-task serial pipeline (`src/pipeline.ts`) with generation counters: `collect` → `audit` →
  `merge`; pass → `merged` (+ `tracker.onMerged`, `node.cleanup`), `conflict` → `conflict`,
  `tests-failed` → fixer with the merge evidence; fail → `fixing` while `attempts < maxAttempts`, else
  `failed` and dependent tasks cancelled transitively.
- Flock: registry `left` requeues `running|fixing|auditing` tasks with attempts untouched and emits
  `task.migrated` when they land elsewhere; `NODE_OFFLINE` from any port takes the same path; `joined`
  / `stats` clear offline marks and pump immediately.
- Budget cap (stop dispatch + warn once, drain running work, cancel the undispatched tail), metrics
  with a 1 s throttle + 5 s heartbeat and core's `estimateSavedUsd`, cancel/abort semantics, and a
  deterministic or `writer`-model run summary.
- 114 engine tests across 12 files: golden `task.status` trace over the sky-todo fixture, fix loop,
  attempt exhaustion + dependent cancellation, merge conflict, tests-failed, node death mid-task and
  mid-audit, node join, `maxParallel` and registry capacity curves, budget, dry run, cancel (including
  cancel during planning), abortTask, writer, metrics throttle/heartbeat, transitions/state/nodes/
  metrics/summary/agent-event units, empty plans and two concurrent runs.
- `docs/epic-20-engine.md` with the exact exported signatures and a server/CLI usage snippet.

**Key design decisions:**
- One `RunDriver` per run; the engine is a thin registry over it. Keeps two concurrent runs isolated
  (separate ledger, chains, metric publisher) while `EngineApi` stays process-wide.
- Per-task promise chain + per-task generation counter. A late `session.idle` or `collect` from an
  abandoned session is dropped, which is what makes migration and cancellation safe.
- `attempts` = number of audit verdicts (1-based to the auditor), so migration never burns the retry
  budget and merge failures share the same budget.
- Dispatch passes cloned `NodeInfo`s with `activeSessions` overwritten by the engine's own count:
  the registry snapshot may lag one heartbeat, and a filled slot must never be offered twice.
- Budget exhaustion drains then cancels the still-queued tasks, so `waitForFinish` always resolves.
- A scheduler answer outside the dispatchable list fails that task with an error log instead of
  leaving it `ready` forever (a wedged run is worse than a loud failure).
- Local vs API usage is classified from the `session.started` model and the provider config (a
  provider with no `apiKeyEnv` is local), so Ollama/llama.cpp/lent perch models meter at $0.
- A final PR is opened only when at least one task merged; a fully failed run has nothing to propose.
- `strictTransitions` and `timers` are additive optional deps for deterministic tests.

**Verification (exact commands + results):**
- `bun install` (worktree): `Checked 133 installs across 192 packages (no changes) [22.00ms]`
- `bun test packages/engine` ×3, identical: `114 pass / 0 fail / Ran 114 tests across 12 files.`
  (200 ms, 173 ms, 207 ms)
- `bun run test` (root): `299 pass / 0 fail / 1200 expect() calls / Ran 299 tests across 48 files. [448.00ms]`
- `bun run typecheck`: exit 0 (every `packages/*` and `apps/*` project).
- `bunx biome check packages/engine`: clean.
- `bun run check`: fails **only** on pre-existing `tools/local-models/smoke.ts` (10 Biome format/import
  errors, Epic 02's lane, untouched by this branch; `git diff main -- tools/` is empty). Everything in
  `packages/engine` passes Biome and typecheck. Not fixed: outside my lane.

**Dependencies added:** none (only `@starling/core`, already present).

**CONTRACT REQUESTS:** none. The only interfaces I needed were the §8 `EngineApi`/`StartRunInput` /
`BundleUrlFor` mirrors already in the handshake section; no core contract or port change was necessary.

**Deliberately deferred / out of scope:**
- Conflict resolver agent (Wave 2): `conflict` is terminal and its dependents are cancelled, exactly
  as §4 says for terminal non-merge results.
- `Tracker.openTaskPR` + worker-handback PR bodies (needs Epic 13's parser and GitHub mode).
- Resume-after-process-restart; the store and JSONL event log keep the record, but no driver recovery.
- Server/CLI wiring (Epics 21/22), real port implementations, and any live network/opencode test.
- A run with zero dispatchable nodes waits rather than failing; the flock/registry owns offline
  timeouts and node liveness.

**Open questions / flagged tradeoffs:**
- Should a budget-capped run report `finished` or `failed` when some tasks merged? I chose `finished`
  (merged > 0) with the cancelled tail visible in metrics; `failed` is only for zero merges.
- `skipped` merges are treated as landed (with a warn log) because the alternative — failing a task
  whose branch is empty — blocks its lane for no reason. Flagging in case the merger intends
  "skipped" as a failure.
- `RunDriver` is ~830 lines: the pure logic is split out (`state`, `nodes`, `metrics`, `summary`,
  `transitions`, `agent-event`) and the pipeline lives in `pipeline.ts`; the rest is the single state
  machine. Splitting its fields further felt riskier than helpful, but a future epic may prefer a
  `RunState` object.
