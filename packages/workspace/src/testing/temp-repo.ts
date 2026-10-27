/**
 * Test-only helpers: disposable git repositories under the OS temp dir.
 *
 * These never touch the network, never touch the developer's global git config (identity is set
 * locally per repo) and never leave anything behind: every suite removes its directories.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { exec } from '@starling/core';

/** Create an empty temp directory. */
export async function makeTempDir(prefix = 'starling-ws-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

/** Remove directories, ignoring errors (best effort teardown). */
export async function removeDirs(...dirs: string[]): Promise<void> {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}

/** Run git in `cwd`, throwing on a non-zero exit so a broken fixture fails loudly. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await exec(['git', ...args], {
    cwd,
    env: { GIT_TERMINAL_PROMPT: '0' },
  });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.code}): ${result.stderr}`);
  }
  return result.stdout;
}

/** Write a file, creating parent directories. */
export async function writeFileIn(root: string, relative: string, content: string): Promise<string> {
  const target = join(root, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

export interface RepoOptions {
  /** Set local user.name/user.email. Default true. */
  identity?: boolean;
}

/** `git init` plus one commit on `main`, with a repo-local identity. */
export async function initRepo(dir: string, opts: RepoOptions = {}): Promise<string> {
  await mkdir(dir, { recursive: true });
  await git(dir, 'init', '-q', '-b', 'main');
  if (opts.identity !== false) {
    await git(dir, 'config', 'user.name', 'Test Agent');
    await git(dir, 'config', 'user.email', 'test@starling.local');
  }
  await writeFileIn(dir, 'README.md', '# demo\n');
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-qm', 'init');
  return dir;
}

/** Write a file and commit it. Returns the new commit sha. */
export async function commitFile(
  dir: string,
  relative: string,
  content: string,
  message: string,
): Promise<string> {
  await writeFileIn(dir, relative, content);
  await git(dir, 'add', '-A');
  await git(dir, 'commit', '-qm', message);
  return (await git(dir, 'rev-parse', 'HEAD')).trim();
}
