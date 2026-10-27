## Epic 12 Handback — Planner: goal to lane-safe task DAG

**Status:** Complete. Branch `epic/12-planner` @ 6ef0df7 (docs commit follows).

**Delivered:**
- `createPlanner({ llm, clock?, maxRepairs?=2, minTasks?=2, maxTasks?=12, maxTokens?, temperature? })` implementing core's `Planner` port: prompt → `completeJson(PlanDraftSchema)` → validate → ≤ `maxRepairs` LLM repair turns → deterministic repair → warnings-only result.
- `planFromDraft()` builds the real `Plan`: ULID `id`, `goalId` from the goal, `model` from the LLM response, `createdAt` from the injected clock. Keys/globs/dependency refs normalised once at that boundary.
- `validatePlan(plan, { map?, minTasks?, maxTasks? })`: errors for `cycle` (with path), `missing-dep`, duplicate keys (`other`), `empty-dod`, `empty-lane`, and `lane-overlap` for every concurrent (non-ancestor) pair with `globsOverlap` hits naming both keys and globs; warnings for task-count bounds, estimate > 40, non-positive estimate, an `owns` glob that is neither present nor a plausible new-file location, and a DoD with no test step.
- `repairPlan(plan)`: drops duplicate/empty-key and un-auditable tasks, drops dangling deps, breaks cycles by dropping the newest edge (latest task-array source), serialises overlapping concurrent pairs by adding `later → earlier` in key order. Reports every fix as a warn-level notice. Pure, never mutates its input.
- `src/prompt.ts`: snapshot-tested planning doctrine (`PLANNER_SYSTEM_PROMPT`, 14 rules) plus `buildPlanPrompt`, `buildRepairRequest`, `buildRepairMessages`; `src/render-map.ts` renders the map compactly (tree, languages, commands, files with symbols/summaries, all capped deterministically).
- `src/graph.ts`: `buildDepGraph`, `findCycles` (canonical, self-loops), `formatCycle`, `reachableFrom` internals, `isAncestor`, `canRunConcurrently`.
- 72 tests in 8 files: clean fixture plan, LLM-fixed overlap, deterministic overlap/cycle/dangling-dep/task-drop repairs, repair cap, invalid JSON propagation, `PLAN_INVALID` on an empty plan, ancestor/transitive overlap allowed, 200-case seeded fuzz through `plan()` asserting zero error-level issues, a 50-DAG property test proving `lane-overlap` reports exactly the concurrent overlapping pairs, prompt snapshot, and renderer coverage.

**Key design decisions:**
- LLM proposes, deterministic code disposes — `plan()` re-validates its own output and throws `PLAN_INVALID` rather than returning an unsafe plan (defensive; unreachable by the repair rules).
- Un-auditable tasks (no `owns`, no DoD) are dropped with a notice instead of inventing a lane/DoD — patching them would make the auditor verify fiction.
- Ancestor pairs may share files; only genuinely concurrent tasks must be disjoint, matching ARCHITECTURE §4's DAG semantics.
- Cycles drop the "newest" edge and lane overlaps serialise by key order (not array order) for determinism across retries.
- Structural warnings do not block; they are returned for `plan.created` so the dashboard can explain repairs.
- Added `zod` (4.6.7) locally for `PlanDraftSchema`; no sibling packages imported and no handshake mirror was needed (all touched interfaces are core ports/contracts).

**Verification (exact commands + results):**
- `bun install`: `Checked 133 installs across 192 packages (no changes)`.
- `bun test packages/planner`: `72 pass / 0 fail — 2 snapshots, 665 expect() calls, Ran 72 tests across 8 files`.
- `bun run test` (root): `257 pass / 0 fail — 2 snapshots, 1449 expect() calls, Ran 257 tests across 44 files`.
- `bunx biome check packages/planner`: `Checked 19 files. No fixes applied.`
- `bun run typecheck`: clean (all `packages/*` + `apps/*`).
- `bun run check`: **fails only on pre-existing files outside this lane** — Biome formatting in `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host,ollama,ollama.test,smoke}.ts` and two `tools/local-models/results/*.json` (all from Epics 01/02 on `main`). No planner or epic-12 doc errors remain.

**Dependencies added:** `zod@4.6.7` in `packages/planner/package.json` (also reflected by `bun install` in `bun.lock`). `picomatch@4.0.7` was pre-installed by Epic 00 and is unused by this implementation.

**CONTRACT REQUESTS:** none. (`Planner.validate(plan)` has no repo-map parameter, so `createPlanner` closes over the most recent map for glob-existence warnings; the explicit `validatePlan(plan, { map })` is exported for the engine and evals.)

**Deliberately deferred / out of scope:**
- Real LLM / live prompt tuning and `*.live.test.ts` (L23; Epic 28/29).
- Evals harness and planner quality scoring (Epic 29).
- Repo mapping/rendering consolidation with Epic 11 (C1 picks one renderer).
- Cost/usage accounting and `plan.created` publishing (LLM layer and engine own those).
- Multi-run decomposition above 12 tasks.

**Open questions / flagged tradeoffs:**
- Dropping tasks that lack a lane or DoD keeps the run alive but loses a model-authored task; failing the whole plan instead would be stricter. I chose availability + a visible warning. Worth revisiting if evals show silent work loss.
- `globsOverlap` is conservative for mid-path `**`, so an occasional independent task is serialised rather than risking a merge conflict. Documented in `docs/epic-12-planner.md`.
- `validate()` cannot see a repo map unless `plan()` ran first; callers that validate arbitrary plans should use `validatePlan(plan, { map })`.
