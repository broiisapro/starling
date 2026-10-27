## Epic 45 Handback — Conflict-resolver loop

**Status:** Complete. Branch `epic/45-resolver` @ 24f6515 (the resolver commit; the docs and this handback follow it).
Closes #32.

**Delivered:**

- `createConflictResolver({ node, prompts, workspace, merger, clock?, exec?, maxAttempts?,
  testTimeoutMs?, sessionTimeoutMs?, maxHunkLines?, bundleUrlFor? })` in
  `packages/merger/src/resolver.ts`:
  - `resolve({ run, integrationBranch, taskA, taskB?, conflict, prompt, model, testCommand? })`
    returns `ResolveResult` (a `MergeResult` plus `attempts`, `resolveBranch`, `resolved`,
    `sessions`, `failures`, `notes`).
  - Creates `starling/<runShort>/resolve-<taskKey>` from the integration branch, merges the task
    branch **with the conflict left in place** and commits the markers as a two-parent merge commit.
  - Starts a resolver session through the injected `ExecutionNode` with `prompts.resolver(...)` plus
    a "Previous attempt did not land" section on retries; waits for `session.idle` (buffering events
    before the handle exists, failing on `session.error`, 20 min watchdog), collects, cleans up.
  - Verifies `git grep -n -e '^<<<<<<< ' <resolveBranch>` is empty and runs the suite in a
    scratch worktree; then lands through `merger.merge(repo, integrationBranch, {...taskA,
    branch: resolveBranch}, { testCommand })`.
  - Bounded to 2 attempts (each a fresh copy: `git branch -f` back to the marker commit); on
    give-up `resolved: false` with `status` `conflict`/`tests-failed`, the failures, and the branch
    kept for inspection. The integration branch is never touched by the resolver itself.
  - Clean-merge path: if the reported conflict no longer reproduces, it lands the branch without
    spending a session (`attempts: 0`).
- `packages/merger/src/conflict.ts`: `commitConflictedMerge`, `findConflictMarkers`, `findHunks`,
  `renderHunks`, `readHunks`, `resetBranch` + `DEFAULT_HUNK_LINES`/`DEFAULT_HUNK_CHARS`/
  `DEFAULT_HUNKS_PER_FILE`/`DEFAULT_MAX_ATTEMPTS`.
- `packages/merger/src/idle.ts`: `watchForIdle` (session filter, pre-attach buffering, `session.error`
  as failure, `unref`'d watchdog).
- `packages/merger/src/suite.ts`: `runSuite` shared by the merge queue and the resolver (timeouts and
  spawn failures are failures, `CI=1`, `STARLING_TASK`); `DEFAULT_TEST_TIMEOUT_MS` moved here and
  re-exported unchanged from the package root.
- `packages/prompts/src/resolver-prompt.ts` + `compiler.ts`: the resolver prompt now carries both
  tasks' DoDs, the **trimmed conflict hunks** (`ResolverPromptExtras { hunks?: string[] }`,
  `DEFAULT_MAX_HUNK_CHARS = 6_000`) and "keep both behaviours and both sets of tests"; the compiler
  is a `ResolverPromptCompiler` with an optional third `resolver` argument. The core two-argument
  port is unchanged; a plain implementation is still assignable (pinned by a test).
- Tests: 33 new in `@starling/merger` (77 total), 7 new in `@starling/prompts` (108 total), all on
  real temp git repos with a scripted fake node:
  - `src/conflict.test.ts` (14): hunk parsing/trimming/clamping, diff3, marker commit with two
    parents, clean-merge path, `git grep` markers, `branch -f` reset.
  - `src/resolver.test.ts` (10): resolved → merged (both behaviours on integration, no leftover
    worktrees, task branch now an ancestor); still-conflicted → 2 attempts → give up with integration
    unmoved; red suite → `tests-failed` with the nested suite's assertion text; stale conflict that
    no longer reproduces; input validation; deterministic branch naming.
  - `src/conflict-bait.test.ts` (2): the sky-todo `conflict-bait` demo proof — two hand-made branches
    editing `src/ui/render.ts`, preflight predicting the conflict, the queue reporting it, a
    scripted resolver fixing it, the merge landing green, the marker commit still inspectable; plus a
    negative control where deleting one side leaves the suite red and integration unmoved.
  - `src/idle.test.ts` (7): idle, other sessions/tasks/runs ignored, pre-attach replay, `session.error`,
    watchdog, idempotent `stop()`.
- `docs/epic-45-resolver.md` with the six AGENTS.md §6 sections and an **engine-hook** section giving
  Epic 49 the exact call site (`packages/engine/src/pipeline.ts`, `TaskPipeline.#merge()`,
  `case 'conflict'`), the resolver wiring (queue-wrapped `Merger`), and the transitions
  `conflict → fixing (resolving) → merging → merged | failed`.

**Key design decisions:**

- **A branch whose tip is the conflict.** Committing the markers on a fresh branch from integration
  gives the agent a real worktree to repair, keeps the task branch untouched, and makes a retry a
  deterministic `git branch -f` instead of a half-edited tree.
- **The resolver never lands anything itself.** The merge queue stays the single place that merges,
  runs the suite on integration and can roll back. The cost is a second suite run (once on the
  resolve branch for a precise failure, once in the merger as the authoritative gate); it only
  happens for conflicts.
- **`git grep` on the branch, not the worktree.** Works without a checkout (and after a remote
  node's bundle import), cannot be fooled by a stale directory, and a git failure throws instead of
  claiming success.
- **Fresh session per attempt.** The branch after a failed attempt contains that attempt's wrong
  resolution; a fresh copy of the conflict is unambiguous, and the engine's fixer keeps owning
  non-conflict repairs.
- **`resolved` + a core-enum `status`, not a new status.** `MergeResult.status` is LOCKED and has no
  `failed`, so the result carries the last honest status plus `resolved: false`; the engine hook maps
  that to `TaskStatus.failed`. No contract change.
- **Optional third prompt argument.** `PromptCompiler.resolver(ctx, conflict)` stays LOCKED; the
  extras are an optional third parameter (a two-argument compiler satisfies it), so the merger passes
  hunks structurally without importing `@starling/prompts`.
- **`taskB` is context, not control flow.** The conflict is always task A vs the integration branch;
  `taskB` names the sibling in the marker commit message (`git log` reads like the plan).
- **Infrastructure failures are loud, model failures are bounded.** A merge with no unmerged paths, a
  failing `git grep`, or a branch git refuses to move throws `MERGE_ERROR`; markers left behind or a
  red suite is an attempt and is retried.

**Verification (exact commands + results):**

- `bun install` (worktree): `Checked 163 installs across 221 packages (no changes)` — clean;
  `bun.lock` updated by `bun install` (not hand-edited).
- `bun test packages/merger`: `77 pass / 0 fail`, `284 expect() calls`, 9 files.
- `bun test packages/prompts`: `108 pass / 0 fail`, `4 snapshots, 319 expect() calls`, 8 files.
- `bun test src/conflict-bait.test.ts` (from `packages/merger`):
  `2 pass / 0 fail`, `27 expect() calls`, `Ran 2 tests across 1 file. [5.27s]` — the demo proof
  includes `preflight` → `conflict` → resolver → `merged` and the negative control.
- `bun run test` (root), both halves:
  - packages/server/cli/skills/integrations/tools/evals: `1399 pass, 4 skip, 0 fail — Ran 1403 tests
    across 166 files. [49.77s]`
  - apps/web: `426 pass, 0 fail — Ran 426 tests across 39 files. [9.04s]`
- `bun run check`: `Checked 715 files in 448ms. No fixes applied.` then the per-workspace
  `tsc --noEmit -p` loop with no output (clean).
- Manual/live checks: none needed — no network, no LLM, no opencode session in any test.

**Dependencies added:** `@starling/workspace: workspace:*` in `packages/merger` (real worktrees in
the resolver tests and `test-helpers.ts`; the production resolver only knows the `Workspace` port).
No third-party packages. `bun.lock` updated by `bun install`.

**CONTRACT REQUESTS:** none. Two locked shapes were worked around locally:
- `PromptCompiler.resolver` stays two-argument; the hunks are an optional third parameter that a
  plain implementation may ignore.
- `MergeResult.status` has no `failed`; `ResolveResult.resolved` carries the failure and the engine
  maps it to `TaskStatus.failed`. If the orchestrator prefers a core change later, the natural one is
  `MergeResult.status | 'failed'` or an optional `MergeResult.resolved?: boolean` — not made here.

**FIX REQUESTS (lanes I don't own):**

1. `packages/engine/src/pipeline.ts`, `TaskPipeline.#merge()`, `case 'conflict'` — replace
   `transition(key, 'conflict'); cleanup(live)` with the resolver call in
   `docs/epic-45-resolver.md` § *engine-hook*: transition to `fixing` (the locked `TaskStatus` enum
   has no `resolving`), publish a `log` info, call
   `deps.resolver.resolve({ run, integrationBranch, taskA, taskB, conflict: result,
   prompt: host.promptContext(spec, host.branchOf(key)), model: modelFor(config, 'resolver'),
   testCommand: ctx.testCommand })`, publish `merge.result` with the returned result, then
   `merging` + `merged` (+ `tracker.onMerged`) when `resolved`, otherwise `failed` with
   `log('error', resolved.detail)`; keep today's `conflict` behaviour when no resolver is wired.
2. `packages/engine/src/types.ts` — add `resolver?: ConflictResolver` to `EngineDeps`
   (`import type { ConflictResolver } from '@starling/merger'`).
3. `packages/engine/src/run-driver.ts` — construct it next to the merger:
   `createConflictResolver({ node, prompts, workspace, merger: queuedMerger, clock, bundleUrlFor })`
   where `queuedMerger` wraps `merger.queue().enqueue` so a resolver landing cannot race a normal
   merge in the shared integration worktree; pass it into `TaskPipeline`/`EngineDeps`.
4. `packages/engine/src/pipeline.ts` (optional) — derive `taskB` with
   `conflictingTasks(plan, key, result.conflictedFiles)[0]` from `@starling/prompts`; it is context
   only (marker commit message and telemetry).

**Deliberately deferred / out of scope:**

- Wiring the engine (Epic 49 owns `packages/engine`); the exact call site and transitions are in the
  doc and as FIX REQUESTS above.
- Real LLM resolver sessions (C2). Every test uses a scripted agent; no real model, opencode server,
  Ollama or GitHub call is made.
- Re-auditing the resolution: the auditor's lane check would flag the sibling's file, which is the
  nature of a conflict. The gates are the marker check, the suite and the merge queue.
- Re-preparing the conflict when the integration branch moves during a resolver session (a landing
  conflict becomes a failed attempt instead).
- Deleting the resolve branch after a give-up; it is kept for inspection.
- Flock scheduling of resolver sessions (choosing the perch); `bundleUrlFor` makes a remote node
  usable, but selection/event streaming is engine/server work.

**Open questions / flagged tradeoffs:**

- **Which node runs the resolver, and does the engine count that session against `maxParallel`?**
  `LocalNode` counts it in `activeSessions`, so the scheduler sees it, but the engine's own dispatch
  budget does not. Epic 49 should decide (reuse the task's node is the simplest and keeps the warm
  worktree cache).
- **Two suite runs on the happy path** (resolver verification + merger gate). Deliberate, documented;
  if it proves too slow for big repos, the resolver could pass no `testCommand` to the merger and rely
  on its own verified tree (the merge commit's tree is identical). Not done, because the invariant
  "integration only takes commits the suite vouched for" is worth more than one suite run.
- **Give-up status is `conflict`/`tests-failed` + `resolved: false`.** If the orchestrator would
  rather see `MergeResult.status: 'failed'`, that is a core change (CONTRACT REQUEST above) and the
  engine hook would switch on it instead of `resolved`.
