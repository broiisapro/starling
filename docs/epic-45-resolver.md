# Epic 45 — Conflict-resolver loop

**Wave 2a · branch `epic/45-resolver` · issue #32 · lanes `packages/merger/**`,
`packages/prompts/src/resolver*`**

## Goal

When two branches collide anyway — a plan whose lanes overlapped, a task that needed one line in a
sibling's file, a demo that deliberately baits the conflict — Starling should not just mark the task
`conflict` and stop. It should spin up a **resolver agent** that merges both intents, commit that
resolution on a throwaway branch, prove it (no markers, suite green) and hand it back to the merge
queue. This epic builds that capability as a self-contained service, `createConflictResolver()`, that
the engine calls from one place; it does not wire the engine (Epic 49 owns `packages/engine`).

## How it works

### The service

```ts
const resolver = createConflictResolver({ node, prompts, workspace, merger }); // clock/exec optional
const result = await resolver.resolve({ run, integrationBranch, taskA, taskB, conflict, prompt, model, testCommand });
```

`resolve()` runs this loop, entirely on real git:

1. **Rebuild the conflict.** `workspace.create(repo, 'starling/<runShort>/resolve-<taskKey>', integrationBranch)`
   creates the resolve branch from the integration branch, then merges the task branch with
   `git merge --no-ff --no-edit -m "merge(<taskKey>): conflict left in place for the resolver"`.
   On a content conflict it stages the marker files as they are and **commits them**, so the resolve
   branch's tip is a two-parent merge commit whose tree literally contains `<<<<<<<` markers. The
   temporary worktree is removed.
   If the merge turns out clean (a sibling landed in between and the conflict no longer reproduces),
   the resolver skips the agent entirely and lands the branch (`attempts: 0`).
2. **Capture the hunks.** `readHunks()` reads each conflicted file from that worktree and trims every
   marker block: `--- <path>` header, at most 8 lines per side, at most 3 conflicts per file, at most
   2,000 characters per file, with `… (N more lines)` where it cut.
3. **Ask an agent.** `node.startTask({ runId, taskKey, repo, fromRef: resolveBranch, branch:
   resolveBranch, prompt, model })`. `prompt` is `prompts.resolver(ctx', conflict, { hunks })` where
   `ctx'` is the engine's `PromptContext` with `branch` overridden to the resolve branch and
   `testCommand` normalised. On a retry the prompt gains a **Previous attempt did not land** section
   with the last failures (tail-trimmed) and the attempt number.
4. **Wait for idle.** `watchForIdle()` subscribes to `agent.event`s for `(runId, taskKey)`, buffers
   events that arrive before the handle (and therefore the session id) exists, resolves on
   `session.idle`, rejects on `session.error`, and abandons a hung session after 20 minutes.
5. **Collect and clean up.** `node.collect(handle, repo, integrationBranch)` commits whatever the
   agent left uncommitted (and imports a remote node's bundle); `node.cleanup(handle)` always runs,
   in a `finally`, and its failures become `notes`, never a silent success.
6. **Prove it.** `git grep -n -e '^<<<<<<< ' <resolveBranch>` — exit 1 is the pass. Then a
   scratch worktree of the resolve branch runs `bash -c <testCommand>` with `CI=1`,
   `STARLING_TASK=<taskKey>` and a 10-minute timeout (shared with the merge queue's `runSuite`), and
   is removed again. No test command means the suite step is skipped.
7. **Land it.** `merger.merge(repo, integrationBranch, { ...taskA, branch: resolveBranch }, { testCommand })`.
   `merged`/`skipped` → `resolved: true`. `conflict`/`tests-failed` → the next attempt. The resolver
   never moves the integration branch itself: the merge queue stays the only thing that does, with
   its worktree, its suite and its rollback.
8. **Bound it.** Two attempts by default. A retry is a *fresh* copy: `git branch -f <resolve>
   <markerCommit>` after the node cleanup, then a new session. After two failures the result is
   `resolved: false` with `status` set to the last honest failure (`conflict` when markers or a
   conflict survived, `tests-failed` when the suite stayed red), `attempts: 2`, `failures`, and the
   resolve branch left in place for inspection.

`ResolveResult` is a `MergeResult` plus `{ attempts, resolveBranch, resolved, sessions, failures,
notes }`. `status` never leaves core's LOCKED enum.

### The prompt

`packages/prompts/src/resolver*` now carries, in order: the role and the conflicted files, **the
trimmed hunks** in a fenced block, its own intent (goal, deliverables, out-of-scope, **DoD**), every
sibling lane that owns a conflicted file **with that sibling's DoD**, the rules (preserve both
behaviours, keep both sets of tests, resolve in place, no `merge --abort`, run the suite, commit
`fix(<key>): resolve merge conflict`), and the handback block. `buildResolverPrompt(ctx, conflict,
options, extras?)` takes the hunks as an optional fourth argument; `createPromptCompiler()` returns
a `ResolverPromptCompiler` whose `resolver(ctx, conflict, extras?)` accepts them. The core port is
unchanged: a two-argument implementation is still assignable, which the compiler test pins.

### The demo proof

`packages/merger/src/conflict-bait.test.ts` runs the sky-todo **`conflict-bait`** story without an
LLM or the demo app's dependencies. A hermetic repo mirrors `src/ui/render.ts`'s footer, with a real
`bun test` suite that encodes both tasks' definitions of done. Two hand-made branches
(`date-sort`, `delete-all`) edit the same function; `date-sort` lands; `preflight` predicts the
conflict; the queue reports it; a scripted resolver agent writes the reconciled function; the
resolver proves it and the merge lands. The test then asserts the marker commit
(`git show <resolve>^:src/ui/render.ts` still contains `<<<<<<<`), the resolved integration tree
(both behaviours, no markers), that the suite passed on integration, and that no resolver worktree
is left behind. A negative control repeats the run with an agent that deletes one side: the suite
stays red, the result is `tests-failed` and the integration branch does not move.

## Key decisions & reasoning

- **A branch whose tip is the conflict, not the agent's original worktree.** A resolver needs a
  worktree that *contains* the markers; the task branch's worktree is gone by conflict time (the
  engine cleaned it up) and rebasing it would lose the original diff. Committing the markers on a
  fresh branch from integration makes the state explicit, keeps the task branch untouched for
  history/debugging, and makes a retry a deterministic `git branch -f`.
- **Never land from the resolver.** The merge queue owns the integration worktree, the suite and the
  rollback; duplicating that in the resolver would be two implementations of "integration is always
  green". The cost is a second suite run on the resolve branch before the merger's authoritative
  run — deliberate: the first gives a precise failure without touching integration, and the second
  is the one that vouches for the branch. It only happens for conflicts.
- **Markers are checked with `git grep` on the branch, not by reading a worktree.** It needs no
  checkout, works after `collect` imported a remote branch, and cannot be fooled by a stale or
  reused directory. Exit 1 means clean; any other non-zero exit throws `MERGE_ERROR` rather than
  claiming success.
- **Retry from the marker commit instead of sending a fixer prompt to the same session.** The branch
  after a failed attempt contains that attempt's (wrong) resolution; asking the same session to fix
  its own merge is the fixer loop's job, and mixing the two would make "what is the branch now?"
  unanswerable. A fresh copy of the conflict is cheap and unambiguous. The engine's existing fixer
  still handles non-conflict failures.
- **Verification happens after `node.cleanup`.** `LocalNode` (and the scripted node) check out the
  resolve branch in their own worktree; git refuses a second `worktree add` for a checked-out
  branch. Cleanup first also keeps the node's worktree out of the scratch measurement.
- **`resolved` + a core-enum `status`.** `MergeResult.status` has no `failed` (LOCKED), so the
  resolver reports the last attempt's honest status plus `resolved: false`; the engine's hook maps
  that to `TaskStatus.failed`. This avoided a contract change and kept every existing consumer of
  `MergeResult` working.
- **Optional third prompt argument.** `PromptCompiler.resolver(ctx, conflict)` is LOCKED at two
  arguments. Extending it with an *optional* third argument is source-compatible in both directions
  (a two-argument compiler satisfies the wider type), so the merger can pass hunks structurally
  without importing `@starling/prompts` and without a core change.
- **Hunks are trimmed by the merger, rendered by the prompt.** The merger owns the worktree and the
  cap (`HunkOptions`); the prompt owns presentation, code fences and the section order. The prompt
  also clamps the whole block, so a caller that ignores the cap cannot blow the budget.
- **`taskB` is context, not control flow.** The conflict is always "task A vs the integration
  branch"; `taskB` only names the sibling in the marker commit message
  (`merge(delete-all): conflict with date-sort left in place for the resolver`) and in the engine
  hook's telemetry, so `git log` reads like the plan.
- **Infrastructure failures are loud, model failures are bounded.** A merge that fails without
  unmerged paths, a `git grep` error, or a branch that will not move throws `MERGE_ERROR`; a marker
  left behind or a red suite is an attempt and is retried. Burning agent attempts on a broken repo
  helps nobody.
- **Reuse over duplication.** `runSuite` moved out of `merge.ts` into `suite.ts` so the queue and the
  resolver share one definition of "the suite failed", including timeouts and spawn failures. The
  scripted node reuses `@starling/workspace` (real worktrees) and core's `makeNodeInfo`, so the only
  fake part of the tests is the agent's edit.

## Interfaces for future epics

Everything is exported from `@starling/merger`:

```ts
export function createConflictResolver(options: ConflictResolverOptions): ConflictResolver;

export interface ConflictResolverOptions {
  node: ExecutionNode;
  prompts: PromptCompiler;            // @starling/prompts' compiler understands the extras
  workspace: Workspace;               // real worktrees for the conflict and the scratch suite
  merger: Merger;                     // the only thing that lands a branch
  clock?: Clock;                      // default systemClock
  exec?: ExecFn;                      // injectable git, default core exec
  maxAttempts?: number;               // default 2
  testTimeoutMs?: number;             // default 10 min
  sessionTimeoutMs?: number;          // default 20 min, 0 disables
  maxHunkLines?: number;              // default 8 per side
  bundleUrlFor?: (ref: string) => { url: string; token: string }; // remote perch support
}

export interface ConflictResolver {
  resolve(ctx: ResolveContext): Promise<ResolveResult>;
  branchFor(runId: string, taskKey: string): string;   // no side effects
}

export interface ResolveContext {
  run: Run;
  integrationBranch: string;
  taskA: TaskRun;                     // conflict.taskKey must match its taskKey
  taskB?: TaskRun;                    // the landed sibling, when the engine knows it
  conflict: MergeResult;              // status must be 'conflict'
  prompt: PromptContext;              // engine's context; `branch` is overridden
  model: ModelRef;                    // modelFor(config, 'resolver')
  testCommand?: string;               // overrides prompt.testCommand; empty = no suite
}

export interface ResolveResult extends MergeResult {
  attempts: number;
  resolveBranch: string;              // starling/<runShort>/resolve-<taskKey>
  resolved: boolean;                  // false ⇒ the engine must fail the task
  sessions: string[];
  failures: string[];
  notes: string[];
}

// building blocks, also public
export function commitConflictedMerge(input: ConflictMergeInput): Promise<ConflictMergeOutcome>;
export async function findConflictMarkers(git: Git, repo: string, ref: string): Promise<ConflictMarker[]>;
export async function resetBranch(git: Git, repo: string, branch: string, commit: string): Promise<void>;
export function findHunks(text: string): RawHunk[];
export function renderHunks(path: string, text: string, options?: HunkOptions): string;
export async function readHunks(worktreePath: string, files: string[], options?: HunkOptions): Promise<string[]>;
export function watchForIdle(node: ExecutionNode, options: IdleWatchOptions): IdleWatch;
export function runSuite(exec: ExecFn, cwd: string, command: string, options: SuiteOptions): Promise<SuiteOutcome>;
export const DEFAULT_MAX_ATTEMPTS = 2;
export const DEFAULT_SESSION_TIMEOUT_MS = 1_200_000;
export const DEFAULT_HUNK_LINES = 8;
```

Prompts: `ResolverPromptExtras { hunks?: string[] }`, `ResolverPromptCompiler` (a `PromptCompiler`
with an optional third `resolver` argument), `DEFAULT_MAX_HUNK_CHARS = 6_000`.

### engine-hook

**Exact call site: `packages/engine/src/pipeline.ts`, `TaskPipeline.#merge()`, `case 'conflict'`.**
Today it does `transition(key, 'conflict'); cleanup(live)`. Replace it with a resolver call. Nothing
else in the engine changes; audit, fixer, scheduling and the queue stay as they are.

```ts
// packages/engine/src/pipeline.ts — inside #merge(), replacing `case 'conflict':`

case 'conflict': {
  const task = this.#host.run.tasks[key];
  const spec = live.spec;
  if (this.#deps.resolver === undefined || task === undefined) {
    this.#host.transition(key, 'conflict');            // no resolver wired: keep today's behaviour
    await this.#cleanup(live);
    return;
  }

  // conflict → resolving. The LOCKED TaskStatus enum has no 'resolving'; 'fixing' is the
  // "an agent is repairing this task" state the UI already renders.
  if (!this.#host.transition(key, 'fixing')) return;
  this.#host.log('info', `${key} conflicted; spinning up a resolver agent`, key);

  const resolved = await this.#deps.resolver.resolve({
    run: this.#host.run,
    integrationBranch: this.#integrationBranch,
    taskA: structuredClone(task),
    taskB: conflictingTasks(plan, key, result.conflictedFiles)[0],   // optional, see below
    conflict: result,
    prompt: this.#host.promptContext(spec, this.#host.branchOf(key)),
    model: modelFor(this.#host.config, 'resolver'),
    testCommand: ctx.testCommand,
  });
  if (this.#stale(live, generation)) return;

  this.#host.save();
  this.#host.publish({
    type: 'merge.result', runId: this.#host.run.id, ts: resolved.ts, payload: resolved,
  });
  this.#host.touchMetrics();

  if (resolved.resolved) {
    // resolving → merging → merged. The resolver already merged through the merger, so the
    // 'merging' transition is recorded for the timeline rather than for work.
    this.#host.transition(key, 'merging');
    this.#host.transition(key, 'merged');
    const merged = this.#host.run.tasks[key];
    if (merged !== undefined) {
      await this.#deps.tracker.onMerged(this.#host.run, structuredClone(merged));
    }
  } else {
    // resolving → failed.
    this.#host.log('error', `${key} could not be resolved: ${resolved.detail}`, key);
    this.#host.transition(key, 'failed');
  }
  await this.#cleanup(live);
  return;
}
```

State transitions: **`conflict` (the merge result) → `fixing` (resolving; publish a `log` event) →
`merging` → `merged` | `failed`**. `conflict` is the `MergeResult` status, not a `TaskStatus` the
engine needs to enter first: the task is already `merging` when the queue reports it, and the hook
goes straight to `fixing`. `task.migrated` is not involved — resolver sessions run on the node that
is passed in.

Wiring (FIX REQUEST for Epic 49, spelled out in the handback):

```ts
// EngineDeps gains an optional dependency; nothing else changes type.
resolver?: ConflictResolver;                    // from '@starling/merger'

// run-driver.ts, where the merger is created:
const merger = createMerger({ worktreeRoot, clock });
// Queue-serialise the resolver's landing so it cannot race a normal merge:
const queued: Merger = {
  merge: (repo, branch, task, opts) => merger.queue().enqueue(repo, branch, task, opts),
  preflight: merger.preflight,
};
const resolver = createConflictResolver({
  node: <the node the task ran on>, prompts, workspace, merger: queued, clock,
  bundleUrlFor: flock ? (ref) => bundleUrlFor(ref) : undefined,
});
```

Two things for the wiring epic to decide, both flagged rather than assumed:

- **Which node** runs the resolver session. `ResolveContext` does not carry a node id; pass the node
  that just finished the task (it has a warm worktree cache and its own capacity accounting), or
  ask the scheduler again. Cost: a resolver session is one extra node session, and `LocalNode.info()`
  counts it, so `maxSessions` still protects the machine.
- **`taskB`.** The engine can name the sibling with the attribution the prompts package already
  implements: `conflictingTasks(plan, taskKey, conflictedFiles)` returns every task whose `lane.owns`
  matches a conflicted file. It is optional context only.

## Deviations from plan

- **`resolve()` returns `ResolveResult` (a `MergeResult` + bookkeeping), not a bare `MergeResult`.**
  The assignment asked for `MergeResult`; the extra fields (`attempts`, `resolved`, `sessions`,
  `failures`, `notes`, `resolveBranch`) are what the engine needs to publish honest events. It is
  assignable to `MergeResult`, so the requested signature still holds.
- **`status` on give-up is `conflict`/`tests-failed` + `resolved: false`, not a new `failed` status.**
  `MergeResult.status` is LOCKED and has no `failed`; the engine hook maps `resolved: false` to
  `TaskStatus.failed` instead of widening the contract.
- **`ResolveContext` needs the engine's `PromptContext`** (`prompt`) and the resolver `model`. The
  prompt compiler needs the plan and repo map, and inventing either inside the resolver would be a
  lie; the model role is config the engine already resolves.
- **The resolver runs the suite twice on the happy path** (once itself, once in the merger). See the
  decision above; the second run is the one that guards the integration branch.
- **Prompt extras are a third argument, not a field on `MergeResult`.** The contract is LOCKED and a
  new optional field would have forced a core change for presentation data.
- **`@starling/workspace` is now a dependency of `@starling/merger`.** It is used by the resolver's
  tests (real worktrees through the real port implementation) and by `test-helpers.ts`; the
  production resolver only knows the `Workspace` port.
- **Test count:** 77 in `@starling/merger` (was 44) and 108 in `@starling/prompts` (was 101),
  including the conflict-bait proof and a negative control. Outside the two packages' tests, the
  full suite stays green (1399 + 426).

## Known limitations / deferred

- **A concurrent merge during a resolver session can invalidate the resolution.** The branch was
  built from the integration tip at prepare time; if another task lands first, the resolver's
  `merger.merge` either merges cleanly on top or reports a conflict, which is treated as a failed
  attempt. Re-preparing between attempts is not attempted (it would reset the retry's baseline).
- **No re-audit of the resolution.** The auditor's lane check would flag the sibling's file as
  out-of-lane, which is the whole point of a conflict. The gates are the marker check, the suite and
  the merge queue; a re-audit would need a relaxed lane rule for resolver diffs (Epic 49's call).
- **Marker check is `^<<<<<<< ` only.** That matches git's own marker exactly; a model writing a
  marker-like line without the trailing space is not detected, but it also does not produce an
  unbuildable file in practice.
- **The resolve branch is kept after a give-up** (so a human can inspect it). Nothing deletes it at
  the end of a run; `git branch -D` or a future run-cleanup step owns that.
- **No flock scheduling of resolver sessions.** `bundleUrlFor` makes a remote `ExecutionNode` usable,
  but choosing the perch and streaming its events into the drawer is engine/server work.
- **Real resolver sessions are untested here** (L29/C2). Every test uses a scripted agent; the first
  real run belongs to the C2 integration.
- **POSIX only.** The suite is run with `bash -c`, like the merge queue.
- **`sessionTimeoutMs` defaults to 20 minutes.** A real coding model on a large conflict may need
  more; it is configurable and the watchdog is `unref`'d so it never keeps a process alive.
