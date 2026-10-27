import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type ExecResult, exec, type TaskRun } from '@starling/core';
import { makeTaskRun } from '@starling/core/testing';

/**
 * Hermetic git environment: no user/system config, no credential or signing prompts.
 *
 * Repo-local identity is configured by `makeRepo`, so commits work while a developer's global
 * `commit.gpgsign` or hooks cannot leak into the tests.
 */
export const GIT_ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};

const tempDirs: string[] = [];

export async function makeTempDir(prefix = 'starling-merger-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Remove every directory created by these helpers. Call from `afterAll`. */
export async function cleanupTempDirs(): Promise<void> {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

/** Raw git invocation: returns the result, including non-zero exits. */
export function gitResult(repo: string, args: string[]): Promise<ExecResult> {
  return exec(['git', ...args], { cwd: repo, env: GIT_ENV });
}

/** Git invocation that throws on failure. Returns trimmed stdout. */
export async function git(repo: string, args: string[]): Promise<string> {
  const result = await gitResult(repo, args);
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${result.code}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

export async function writeFiles(repo: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const full = join(repo, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

export interface TestRepo {
  repo: string;
  worktreeRoot: string;
}

/** A fresh git repo with one commit on `main`, plus a temp worktree root. */
export async function makeRepo(
  files: Record<string, string> = { 'README.md': '# demo\n' },
): Promise<TestRepo> {
  const repo = await makeTempDir('starling-merger-repo-');
  await git(repo, ['init', '--quiet', '-b', 'main']);
  await git(repo, ['config', 'user.name', 'Starling Test']);
  await git(repo, ['config', 'user.email', 'test@starling.local']);
  await git(repo, ['config', 'commit.gpgsign', 'false']);
  await writeFiles(repo, files);
  await git(repo, ['add', '--all']);
  await git(repo, ['commit', '--quiet', '-m', 'init']);

  const worktreeRoot = await makeTempDir('starling-merger-wt-');
  return { repo, worktreeRoot };
}

export interface CreateBranchOptions {
  from?: string;
  message?: string;
}

/** Create `branch` from `from`, commit `files`, then go back to `from`. */
export async function createBranch(
  repo: string,
  branch: string,
  files: Record<string, string>,
  { from = 'main', message = `feat: ${branch}` }: CreateBranchOptions = {},
): Promise<void> {
  await git(repo, ['checkout', '--quiet', '-B', branch, from]);
  await writeFiles(repo, files);
  await git(repo, ['add', '--all']);
  await git(repo, ['commit', '--quiet', '--allow-empty', '-m', message]);
  await git(repo, ['checkout', '--quiet', from]);
}

/** `git branch <name> <from>` — the integration branch the engine's Workspace would create. */
export async function createIntegrationBranch(
  repo: string,
  branch = 'starling/run1/integration',
  from = 'main',
): Promise<string> {
  await git(repo, ['branch', branch, from]);
  return branch;
}

/** Commit a change on `main` (or any checked-out branch) without leaving it. */
export async function commitOnCurrent(
  repo: string,
  files: Record<string, string>,
  message: string,
): Promise<void> {
  await writeFiles(repo, files);
  await git(repo, ['add', '--all']);
  await git(repo, ['commit', '--quiet', '-m', message]);
}

export function rev(repo: string, ref: string): Promise<string> {
  return git(repo, ['rev-parse', ref]);
}

/** True when `path` exists in `ref`'s tree (works for branches, tags and commits). */
export async function hasFile(repo: string, ref: string, path: string): Promise<boolean> {
  const result = await gitResult(repo, ['cat-file', '-e', `${ref}:${path}`]);
  return result.code === 0;
}

export function makeTask(branch: string | undefined, taskKey = 'theme'): TaskRun {
  return makeTaskRun({ taskKey, branch, status: 'merging' });
}
