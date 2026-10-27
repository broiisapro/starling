# Epic 57 — Workspace hardening at swarm scale

## Goal

Starling's selling point is *lots* of agents. Epic 14 built the git layer for "about 20 agents";
this epic makes it hold at **50+ concurrent worktrees**, on big repositories, across crashes, and
without leaving anything behind.

Concretely: find the real bottlenecks with a reproducible stress harness, fix them in the git layer,
add crash recovery (`recoverWorkspace`, the engine behind a future `starling gc`), cover the edge
cases a real repository throws at you (submodules, LFS pointers, spaces/unicode, a detached base, a
dirty main checkout), and report what a worktree actually costs on disk.

Everything here is inside `packages/workspace` and `tools/stress`. Merge logic, the engine and CLI
wiring are out of scope (see *Known limitations / deferred* and the handback's FIX REQUESTS).

## How it works

### The stress harness (`tools/stress`)

`bun tools/stress/worktrees.ts` is the measurement, not a separate implementation. It generates a
throwaway repository (5 000 files over 50 directories, one shared file per conflict pair), then drives
the **real** `@starling/workspace` port the way the engine does:

| phase             | concurrency | what it proves                                                       |
| ----------------- | ----------- | -------------------------------------------------------------------- |
| `create`          | 60 at once  | every task gets its own worktree, no lost registrations              |
| `commit`          | 60 at once  | 60 private indexes commit in parallel; half edit a shared line        |
| `diff`            | 60 at once  | audit input stays cheap when the worktree is clean and when it is not |
| `predict-conflicts` | 20 pairs  | `merge-tree` finds the exact path two tasks both changed             |
| `bundle-create` / `bundle-fetch` | 10 | the Flock round trip returns the same commit                 |
| `remove`          | 60 at once  | nothing is left registered or on disk                                |

Each call is timed individually (including mutex queueing, because that is the latency the engine
sees), so the report gives p50/p95/p99/max and a total per operation. Failures are collected rather
than thrown, and `ok` is false if any operation failed. `--keep` leaves the repo for inspection,
`--json` emits the report, `--no-sparse` skips the sparse comparison.

`tools/stress/harness.test.ts` runs the same code path at test scale (120 files, 6 worktrees), so the
harness cannot rot between full runs.

### Bottleneck 1 — process spawn storms → a bounded pool (`pool.ts`)

Every workspace call fans out into `git` child processes. 60 concurrent audits used to mean hundreds
of simultaneous `git` processes competing for CPU, page cache and the disk queue.

`Semaphore` + `boundedExec` cap in-flight `git` processes at `defaultGitConcurrency()`: one per core,
clamped to **4…12** (the disk queue, not the executor, is the bottleneck above that). Queueing is
FIFO per `Git` instance, so a second repository never waits behind the first. `maxConcurrency: 0`
disables the pool (tests that drive a fake exec), and `createWorkspace({ maxConcurrency })` exposes it.

### Bottleneck 2 — `index.lock` retries (`git.ts`)

A single 50 ms retry was enough for "a human is holding the lock". It is not enough when 60 agents
stage at once: the loser of an internal race typically needs a few tens of milliseconds. Retries are
now **six attempts**, exponential (25 ms base, 1 s cap) with up to 25 % jitter so waiters spread out
instead of waking in lockstep. The contention predicate gained `cannot lock worktree` and
`failed to lock`; anything else still fails immediately with argv and stderr attached.

### Bottleneck 3 — `git worktree add` is not concurrency-safe, so creates stay serialised but do less

Measured, not assumed: 60 parallel `git worktree add` calls against one repository produced
`fatal: failed to read .git/worktrees/wtN/commondir` and only **56 of 60** registrations. Worktree
creation therefore remains under the repo mutex (a bounded pool cannot help here — it would not fix
the race), but the work inside the lock shrank from "list worktrees, check, add" to:

1. a per-instance `known` map hit returns immediately (the scheduler-retry case);
2. optimistically `git worktree add -b <branch> <path> <fromRef>` — **one spawn, no `worktree list`**;
3. only on failure: check whether the branch exists (a previous run), then `findWorktree` →
   `prune --expire now` → `worktree add <path> <branch>`; an unregistered leftover directory is
   cleared only when its `.git` pointer proves it belongs to this repository.

That removes ~59 `worktree list` calls from a 60-task dispatch, leaving the checkout itself as the
only real cost.

### Bottleneck 4 — `worktree prune` on every removal

`remove()` pruned after every removal: 60 full scans of `.git/worktrees` per cleanup. Prunes are now
debounced per repo (`pruneIntervalMs`, default 10 s) and always use `--expire now`, because plain
`git worktree prune` honours a three-month expiry and would leave a crash's stale registration for a
quarter. A failed prune is swallowed (the next create or remove fixes it) — it must never fail a
successful removal.

### Bottleneck 5 — the diff path (`workspace.ts`)

`diff()` used to spend five spawns answering "what changed": two `--numstat`, two patches, plus
`ls-files --others`. It now starts with **one** `git status --porcelain=v1 -z --no-renames
--untracked-files=all`, which answers both "are tracked files modified?" and "which files are
untracked?". The working-tree numstat and patch are fetched **only** when there is something to fetch.
A clean worktree right after an agent commits therefore costs 3 spawns instead of 5; a dirty one costs
5 instead of 5, with the untracked scan folded in.

Similarly, `commitAll()` no longer reads `user.name`/`user.email` before every commit (two spawns per
task). It commits with `-c commit.gpgsign=false` and, only if git reports an identity failure, retries
with `-c user.name=Starling Bot -c user.email=starling@localhost`. The fallback behaviour is unchanged
and still covered by a test; the fast path costs nothing.

### Unicode paths (`git.ts`)

`core.quotePath=false` is now pinned on **every** git call. Without it, `--numstat`, `--name-only`
and patch headers print non-ASCII paths as `"src/na\303\257ve file.ts"`, which would break lane globs
and changed-file lists in any repository with unicode filenames. Found by the new edge-case test, not
by reading docs.

### Crash safety — `recoverWorkspace(repo, worktreeRoot, opts)`

The gc for git state a dead run leaves behind. Exported for a future `starling gc` and safe to call
from an operator's shell today.

It scans:

- **worktrees** under `worktreeRoot` whose branch is in `starling/` (configurable prefix);
- **branches** in that namespace that no worktree has checked out (`remove()` keeps the branch; the
  merger decides merges, gc decides leaks);
- **directories** under `worktreeRoot` that git no longer registers (an add that died halfway), only
  when `.git` is a `gitdir:` pointer into this repository — never an arbitrary directory;
- **stale registrations** whose directory vanished.

Safety rules (all tested):

- a run id in `liveRunIds` is never touched;
- everything must be older than `olderThanHours` (default 12) **by every clock we can read**: branch
  reflog creation time, HEAD commit time, worktree directory mtime and the worktree's private git
  index mtime. No evidence at all means *keep*;
- `starling/<run>/integration` is the run's deliverable and is protected unless
  `includeIntegration: true`;
- `dryRun: true` produces the identical report and changes nothing (what `starling gc --dry-run`
  will show);
- missing registrations are pruned **before** branches are deleted (git refuses `branch -D` while a
  broken registration still claims the branch);
- failures are collected into `report.errors` instead of aborting the cleanup.

### Dirty main checkout

`ensureIntegrationBranch()` now refuses to cut an integration branch from a base that is checked out
with **uncommitted changes to tracked files**, with a message that names the checkout and says to
commit or stash, and `details.reason = 'dirty-base-checkout'`. Untracked files alone do not block a
run: they cannot be lost by branching, and a stray `.DS_Store` or log file must not stop every run. A
commit sha or remote ref base is exempt (nothing is checked out at a sha).

### Sparse worktrees (`sparse.ts`, opt-in)

A lane usually needs one or two directories out of hundreds, so a full checkout per worktree is the
biggest avoidable cost. `createWorkspace({ sparseCheckout: (branch) => ['src/a'] })`:

1. `git worktree add --no-checkout -b <branch> <path> <fromRef>`;
2. `git sparse-checkout set --cone src/a`;
3. `git read-tree -m -u HEAD` — **required**: a `--no-checkout` worktree has an empty index, so step 2
   alone leaves every path staged as deleted (this was found empirically, not from the docs).

Cone mode keeps repo-root files plus the named directories. Off by default because it is a behaviour
change: an agent that greps the whole repo, or a test that imports a sibling package outside the lane,
will not find the files. The engine can derive the directories from `TaskSpec.lane.owns` once it
decides to opt in.

### Disk accounting (`disk.ts`)

`diskUsage(path)` walks without following symlinks (a lane that symlinks `node_modules` must not be
walked) and returns bytes/files/dirs/symlinks; `formatBytes` renders it. Reusable by `starling gc` to
report what a cleanup would free.

## Key decisions & reasoning

| decision | why | alternatives rejected |
| --- | --- | --- |
| Bound `git` processes at 4…12 | Beyond one process per core the bottleneck is the disk queue; a cap keeps latency predictable under a 60-way burst | Unbounded (the status quo: spawn storms); a single global pool (one repo would starve another) |
| Six retries with jittered exponential backoff | Swarm-internal contention needs tens of ms, not one 50 ms retry; jitter stops herd wake-ups | One retry (too fragile); fixed 1 s backoff (slow tail); blind retries on every failure (hides real errors) |
| Keep `worktree add` serialised per repo | Measured: parallel adds silently lost 4 of 60 registrations | Per-branch locks or a bounded parallel add — both preserve the race |
| Optimistic `worktree add -b` instead of list-then-add | One spawn per create and no list of 60 worktrees, while still recovering from a previous run | Listing first (the old path: 60 needless spawns per dispatch) |
| Fold dirty/untracked detection into one `status` call | `--no-renames -z` makes parsing one field per entry and replaces three spawns | `diff --quiet` + `ls-files` (still two spawns, and `status` also gives the paths) |
| Identity fallback via a failed-commit retry | Two fewer spawns per task; the fallback path is only taken when git actually has no identity | Pre-reading config every commit (the old path); writing config (mutates the user's repo) |
| Debounce prune, always `--expire now` | 60 prunes per cleanup is pointless work; the default three-month expiry defeats crash recovery | Prune per removal (old); `--expire now` on every removal (still 60 scans) |
| Pin `core.quotePath=false` globally | Unicode paths must survive into lane checks and patches | `-z` everywhere (not possible for patches); relying on user config (unpredictable) |
| `GIT_LFS_SKIP_SMUDGE=1` for every git call | A worktree checkout must not pull gigabytes from an LFS remote (or fail with none); audits read pointers | Letting git-lfs run (network in the git layer, and it fails without a remote) |
| Refuse a dirty base, allow untracked | Tracked edits would be silently excluded from every task; untracked files cannot be lost by branching | Refusing on any `status` output (too brittle for real repos) |
| Sparse checkout opt-in behind a callback | Lanes vary per task while a workspace is per run; correctness depends on the lane actually being complete | Sparse by default (breaks repo-wide greps and cross-lane tests) |
| gc collects only `starling/` refs and anything older by *every* clock | Deleting the wrong branch destroys an agent session; "no evidence" must mean "keep" | Trusting commit dates (a branch cut from an old base looks ancient); trusting directory mtime alone (nested edits do not bump it) |
| Protect `<run>/integration` by default | It is the run's deliverable and a human may still need it | Deleting it with the rest of a dead run (silent loss of the only copy) |
| Failures collected, not thrown, in gc and the harness | One stuck worktree must not stop the rest of a cleanup, and a stress report is more useful with the failure list | Fail-fast (loses the rest of the report) |

## Measured results

Full 5 000-file / 60-worktree run (`bun tools/stress/worktrees.ts`), verbatim output in
`.orchestrator/handbacks/57-workspace-hardening.md`. Zero failures across create, commit, diff,
conflict prediction, bundles and removal; 20/20 expected conflicts found; 10/10 bundles fetched back
at the right commit; 60/60 worktrees removed and only the main checkout registered afterwards.

What the numbers say:

- **`create` is the only serialised operation** and therefore the only one whose per-call latency is
  dominated by the repo mutex. The per-call p50/p95 include queueing behind the other 59 tasks (they
  are what a caller sees — task #60 waits ~22.6 s for its worktree); the phase wall clock is the cost:
  23.5 s for 60 tasks ≈ **0.39 s per task**, i.e. one `worktree add` of a 5 000-file repo, which is
  git's checkout, not Starling's overhead.
- **Everything else is parallel**: 60 commits (7.4 s phase), 60 diffs (0.77 s) and 60 removals (18.0 s)
  run concurrently under the bounded pool. `diff` is that cheap because a clean worktree now costs
  three spawns instead of five.
- **Conflict prediction is nearly free** (80 ms for 20 pairs) and the bundle round trip is milliseconds
  (867 ms for 10 create+fetch pairs), so the Flock transport is not a bottleneck at this scale.
- **Disk**: a full worktree is ~394 KB apparent / **~19.6 MB allocated** for 5 023 files — the block
  per file is the real cost, and `.git` (26.7 MB) is shared by all of them. 60 worktrees therefore cost
  about 1.2 GB allocated, not 60 copies of the repo.
- **Sparse is a clear win**: a two-directory cone lane materialises 202 files / 808 KB allocated, a
  **96 % reduction**. It stays opt-in (see the trade-off below) but the engine should use it for lanes
  that are genuinely directory-shaped.
- The harness prints the 1/5/15-minute load average next to the timings: this run started at load 23
  while other agents were still working on the same 10-core laptop (an earlier run at load 95 took
  208 s total, same zero failures), so absolute p95s should be re-measured on a fully quiet machine
  before being quoted as a product claim.

## Interfaces for future epics

```ts
import {
  applySparseCheckout,
  boundedExec,
  branchesWithPrefix,
  createWorkspace,
  DEFAULT_OLDER_THAN_HOURS,
  defaultGitConcurrency,
  diskUsage,
  formatBytes,
  isIntegrationBranch,
  isLinkedWorktree,
  pruneWorktrees,
  recoverWorkspace,
  repoStatus,
  runIdOf,
  Semaphore,
  type CreateWorkspaceOptions,
  type RecoveryReport,
  type RecoverWorkspaceOptions,
  type RepoStatus,
  type WorkspaceWithBundles,
} from '@starling/workspace';
```

### `createWorkspace` (unchanged port, new options)

```ts
export interface CreateWorkspaceOptions {
  worktreeRoot: string;
  exec?: typeof exec;              // inject a fake for tests
  clock?: Clock;                   // bundle names, prune debounce, refusal messages
  maxConcurrency?: number;         // git process cap; 0 disables the pool
  pruneIntervalMs?: number;        // per-repo debounce for `worktree prune`; default 10_000
  sparseCheckout?: (branch: string) => string[] | undefined; // opt-in sparse lanes
}
export function createWorkspace(opts: CreateWorkspaceOptions): Workspace & BundleOps;
```

The core `Workspace` port is untouched. Behavioural changes callers should know about:

- `ensureIntegrationBranch` throws `WORKSPACE_ERROR` (`details.reason = 'dirty-base-checkout'`) when
  the base branch is checked out with tracked modifications;
- `create` returns the same paths as before, but no longer creates `worktreeRoot`'s subdirectories
  (the root itself is still created eagerly);
- `remove` prunes lazily, so `git worktree list` can briefly show a registration whose directory is
  already gone; the next create/remove (or `recoverWorkspace`) clears it;
- `commitAll` produces the same commits; the identity fallback is identical but resolved by retry.

### Crash recovery (future `starling gc`, engine startup)

```ts
export interface RecoverWorkspaceOptions {
  dryRun?: boolean;                 // report only
  olderThanHours?: number;          // default 12
  liveRunIds?: Iterable<string>;    // run ids with a live session; never collected
  branchPrefix?: string;            // default 'starling/'
  includeIntegration?: boolean;     // default false
  clock?: Clock;                    // deterministic tests
  exec?: typeof exec;               // deterministic tests
}
export function recoverWorkspace(
  repo: string,
  worktreeRoot: string,
  opts?: RecoverWorkspaceOptions,
): Promise<RecoveryReport>;

export interface RecoveryReport {
  repo: string; worktreeRoot: string; dryRun: boolean; cutoffTs: number;
  scanned: { worktrees: number; branches: number; directories: number };
  entries: RecoveryEntry[];         // what is (or would be) collected, with actions
  removed: { worktrees: string[]; branches: string[]; directories: string[]; registrations: number };
  kept: { live: string[]; young: string[]; protected: string[]; foreign: string[]; unknown: string[] };
  errors: { target: string; message: string }[];
}
```

Suggested wiring (outside this lane):

- **engine**: call `recoverWorkspace(repo, worktreeRoot, { liveRunIds: [currentRunShort] })` before
  dispatching a run (or on startup) so a crashed run's disk is reclaimed; never pass a live run id.
- **CLI**: `starling gc [--repo .] [--dry-run] [--older-than-hours 12] [--json]` formatting
  `RecoveryReport` (FIX REQUEST in the handback).
- **flock/perch**: a perch's cache dir can use the same module with its own root; nothing in it is
  hub-specific.

### Helpers worth reusing

```ts
export class Semaphore { run<T>(fn: () => Promise<T>): Promise<T>; active: number; queued: number }
export function boundedExec(execFn: typeof exec, limit: number): typeof exec
export function defaultGitConcurrency(): number
export function repoStatus(git: Git, cwd: string): Promise<RepoStatus>     // one call, dirty + untracked
export function pruneWorktrees(git: Git, cwd: string): Promise<void>       // `--expire now`
export function branchesWithPrefix(git: Git, cwd: string, prefix: string): Promise<string[]>
export function refCreatedAt(git: Git, cwd: string, ref: string): Promise<number | undefined>
export function refCommitTime(git: Git, cwd: string, ref: string): Promise<number | undefined>
export function worktreeAdminDir(dir: string): Promise<string | undefined>
export function isLinkedWorktree(dir: string, gitDir: string): Promise<boolean>
export function mtimeMs(path: string): Promise<number | undefined>
export function isInside(root: string, candidate: string): boolean
export function runIdOf(branch: string, prefix?: string): string | undefined
export function isIntegrationBranch(branch: string, prefix?: string): boolean
export function normalizeSparseDirs(directories: string[]): string[]
export function applySparseCheckout(git: Git, path: string, dirs: string[]): Promise<void>
export function diskUsage(path: string): Promise<DiskUsage>
export function formatBytes(bytes: number): string
```

The harness is not part of the package: it lives in `tools/stress` and exports `runStress` /
`formatReport` for anyone who wants to reproduce a number. Keeping it out of `@starling/workspace`
stops test-scale and stress-scale code from drifting into the library's public API.

## Deviations from plan

- **Creates are still serialised.** The brief asked to fix "lock contention", and the honest fix after
  measuring was to make the critical section cheaper, not wider: parallel `worktree add` loses
  registrations on this git (2.54). Documented above with the exact failure.
- **`create()` no longer creates the target's parent directory.** `worktreePathFor` always resolves to
  a direct child of `worktreeRoot`, which the factory creates eagerly, so the `mkdir` was dead weight;
  it was removed rather than kept "just in case".
- **Identity handling changed mechanism, not behaviour.** The old code always read
  `user.name`/`user.email`; the new code only acts when a commit actually fails for identity. Tests
  assert the `Starling Bot <starling@localhost>` fallback still appears.
- **`GIT_LFS_SKIP_SMUDGE=1` is on for every git call**, not only for worktree creation. It is the only
  way to keep a checkout from reaching the network, and no Starling operation needs LFS content.
- **`core.quotePath=false` is pinned globally** rather than only on path-printing calls, so two code
  paths cannot disagree.
- **Sparse checkout needs `read-tree` after `sparse-checkout set`.** The brief assumed
  `--no-checkout` + sparse checkout would help; the naive version leaves every file staged as deleted.
  The prototype includes the missing step and a test that proves the worktree is clean.
- **`recoverWorkspace` protects integration branches by default** (the brief said "orphaned worktrees
  and branches from dead runs"; the integration branch is the run's deliverable, so it is opt-in).
- **The stress harness runs a scaled-down version in `bun test`.** The full 60-worktree run takes
  minutes and a gigabyte, which does not belong in every test invocation; the harness itself is covered
  by the small run.

## Known limitations / deferred

- **Submodules are not initialised.** A task worktree contains the gitlink only (`160000`), no
  submodule content, and changes *inside* a submodule never appear in `diff`/`changedFiles`. A task
  that needs submodule sources must run `git submodule update --init` itself. Recursive checkout was
  rejected: it multiplies network and disk per worktree and can fail the whole run.
- **LFS content is never downloaded** by the workspace layer (pointer files only). A task that must
  read or produce real LFS objects has to run `git lfs pull`/`git lfs push` itself.
- **Dirty-worktree removal is forced.** `remove()` and gc both use `worktree remove --force`; a dead
  run's uncommitted files are lost (its commits are not, unless the branch is also collected). That is
  the point of gc, but it is data loss by design.
- **gc cannot prove "no live session" on its own.** It trusts the `liveRunIds` it is given; the engine
  (which knows the runs) must pass them. Age heuristics (reflog, commit time, directory and index
  mtimes) can keep a genuinely dead worktree that was touched recently, which is the safe direction.
  With no evidence at all it keeps the branch and reports it under `kept.unknown`.
- **Bundles are not garbage-collected.** `<worktreeRoot>/bundles/*.bundle` are transport artifacts of
  a run; a future gc could expire them, and `report.disk` does not account for them (the stress report
  does).
- **Dirty-base detection only looks at tracked modifications.** Untracked files and ignored files do
  not block a run (deliberate; documented above).
- **Cross-process races are recovered, not prevented.** Two Starling processes creating the same
  branch still end with one success and one "already exists → treat as success". The in-process mutex
  is per instance; git's own ref locks cover the rest.
- **Windows is still untested.** Paths are sanitised for it, but worktree/symlink behaviour has only
  been exercised on macOS (APFS) and, in principle, Linux.
- **Sparse worktrees are opt-in and lane-completeness is the caller's problem.** Nothing verifies that
  a sparse checkout contains everything the task needs; a lane-glob derivation that understands
  `owns`/`reads` is engine work.
- **Stress numbers are machine- and load-dependent.** The harness reports the 1/5/15-minute load
  average next to the timings so a number is not compared across a quiet laptop and a busy one.
- **No `starling gc` command yet.** `recoverWorkspace` is exported and tested; wiring it into the CLI
  (and calling it at run start) is a FIX REQUEST for the CLI/engine lanes.
