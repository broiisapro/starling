## Epic 57 Handback — Workspace hardening at swarm scale

**Status:** Complete. Branch `epic/57-workspace-hardening` @ `c75c67b` (this handback is the final
commit on top), rebased onto current `origin/main`.

**Delivered:**

- `tools/stress/worktrees.ts` + `tools/stress/harness.ts` — a reproducible swarm-scale harness that
  drives the real `Workspace` port on a generated 5 000-file repo: 60 concurrent worktrees created,
  committed in, diffed, 20 pairwise conflict predictions, 10 bundle create/fetch round trips, 60
  removals, plus disk measurement and a sparse-vs-full comparison. Per-operation p50/p95/p99/max,
  phase wall clock, load average, and a failure list; exit code 1 on any failure. `--json`, `--keep`,
  `--no-sparse`, `--files/--worktrees/--pairs/--bundles`.
- `tools/stress/harness.test.ts` — the same code path at test scale (120 files, 6 worktrees) so the
  harness is exercised by `bun run test`.
- `packages/workspace/src/pool.ts` — `Semaphore` + `boundedExec` + `defaultGitConcurrency()`
  (one process per core, clamped 4…12), wired into `Git`; `maxConcurrency: 0` disables it.
- `packages/workspace/src/git.ts` — six retries with jittered exponential backoff (25 ms → 1 s) for
  lock contention; `cannot lock worktree` / `failed to lock` added to the contention predicate; every
  call now runs with `-c core.quotePath=false` (unicode paths were octal-quoted) and
  `GIT_LFS_SKIP_SMUDGE=1` (no network from a checkout).
- `packages/workspace/src/workspace.ts` — one-spawn create with an in-memory reuse map, failure
  diagnosis (existing branch / stale registration / leftover directory), one `git status` call per
  diff/changedFiles instead of three spawns, identity fallback by commit retry instead of two config
  reads per task, debounced `worktree prune --expire now`, dirty-base refusal, opt-in sparse
  checkouts.
- `packages/workspace/src/recover.ts` — `recoverWorkspace(repo, worktreeRoot, opts)` for a future
  `starling gc`: collects dead-run worktrees, orphan `starling/*` branches, unregistered Starling
  directories and stale registrations; protects live runs and `<run>/integration`; `dryRun`;
  `olderThanHours` (default 12); failures collected in `report.errors`.
- `packages/workspace/src/sparse.ts` — `normalizeSparseDirs` + `applySparseCheckout`
  (`--no-checkout` → `sparse-checkout set --cone` → `read-tree -mu HEAD`; the last step is required,
  without it the worktree is empty and staged as deleted).
- `packages/workspace/src/disk.ts` — `diskUsage` (no symlink following) and `formatBytes`.
- `packages/workspace/src/repo.ts` — `repoStatus` (one-call dirty+untracked), `pruneWorktrees`,
  `branchesWithPrefix`, `refCreatedAt`, `refCommitTime`, `worktreeAdminDir`, `isLinkedWorktree`,
  `mtimeMs`, `isInside`.
- New tests: `pool.test.ts` (9: semaphore limits/FIFO/errors, bounded exec, pool+mutex composition),
  `edge-cases.test.ts` (12: submodules ×2, LFS pointer + LFS-sized untracked blob, unicode/space paths
  ×2, detached base ×3, dirty main ×3), `recover.test.ts` (20: dry run, collection, live/young/
  integration protection, orphan branch, unregistered directory, foreign directory, outside-root
  worktree, bundle dir, stale registration, report shape), `sparse.test.ts` (9: dir normalisation,
  cone checkout, disk win, failure cleanup, prune debouncing, disk accounting), plus updated
  `git.test.ts` and `workspace.test.ts`.
- `docs/epic-57-workspace-hardening.md` — goal, mechanics, decisions, interfaces, deviations,
  limitations.

**Key design decisions:**

- **Creates stay serialised per repo** — measured, not assumed: 60 parallel `git worktree add` calls on
  one repository printed `fatal: failed to read .git/worktrees/wt16/commondir` and registered only 56
  of 60. Instead the critical section got cheaper: an optimistic `worktree add -b` (one spawn, no
  `worktree list`) with an in-memory reuse map, so a 60-task dispatch spends 60 spawns instead of 120.
- **Bounded process pool (4…12)** rather than unbounded fan-out — above one process per core the
  bottleneck is the disk queue, so a cap keeps the tail down without starving any single call.
- **Six jittered retries** — swarm-internal lock contention needs tens of ms, not one 50 ms retry;
  jitter stops waiters waking in lockstep. Non-contention failures still fail immediately.
- **One `status --porcelain=v1 -z --no-renames -uall`** answers "modified?" and "untracked?" at once,
  replacing three spawns per diff; the working-tree patch is fetched only when something changed.
- **`core.quotePath=false` pinned globally** — found by the unicode test: without it `--numstat` and
  patch headers print `"src/na\303\257ve file.ts"`, which would corrupt lane checks.
- **`GIT_LFS_SKIP_SMUDGE=1` pinned globally** — a worktree checkout must never pull LFS objects (or
  fail when there is no LFS remote); audits read pointers. Verified on a machine with git-lfs
  installed, where the default checkout tried to download a 124 MB object and failed.
- **Dirty-base refusal only for tracked modifications** — untracked files cannot be lost by branching,
  and refusing on them would make the workspace brittle; the error carries
  `details.reason = 'dirty-base-checkout'`.
- **gc protects integration branches and needs `liveRunIds`** — the integration branch is the run's
  deliverable, and only the engine knows which runs are live. Age is the max of reflog creation,
  HEAD commit time, directory mtime and the worktree index mtime; "no evidence" keeps, never deletes.
- **Sparse checkout is opt-in via a callback** — lanes vary per task while a workspace is per run, and
  sparse is a behaviour change (repo-wide greps and cross-lane imports stop working).
- **Stress report carries both per-call latency and phase wall clock** — for a serialised phase the
  sum of per-call latencies is queueing, not cost, so printing both keeps the report honest.

**Verification (exact commands + results):**

- `bun install` (worktree): `Checked 162 installs across 221 packages (no changes) [8.00ms]` — no
  lockfile change, no dependencies added.
- `bun test packages/workspace`: **135 pass / 0 fail**, `408 expect() calls`, `Ran 135 tests across 12
  files. [11.42s]`.
- `bun run test` (root): packages half **1417 pass / 4 skip / 0 fail**, `6497 expect() calls`,
  `Ran 1421 tests across 167 files. [26.90s]`; web half **426 pass / 0 fail**, `3527 expect() calls`,
  `Ran 426 tests across 39 files. [2.31s]`; script exit 0.
- `bun run check` (root): `Checked 717 files in 217ms. No fixes applied.` and the per-workspace
  `tsc --noEmit -p` loop exits 0. `tools/stress` (not in the root loop) also passes
  `tsc --noEmit -p tools/stress/tsconfig.json` and `biome check`.
- `bun tools/stress/worktrees.ts` (full run, load average 23.1/22.4/40.1): see below.
- `bun tools/stress/worktrees.ts --files 400 --worktrees 8 --pairs 3 --bundles 3`: exit 0, zero
  failures (used to sanity-check the phase/disk report before the final run).

**Full stress run (verbatim, 5 000 files / 60 worktrees, re-run after the rebase):**

```
starling-wt/57-workspace-hardening $ bun tools/stress/worktrees.ts
repo ready: 5000 files, 20 conflict pairs (2161 ms)
creating 60 worktrees concurrently…
committing in 60 worktrees concurrently…
diffing 60 worktrees concurrently…
predicting conflicts for 20 pairs…
creating and fetching 10 bundles…
measuring disk use…
removing 60 worktrees concurrently…
measuring a sparse lane worktree…
Starling workspace stress — 5,000 files, 60 worktrees
repo:         /var/folders/…/starling-stress-IKEPH7/repo
worktreeRoot: /var/folders/…/starling-stress-IKEPH7/worktrees
load average: 23.1 / 22.4 / 40.1 (1 / 5 / 15 min — absolute timings include whatever else the machine was doing)

operation           n  fail     p50     p95     p99     max    total
-----------------  --  ----  ------  ------  ------  ------  -------
create             60     0  12.53s  22.62s  23.32s  23.53s  747.42s
remove             60     0   9.29s  17.14s  17.83s  18.01s  548.88s
commit             60     0   7.26s   7.37s   7.38s   7.39s  435.53s
diff               60     0    735ms   761ms   763ms   764ms   43.71s
predict-conflicts  20     0    67ms    79ms    80ms    80ms    1.35s
bundle-fetch       10     0    50ms    62ms    63ms    63ms    530ms
bundle-create      10     0    32ms    41ms    42ms    42ms    337ms
create-sparse       1     0    74ms    74ms    74ms    74ms     74ms
remove-sparse       1     0    63ms    63ms    63ms    63ms     63ms

total 58.82s (setup 2.16s)   failures 0   OK
phases (wall clock): create 23.53s/60, commit 7.39s/60, diff 765ms/60, predict-conflicts 80ms/20, bundles 867ms/10, disk 5.71s/60, remove 18.01s/60, sparse 156ms
checks: 60/60 commits, 60/60 diffs, 20/20 conflicting pairs found, 10/10 bundles fetched, 60/60 worktrees removed, 1 registered after cleanup

disk: 394 KB per worktree apparent size (p50 394 KB, p95 394 KB; ~5,023 files each), 19.6 MB allocated (du sample)
      23.1 MB apparent for 60 worktrees; .git 26.7 MB (shared), main checkout 27.1 MB, bundles 6.4 KB
      sparse lane (src/mod0, src/mod1): 15.3 KB / 202 files (808 KB allocated) — 96% smaller than a full checkout
```

How to read it: per-call `create`/`remove` latencies include mutex queueing (60 tasks in flight), so
their sums exceed the run; the `phases (wall clock)` line is the cost. The run before the rebase (load
average 18.3, total 55.72 s, create phase 23.26 s) and a run at load average 95 (208 s total) both
finished with zero failures — the numbers move with the machine, the correctness does not.

**Dependencies added:** none.

**CONTRACT REQUESTS:** none. `packages/core` was not touched and the `Workspace` port signature is
unchanged; `recoverWorkspace`, `diskUsage` and the pool are additive exports of `@starling/workspace`.

**FIX REQUESTS (lanes I do not own):**

1. `apps/cli/src/**` (Epic 22/CLI lane) — add the `starling gc` command the assignment reserved for a
   FIX REQUEST: `starling gc [--repo .] [--worktree-root <dir>] [--dry-run] [--older-than-hours 12]
   [--include-integration] [--json]`, implemented as
   `recoverWorkspace(repo, worktreeRoot ?? join(dirname(repo), '.starling-worktrees'), {...})` and
   printing `report.entries`/`report.removed` (exit 1 when `report.errors` is non-empty). The report
   is JSON-serialisable as-is.
2. `packages/engine/src/**` (Epic 49) — call `recoverWorkspace(repo, worktreeRoot, { liveRunIds })`
   once at run start (or on hub startup) with the run ids that currently have sessions, so a crashed
   run's worktrees and `starling/*` branches are reclaimed before the next dispatch. Suggested:
   `liveRunIds` = short run ids of every run in `pending|running|auditing|fixing|merging`.
3. `packages/engine/src/**` (Epic 49) — today nothing deletes task branches after a merge; the merger
   merges into the integration branch and `Workspace.remove` removes the worktree only. If branches are
   meant to be cleaned per run, either add that to the merge path or rely on the gc wiring above.
4. `apps/cli/src/**` + `starling.config.yaml` schema (root config is not my lane) — the two new knobs
   `worktree.maxGitConcurrency` and `worktree.pruneIntervalMs` are supported by
   `createWorkspace` but not plumbed from config; defaults (4…12, 10 s) are sane, so this is optional.

**Deliberately deferred / out of scope:**

- Merge logic, the engine, CLI wiring (per the assignment).
- Automatic submodule initialisation; LFS object download/push.
- Bundle-file garbage collection.
- Sparse-checkout derivation from `TaskSpec.lane` (needs engine input).
- Windows verification.

**Open questions / flagged tradeoffs:**

- **Machine load makes absolute timings non-comparable.** The final stress run reports load average
  23.1/22.4/40.1 because sibling agents were building on this same 10-core laptop (earlier runs saw
  load in the 90s–100s). Phase wall clock and the zero-failure result are the meaningful parts; the
  p95s should be re-measured on a quiet machine before quoting them as a product claim.
- **`GIT_LFS_SKIP_SMUDGE=1` is a deliberate product decision**: Starling never downloads LFS content.
  If a future epic needs binary assets for a task, it must opt in explicitly rather than re-enabling
  the smudge filter globally.
- **Should `recoverWorkspace` delete integration branches by default?** I chose protection (the branch
  is the deliverable); if the product wants a strict "leave nothing behind", `includeIntegration: true`
  is one flag away — but it can destroy the only copy of a crashed run's work.
- **`stat` apparent size vs allocated blocks.** The report shows both because 5 000 tiny files cost one
  block each (31 KB apparent vs 1.6 MB allocated for a 406-file sample). If a future metrics panel
  shows "disk per worktree", it should use `du`-style allocation, not `st_size`.

Closes #81
