# Epic 17: Merge queue

**Wave 1 · Branch `epic/17-merger` · Issue: find it with `gh issue list --search "Epic 17 in:title"` · Model: DeepSeek V4.1 Flash · Budget: 60–120 min of autonomous work**

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
`packages/merger/**`
plus `docs/epic-17-merger.md` and `.orchestrator/handbacks/17-merger.md`. Read anything; write nothing else.

## Goal
Implement `Merger`: land audited task branches onto the run's integration branch one at a time, run the regression suite after each merge, and roll back cleanly if tests fail or git conflicts. The integration branch must **always** be green.

## Deliverables
- `createMerger(opts: { worktreeRoot: string; exec?: typeof exec; clock?: Clock; testTimeoutMs?: number }): Merger & { queue(): MergeQueue }`.
- `merge(repo, integrationBranch, run, { testCommand })`:
  - Uses a dedicated integration worktree (`<worktreeRoot>/_integration/<branch-sanitised>`, created on first use).
  - `git merge --no-ff --no-edit <run.branch>` with message `merge(<taskKey>): <title or branch>`.
  - On conflict: collect `git diff --name-only --diff-filter=U`, `git merge --abort`, return `conflict` with `conflictedFiles`.
  - On a clean merge with a `testCommand`: run the tests. If they fail, `git reset --hard HEAD~1` (verify it was our merge commit) and return `tests-failed` with the output tail in `detail`. Otherwise return `merged` with the commit sha.
  - Idempotent: if the branch is already an ancestor of the integration branch, return `skipped`.
- `MergeQueue`: `enqueue(repo, integrationBranch, run, opts): Promise<MergeResult>`, which serialises **per integration branch** (one merge at a time) and keeps FIFO order; `pending()` and `onResult(fn)`.
- `preflight(repo, integrationBranch, branch)`: uses `git merge-tree --write-tree --name-only` to predict conflicts **without** touching any worktree. The engine can call it before enqueueing.
- Tests against **real temp git repos**: clean merge; conflict → aborted and integration branch unchanged; tests-failed → rolled back (testCommand like `test ! -f BROKEN`); already-merged → skipped; three concurrent `enqueue` calls serialised with the final history containing all three; preflight agrees with the actual merge result; the integration worktree is reused across merges.

## Explicitly out of scope
Conflict *resolution* by an agent (Wave 2, Epic 45). Pushing or opening PRs (Epic 18). Choosing merge order (the engine decides; the queue is FIFO).

## Definition of done (run literally, paste results in the handback)
1. `bun install` clean in your worktree.
2. `bun test packages/merger` passes, ≥ 15 tests, total runtime < 30 s.
3. `bun run test` at the repo root passes, all packages' tests and not just yours. Paste the summary line.
4. `bun run check` passes (Biome + typecheck for every workspace).
5. `docs/epic-17-merger.md` (sections per AGENTS.md §6; **"Interfaces for future epics"** must show exact exported signatures and a usage snippet) and `.orchestrator/handbacks/17-merger.md` written. PR opened per AGENTS.md §6 with `Closes #<issue>`; print the PR URL last.

## Git
Branch `epic/17-merger`. Conventional Commits scoped to your lane (`feat(merger): …`, `test(merger): …`, `docs(epic-17): …`), committed small and often: at least 6 commits that tell the story. `git fetch origin && git rebase origin/main` before pushing. No merging, no tags.
