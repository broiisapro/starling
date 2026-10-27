## Epic 14 Handback — Workspace: worktrees, conflict prediction, bundles

**Status:** Complete. Branch `epic/14-workspace` @ `4ca385e` (this handback commit on top).

**Delivered:**

- `packages/workspace/src/workspace.ts` — `createWorkspace({ worktreeRoot, exec?, clock? })` returning
  `Workspace & BundleOps`. Every port method is implemented on the real git CLI (`exec` argv only):
  `ensureIntegrationBranch` (idempotent, never moves an existing branch), `create` (worktree add,
  reuse, recover), `diff` (`base...HEAD` + working tree + untracked, 200 KB cap), `changedFiles`
  (committed + staged + unstaged + untracked, deduped), `predictConflicts`
  (`merge-tree --write-tree --name-only --no-messages`, git ≥ 2.38), `commitAll` (stages all, identity
  fallback, returns sha or `undefined`), `remove` (`worktree remove --force` + prune, idempotent).
- `packages/workspace/src/bundle.ts` — `BundleOps`: `createBundle` (full or thin `base..ref`),
  `cloneFromBundle` (checks the branch out; bundle clones have no HEAD), `fetchBundle` (forced update,
  with a temp-ref + `update-ref` fallback when the branch is checked out in a hub worktree).
- `packages/workspace/src/mutex.ts` — `KeyedMutex`, keyed by the repo's common git dir; worktree
  creation/removal, branch creation, bundle create/fetch serialise, per-worktree work does not.
- `packages/workspace/src/git.ts` — `Git` runner: `GIT_TERMINAL_PROMPT=0`, one retry after a 50 ms
  backoff on `index.lock`-style contention, `WORKSPACE_ERROR` with argv + stderr on failure.
- `packages/workspace/src/version.ts` — version parsing and the `GIT_TOO_OLD` guard.
- `packages/workspace/src/diff.ts` — pure `--numstat` parsing, untracked line counting, new-file patch
  synthesis, 200 KB UTF-8-safe truncation.
- `packages/workspace/src/{paths,repo}.ts` — branch→path sanitising, repo discovery, worktree listing.
- `packages/workspace/src/*.test.ts` — 81 tests (79 new + the 2 skeleton ones), real temp git repos,
  no network, no LLM/opencode/GitHub/ollama.
- `docs/epic-14-workspace.md` — design, decisions, interfaces for Epics 17/20/30/31, limitations.

**Key design decisions:**

- **Mutex key = common git dir, not repo path** — every linked worktree of one repo must serialise on
  the same key; keying by caller path would let the hub and a task worktree race. `resolveRepo` asks
  git for `--git-common-dir` and `realpath`s it.
- **Per-worktree operations take no lock** — `diff`/`changedFiles`/`commitAll` stay parallel across 20
  agents; only shared `.git` state is serialised.
- **Retry only known contention messages** — blind retries would hide real failures; the predicate is
  a fixed list (`index.lock`, `cannot lock ref`, `another git process`, …), one retry only.
- **Canonical worktree paths** — on macOS `/var` is a symlink to `/private/var`; the factory creates
  and realpaths `worktreeRoot` so our returned path equals `git worktree list`'s. Found by a test.
- **Untracked patches synthesised in-process** — `git diff --no-index` is one process per file; a
  worker dropping 200 new sources would cost 200 spawns per audit. Output mirrors git's new-file hunk.
- **Identity fallback via `-c`, not `git config`** — never mutates the user's repo/global config; `-c
  commit.gpgsign=false` prevents a headless run from hanging on pinentry. Hooks stay enabled; a failing
  hook is a real `WORKSPACE_ERROR`.
- **`merge-tree` output parsed positionally with a guard** — exit 1 *and* a hex OID on line 1 is the
  only shape treated as "conflicts", so a typo'd ref cannot masquerade as a conflict.
- **Checked-out-branch fetch fallback via a temp ref + `update-ref`** — Flock re-collects a task while
  an audit worktree exists; plain `git fetch` refuses, and failing there would strand the task.
- **`GIT_TOO_OLD` widened locally** — core's frozen `StarlingErrorCode` has no such member; the error
  carries the literal code so callers can assert it today (CONTRACT REQUEST below).
- **Diff stats are summed across committed + working phases** — three-dot base for committed work, so
  an integration branch that moved since dispatch is not blamed on the worker.

**Verification (exact commands + results):**

- `bun install` (worktree) → `Checked 133 installs across 192 packages (no changes) [12.00ms]`
- `bun test packages/workspace` → `81 pass / 0 fail, 228 expect() calls, Ran 81 tests across 8 files
  [4.03s]`; re-run twice to check the concurrency tests: `0 fail … [7.00s]`, `0 fail … [8.29s]`
  (all well under the 30 s budget; includes the 20-way concurrent `create` test and the bundle round
  trip).
- `bun run test` (root) → `266 pass / 0 fail, 1012 expect() calls, Ran 266 tests across 44 files
  [4.40s]`
- `bun run typecheck` (all 18 workspaces) → exit 0, no output.
- `biome check docs/epic-14-workspace.md packages/workspace` → `Checked 21 files … No fixes applied.`
- `bun run check` (root) → **fails, and not because of this lane**: 9 formatting errors in
  `docs/epic-01-demo-target.md`, `docs/epic-02-repo-ops.md` and `tools/local-models/{host,ollama,ollama.test,smoke}.ts`
  plus the two `results/*.json` files. Proven pre-existing: `git archive origin/main | tar -x` into an
  empty dir and `biome check .` there reports the same `Found 9 errors.` My lane's doc and package are
  clean; the failures are in files this branch does not touch (`git status` touches only
  `packages/workspace/**`, `docs/epic-14-workspace.md`, and this handback).
- Manual checks: `git --version` → `git version 2.54.0`; confirmed `git merge-tree --write-tree
  --name-only --no-messages` prints the tree OID then conflicted paths (exit 1) and nothing on stdout
  for an unknown ref; confirmed `git fetch <bundle> ref:refs/heads/<checked-out>` fails with "refusing
  to fetch into branch", so the temp-ref fallback test is genuinely exercising the fallback.
- No temp dirs leak: after the suites, `ls /var/folders/…/T/starling-ws-*` → no matches.

**Dependencies added:** none.

**CONTRACT REQUESTS:**

1. **Add `'GIT_TOO_OLD'` to `StarlingErrorCode`** in `packages/core/src/errors.ts`. `predictConflicts`
   must reject git < 2.38, and the assignment specifies this exact code; the frozen union has no such
   member, so this lane throws it through a locally widened constant
   (`GIT_TOO_OLD_CODE = 'GIT_TOO_OLD' as StarlingErrorCode`). Adding the member is additive and lets
   both sides drop the cast.
2. **(Optional, for Epic 30)** Promote `BundleOps` into `@starling/core` next to `Workspace` (or into
   ARCHITECTURE §8) once `packages/flock` and `apps/server` need it: `createBundle`,
   `cloneFromBundle`, `fetchBundle`. Today it is a local interface exported from
   `@starling/workspace`; the shape is documented in `docs/epic-14-workspace.md`.

**Deliberately deferred / out of scope:**

- Merge-queue sequencing, integration-branch policy and anything that decides *when* to merge (Epic 17).
- Pushing to remotes, opening PRs, GitHub (Epics 21/22 and the tracker epic).
- Runner/opencode integration (`packages/runner`, Epic 15/16).
- Submodule initialisation/updating; worktrees are plain `git worktree add` without
  `--recurse-submodules`.
- Cancel/abort semantics for a running git command (timeouts are configurable, not exposed here).

**Open questions / flagged tradeoffs:**

- **Diff stat double-counting.** A file committed and then edited again contributes both deltas to
  `DiffSummary.files`; the patch is authoritative. A single merged `git diff base` would misattribute
  base-side changes once the integration branch moves, so the additive model was chosen. If the
  auditor's prompts need exact per-file totals, Epic 16 can compute them from the patch instead.
- **`bun run check` is red on `main`** (9 Biome errors in Epic 01/02 docs and `tools/local-models`).
  Not fixed here: those files are outside this lane. The integrator should run `bun run format` (or
  accept the failures) before the next checkpoint, otherwise every Wave 1 agent's DoD #4 will fail for
  the same reason.
- **Cross-process races are recovered, not prevented.** Two Starling processes creating the same
  branch end with one "already exists" handled as success. If the integrator wants multi-process
  safety beyond git's own lock files, a file lock next to the common git dir would be the next step.
- **Removing a worktree whose directory is already gone cannot prune** (the port passes no repo
  handle). A later `create()` prunes it; a periodic `git worktree prune` in the engine would be belt
  and braces.
