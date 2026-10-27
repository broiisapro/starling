/**
 * The real `Workspace` port, on the git CLI (ARCHITECTURE L13).
 *
 * Up to ~20 opencode agents run at once, each in its own worktree. Two rules keep that safe:
 *
 * 1. Anything that writes shared `.git` state (worktree add/remove/prune, branch create, fetch,
 *    bundle import) runs under a mutex keyed by the repo's common git dir. Everything that happens
 *    *inside* one worktree — staging, committing, diffing — takes no lock and stays parallel.
 * 2. A single retry after a short backoff covers the residual case where an external git process
 *    (a human, an editor plugin, another Starling instance) holds `index.lock`.
 *
 * Audit and merge always read a branch the hub owns, so this package never pushes and never talks to
 * a remote (see ARCHITECTURE §1: bundles are the transport).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, rmdir, stat } from 'node:fs/promises';
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
import { sanitizeBranchInput, worktreePathFor } from './paths';
import {
  listWorktrees,
  normalizeKey,
  type RepoContext,
  refExists,
  resolveRepo,
  splitNul,
  untrackedFiles,
} from './repo';
import { MIN_MERGE_TREE_VERSION } from './version';

export interface CreateWorkspaceOptions {
  /** Parent directory for every worktree (`<root>/<sanitised branch>`); created on demand. */
  worktreeRoot: string;
  /** Injectable `exec` for tests and for faking git. Defaults to core's real `exec`. */
  exec?: ExecLike;
  /** Injectable clock, used only to keep generated bundle filenames unique. */
  clock?: Clock;
}

/** `Workspace` plus the bundle helpers Flock mode needs (not part of the core port). */
export type WorkspaceWithBundles = Workspace & BundleOps;

/** Local identity used when the repo has none. Passed with `-c`, so global config is never touched. */
const FALLBACK_IDENTITY = { name: 'Starling Bot', email: 'starling@localhost' } as const;

/** Dedupe while preserving input order. */
function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function errnoCode(err: unknown): unknown {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: unknown }).code
    : undefined;
}

/** Read `user.name` / `user.email` as git itself would resolve them (local → global → system). */
async function readIdentity(git: Git, cwd: string): Promise<{ name?: string; email?: string }> {
  const name = (await git.attempt(['config', '--get', 'user.name'], { cwd })).stdout.trim();
  const email = (await git.attempt(['config', '--get', 'user.email'], { cwd })).stdout.trim();
  return {
    name: name === '' ? undefined : name,
    email: email === '' ? undefined : email,
  };
}

/** True when `dir/.git` is the pointer file of a linked worktree that belongs to `gitDir`. */
async function isLinkedWorktree(dir: string, gitDir: string): Promise<boolean> {
  try {
    const info = await stat(join(dir, '.git'));
    if (!info.isFile()) return false;
    const pointer = (await readFile(join(dir, '.git'), 'utf8')).trim();
    if (!pointer.startsWith('gitdir:')) return false;
    const pointed = normalizeKey(pointer.slice('gitdir:'.length).trim());
    const worktreesDir = join(normalizeKey(gitDir), 'worktrees');
    return pointed === worktreesDir || pointed.startsWith(`${worktreesDir}/`);
  } catch {
    return false;
  }
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
  const mutex = new KeyedMutex();
  const git = new Git(execFn, mutex);

  /** Return the path of an already-registered worktree for `branch`, if its directory still exists. */
  async function findWorktree(ctx: RepoContext, branch: string): Promise<string | undefined> {
    const wanted = `refs/heads/${branch}`;
    const entries = await listWorktrees(git, ctx.root);
    const match = entries.find((entry) => entry.branch === wanted);
    if (match === undefined) return undefined;
    if (existsSync(match.path)) return match.path;
    // Registered but the directory is gone: drop the stale entry and let the caller re-create it.
    await git.attempt(['worktree', 'prune'], { cwd: ctx.root });
    return undefined;
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

    const args = ['branch', branch, base];
    const result = await git.run(args, { cwd: ctx.root, lock: ctx.lockKey });
    // A concurrent Starling instance may have won the race; that is still success.
    if (result.code === 0) return;
    if (await refExists(git, ctx.root, `refs/heads/${branch}`)) return;
    throw gitFailure(args, result);
  }

  async function create(
    repo: string,
    branch: string,
    fromRef: string,
  ): Promise<{ path: string; branch: string }> {
    const name = sanitizeBranchInput(branch);
    const ctx = await resolveRepo(git, repo);
    const target = worktreePathFor(worktreeRoot, name);

    return git.lock(ctx.lockKey, async () => {
      const existing = await findWorktree(ctx, name);
      if (existing !== undefined) return { path: existing, branch: name };

      await mkdir(dirname(target), { recursive: true });
      if (existsSync(target)) {
        const entries = await readdir(target);
        if (entries.length === 0) await rmdir(target);
      }

      const branchExists = await refExists(git, ctx.root, `refs/heads/${name}`);
      const args = branchExists
        ? ['worktree', 'add', target, name]
        : ['worktree', 'add', '-b', name, target, fromRef];
      const result = await git.attempt(args, { cwd: ctx.root });
      if (result.code !== 0) {
        const raced = await findWorktree(ctx, name);
        if (raced !== undefined) return { path: raced, branch: name };
        throw gitFailure(args, result);
      }
      return { path: target, branch: name };
    });
  }

  async function diff(worktreePath: string, baseRef: string): Promise<DiffSummary> {
    const cwd = resolve(worktreePath);
    const committed = parseNumstat(await git.text(['diff', '--numstat', `${baseRef}...HEAD`], { cwd }));
    const working = parseNumstat(await git.text(['diff', '--numstat', 'HEAD'], { cwd }));

    const parts = [
      await git.stdout(['diff', '--no-color', '--no-ext-diff', `${baseRef}...HEAD`], { cwd }),
      await git.stdout(['diff', '--no-color', '--no-ext-diff', 'HEAD'], { cwd }),
    ];

    const untrackedStats: FileStat[] = [];
    for (const rel of await untrackedFiles(git, cwd)) {
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
        // The file disappeared between `ls-files` and the read: it is simply not part of this diff.
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
    const working = splitNul(await git.stdout(['diff', '--name-only', '-z', 'HEAD'], { cwd }));
    const untracked = await untrackedFiles(git, cwd);
    return dedupe([...committed, ...working, ...untracked]);
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

    const identity = await readIdentity(git, cwd);
    const config: string[] = [];
    if (identity.name === undefined || identity.email === undefined) {
      config.push('-c', `user.name=${FALLBACK_IDENTITY.name}`, '-c', `user.email=${FALLBACK_IDENTITY.email}`);
    }
    // Never sign from a harness: a missing passphrase would hang the run.
    config.push('-c', 'commit.gpgsign=false');

    const args = [...config, 'commit', '-m', message];
    const committed = await git.attempt(args, { cwd });
    if (committed.code !== 0) throw gitFailure(args, committed);
    return git.text(['rev-parse', 'HEAD'], { cwd });
  }

  async function remove(worktreePath: string): Promise<void> {
    const target = resolve(worktreePath);
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
      // Best effort: stale administrative entries should never fail a successful removal.
      await git.attempt(['worktree', 'prune'], { cwd: repoRoot });
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
