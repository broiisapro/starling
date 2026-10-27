# Epic 17 — Merge queue

## Goal

Land audited task branches on the run's integration branch, one at a time, and keep that branch
green while doing it. Every merge goes through a dedicated integration worktree, a `--no-ff` merge
commit, the project's regression suite and, when anything is red, a rollback that leaves the branch
exactly where it was. A FIFO queue serialises merges per integration branch so the engine can
enqueue results as they audit, without coordinating worktrees itself. `preflight()` lets the engine
predict conflicts with `git merge-tree` before it enqueues anything, without touching a worktree.

Deliverable branch: `starling/<runShort>/integration` (created elsewhere; this epic never invents a
base).

## How it works

### 1. The integration worktree

`createMerger({ worktreeRoot, exec?, clock?, testTimeoutMs? })` canonicalises `worktreeRoot` once
(`realpath` of the nearest existing ancestor) and derives
`<worktreeRoot>/_integration/<sanitised integration branch>` — for example
`starling-run1-integration` for `starling/run1/integration`.

`ensureIntegrationWorktree()` runs before every merge:

1. `mkdir -p <worktreeRoot>/_integration`, then `git worktree prune` (drops registrations for
   directories someone deleted).
2. If this repo already registers that path:
   - detached HEAD → `git checkout -f <integrationBranch>`;
   - a different branch → `MERGE_ERROR` (see “Key decisions”);
   - otherwise reuse it.
   - A stale `MERGE_HEAD` is aborted; a dirty tree is `reset --hard` + `clean -fdq`. The worktree is
     Starling-owned, so recovery is safe; ignored files (`node_modules`, build caches) are kept.
3. If the path exists but is not a worktree of this repo → `MERGE_ERROR` instead of hijacking it.
4. Otherwise `git worktree add --quiet <path> <integrationBranch>`.

One worktree is reused for every merge on that branch, so the suite runs in a warm checkout and the
queue never pays for a fresh `worktree add` per task.

### 2. One merge (`mergeTask`)

`merge(repo, integrationBranch, task, { testCommand?, title? })`:

1. Validate the task has a branch; `git rev-parse` the repo, the integration branch and the task
   branch (`MERGE_ERROR` with a precise message when one is missing).
2. If the task branch is already an ancestor of the integration branch → `skipped`, without creating
   a worktree. This is the idempotency path (retries, resumed runs).
3. Ensure the worktree, record `headBefore`.
4. `git -c commit.gpgsign=false merge --no-ff --no-edit -m "merge(<taskKey>): <title or branch>" <branch>`.
5. On a non-zero exit: collect `git diff --name-only --diff-filter=U`, `git merge --abort` (reset
   fallback), verify HEAD is back at `headBefore`, and return `conflict` with `conflictedFiles`.
   A non-zero exit with no unmerged paths is a hard `MERGE_ERROR`, not a conflict.
6. On success record the merge commit and, when a `testCommand` is configured, run it in the
   worktree with `bash -c`, `CI=1`, `STARLING_TASK=<taskKey>` and a timeout
   (`testTimeoutMs`, default 10 minutes).
7. Green → `merged` with the commit sha. Red, timed out or unrunnable → verify the commit is still
   ours, `git reset --hard HEAD~1`, return `tests-failed` with the output tail in `detail`.

The rollback guard is deliberately strict: it refuses unless `HEAD` is the exact merge commit we
created **and** that commit has two parents whose first is `headBefore`. A test command (or hook)
that moves HEAD gets a loud `MERGE_ERROR` instead of losing its commit to `HEAD~1`.

### 3. The queue

`merger.queue()` returns a `MergeQueue`:

```ts
enqueue(repo, integrationBranch, task, opts?): Promise<MergeResult>
pending(): MergeQueueEntry[]          // queued + running, oldest first
results(): MergeResult[]             // landed results, oldest first
onResult(fn): () => void             // unsubscribe
```

Each `enqueue` chains onto a tail promise keyed by `repo` + `integrationBranch`, so tasks for one
branch merge strictly in call order while different runs/branches proceed independently. The tail
swallows rejection: a rejected merge rejects its own caller but never blocks the next task. Entries
leave `pending()` in the `finally` of their run, including failures.

### 4. Preflight

`preflight(repo, integrationBranch, branch)` first checks ancestry (`alreadyMerged: true`), then runs
`git merge-tree --write-tree --name-only <integrationBranch> <branch>` and parses the output:
line 1 is the result tree oid, then conflicted paths until a blank line, then human-readable
messages. Exit 0 → `clean`; exit 1 → `conflictedFiles`; >1 → `MERGE_ERROR` (git < 2.38 lacks
`--write-tree`). No worktree, index or ref is touched; the only side effect is one dangling tree
object that git's normal GC collects.

## Key decisions & reasoning

- **A single reused worktree per integration branch, as specified.** Alternatives (a fresh worktree
  per merge, or merging in the user's checkout) either pay the checkout cost per task or risk the
  user's files. Reuse also means the queue's test command runs against the real accumulated tree.
- **`realpath` canonicalisation of `worktreeRoot`.** On macOS `git worktree list` reports
  `/private/var/…` while `tmpdir()` says `/var/…`; comparing the raw strings would make the merger
  try to create a path that already exists. Canonicalising once keeps `ensure`, `dispose` and tests
  agreeing.
- **Recover dirty/detached worktrees, refuse branch mismatch.** A crash should not wedge the queue,
  so a stale merge or scratch file is reset. A worktree on a _different_ branch, however, means two
  branch names sanitised to the same directory (e.g. `a/b` vs `a-b`) or a human moved it; switching
  branches under a concurrent queue would corrupt both merges, so it fails loudly instead.
- **Detect conflicts from `diff --diff-filter=U`, not the merge exit code.** `git merge` exits
  non-zero for hooks, a missing branch and unrelated histories too. Only unmerged paths are a
  `conflict`; everything else is a `MERGE_ERROR` after aborting.
- **Verify that abort restored the tip.** `merge --abort` is expected to restore `headBefore`; if it
  did not, returning `conflict` would hide a corrupted branch, so the merge throws instead.
- **The regression suite is a shell string run with `bash -c`.** The repo's `testCommand` comes from
  config and is meant to be a shell line (`bun test`, `test ! -f BROKEN`, `npm test -- --ci`).
  `core.exec` is argv-only by design (L13), so the shell is explicit at this boundary.
- **Timeouts and spawn failures count as failed tests.** The invariant is “the integration branch is
  always green”, and a suite we could not run is not green. Both roll back. `CI=1` keeps common
  runners non-interactive.
- **`TASK_TITLE` is additive (`opts.title`).** `MergeResult`/the port only defines `testCommand`, but
  `merge(t03-csv-export): CSV export` is much better history than repeating the generated branch
  name. The wider options type is assignable to the port, so the engine can pass a title without a
  contract change.
- **`commit` on `tests-failed` is the rolled-back merge sha, not a landed commit.** It is useful for
  logs and the queue UI ("we rolled this back"); `detail` always says `Rolled … back …`, and the
  engine must only record a landed commit for `status === 'merged'`.
- **Queue key is `repo + NUL + integrationBranch`.** The integration branch is enough within a run,
  but the repo is included so two runs on different repos never serialise against each other.
- **Listener failures are surfaced asynchronously.** A merge that already landed must not be turned
  into a rejection because a UI subscriber threw; the error is rethrown from a microtask so it is
  visible rather than swallowed (AGENTS.md §7).
- **No `src/handshake.ts`.** The `Merger` port already lives in `@starling/core`; this epic consumes
  no sibling Wave 1 interface. `MergeQueue`, `PreflightResult` and `MergerService` are new local
  surface, documented below for E20/E21/E26.
- **No new dependencies.** `git`/`bash` are shelled out through core's injectable `exec`; the only
  imports are `@starling/core` and Node/Bun built-ins.

## Interfaces for future epics

Everything is exported from `@starling/merger` (`packages/merger/src/index.ts`):

```ts
export function createMerger(options: MergerOptions): MergerService;

export interface MergerOptions {
  worktreeRoot: string;
  exec?: ExecFn; // (cmd: string[], opts: ExecOptions) => Promise<ExecResult>
  clock?: Clock; // default: systemClock
  testTimeoutMs?: number; // default: 10 * 60 * 1000
}

export interface MergerService extends Omit<Merger, 'merge'> {
  merge(repo: string, integrationBranch: string, task: TaskRun, opts?: MergeOptions): Promise<MergeResult>;
  queue(): MergeQueue;
  preflight(repo: string, integrationBranch: string, branch: string): Promise<PreflightResult>;
  integrationWorktreePath(integrationBranch: string): string; // no side effects
  dispose(): Promise<void>; // remove owned integration worktrees
}

export interface MergeOptions {
  testCommand?: string;
  title?: string;
}

export interface MergeQueue {
  enqueue(repo: string, integrationBranch: string, task: TaskRun, opts?: MergeOptions): Promise<MergeResult>;
  pending(): MergeQueueEntry[];
  results(): MergeResult[];
  onResult(fn: (result: MergeResult) => void): () => void;
}

export interface MergeQueueEntry {
  id: string;
  repo: string;
  integrationBranch: string;
  taskKey: string;
  branch?: string;
  enqueuedAt: number;
  state: 'queued' | 'running';
}

export interface PreflightResult {
  repo: string;
  integrationBranch: string;
  branch: string;
  clean: boolean;
  conflictedFiles: string[];
  alreadyMerged: boolean;
  detail: string;
}

// composable building blocks (used by the tests and available to the engine)
export function createMergeQueue(deps: { merge: MergeFn; clock: Clock }): MergeQueue;
export function mergeTask(
  deps: MergeDeps,
  repo: string,
  integrationBranch: string,
  task: TaskRun,
  opts?: MergeOptions,
): Promise<MergeResult>;
export function runPreflight(
  git: Git,
  repo: string,
  integrationBranch: string,
  branch: string,
): Promise<PreflightResult>;
export function ensureIntegrationWorktree(input: EnsureWorktreeInput): Promise<string>;
export function parseMergeTree(stdout: string): {
  tree?: string;
  conflictedFiles: string[];
  messages: string;
};
export function sanitizeBranchName(branch: string): string;
export function canonicalPath(path: string): string;
export function listWorktrees(git: Git, repo: string): Promise<WorktreeEntry[]>;
export function createGit(execFn: ExecFn): Git;
export function integrationWorktreePath(worktreeRoot: string, integrationBranch: string): string;
export const INTEGRATION_DIR = '_integration';
export const DEFAULT_TEST_TIMEOUT_MS = 600_000;
```

### Engine usage (Epic 20)

```ts
import { createMerger } from '@starling/merger';

const merger = createMerger({ worktreeRoot: config.worktreeRoot, clock: systemClock });

// Optional: ask before enqueueing (no worktree, no ref movement).
const forecast = await merger.preflight(repo, run.integrationBranch!, task.branch!);
if (!forecast.clean) {
  // Wave 2 / Epic 45: hand `forecast.conflictedFiles` to a resolver session.
  // For now: task.status = 'conflict'.
}

const result = await merger.queue().enqueue(repo, run.integrationBranch!, task, {
  testCommand: config.testCommand === 'auto' ? map.testCommand : config.testCommand,
  title: run.plan?.tasks.find((spec) => spec.key === task.taskKey)?.title,
});

if (result.status === 'merged') {
  // publish merge.result, Tracker.onMerged, Workspace.remove(task.worktreePath)
} else if (result.status === 'tests-failed') {
  // back to the fixer with result.detail as the failure tail
}

await merger.dispose(); // after the queue has drained
```

`MergerService` structurally satisfies core's `Merger` port, so an engine that only needs
`merge()` can type the field as `Merger` and never see the queue.

### Queue UI (Epic 26) / server (Epic 21)

`MergeResult` is already the locked contract; `queue.pending()` is the extra signal for a “waiting”
lane, and `onResult` is what the server can bridge to `merge.result` events if it wants to publish
from the merger instead of the engine. Neither is required for the first integration.

## Deviations from plan

- **`preflight`, `queue()` and `dispose()` live on the returned service**, not on the core `Merger`
  port (which stays untouched). The prompt's `Merger & { queue(): MergeQueue }` shape is preserved by
  `MergerService`.
- **`MergeOptions.title`** is additive so merge commits can carry the task title; passing no title
  falls back to the branch name exactly as specified.
- **`MergeQueue.results()`** was added beyond `pending()`/`onResult()` because the queue is the
  natural place to keep the landed order for a UI/debug view.
- **`testTimeoutMs` defaults to 10 minutes** (the prompt did not prescribe a default), and a timeout
  is reported as `tests-failed` with the timeout message in `detail`.
- **No handshake mirror file** was needed (the port lives in core), so `src/handshake.ts` does not
  exist in this package.
- **43 tests, not 15.** All the required cases plus rollback-guard, dirty-worktree recovery,
  timeout, output-tail, per-branch queue isolation, and worktree collision/refusal paths.

## Known limitations / deferred

- **Conflict resolution is out of scope** (Wave 2, Epic 45). The merger only reports
  `conflictedFiles` and aborts; the engine decides whether to spawn a resolver or fail the task.
- **Pushing, PRs and the final GitHub report are out of scope** (Epic 18). This epic never touches
  the network.
- **Merge order is FIFO and chosen by the caller.** Dependency-aware ordering is the engine's job
  (Epic 20); the queue deliberately does not reorder.
- **Timeout kills the `bash` wrapper, not necessarily its children.** A runaway test runner could
  keep running in the worktree after `EXEC_TIMEOUT` while the merger resets it. A process-group kill
  would need support in `core.exec` (see contract request note below in the handback).
- **Sanitised directory collisions fail loudly**: two distinct branches that sanitise to the same
  directory (`a/b` and `a-b`) cannot both use one `worktreeRoot`. Starling-generated
  `starling/<short>/integration` names are unique, so this only affects hand-made branches.
- **Two merger instances sharing a `worktreeRoot` and branch are not coordinated.** The engine is
  expected to create one merger per run; cross-process queue coordination is not attempted (the hub
  is single-process by design).
- **A relative `worktreeRoot` resolves against the hub process cwd.** The engine should pass the
  config value resolved against the repo (the config default is `../.starling-worktrees`).
- **POSIX shell required.** Tests run under `bash -c`; Windows is not a target for Wave 1.
- **No live tests.** The merger has no network/LLM surface; everything runs against real temp git
  repos.
