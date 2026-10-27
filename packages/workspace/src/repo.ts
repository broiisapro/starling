/**
 * Repository discovery and small read-only git queries shared by the workspace and bundle helpers.
 *
 * The mutex key is the **common git dir**, not the repo path: every linked worktree of one repo
 * resolves to the same key, so worktree A and the main checkout cannot race each other.
 */
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { StarlingError } from '@starling/core';
import type { Git } from './git';

export interface RepoContext {
  /** Working-tree root of the path the caller passed. */
  root: string;
  /** Absolute common git dir (`.git`), shared by every worktree of the repo. */
  gitDir: string;
  /** Mutex key for shared-state operations. */
  lockKey: string;
}

/** Resolve symlinks when possible so two spellings of one repo share a mutex. */
export function normalizeKey(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/** Throw unless `repo` is inside a git work tree; return its canonical root and lock key. */
export async function resolveRepo(git: Git, repo: string): Promise<RepoContext> {
  const cwd = resolve(repo);
  const rootResult = await git.attempt(['rev-parse', '--path-format=absolute', '--show-toplevel'], { cwd });
  if (rootResult.code !== 0) {
    throw new StarlingError('WORKSPACE_ERROR', `not a git repository: ${cwd}`, {
      details: { stderr: rootResult.stderr.trim() },
    });
  }
  const root = rootResult.stdout.trim();

  const commonResult = await git.attempt(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
  });
  const gitDir = commonResult.code === 0 ? resolve(cwd, commonResult.stdout.trim()) : join(root, '.git');

  return { root, gitDir, lockKey: normalizeKey(gitDir) };
}

/** Repo root for an existing worktree path, derived from its common git dir. */
export function repoRootForGitDir(gitDir: string): string {
  return dirname(gitDir);
}

/** True when `ref` resolves. */
export async function refExists(git: Git, cwd: string, ref: string): Promise<boolean> {
  const result = await git.attempt(['rev-parse', '--verify', '--quiet', ref], { cwd });
  return result.code === 0;
}

export interface WorktreeEntry {
  path: string;
  /** Full ref, e.g. `refs/heads/main`, or undefined when detached. */
  branch?: string;
  head?: string;
}

/** `git worktree list --porcelain`, parsed. */
export async function listWorktrees(git: Git, cwd: string): Promise<WorktreeEntry[]> {
  const output = await git.text(['worktree', 'list', '--porcelain'], { cwd });
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | undefined;

  for (const line of output.split('\n')) {
    if (line === '') {
      if (current !== undefined) entries.push(current);
      current = undefined;
      continue;
    }
    const space = line.indexOf(' ');
    const key = space < 0 ? line : line.slice(0, space);
    const value = space < 0 ? '' : line.slice(space + 1);
    if (key === 'worktree') {
      if (current !== undefined) entries.push(current);
      current = { path: value };
    } else if (current !== undefined && key === 'branch') {
      current.branch = value;
    } else if (current !== undefined && key === 'HEAD') {
      current.head = value;
    }
  }
  if (current !== undefined) entries.push(current);
  return entries;
}

/** Untracked, non-ignored files relative to the repo/worktree root (`-z`, so spaces are safe). */
export async function untrackedFiles(git: Git, cwd: string): Promise<string[]> {
  const output = await git.stdout(['ls-files', '--others', '--exclude-standard', '-z'], { cwd });
  return splitNul(output);
}

/** Split NUL-separated git output, dropping the trailing empty field. */
export function splitNul(output: string): string[] {
  return output.split('\0').filter((entry) => entry !== '');
}
