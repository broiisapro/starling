# Epic 14 — Workspace: worktrees, conflict prediction, bundles

## Goal

Implement the `Workspace` port (ARCHITECTURE §6) on the real `git` CLI, correct enough for ~20
agents writing in parallel worktrees at once, and add the git-bundle helpers Flock mode needs to ship
a repository between laptops without a shared filesystem, SSH or a GitHub round trip.

Nothing here decides _when_ to merge or _what_ to merge — that is Epic 17. This package only touches
git: worktrees in, diffs and changed files out, merge-tree conflict prediction, a commit helper, and
bundles both ways.

## How it works

### Modules (all under `packages/workspace/src`)

| module         | responsibility                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `mutex.ts`     | `KeyedMutex`: async mutex per key; `sleep` for the retry backoff.                                          |
| `git.ts`       | `Git`: the only place that calls `exec(['git', …])`. Env hardening, lock-contention retry, typed failures. |
| `version.ts`   | `parseGitVersion` / `assertGitVersion` / `MIN_MERGE_TREE_VERSION` (2.38) and the `GIT_TOO_OLD` code.       |
| `paths.ts`     | Branch → path component sanitising, worktree and bundle paths, `shortRef`.                                 |
| `diff.ts`      | Pure diff plumbing: `--numstat` parsing, untracked line counting, new-file patch synthesis, 200 KB cap.    |
| `repo.ts`      | Repo discovery (`resolveRepo`), worktree listing, ref existence, untracked file listing.                   |
| `bundle.ts`    | `createBundleOps`: `createBundle`, `cloneFromBundle`, `fetchBundle`.                                       |
| `workspace.ts` | `createWorkspace`: the port implementation plus the bundle helpers.                                        |
| `index.ts`     | Public surface: `createWorkspace`, `BundleOps`, and the reusable internals (documented below).             |

### Worktree lifecycle

`create(repo, branch, fromRef)` runs under a mutex keyed by the repo's **common git dir** (so every
linked worktree of one repo shares one lock) and is idempotent:

1. If a registered worktree already has `refs/heads/<branch>` checked out and its directory exists,
   return it. A registration whose directory vanished is pruned first, then re-created.
2. Otherwise `git worktree add -b <branch> <worktreeRoot>/<sanitised branch> <fromRef>`, or
   `git worktree add <path> <branch>` when the branch already exists.
3. If `worktree add` fails, re-check the worktree list once — another Starling process may have won
   the race — and only then surface a `WORKSPACE_ERROR`.

`worktreeRoot` is created and canonicalised (symlinks resolved) when the workspace is built, so the
path we return is the same path git reports from `worktree list`.

`remove(path)` takes the same lock, runs `git worktree remove --force <path>` then `git worktree
prune`, and returns silently when the directory is already gone. If the registration was pruned but
the directory survived, it removes the directory only after proving `<path>/.git` is a `gitdir:`
pointer into this repo's `worktrees/` directory.

### Concurrency model

- **Serialised:** `create`, `ensureIntegrationBranch`, `remove`, `fetchBundle`, `createBundle` — every
  operation that writes shared `.git` state (worktree metadata, refs, object imports).
- **Parallel:** `diff`, `changedFiles`, `commitAll` — all of it happens inside one worktree and touches
  no shared mutable state (the object database is append-only and safe concurrently).
- **Retry:** each `git` invocation gets one retry after a 50 ms backoff when stderr looks like lock
  contention (`index.lock`, `cannot lock ref`, `another git process`, …). This covers a human or an
  editor plugin holding a lock; it is not a substitute for the mutex.

The mutex is in-process. Two independent Starling processes can still race, which is why every
"create" path re-checks state after a failure instead of trusting the first `rev-parse`.

### Diff

`diff(worktreePath, baseRef)` collects three things and merges them:

- `git diff --numstat baseRef...HEAD` and `git diff --no-color --no-ext-diff baseRef...HEAD` — work the
  agent committed (three-dot, so an integration branch that moved since the worktree was cut does not
  show up as the agent's change);
- `git diff --numstat HEAD` and `git diff HEAD` — staged _and_ unstaged work;
- untracked, non-ignored files, counted and patched in-process: one `@@ -0,0 +1,N @@` hunk per file
  (`new file mode`, `Binary files … differ` for binaries, `\ No newline at end of file` when needed).

File statistics are summed per path across the three sources. The patch is capped at **200 KB UTF-8
bytes**; when it is cut, a marker is written _inside_ the budget and `truncated: true` is returned, so
`Buffer.byteLength(patch) <= 200 * 1024` is always true. The cut never splits a multi-byte character.

`changedFiles` returns the union of `base...HEAD`, working-tree-vs-`HEAD` (staged and unstaged), and
untracked non-ignored files, deduped in that order.

### Conflict prediction

`predictConflicts(repo, ours, theirs)` checks the git version once (per workspace instance), then runs:

```
git merge-tree --write-tree --name-only --no-messages <ours> <theirs>
```

Exit `0` means no conflicts. Exit `1` with a tree OID on the first stdout line means the remaining
lines are conflicted paths. Anything else (unknown ref, unrelated histories) is a `WORKSPACE_ERROR`
carrying stderr. Git older than 2.38 cannot answer this mode and gets `StarlingError('GIT_TOO_OLD')`.

### Commit helper

`commitAll(worktreePath, message)` stages everything (`git add -A`), returns `undefined` when nothing
is staged, and otherwise commits with `-c commit.gpgsign=false`. If `user.name` / `user.email` do not
resolve to non-empty values, both are supplied inline with `-c user.name='Starling Bot' -c
user.email='starling@localhost'` — the repository's global and system config are never read into,
never written. Hooks are left enabled: a failing hook is a real failure and surfaces as
`WORKSPACE_ERROR` with the hook output.

### Bundles (Flock transport)

```
hub → perch:  createBundle(repo, ref)            → path to a full bundle
              cloneFromBundle(bundle, dir, ref)  → { path, branch }  (perch)
perch → hub:  createBundle(repo, ref, { base })  → thin `base..ref` bundle
              fetchBundle(repo, bundle, ref, intoBranch)             (hub)
```

Generated bundles land in `<worktreeRoot>/bundles/<sanitised ref>-<clock>-<seq>.bundle` unless
`outPath` says otherwise. A bundle has no HEAD symref, so a clone often has only `origin/<branch>`;
`cloneFromBundle` checks the branch out explicitly (`-B <branch> origin/<branch>`).

`fetchBundle` uses `git fetch --force <bundle> <ref>:refs/heads/<intoBranch>`. If git refuses because
the target branch is checked out in a hub worktree, it fetches to a throwaway
`refs/starling/tmp/…` and moves the branch with `git update-ref` (verified by a test).

## Key decisions & reasoning

- **The mutex key is the common git dir, not the repo path.** Every worktree of one repository must
  serialise against the same key; keying by the caller's path would let the hub and a task worktree
  race. `resolveRepo` therefore asks git for `--git-common-dir` and normalises it with `realpath`.
- **No lock for per-worktree work.** `commitAll`/`diff` inside a worktree are inherently independent;
  locking them would serialise 20 agents for no correctness gain. This is the whole point of
  worktrees.
- **Retry only on recognised contention.** Blind retries hide real failures. The retry predicate is a
  fixed list of lock-related messages; anything else fails immediately with stderr attached.
- **Canonical worktree paths.** On macOS `/var` is a symlink to `/private/var`, so a worktree created
  through one spelling and listed by git through the other compared unequal. `createWorkspace`
  resolves `worktreeRoot` once (creating it), and the returned paths match `git worktree list`.
- **`git add -A` + `--cached --quiet` instead of status parsing.** It is one staging call and one
  cheap predicate; parsing `git status --porcelain` would re-implement porcelain.
- **Identity via `-c`, never `git config`.** Writing config, even locally, would mutate a repository
  the user owns and could leak between concurrent runs. `-c` is scoped to the single commit process.
- **`-c commit.gpgsign=false`.** A harness that inherits a user's `commit.gpgsign=true` would block on
  a pinentry prompt with no terminal. Signing agent commits is not a product requirement.
- **Hooks stay on.** `--no-verify` would silently disable the target repo's own quality gate; the
  auditor exists precisely to respect it. A failing pre-commit hook is reported, not bypassed.
- **Untracked patches are synthesised in-process.** `git diff --no-index` handles one file per process;
  an agent that drops 200 new files would cost 200 spawns per audit. The generated format is what git
  emits for a plain new text file, and it is unit-tested.
- **Stats are summed across committed and working-tree phases.** The union answers "how much did this
  task change, in total, against the integration branch" without a second diff pass. The patch remains
  the source of truth for content.
- **`merge-tree --write-tree` output is parsed positionally.** The first line is always the tree OID;
  treating an OID-less exit 1 as "conflict" would report conflicts for a typo'd ref. Guards: exit code
  is exactly 1 _and_ line 1 matches a hex object id.
- **Checked-out-branch fetch fallback via a temp ref.** Flock re-collects a task while an audit
  worktree exists; `git fetch` refuses to update a checked-out branch, and failing there would strand
  the task. Plumbing (`update-ref`) is the standard escape hatch.
- **`cloneFromBundle` refuses `HEAD`.** `shortRef('HEAD') === 'HEAD'`, and a local branch called `HEAD`
  is nonsense; failing early with `INVALID_ARGUMENT` beats a confusing git error.
- **Bundle filenames carry clock + sequence.** Two tasks bundling in the same millisecond must not
  overwrite each other's file while the server streams it.

## Interfaces for future epics

```ts
import { createWorkspace } from '@starling/workspace';
import type { BundleOps, CreateWorkspaceOptions, WorkspaceWithBundles } from '@starling/workspace';
```

### The port (Epic 17 merger, Epic 20 engine)

`createWorkspace` returns `Workspace & BundleOps`; the `Workspace` half is exactly the frozen port:

```ts
export interface CreateWorkspaceOptions {
  worktreeRoot: string;   // parent dir for worktrees; created + canonicalised eagerly
  exec?: typeof exec;     // inject core's exec (or a fake) for tests
  clock?: Clock;          // used only for bundle filenames
}

export function createWorkspace(opts: CreateWorkspaceOptions): Workspace & BundleOps;

export type WorkspaceWithBundles = Workspace & BundleOps;

// Workspace (core, unchanged)
ensureIntegrationBranch(repo: string, base: string, name: string): Promise<void>
create(repo: string, branch: string, fromRef: string): Promise<{ path: string; branch: string }>
diff(worktreePath: string, baseRef: string): Promise<DiffSummary>
changedFiles(worktreePath: string, baseRef: string): Promise<string[]>
predictConflicts(repo: string, ours: string, theirs: string): Promise<string[]>
commitAll(worktreePath: string, message: string): Promise<string | undefined>
remove(worktreePath: string): Promise<void>
```

### Bundles (Epic 30 flock, Epic 31 perch)

```ts
export interface BundleOps {
  createBundle(repo: string, ref: string, opts?: { base?: string; outPath?: string }): Promise<string>;
  cloneFromBundle(bundlePath: string, dir: string, ref: string): Promise<{ path: string; branch: string }>;
  fetchBundle(repo: string, bundlePath: string, ref: string, intoBranch: string): Promise<void>;
}
```

`createBundle` returns an absolute path; serving it is `apps/server`'s job (`GET
/api/flock/bundle`). `cloneFromBundle` returns a normal clone with `branch` checked out — the perch's
`LocalNode` makes its task worktree from there. `fetchBundle` leaves `refs/heads/<intoBranch>` in the
hub repo, which is exactly what `Auditor` and `Merger` expect to read.

### Usage snippet (engine, end to end for one task)

```ts
import { createWorkspace } from '@starling/workspace';

const ws = createWorkspace({ worktreeRoot: `${repoPath}/../.starling-worktrees` });
const integration = `starling/${runShort}/integration`;
const taskBranch = `starling/${runShort}/t03-csv-export`;

await ws.ensureIntegrationBranch(repoPath, 'main', integration);

// Before dispatch: do we already know this will conflict with a merged sibling?
const conflicts = await ws.predictConflicts(repoPath, integration, taskBranch);

const { path } = await ws.create(repoPath, taskBranch, integration);
// … agent runs in `path` …
const sha = await ws.commitAll(path, 'feat(t03): csv export');
const summary = await ws.diff(path, integration); // AuditInput.diff
const files = await ws.changedFiles(path, integration); // AuditInput.changedFiles
await ws.remove(path); // after the merge queue is done
```

### Other exported helpers (reusable, not part of the port)

```ts
export class KeyedMutex { run<T>(key: string, fn: () => Promise<T>): Promise<T>; keys(): string[]; pending(key: string): number }
export class Git { attempt(args, opts): Promise<ExecResult>; run(args, opts): Promise<ExecResult>; ok(args, opts): Promise<ExecResult>; stdout(...); text(...); lock<T>(key, fn): Promise<T>; version(cwd?): Promise<GitVersion>; requireVersion(min?, cwd?): Promise<void> }
export function createBundleOps(opts: { git: Git; worktreeRoot: string; clock?: Clock }): BundleOps
export function resolveRepo(git: Git, repo: string): Promise<{ root: string; gitDir: string; lockKey: string }>
export function listWorktrees(git: Git, cwd: string): Promise<{ path: string; branch?: string; head?: string }[]>
export function refExists(git: Git, cwd: string, ref: string): Promise<boolean>
export function untrackedFiles(git: Git, cwd: string): Promise<string[]>
export function sanitizeBranch(branch: string): string
export function worktreePathFor(worktreeRoot: string, branch: string): string
export function parseNumstat(stdout: string): { path: string; added: number; removed: number }[]
export function newFilePatch(relPath: string, bytes: Uint8Array, mode?: string): string
export function truncatePatch(patch: string, limitBytes?: number): { patch: string; truncated: boolean }
export const PATCH_LIMIT_BYTES = 200 * 1024;
export function parseGitVersion(output: string): GitVersion | undefined
export function assertGitVersion(found: GitVersion, min?: GitVersion): void
export const MIN_MERGE_TREE_VERSION: GitVersion; // { major: 2, minor: 38, patch: 0 }
export const GIT_TOO_OLD_CODE: StarlingErrorCode; // 'GIT_TOO_OLD' until core adds it to the union
```

## Deviations from plan

- **Extra exports.** `Git`, `KeyedMutex`, `createBundleOps`, the diff/path/repo helpers and
  `assertGitVersion` are exported beyond the two required entry points. They are the seams the tests
  drive (fake `exec`, fake clock), and Epic 17/30 would otherwise re-implement `parseNumstat` or a
  repo-keyed mutex. Additive only; the required surface is unchanged.
- **`createWorkspace` creates `worktreeRoot` synchronously.** The assignment said "created on demand";
  canonicalising the root needs it to exist, so the factory does one `mkdirSync`. Documented in the
  function and covered by every test.
- **`GIT_TOO_OLD` is not in `StarlingErrorCode` yet.** Core's union (frozen in Epic 00) has no such
  code. The error is thrown with the literal code via a locally widened constant so callers can test
  `err.code === 'GIT_TOO_OLD'` now. CONTRACT REQUEST filed in the handback.
- **`commitAll` also disables commit signing** (`-c commit.gpgsign=false`) in addition to the identity
  fallback. Without it a user-signed repo would hang a headless run.
- **Untracked patches are generated in TypeScript** rather than by `git diff --no-index`. Same shape,
  no per-file process.
- **`cloneFromBundle` accepts a repo or a worktree** and always checks the branch out itself, because
  bundle clones commonly end up with only `origin/<branch>`.

## Known limitations / deferred

- **File statistics can double-count.** A file committed _and_ then edited again contributes both
  deltas to `DiffSummary.files`. The patch is authoritative; the numbers are an overview for the
  auditor prompt. A single merged diff was rejected because it would misattribute base-side changes
  once the integration branch moves.
- **Synthesised untracked patches drop git's path quoting.** Paths containing `"` or a newline would
  not be quoted the way git quotes them; spaces and tabs are fine. Binary/oversized untracked files
  appear as `Binary files … differ` or are omitted (stats 0/0) but never inflate the patch.
- **Untracked files over 4 MB are not read** (`UNTRACKED_MAX_BYTES`): stats stay 0/0 and no hunk is
  emitted. Deliberate memory guard on a laptop running 20 agents.
- **`remove()` cannot prune when the directory is already gone.** The port gives no repo handle, so
  the call returns silently and leaves any registration to a later `create()` (which prunes) or a
  manual `git worktree prune`.
- **Submodules** are not handled specially: `git add -A` follows normal git semantics, and a worktree
  is not initialised with `--recurse-submodules`.
- **Cross-process races on ref creation** are recovered, not prevented: two Starling processes both
  creating the same branch end with one success and one "already exists → treat as success".
- **Hooks run on commit.** A repo with a slow or interactive hook will slow or fail `commitAll`; that
  is intentional (respect the target repo's gate) but worth knowing for pre-commit frameworks.
- **`predictConflicts` writes a tree object** into the repo, exactly like a real merge. Harmless
  (unreferenced objects are gc'd) but not a read-only operation.
- **No remote push, no GitHub, no merge-queue logic.** Out of scope by assignment; Epic 17 owns the
  queue and the integration branch is only ever local here.
- **POSIX behaviour only in practice.** Windows paths were not exercised; the sanitiser avoids
  characters Windows rejects, so the design should carry over, but it is untested.
