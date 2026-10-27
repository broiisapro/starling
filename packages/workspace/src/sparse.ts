/**
 * Opt-in sparse worktrees.
 *
 * A lane tells us which directories a task may touch — usually one or two packages out of hundreds.
 * A full checkout of a large repo for every one of 60 worktrees is the single biggest avoidable
 * cost in the git layer: the *objects* are shared, but every checked-out file is a separate inode
 * and a separate 4 KB block. `git worktree add --no-checkout` + `git sparse-checkout set --cone`
 * materialises only the lane's directories (plus the repo root files git always includes in cone
 * mode), which the stress harness measures at ~50x fewer files for a two-directory lane on a 5k-file
 * repo (see `tools/stress/worktrees.ts`).
 *
 * It stays opt-in because sparse checkout is a behaviour change, not a free win: an agent that greps
 * the whole repo, or a test command that imports a sibling package outside the lane, will not find
 * the files. The engine decides per branch (there is one workspace per run, lanes vary per task, so
 * `CreateWorkspaceOptions.sparseCheckout` is a callback, not a static list).
 */
import { isAbsolute, resolve } from 'node:path';
import { StarlingError } from '@starling/core';
import type { Git } from './git';

/**
 * Keep only relative directory paths without `..` segments. Cone mode additionally rejects
 * wildcards, so anything with `*?[` is refused here with a typed error instead of a git one.
 */
export function normalizeSparseDirs(directories: string[]): string[] {
  const cleaned: string[] = [];
  for (const raw of directories) {
    const dir = raw
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/\/+$/, '');
    if (dir === '' || dir === '.') continue;
    if (isAbsolute(dir) || dir.startsWith('/')) {
      throw new StarlingError('INVALID_ARGUMENT', `sparse checkout path must be relative: ${raw}`);
    }
    if (dir.split('/').includes('..')) {
      throw new StarlingError('INVALID_ARGUMENT', `sparse checkout path must stay in the repo: ${raw}`);
    }
    if (/[*?[\]]/.test(dir)) {
      throw new StarlingError(
        'INVALID_ARGUMENT',
        `sparse checkout uses cone mode, which takes directories, not globs: ${raw}`,
      );
    }
    cleaned.push(dir);
  }
  return [...new Set(cleaned)];
}

/**
 * Narrow a freshly added `--no-checkout` worktree to `directories`.
 *
 * Two steps, and both are needed: `git sparse-checkout set --cone` writes the patterns, but a
 * `--no-checkout` worktree still has an empty index, so it leaves every path staged as deleted.
 * `git read-tree -mu HEAD` then materialises exactly the cone's files into the index and working
 * tree (verified: README/root files plus `src/a`, nothing from `src/b`).
 */
export async function applySparseCheckout(
  git: Git,
  worktreePath: string,
  directories: string[],
): Promise<void> {
  const dirs = normalizeSparseDirs(directories);
  if (dirs.length === 0) return;
  const target = resolve(worktreePath);
  const steps = [
    ['sparse-checkout', 'set', '--cone', ...dirs],
    ['read-tree', '-m', '-u', 'HEAD'],
  ];
  for (const args of steps) {
    const result = await git.attempt(args, { cwd: target });
    if (result.code !== 0) {
      throw new StarlingError('WORKSPACE_ERROR', `sparse checkout failed in ${target}`, {
        details: { args, stderr: result.stderr.trim().slice(0, 2000) },
      });
    }
  }
}
