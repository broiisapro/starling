## Epic 17 Handback — Merge queue

**Status:** Complete. Branch `epic/17-merger` @ `1b3bb46` (code + docs; this handback is committed on top).

**Delivered:**
- `createMerger({ worktreeRoot, exec?, clock?, testTimeoutMs? })` in `packages/merger/src/merger.ts`. Returns `MergerService`: the core `Merger` port plus `queue()`, `preflight()` and `dispose()`. Structurally assignable to `Merger & { queue(): MergeQueue }`.
- `merge(repo, integrationBranch, task, { testCommand?, title? })`:
  - validates the repo and both branches (`MERGE_ERROR` with the missing ref named);
  - returns `skipped` when the task branch is already an ancestor, before touching a worktree;
  - reuses `<worktreeRoot>/_integration/<branch-sanitised>`, created on first use, recovering a stale `MERGE_HEAD`/dirty tree;
  - `git -c commit.gpgsign=false merge --no-ff --no-edit -m "merge(<taskKey>): <title or branch>" <branch>`;
  - on conflicts: `git diff --name-only --diff-filter=U` → `git merge --abort` → verifies HEAD is back at the pre-merge tip → `conflict` + `conflictedFiles`; a non-conflict merge failure is `MERGE_ERROR` (merge aborted first);
  - with `testCommand`: runs `bash -c <cmd>` in the worktree (`CI=1`, `STARLING_TASK=<key>`, timeout, default 10 min) → `merged` with the commit sha, or rolls back with `git reset --hard HEAD~1` and returns `tests-failed` with the output tail in `detail`. Timeout and spawn failure count as failed (branch stays green).
  - rollback refuses unless HEAD is exactly our merge commit and its first parent is the pre-merge tip (`MERGE_ERROR` instead of deleting someone else's commit).
- `MergeQueue` (`queue.ts`): `enqueue` chains on a per-`repo + integrationBranch` tail promise (strict FIFO per branch, independent branches concurrent), `pending()` (queued + running, oldest first), `results()`, `onResult(fn)` returning an unsubscribe. A rejected merge rejects only its caller; the queue keeps going.
- `preflight(repo, integrationBranch, branch)` (`preflight.ts`): ancestry short-circuit then `git merge-tree --write-tree --name-only`, parsed into `{ clean, conflictedFiles, alreadyMerged, detail }`. No worktree, index or ref is touched.
- `dispose()` removes exactly the integration worktrees this merger created (`worktree remove --force`, `rm` + `prune` fallback).
- Pure building blocks exported and tested: `createMergeQueue`, `mergeTask`, `runPreflight`, `parseMergeTree`, `ensureIntegrationWorktree`, `listWorktrees`, `sanitizeBranchName`, `canonicalPath`, `integrationWorktreePath`, `createGit`.
- 43 tests across 5 files against real temp git repos (clean merge, `.git`-verified merge commit, conflict + aborted + unchanged branch, conflict recovery, test gate green/red, output tail, timeout rollback, rollback guard, already-merged skip, three concurrent enqueues FIFO + linear first-parent history, rejected merge not poisoning the queue, per-branch queue isolation, slow-first FIFO, preflight clean/conflict/agreement/no-side-effects/missing refs, worktree reuse, dirty + detached recovery, foreign-directory and cross-branch refusal, dispose).

**Key design decisions:**
- One reused integration worktree per branch (as specified) — the suite runs on the accumulated tree without a per-task `worktree add`; recovery makes a crashed merge harmless.
- Canonicalise `worktreeRoot` with `realpath` — macOS reports `/private/var/…` from git while `tmpdir()` says `/var/…`; raw string comparison would fail to find the worktree the merger just created.
- Detect conflicts from unmerged paths, not the merge exit code — hooks, unrelated histories and missing refs also exit non-zero, and only unmerged paths are a `conflict`.
- A different-branch worktree at the sanitised path is a loud `MERGE_ERROR` rather than `checkout -f` — two branch names can sanitise identically (`a/b` vs `a-b`), and switching under a live queue would corrupt both merges.
- Rollback is guarded by SHA + parent check, not a bare `HEAD~1` — a test command/hook can move HEAD, and deleting its commit would be worse than failing loudly.
- Regression suites are shell lines → `bash -c` at this boundary; `core.exec` stays argv-only (L13). Timeout and spawn failure roll back too: unverified is not green.
- `opts.title` is additive (assignable to the port) so history reads `merge(t03): CSV export` without a contract change.
- `commit` on `tests-failed` is the rolled-back merge sha for logs; `detail` always says "Rolled … back", and only `merged` results carry a landed commit.
- No `src/handshake.ts`: the `Merger` port is already in `@starling/core` and no sibling Wave 1 interface is consumed. `MergeQueue`/`PreflightResult` are new local surface, documented for E20/E21/E26.

**Verification (exact commands + results):**
- `bun install` (clean worktree): `Checked 133 installs across 192 packages (no changes) [18.00ms]`
- `bun test packages/merger`: `43 pass / 0 fail`, `135 expect() calls`, `Ran 43 tests across 5 files. [10.05s]` (< 30 s)
- `bun run test` (root): `$ bun test packages apps skills integrations tools evals` → `228 pass / 0 fail`, `919 expect() calls`, `Ran 228 tests across 41 files. [8.51s]`
- `bun run typecheck` (all 18 workspaces): exit 0 (no output beyond the loop command)
- `bunx biome check packages/merger`: `Checked 17 files in 35ms. No fixes applied.`
- `bun run check`: **fails on pre-existing files outside this lane only** — `biome check .` reports format errors in `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md`, `tools/local-models/{host,ollama,ollama.test,smoke}.ts`, `tools/local-models/smoke.ts:33 organizeImports` and two `tools/local-models/results/*.json`. These landed on `main` with Epics 01/02 and were failing before this branch; I did not touch them. The `tsc` half of the script passes (verified separately, above).
- Manual merge check: see `merge.test.ts` — every assertion runs real `git` in `mkdtemp` repos, including `git rev-list --parents` for the `--no-ff` shape and `git status --porcelain` after abort/rollback. No network, LLM, opencode or GitHub calls anywhere.

**Dependencies added:** none.

**CONTRACT REQUESTS:**
1. **`packages/core/src/ports.ts` — surface preflight and the queue at C1.** Proposed additive change:
   ```ts
   export interface MergePreflight { clean: boolean; conflictedFiles: string[]; alreadyMerged: boolean; detail: string }
   export interface Merger {
     merge(...): Promise<MergeResult>;
     preflight?(repo: string, integrationBranch: string, branch: string): Promise<MergePreflight>;
   }
   export interface MergeQueue { enqueue(...): Promise<MergeResult>; pending(): unknown[]; onResult(fn: (r: MergeResult) => void): () => void }
   ```
   Why: the engine currently has to import `@starling/merger` (or mirror the queue type locally) to call `preflight()`/`queue()`. Making them optional on the port keeps the mock simple (`MockMerger` already compiles) while letting E20 depend only on core. This epic ships the local version; no core file was edited.
2. **`packages/core/src/exec.ts` — process-group kill on timeout (optional).** `exec` currently kills only the direct child; a `bash -c 'bun test'` timeout can leave the test runner alive in the integration worktree while the merger resets it. A `killProcessGroup` option (spawn with `detached`/`setsid`, kill `-pid`) would let the merger stop the whole tree. Worked around today by treating timeout as failed and resetting; a stray child can still write during the reset.

**Deliberately deferred / out of scope:**
- Conflict resolution by an agent (Wave 2, Epic 45) — the merger only reports `conflictedFiles`.
- Pushing, PR creation and the final GitHub report (Epic 18) — this package never touches the network.
- Merge ordering beyond FIFO; dependency order is the engine's decision (Epic 20).
- GitHub mode / audit; merges run only on the hub repo (L20).
- Cross-process/multi-instance queue coordination; engine creates one merger per run.
- Windows shell support; tests execute via `bash -c`.

**Open questions / flagged tradeoffs:**
- Default `testTimeoutMs` is 10 minutes (not prescribed). A large suite may legitimately exceed it; the engine can override per merger. Is a run-level budget better than a fixed default?
- `TaskRun` has no `title`, so the merge message uses `opts.title` when the engine passes one and the branch name otherwise. If the contract later grows `TaskRun.title`, the merger can prefer it with no API change.
- Sanitised worktree paths can collide for hand-made branch names (`a/b` vs `a-b`); the merger fails loudly rather than corrupting. Starling-generated names are collision-free. Say the word if you'd prefer a hash suffix (would deviate from the prompt's literal `<branch-sanitised>` path).
- `tests-failed` results include the rolled-back merge SHA in `commit`; consumers must only treat `commit` as landed when `status === 'merged'`. Documented in the epic doc; happy to drop the field if the UI would rather infer it from `detail`.
- Two merger instances sharing a `worktreeRoot` + integration branch are not coordinated. Assumed one merger per run; flagging in case the server ever runs two runs against the same repo/config concurrently.
