/**
 * Repository discovery and the small read-only git queries the workspace, bundle, recovery and
 * stress code share.
 *
 * The mutex key is the **common git dir**, not the repo path: every linked worktree of one repo
 * resolves to the same key, so worktree A and the main checkout cannot race each other.
 */
import { realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
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

/** True when `candidate` is `root` itself or lives below it (no `../` escapes, no prefix tricks). */
export function isInside(root: string, candidate: string): boolean {
  const base = resolve(root);
  const target = resolve(candidate);
  return target === base || target.startsWith(`${base}${sep}`);
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

/**
 * Drop administrative entries for worktrees whose directory is gone.
 *
 * `--expire now` matters: plain `git worktree prune` honours `gc.worktreePruneExpire` (three months
 * by default), so a worktree lost to a crash this morning would linger for a quarter. An entry is
 * only ever pruned when its directory (or its `gitdir` pointer) is missing, so there is nothing to
 * lose by pruning immediately.
 */
export async function pruneWorktrees(git: Git, cwd: string): Promise<void> {
  await git.attempt(['worktree', 'prune', '--expire', 'now'], { cwd });
}

/** Untracked, non-ignored files relative to the repo/worktree root (`-z`, so spaces are safe). */
export async function untrackedFiles(git: Git, cwd: string): Promise<string[]> {
  const output = await git.stdout(['ls-files', '--others', '--exclude-standard', '-z'], { cwd });
  return splitNul(output);
}

/**
 * Working-tree state in **one** git call.
 *
 * `diff()` used to spend four spawns answering "is anything dirty, and which files are untracked":
 * `diff --numstat HEAD`, `diff HEAD`, and `ls-files --others`. At 50 concurrent audits that is 150
 * extra processes per audit round. `status --porcelain` answers both questions at once, and
 * `--no-renames` keeps the `-z` output at exactly one field per entry (renames are just a delete plus
 * an add for our purposes), so parsing stays trivial.
 */
export interface RepoStatus {
  /** Tracked files with staged or unstaged changes (adds, edits, deletes, mode changes). */
  modified: boolean;
  /** Untracked, non-ignored paths, relative to `cwd`. */
  untracked: string[];
  /** Anything git reports at all, including untracked files. */
  dirty: boolean;
}

export async function repoStatus(git: Git, cwd: string): Promise<RepoStatus> {
  const output = await git.stdout(
    ['status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=all'],
    { cwd },
  );
  const untracked: string[] = [];
  let modified = false;
  for (const entry of splitNul(output)) {
    // Porcelain v1: two status letters, one space, then the path.
    if (entry.length < 4) continue;
    if (entry[0] === '?' && entry[1] === '?') {
      untracked.push(entry.slice(3));
      continue;
    }
    modified = true;
  }
  return { modified, untracked, dirty: modified || untracked.length > 0 };
}

/** Short names of every local branch under `prefix`, e.g. `['starling/abc/t01']`. */
export async function branchesWithPrefix(git: Git, cwd: string, prefix: string): Promise<string[]> {
  const output = await git.text(['for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}`], {
    cwd,
  });
  return output.split('\n').filter((line) => line !== '');
}

/**
 * Absolute git dir of a linked worktree, read from its `.git` pointer file, if the directory has one.
 * Used to prove a directory on disk really belongs to *this* repository before anything deletes it.
 */
export async function worktreeAdminDir(dir: string): Promise<string | undefined> {
  try {
    const pointer = (await readFile(join(dir, '.git'), 'utf8')).trim();
    if (!pointer.startsWith('gitdir:')) return undefined;
    return resolve(dir, pointer.slice('gitdir:'.length).trim());
  } catch {
    return undefined;
  }
}

/** True when `dir/.git` is the pointer file of a linked worktree that belongs to `gitDir`. */
export async function isLinkedWorktree(dir: string, gitDir: string): Promise<boolean> {
  const admin = await worktreeAdminDir(dir);
  if (admin === undefined) return false;
  const worktreesDir = join(normalizeKey(gitDir), 'worktrees');
  const pointed = normalizeKey(admin);
  return pointed === worktreesDir || pointed.startsWith(`${worktreesDir}${sep}`);
}

/** Modification time in epoch ms, or undefined when the path does not exist / cannot be read. */
export async function mtimeMs(path: string): Promise<number | undefined> {
  try {
    const info = await stat(path);
    return info.mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * When the ref was created, from its reflog (epoch ms).
 *
 * A branch's *commit* date is the date of the commit it points at, which for a branch cut from an
 * old base is arbitrarily old — useless for "is this run dead?". The reflog's oldest entry is the
 * only local record of when the branch itself appeared. Returns undefined when reflogs are off or
 * trimmed: callers must then fall back to other evidence rather than guess.
 */
export async function refCreatedAt(git: Git, cwd: string, ref: string): Promise<number | undefined> {
  const result = await git.attempt(['reflog', 'show', '--date=unix', '--format=%gd', ref], { cwd });
  if (result.code !== 0) return undefined;
  let oldest: number | undefined;
  for (const line of result.stdout.split('\n')) {
    const match = line.match(/@\{(\d+)\}/);
    if (match === null) continue;
    const seconds = Number.parseInt(match[1] ?? '', 10);
    if (!Number.isFinite(seconds)) continue;
    if (oldest === undefined || seconds < oldest) oldest = seconds;
  }
  return oldest === undefined ? undefined : oldest * 1000;
}

/** Committer time of the commit a ref points at (epoch ms), or undefined. */
export async function refCommitTime(git: Git, cwd: string, ref: string): Promise<number | undefined> {
  const result = await git.attempt(['log', '-1', '--format=%ct', ref], { cwd });
  if (result.code !== 0) return undefined;
  const seconds = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

/** Split NUL-separated git output, dropping the trailing empty field. */
export function splitNul(output: string): string[] {
  return output.split('\0').filter((entry) => entry !== '');
}
