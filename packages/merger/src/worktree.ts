import { existsSync, realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { StarlingError } from '@starling/core';
import { type Git, outputTail } from './git.ts';

/** Subdirectory of `worktreeRoot` that holds every integration worktree. */
export const INTEGRATION_DIR = '_integration';

/**
 * Resolve symlinks, including for paths that do not exist yet.
 *
 * Git stores worktree paths resolved through `realpath` (on macOS `/var/…` becomes `/private/var/…`),
 * so the merger must compare apples to apples or it would try to `worktree add` an existing path.
 */
export function canonicalPath(path: string): string {
  let current = resolve(path);
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return resolve(path);
    missing.unshift(basename(current));
    current = parent;
  }
  return join(realpathSync(current), ...missing);
}

/** Turn `starling/abc123/integration` into a filesystem-safe directory name. */
export function sanitizeBranchName(branch: string): string {
  const cleaned = branch
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');
  return cleaned.length > 0 ? cleaned : 'integration';
}

/** The integration worktree path for a branch, relative to an already-canonical worktree root. */
export function integrationWorktreePath(worktreeRoot: string, integrationBranch: string): string {
  return join(worktreeRoot, INTEGRATION_DIR, sanitizeBranchName(integrationBranch));
}

export interface WorktreeEntry {
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
}

/** Parse `git worktree list --porcelain`. */
export async function listWorktrees(git: Git, repo: string): Promise<WorktreeEntry[]> {
  const output = await git.must(repo, ['worktree', 'list', '--porcelain']);
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | undefined;

  const flush = (): void => {
    if (current !== undefined) entries.push(current);
    current = undefined;
  };

  for (const line of output.split('\n')) {
    if (line.trim().length === 0) {
      flush();
      continue;
    }
    const separator = line.indexOf(' ');
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1);
    if (key === 'worktree') {
      flush();
      current = { path: value, bare: false, detached: false };
    } else if (current === undefined) {
    } else if (key === 'HEAD') {
      current.head = value;
    } else if (key === 'branch') {
      current.branch = value.replace(/^refs\/heads\//, '');
    } else if (key === 'bare') {
      current.bare = true;
    } else if (key === 'detached') {
      current.detached = true;
    }
  }
  flush();
  return entries;
}

/**
 * Leave a worktree clean before a merge.
 *
 * A crashed run can leave a half-finished merge or an agent's scratch file behind. The integration
 * worktree is Starling-owned and single-purpose, so resetting it is safe; a human's checkout is not
 * (and would never be used here).
 */
async function recoverWorktree(git: Git, path: string): Promise<void> {
  const mergeHead = await git.run(path, ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD']);
  if (mergeHead.code === 0) {
    const abort = await git.run(path, ['merge', '--abort']);
    if (abort.code !== 0) {
      const reset = await git.run(path, ['reset', '--hard', 'HEAD']);
      if (reset.code !== 0) {
        throw new StarlingError('MERGE_ERROR', `Could not abort the stale merge in ${path}`, {
          details: { path, tail: outputTail(abort) },
        });
      }
    }
  }

  const status = await git.run(path, ['status', '--porcelain']);
  if (status.code !== 0) {
    throw new StarlingError('MERGE_ERROR', `Could not read the status of ${path}`, {
      details: { path, tail: outputTail(status) },
    });
  }
  if (status.stdout.trim().length === 0) return;

  for (const args of [
    ['reset', '--hard', 'HEAD'],
    ['clean', '-fdq'],
  ]) {
    const result = await git.run(path, args);
    if (result.code !== 0) {
      throw new StarlingError('MERGE_ERROR', `Could not clean the integration worktree at ${path}`, {
        details: { path, args, tail: outputTail(result) },
      });
    }
  }
}

export interface EnsureWorktreeInput {
  repo: string;
  integrationBranch: string;
  /** Already canonical (see `canonicalPath`). */
  worktreeRoot: string;
  git: Git;
}

/**
 * Create the long-lived integration worktree on first use, then reuse it.
 *
 * Reuse is the whole point: each task branch only pays for one `git merge` in an already-warm
 * worktree, and the suite runs in the same directory the queue just updated.
 */
export async function ensureIntegrationWorktree({
  repo,
  integrationBranch,
  worktreeRoot,
  git,
}: EnsureWorktreeInput): Promise<string> {
  const baseDir = join(worktreeRoot, INTEGRATION_DIR);
  await mkdir(baseDir, { recursive: true });
  const path = join(realpathSync(baseDir), sanitizeBranchName(integrationBranch));

  // A previous crash may have left a registration for a directory someone deleted by hand.
  await git.run(repo, ['worktree', 'prune']);

  const existing = (await listWorktrees(git, repo)).find((worktree) => worktree.path === path);
  if (existing !== undefined) {
    // A detached HEAD is the one state we can safely repair: the worktree belongs to us and its
    // branch is known. Anything else means another branch's worktree sanitised to the same path (or
    // a human moved it), and switching branches under a running queue would corrupt both merges.
    if (existing.detached || existing.branch === undefined) {
      const checkout = await git.run(path, ['checkout', '-f', integrationBranch]);
      if (checkout.code !== 0) {
        throw new StarlingError(
          'MERGE_ERROR',
          `Detached integration worktree ${path} could not switch back to "${integrationBranch}"`,
          { details: { path, integrationBranch, tail: outputTail(checkout) } },
        );
      }
    } else if (existing.branch !== integrationBranch) {
      throw new StarlingError(
        'MERGE_ERROR',
        `Integration worktree ${path} is on "${existing.branch}", not "${integrationBranch}"; remove it or use a distinct branch name`,
        { details: { path, expected: integrationBranch, found: existing.branch } },
      );
    }
    await recoverWorktree(git, path);
    return path;
  }

  if (existsSync(path)) {
    throw new StarlingError(
      'MERGE_ERROR',
      `Integration worktree path ${path} already exists but does not belong to ${repo}`,
      { details: { path, repo } },
    );
  }

  const add = await git.run(repo, ['worktree', 'add', '--quiet', path, integrationBranch]);
  if (add.code !== 0) {
    throw new StarlingError(
      'MERGE_ERROR',
      `Could not create the integration worktree for "${integrationBranch}"`,
      {
        details: { repo, path, tail: outputTail(add) },
      },
    );
  }
  return path;
}
