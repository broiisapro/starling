# Epic 20: Engine state machine

**Wave 1 · Branch `epic/20-engine` · Issue: find it with `gh issue list --search "Epic 20 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

## Where you are
Starling (`.orchestrator/PRD.md`) is an open-source, open-weight-first harness. It turns one coding goal into a lane-safe task DAG, runs a flock of opencode agents in parallel git worktrees (on this laptop and on other laptops, "perches"), audits each result with tests, a lane check and a local model, and merges everything through a queue, all shown live in a murmuration dashboard.

**Wave 0 is merged** (tags `epic-00-complete`, `epic-01-complete`):
- `@starling/core`: every contract (zod-first), every port, the event bus, config, `exec`, globs (`matchesAny`, `globsOverlap`, `lanesDisjoint`), pricing/metrics, and **`@starling/core/testing`**, which has a mock for every port plus factories (`makePlan`, `makeRun`, `makeTaskSpec`, `makeNodeInfo`, `makeAgentEvent`, …). **Read `docs/epic-00-foundation.md` first.** Its "Interfaces for future epics" section lists every exported symbol.
- `fixtures/`: `repomaps/sky-todo.json`, `plans/sky-todo-launch-day.json`, `runs/sky-todo-launch-day.jsonl` (252 realistic events including flock events).
- `examples/sky-todo/`: the demo app Starling will operate on. `examples/scripts/make-demo-repo.sh` makes a fresh git repo of it.

**You are one of 23 agents building Wave 1 at the same time**, each in its own lane. Your siblings' packages are still placeholders while you work. **Never import a sibling Wave 1 package.** Depend only on `@starling/core` and its mocks. Where you meet a sibling, use the **handshake interfaces in ARCHITECTURE §8**, mirrored locally in `src/handshake.ts`, copied verbatim with the header comment the section specifies.

## Tech decisions already locked (build on these, don't relitigate)
ARCHITECTURE §7 **L1–L25**. Especially:
- **L21**: Bun 1.4.4, TS 5.9.3, zod 4.6.7, Biome 2.6.3; never touch root config.
- **L22**: add deps only to your own package.json, pinned exact.
- **L23**: **NO local models, no real LLM calls, no real opencode prompts, no GitHub calls from tests, no `ollama` commands at all.** Use the core mocks and in-process `Bun.serve({ port: 0 })` fakes. You may write `*.live.test.ts` files but do not run them. This laptop runs 20+ agents at once, so keep memory use low: no long-running servers left behind, no huge test fixtures.
- **L13/L14**: git and gh go through `exec` from core, injectable so tests can fake it.

## FIRST TASK: carryover
None. This is a Wave 1 epic built directly on Wave 0. (Stated explicitly so it's clear carryover was considered.)

## Your lane (you may write ONLY here)
`packages/engine/**`
plus `docs/epic-20-engine.md` and `.orchestrator/handbacks/20-engine.md`. Read anything; write nothing else.

## Goal
Implement the orchestration engine, the conductor of the murmuration. It runs ARCHITECTURE §4 exactly: map → plan → dispatch ready tasks to execution nodes → audit → fix loop → merge queue → finish. That includes **Flock behaviour** (scheduling across nodes, rescheduling when a perch disappears). It only ever talks to ports, so all of it is testable with core mocks.

## Deliverables
- `createEngine(deps: EngineDeps): EngineApi` (EngineApi mirrored from ARCHITECTURE §8 in `src/handshake.ts`). `EngineDeps = { config: StarlingConfig; bus: EventBus; store: Store; clock: Clock; repoMapper: RepoMapper; planner: Planner; prompts: PromptCompiler; workspace: Workspace; registry: NodeRegistry; scheduler: Scheduler; auditor: Auditor; merger: Merger; tracker: Tracker; bundleUrlFor?: BundleUrlFor; writer?: LLM }`.
- **Explicit transition table** (`src/transitions.ts`) over `TaskStatus`. An illegal transition throws in tests and logs an error in production. Every transition emits `task.status` (from/to/run snapshot), and the run is saved via the store.
- The run lifecycle per ARCH §4: `run.created` → `repomap.ready` → `plan.created` (issues included) → `dryRun` stops here as status `planned` → `tracker.syncPlan` → dispatch loop:
  - **Ready** = all `dependsOn` merged. Dispatch up to `maxParallel`, capped by registry capacity.
  - Each dispatch does `scheduler.pick(nodes, task)`, then `node.startTask` with `repo` = `{kind:'local', path}` for local nodes or `{kind:'bundle', ...bundleUrlFor(integrationBranch)}` for remote ones, branch `starling/<runShort>/<taskKey>` from the integration branch, and the prompt from `prompts.worker`.
  - Subscribe to node `onEvent`. Forward each as an `agent.event` StarlingEvent and accumulate usage into `TaskRun.usage` and cost.
  - On `session.idle`: `node.collect` → `auditing` → `auditor.audit` → `audit.verdict` event.
    - pass → `merging` → `merger.merge` → `merge.result` (`merged` → `tracker.onMerged`, `node.cleanup`; `conflict` → `conflict`, Wave 2 adds the resolver; `tests-failed` → treated like an audit failure).
    - fail with attempts < `maxAttempts` → `fixing` → `node.sendPrompt(prompts.fixer(...))`.
    - otherwise → `failed`. Dependents of failed tasks become `cancelled`.
  - **Node loss**: registry `onChange` `left` → every running/fixing/auditing task on that node goes back to `ready` (attempts unchanged), emitting `task.migrated` when it lands on another node.
  - **Budget**: when API cost ≥ `config.budget.maxUsd`, stop dispatching new tasks, let running ones finish, and emit a warn `log`.
  - **Metrics**: recompute `RunMetrics` on every change and publish `metrics` at most once per second, plus a heartbeat every 5 s. `estSavedUsd` via core `estimateSavedUsd`.
  - Finish: when all tasks are terminal → `run.finished` with a summary (from `writer` if given, else a deterministic template) → `tracker.openFinalPR`.
- `cancel` aborts all sessions and marks pending tasks `cancelled`; `abortTask` aborts one. `waitForFinish(runId)` resolves on `run.finished`.
- Tests with **core mocks + FakeClock** (`MockNode`, `MockRegistry`, `MockScheduler`, `MockAuditor`, `MockMerger`, `MockPlanner`, `MemoryStore`, …):
  - The full sky-todo launch-day plan (fixture) runs to completion with merges in dependency order.
  - Audit fail → fix → pass. maxAttempts exhausted → failed → dependents cancelled.
  - Merge conflict → `conflict`. Tests-failed → fix loop.
  - Node death mid-task → migrated → completes on the other node.
  - maxParallel respected at every instant. Budget cap stops dispatch.
  - Dry run. Cancel. The metrics throttle.
  - A **golden test**: the sequence of `task.status` transitions for the happy path is snapshot-tested, so later refactors can't silently change behaviour.

## Explicitly out of scope
Real implementations of any port (siblings are building them). Conflict resolver agent (Wave 2). Server/CLI wiring (Epics 21, 22). Persisting across process restarts beyond what the Store gives.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/engine` passes, ≥ 30 tests, all deterministic (run the suite 3× and paste three identical pass counts).
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-20-engine.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/20-engine.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/20-engine`. Conventional Commits scoped to your lane (`feat(engine): …`, `test(engine): …`, `docs(epic-20): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
