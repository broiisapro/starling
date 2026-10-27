/**
 * Shared fixtures for the repomap tests. Not exported from the package index: production code must
 * never import this file.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { exec } from '@starling/core';

export async function makeTempDir(prefix = 'starling-repomap-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function writeFiles(
  root: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const full = join(root, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
    }),
  );
}

export async function git(root: string, args: readonly string[]): Promise<string> {
  const result = await exec(['git', ...args], { cwd: root, timeoutMs: 15_000 });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout;
}

/** Init a repo with a deterministic identity so tests never depend on the machine's git config. */
export async function initRepo(root: string): Promise<void> {
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['config', 'user.email', 'repomap-test@starling.local']);
  await git(root, ['config', 'user.name', 'Repomap Test']);
}

export async function commitAll(root: string, message = 'fixture'): Promise<void> {
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', message]);
}

/** Create a temp git repo with `files` written and committed. */
export async function makeRepo(files: Readonly<Record<string, string | Uint8Array>>): Promise<string> {
  const root = await makeTempDir();
  await initRepo(root);
  await writeFiles(root, files);
  await commitAll(root);
  return root;
}

export async function removeDir(root: string | undefined): Promise<void> {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
}
