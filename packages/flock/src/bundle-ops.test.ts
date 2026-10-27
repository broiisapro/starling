import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec, StarlingError } from '@starling/core';
import { createBundleOps } from './bundle-ops.ts';

const temps: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'starling-flock-bundles-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function initRepo(files: Record<string, string>): Promise<string> {
  const repo = await tempDir();
  await exec(['git', 'init', '-b', 'main'], { cwd: repo });
  for (const [path, content] of Object.entries(files)) {
    await writeFile(join(repo, path), content);
  }
  await exec(['git', 'add', '-A'], { cwd: repo });
  await exec(
    ['git', '-c', 'user.name=Starling Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'init'],
    {
      cwd: repo,
    },
  );
  return repo;
}

describe('BundleOps (local mirror of Epic 14)', () => {
  test('round trip: create → clone → fetch into another repo', async () => {
    const source = await initRepo({ 'README.md': 'hello bundle\n' });
    const checkout = join(await tempDir(), 'checkout');
    const ops = createBundleOps();
    const bundle = await ops.createBundle(source, 'main', { outPath: join(await tempDir(), 'main.bundle') });

    await ops.cloneFromBundle(bundle, checkout, 'main');
    expect(await readFile(join(checkout, 'README.md'), 'utf8')).toBe('hello bundle\n');

    const consumer = await initRepo({ 'notes.md': 'consumer\n' });
    await ops.fetchBundle(consumer, bundle, 'main', 'imported');
    const rev = await exec(['git', 'rev-parse', '--verify', 'imported'], { cwd: consumer });
    expect(rev.code).toBe(0);

    const changed = await readFile(join(consumer, 'README.md'), 'utf8').catch(() => '');
    // The ref exists even though the consumer has not checked it out yet.
    expect(changed).toBe('');
  });

  test('createBundle defaults to a temp path and supports a base range', async () => {
    const repo = await initRepo({ 'a.txt': 'one\n' });
    const first = await exec(['git', 'rev-parse', 'HEAD'], { cwd: repo });
    const base = first.stdout.trim();
    await writeFile(join(repo, 'a.txt'), 'two\n');
    await exec(['git', 'add', '-A'], { cwd: repo });
    await exec(
      ['git', '-c', 'user.name=Starling Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'two'],
      {
        cwd: repo,
      },
    );

    const bundle = await createBundleOps().createBundle(repo, 'main', { base });
    expect(bundle.endsWith('.bundle')).toBe(true);
    expect((await Bun.file(bundle).size) ?? 0).toBeGreaterThan(0);
  });

  test('failures surface as WORKSPACE_ERROR with git stderr', async () => {
    const repo = await initRepo({ 'a.txt': 'one\n' });
    const error = await createBundleOps()
      .createBundle(repo, 'nope', { outPath: join(await tempDir(), 'x.bundle') })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StarlingError);
    expect((error as StarlingError).code).toBe('WORKSPACE_ERROR');
    expect((error as StarlingError).message).toContain('git bundle create');
  });
});
