# Epic 12: Planner: goal to lane-safe task DAG

**Wave 1 · Branch `epic/12-planner` · Issue: find it with `gh issue list --search "Epic 12 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`packages/planner/**`
plus `docs/epic-12-planner.md` and `.orchestrator/handbacks/12-planner.md`. Read anything; write nothing else.

## Goal
Implement `Planner`: the brain that turns one goal sentence plus a `RepoMap` into a `Plan` whose tasks can run **in parallel without ever touching the same files**. This is Starling's core trick, and the validator is what makes it trustworthy. The LLM proposes; deterministic code verifies and repairs.

## Deliverables
- `createPlanner(opts: { llm: LLM; clock?: Clock; maxRepairs?: number /* default 2 */; minTasks?: number; maxTasks?: number /* 2..12 */ }): Planner`.
- **Prompt** (`src/prompt.ts`, a pure function, snapshot-tested). The system prompt encodes the rules: each task is 5–25 minutes of agent work; each task has a **lane** of `owns` globs it may write and `reads` it may read; tasks that may run concurrently must have **disjoint `owns`**; prefer new files in feature folders over editing shared files; when two tasks must touch the same file, make one depend on the other; `definitionOfDone` items are literal, checkable steps that always include "tests pass" plus specific new tests; `outOfScope` is explicit; `lockedDecisions` capture repo-wide facts (framework, test runner, style). The user message holds the goal, constraints, and the repo map rendered by your own small renderer (`src/render-map.ts`; repomap's renderer gets adopted at C1).
- LLM call via `llm.completeJson(req, PlanDraftSchema)` (role `planner`), where `PlanDraftSchema` is the LLM-facing shape (summary, lockedDecisions, tasks). Then build the `Plan` (ids via `newId`, the model ref from the response, `createdAt` from the clock).
- **`validate(plan): PlanIssue[]`**, deterministic:
  - `cycle` (report the cycle path) and `missing-dep`.
  - Duplicate task keys (`other`).
  - `empty-dod` and `empty-lane`.
  - **`lane-overlap`**: for every pair of tasks that can run concurrently (neither is an ancestor of the other in the DAG), `globsOverlap(a.lane.owns, b.lane.owns)` non-empty → error naming both keys and the overlapping globs.
  - warn: an `owns` glob matching no file in the map *and* not a plausible new-file location; task count outside the bounds; estimate > 40 min.
- **Repair loop**: if `validate` returns errors, send them back to the LLM (≤ `maxRepairs`) asking for a corrected full plan. If errors remain, apply **deterministic fixes**: break cycles by dropping the newest edge, drop missing deps, and serialise lane-overlapping pairs by adding a dependency edge (later task depends on earlier, ordered by key). After that, a plan returned by `plan()` **never contains error-level issues**; it returns the remaining warnings.
- Tests (MockLLM scripted): a clean sky-todo launch-day plan (use `fixtures/plans/sky-todo-launch-day.json` as the LLM's reply); an overlapping plan fixed by the LLM on repair; an overlapping plan fixed deterministically after repairs run out; a cycle; missing dep; invalid JSON handled by the LLM layer (just assert the error propagates); ancestor pairs allowed to overlap; property-style tests on the validator with generated DAGs (seeded RNG).
- Run a quick sanity check of your prompt text against `examples/sky-todo/demo-goals/launch-day.expected.md`: your doc should show how the prompt steers toward that decomposition.

## Explicitly out of scope
Real LLM calls (L23). Evals harness (Epic 29). Repo mapping (Epic 11). Choosing models.

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/planner` passes, ≥ 25 tests, including the deterministic-repair guarantee: a fuzz test with 200 random plans, every returned plan having 0 error-level issues.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-12-planner.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/12-planner.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/12-planner`. Conventional Commits scoped to your lane (`feat(planner): …`, `test(planner): …`, `docs(epic-12): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
