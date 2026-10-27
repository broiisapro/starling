/**
 * The real `Workspace` port, on the git CLI (ARCHITECTURE L13).
 *
 * Up to 50+ opencode agents run at once, each in its own worktree. Three rules keep that safe:
 *
 * 1. Anything that writes shared `.git` state (worktree add/remove/prune, branch create, fetch,
 *    bundle import) runs under a mutex keyed by the repo's common git dir. Everything that happens
 *    *inside* one worktree — staging, committing, diffing — takes no lock and stays parallel.
 * 2. Every git process goes through a bounded pool, and lock contention is retried with exponential
 *    backoff rather than once (`git.ts`, `pool.ts`).
 * 3. `git worktree add` is *not* safe to run concurrently against the same repository: 60 parallel
 *    adds produced `fatal: failed to read .git/worktrees/wtN/commondir` and four silently missing
 *    worktrees (see `docs/epic-57-workspace-hardening.md`). Creation therefore stays serialised
 *    per repo, but does the minimum work inside the lock: one `worktree add` in the happy path,
 *    with an in-memory reuse map for the retry case that used to cost a `worktree list` each time.
 *
 * Audit and merge always read a branch the hub owns, so this package never pushes and never talks to
 * a remote (see ARCHITECTURE §1: bundles are the transport).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { readdir, readFile, rm, rmdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Clock, DiffSummary, Workspace } from '@starling/core';
import { exec as coreExec, StarlingError, systemClock } from '@starling/core';
import { type BundleOps, createBundleOps } from './bundle';
import {
  buildDiffSummary,
  countNewFileLines,
  type FileStat,
  mergeStats,
  newFilePatch,
  parseNumstat,
  UNTRACKED_MAX_BYTES,
} from './diff';
import { type ExecLike, Git, gitFailure } from './git';
import { KeyedMutex } from './mutex';
import { sanitizeBranchInput, shortRef, worktreePathFor } from './paths';
import {
  isLinkedWorktree,
  listWorktrees,
  normalizeKey,
  pruneWorktrees,
  type RepoContext,
  repoStatus,
  refExists,
  resolveRepo,
  splitNul,
} from './repo';
import { applySparseCheckout, normalizeSparseDirs } from './sparse';
import { MIN_MERGE_TREE_VERSION } from './version';

export interface CreateWorkspaceOptions {
  /** Parent directory for every worktree (`<root>/<sanitised branch>`); created on demand. */
  worktreeRoot: string;
  /** Injectable `exec` for tests and for faking git. Defaults to core's real `exec`. */
  exec?: ExecLike;
  /** Injectable clock, used for bundle filenames, prune debouncing and refusal messages. */
  clock?: Clock;
  /**
   * In-flight `git` process cap for this workspace (default: one per core, clamped to 4…12).
   * `0` disables the pool.
   */
  maxConcurrency?: number;
  /**
   * Minimum gap between `git worktree prune` runs for one repository. Removals used to prune on every
   * call; at 60 removals that is 60 full scans of the admin directory. Default 10 000 ms.
   */
  pruneIntervalMs?: number;
  /**
   * Opt-in sparse worktrees: return the directories a branch needs, or undefined for a full
   * checkout. See `sparse.ts` and `docs/epic-57-workspace-hardening.md` for the trade-off.
   */
  sparseCheckout?: (branch: string) => string[] | undefined;
}

/** `Workspace` plus the bundle helpers Flock mode needs (not part of the core port). */
export type WorkspaceWithBundles = Workspace & BundleOps;

/** Local identity used when the repo has none. Passed with `-c`, so global config is never touched. */
const FALLBACK_IDENTITY = { name: 'Starling Bot', email: 'starling@localhost' } as const;

/** Failures git prints when it cannot work out who the author is (with no config at all). */
const IDENTITY_FAILURE =
  /author identity unknown|please tell me who you are|unable to auto-detect email|empty ident name/i;

/** Dedupe while preserving input order. */
function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function errnoCode(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: unknown }).code
    : undefined;
}

export function createWorkspace(opts: CreateWorkspaceOptions): WorkspaceWithBundles {
  if (opts.worktreeRoot.trim() === '') {
    throw new StarlingError('INVALID_ARGUMENT', 'createWorkspace needs a worktreeRoot');
  }
  // Create and canonicalise the root once: git reports worktree paths with symlinks resolved
  // (`/private/var/...` on macOS), so returning our own un-resolved spelling would make the same
  // worktree compare unequal depending on who asked.
  const requestedRoot = resolve(opts.worktreeRoot);
  mkdirSync(requestedRoot, { recursive: true });
  const worktreeRoot = normalizeKey(requestedRoot);

  const execFn = opts.exec ?? coreExec;
  const clock = opts.clock ?? systemClock;
  const pruneIntervalMs = Math.max(0, opts.pruneIntervalMs ?? 10_000);
  const mutex = new KeyedMutex();
  const git = new Git(execFn, mutex, { maxConcurrency: opts.maxConcurrency });

  /** Branches this workspace instance has already created: branch → worktree path. */
  const known = new Map<string, string>();
  /** Last `worktree prune` per repo, keyed by the common git dir. */
  const lastPrune = new Map<string, number>();

  /** Prune at most once per `pruneIntervalMs` per repository. Best effort by design. */
  async function maybePrune(ctx: RepoContext): Promise<void> {
    const now = clock.now();
    const last = lastPrune.get(ctx.lockKey);
    if (last !== undefined && now - last < pruneIntervalMs) return;
    lastPrune.set(ctx.lockKey, now);
    try {
      await pruneWorktrees(git, ctx.root);
    } catch {
      // A failed prune leaves at most a stale administrative entry; the next create or remove fixes
      // it. Never fail a successful removal because the cleanup of a *different* worktree failed.
    }
  }

  /** Return the path of an already-registered worktree for `branch`, if its directory still exists. */
  async function findWorktree(ctx: RepoContext, branch: string): Promise<string | undefined> {
    const wanted = `refs/heads/${branch}`;
    const entries = await listWorktrees(git, ctx.root);
    const match = entries.find((entry) => entry.branch === wanted);
    if (match === undefined) return undefined;
    if (existsSync(match.path)) return match.path;
    // Registered but the directory is gone: drop the stale entry and let the caller re-create it.
    await pruneWorktrees(git, ctx.root);
    return undefined;
  }

  /**
   * Refuse to cut an integration branch from a base that is checked out with uncommitted changes.
   *
   * A dirty `main` means the user is mid-edit. Branching from `main` would silently exclude that
   * work from every task, and the first merge back into `main` would then fail (or, worse, overwrite
   * it). Untracked files are deliberately *not* fatal: they cannot be lost by branching, and a repo
   * that happens to keep a stray `.DS_Store` or log file around must not block every run.
   *
   * Only branches can be checked out, so a commit sha / remote ref base is exempt.
   */
  async function assertBaseCheckoutClean(ctx: RepoContext, base: string): Promise<void> {
    const branchRef = `refs/heads/${shortRef(base)}`;
    if (!(await refExists(git, ctx.root, branchRef))) return;
    const entries = await listWorktrees(git, ctx.root);
    const checkout = entries.find((entry) => entry.branch === branchRef);
    if (checkout === undefined || !existsSync(checkout.path)) return;

    const status = await repoStatus(git, checkout.path);
    if (!status.modified) return;

    throw new StarlingError(
      'WORKSPACE_ERROR',
      `refusing to start the integration branch: "${shortRef(base)}" is checked out at ` +
        `${checkout.path} with uncommitted changes. Commit or stash them first.`,
      {
        details: {
          base: shortRef(base),
          checkout: checkout.path,
          reason: 'dirty-base-checkout',
        },
      },
    );
  }

  async function ensureIntegrationBranch(repo: string, base: string, name: string): Promise<void> {
    const branch = sanitizeBranchInput(name);
    const ctx = await resolveRepo(git, repo);
    if (await refExists(git, ctx.root, `refs/heads/${branch}`)) return;
    if (!(await refExists(git, ctx.root, base))) {
      throw new StarlingError('WORKSPACE_ERROR', `base ref "${base}" not found in ${ctx.root}`, {
        details: { repo: ctx.root, base },
      });
    }

    await assertBaseCheckoutClean(ctx, base);

    const args = ['branch', branch, base];
    const result = await git.run(args, { cwd: ctx.root, lock: ctx.lockKey });
    // A concurrent Starling instance may have won the race; that is still success.
    if (result.code === 0) return;
    if (await refExists(git, ctx.root, `refs/heads/${branch}`)) return;
    throw gitFailure(args, result);
  }

  /** `worktree add` argv for this branch: create it, or check out an existing branch. */
  function addArgs(
    name: string,
    target: string,
    fromRef: string,
    sparse: boolean,
  ): { create: string[]; existing: string[] } {
    const common = ['worktree', 'add'];
    if (sparse) common.push('--no-checkout');
    return {
      create: [...common, '-b', name, target, fromRef],
      existing: [...common, target, name],
    };
  }

  async function create(
    repo: string,
    branch: string,
    fromRef: string,
  ): Promise<{ path: string; branch: string }> {
    const name = sanitizeBranchInput(branch);
    // Fast path: this workspace already created (and has not removed) the worktree for this branch.
    const cached = known.get(name);
    if (cached !== undefined) {
      if (existsSync(cached)) return { path: cached, branch: name };
      known.delete(name);
    }

    const ctx = await resolveRepo(git, repo);
    const target = worktreePathFor(worktreeRoot, name);
    const sparseDirs = normalizeSparseDirs(opts.sparseCheckout?.(name) ?? []);
    const args = addArgs(name, target, fromRef, sparseDirs.length > 0);

    const created = await git.lock(ctx.lockKey, async () => {
      if (existsSync(target)) {
        const entries = await readdir(target);
        if (entries.length === 0) await rmdir(target);
      }

      const place = async (): Promise<string> => {
        // Happy path (new branch): one spawn, no `worktree list`.
        const attempt = await git.attempt(args.create, { cwd: ctx.root });
        if (attempt.code === 0) return target;

        // The optimistic `-b` failed. A previous run (or another Starling process) may already have
        // the branch, or the branch may be registered but its directory gone. Anything else is real.
        if (!(await refExists(git, ctx.root, `refs/heads/${name}`))) {
          throw gitFailure(args.create, attempt);
        }

        const registered = await findWorktree(ctx, name);
        if (registered !== undefined) return registered;

        // An interrupted earlier add leaves an unregistered directory that git refuses to reuse. It
        // is provably ours when `.git` is a pointer into this repo's worktrees dir, so clear it.
        if (existsSync(target) && (await isLinkedWorktree(target, ctx.gitDir))) {
          await rm(target, { recursive: true, force: true });
        }
        const retried = await git.attempt(args.existing, { cwd: ctx.root });
        if (retried.code !== 0) throw gitFailure(args.existing, retried);
        return target;
      };

      const path = await place();

      if (sparseDirs.length > 0) {
        try {
          await applySparseCheckout(git, path, sparseDirs);
        } catch (err) {
          // Do not leave a half-built worktree behind; the branch stays, so a retry is cheap.
          await git.attempt(['worktree', 'remove', '--force', path], { cwd: ctx.root });
          known.delete(name);
          throw err;
        }
      }
      return path;
    });

    known.set(name, created);
    return { path: created, branch: name };
  }

  async function diff(worktreePath: string, baseRef: string): Promise<DiffSummary> {
    const cwd = resolve(worktreePath);
    const status = await repoStatus(git, cwd);
    const committed = parseNumstat(await git.text(['diff', '--numstat', `${baseRef}...HEAD`], { cwd }));

    const parts = [
      await git.stdout(['diff', '--no-color', '--no-ext-diff', `${baseRef}...HEAD`], { cwd }),
    ];

    // Only ask for the working-tree half when there is one; a clean worktree costs zero extra
    // spawns instead of two (the common case right after an agent commits).
    let working: FileStat[] = [];
    if (status.modified) {
      working = parseNumstat(await git.text(['diff', '--numstat', 'HEAD'], { cwd }));
      parts.push(await git.stdout(['diff', '--no-color', '--no-ext-diff', 'HEAD'], { cwd }));
    }

    const untrackedStats: FileStat[] = [];
    for (const rel of status.untracked) {
      const abs = join(cwd, rel);
      let bytes: Uint8Array;
      let mode = '100644';
      try {
        const info = await stat(abs);
        if (!info.isFile()) continue;
        if (info.mode & 0o111) mode = '100755';
        if (info.size > UNTRACKED_MAX_BYTES) {
          untrackedStats.push({ path: rel, added: 0, removed: 0 });
          continue;
        }
        bytes = new Uint8Array(await readFile(abs));
      } catch (err) {
        // The file disappeared between `status` and the read: it is simply not part of this diff.
        if (errnoCode(err) === 'ENOENT') continue;
        throw err;
      }
      const counted = countNewFileLines(bytes);
      untrackedStats.push({ path: rel, added: counted.added, removed: 0 });
      parts.push(newFilePatch(rel, bytes, mode));
    }

    return buildDiffSummary(mergeStats(committed, working, untrackedStats), parts);
  }

  async function changedFiles(worktreePath: string, baseRef: string): Promise<string[]> {
    const cwd = resolve(worktreePath);
    // `HEAD` covers both the staged and the unstaged halves of the working tree.
    const committed = splitNul(await git.stdout(['diff', '--name-only', '-z', `${baseRef}...HEAD`], { cwd }));
    const status = await repoStatus(git, cwd);
    const working = status.modified
      ? splitNul(await git.stdout(['diff', '--name-only', '-z', 'HEAD'], { cwd }))
      : [];
    return dedupe([...committed, ...working, ...status.untracked]);
  }

  async function predictConflicts(repo: string, ours: string, theirs: string): Promise<string[]> {
    const ctx = await resolveRepo(git, repo);
    await git.requireVersion(MIN_MERGE_TREE_VERSION, ctx.root);

    const args = ['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs];
    const result = await git.attempt(args, { cwd: ctx.root });
    const lines = result.stdout.split('\n').filter((line) => line !== '');

    if (result.code === 0) return [];
    const treeOid = lines[0];
    if (result.code !== 1 || treeOid === undefined || !/^[0-9a-f]{40,64}$/.test(treeOid)) {
      throw gitFailure(args, result);
    }
    // First line is the written tree OID; every following line is a conflicted path.
    return dedupe(
      lines
        .slice(1)
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    );
  }

  async function commitAll(worktreePath: string, message: string): Promise<string | undefined> {
    const cwd = resolve(worktreePath);
    if (message.trim() === '') {
      throw new StarlingError('INVALID_ARGUMENT', 'commitAll needs a commit message');
    }

    const addArgs = ['add', '-A'];
    const added = await git.attempt(addArgs, { cwd });
    if (added.code !== 0) throw gitFailure(addArgs, added);

    const staged = await git.attempt(['diff', '--cached', '--quiet'], { cwd });
    if (staged.code === 0) return undefined;
    if (staged.code !== 1) throw gitFailure(['diff', '--cached', '--quiet'], staged);

    // Never sign from a harness: a missing passphrase would hang the run.
    const base = ['-c', 'commit.gpgsign=false', 'commit', '-m', message];
    let used = base;
    let committed = await git.attempt(used, { cwd });
    if (committed.code !== 0 && IDENTITY_FAILURE.test(`${committed.stderr}\n${committed.stdout}`)) {
      // No usable user.name/user.email: supply one for this process only, never in config.
      used = [
        '-c',
        `user.name=${FALLBACK_IDENTITY.name}`,
        '-c',
        `user.email=${FALLBACK_IDENTITY.email}`,
        ...base,
      ];
      committed = await git.attempt(used, { cwd });
    }
    if (committed.code !== 0) throw gitFailure(used, committed);
    return git.text(['rev-parse', 'HEAD'], { cwd });
  }

  async function remove(worktreePath: string): Promise<void> {
    const target = resolve(worktreePath);
    for (const [name, path] of known) if (path === target) known.delete(name);
    if (!existsSync(target)) return;

    const common = await git.attempt(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: target,
    });
    if (common.code !== 0) {
      throw new StarlingError('WORKSPACE_ERROR', `not a git worktree: ${target}`, {
        details: { stderr: common.stderr.trim() },
      });
    }
    const gitDir = normalizeKey(resolve(target, common.stdout.trim()));
    const repoRoot = dirname(gitDir);

    await git.lock(gitDir, async () => {
      const args = ['worktree', 'remove', '--force', target];
      const result = await git.attempt(args, { cwd: target });
      if (result.code !== 0) {
        // A registration that was already pruned still leaves a directory; clear the worktree
        // ourselves, but only after proving the `.git` pointer file belongs to this repo.
        if (!(await isLinkedWorktree(target, gitDir))) throw gitFailure(args, result);
        await rm(target, { recursive: true, force: true });
      }
      await maybePrune({ root: repoRoot, gitDir, lockKey: normalizeKey(gitDir) });
    });
  }

  const bundles = createBundleOps({ git, worktreeRoot, clock });

  return {
    ensureIntegrationBranch,
    create,
    diff,
    changedFiles,
    predictConflicts,
    commitAll,
    remove,
    createBundle: bundles.createBundle,
    cloneFromBundle: bundles.cloneFromBundle,
    fetchBundle: bundles.fetchBundle,
  };
}
