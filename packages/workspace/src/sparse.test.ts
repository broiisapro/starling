import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isStarlingError } from '@starling/core';
import { diskUsage } from './disk.ts';
import { normalizeKey } from './repo.ts';
import { normalizeSparseDirs } from './sparse.ts';
import { git, initRepo, makeTempDir, removeDirs, writeFileIn } from './testing/temp-repo.ts';
import { createWorkspace } from './workspace.ts';

async function withRepo<T>(fn: (ctx: { repo: string; worktreeRoot: string }) => Promise<T>): Promise<T> {
  const root = await makeTempDir('starling-sparse-');
  try {
    const repo = await initRepo(join(root, 'repo'));
    for (const mod of ['a', 'b', 'c']) {
      for (let index = 0; index < 4; index += 1) {
        await writeFileIn(repo, `src/${mod}/file${index}.ts`, `export const v${index} = '${mod}';\n`);
      }
    }
    await writeFileIn(repo, 'README.md', '# demo\n');
    await git(repo, 'add', '-A');
    await git(repo, 'commit', '-qm', 'tree');
    return await fn({ repo, worktreeRoot: join(root, 'worktrees') });
  } finally {
    await removeDirs(root);
  }
}

describe('normalizeSparseDirs', () => {
  test('keeps relative directories, dedupes and drops the root', () => {
    expect(normalizeSparseDirs(['src/a', 'src/a/', '.', './packages/core', 'docs'])).toEqual([
      'src/a',
      'packages/core',
      'docs',
    ]);
  });

  test('refuses absolute paths, escapes and globs', () => {
    for (const bad of ['/etc/passwd', '../outside', 'src/../..', 'src/*.ts', 'src/[ab]']) {
      try {
        normalizeSparseDirs([bad]);
        throw new Error(`expected a throw for ${bad}`);
      } catch (err) {
        expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
      }
    }
  });
});

describe('sparse worktrees', () => {
  test('materialises only the lane directories and still commits inside them', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({
        worktreeRoot,
        sparseCheckout: (branch) => (branch.endsWith('sparse') ? ['src/a'] : undefined),
      });

      const full = await ws.create(repo, 'starling/run-1/t01-full', 'main');
      const sparse = await ws.create(repo, 'starling/run-1/t02-sparse', 'main');

      expect(existsSync(join(full.path, 'src/b/file0.ts'))).toBe(true);
      expect(existsSync(join(sparse.path, 'src/a/file0.ts'))).toBe(true);
      // Cone mode keeps repo-root files but not the other packages.
      expect(existsSync(join(sparse.path, 'README.md'))).toBe(true);
      expect(existsSync(join(sparse.path, 'src/b'))).toBe(false);
      expect(existsSync(join(sparse.path, 'src/c'))).toBe(false);

      // The sparse worktree is a normal, clean worktree: status sees nothing missing.
      expect((await git(sparse.path, 'status', '--porcelain')).trim()).toBe('');
      await writeFileIn(sparse.path, 'src/a/new.ts', 'export const fresh = 1;\n');
      expect(await ws.commitAll(sparse.path, 'feat: lane work')).toBeDefined();

      const summary = await ws.diff(sparse.path, 'main');
      expect(summary.files).toEqual([{ path: 'src/a/new.ts', added: 1, removed: 0 }]);
      expect(await ws.changedFiles(sparse.path, 'main')).toEqual(['src/a/new.ts']);
    });
  }, 30_000);

  test('a sparse checkout costs less disk than a full one on the same repo', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({
        worktreeRoot,
        sparseCheckout: (branch) => (branch.endsWith('sparse') ? ['src/a'] : undefined),
      });
      const full = await ws.create(repo, 'starling/run-1/t01-full', 'main');
      const sparse = await ws.create(repo, 'starling/run-1/t02-sparse', 'main');

      const fullUsage = await diskUsage(full.path);
      const sparseUsage = await diskUsage(sparse.path);

      expect(sparseUsage.files).toBeLessThan(fullUsage.files);
      expect(fullUsage.files - sparseUsage.files).toBeGreaterThanOrEqual(7); // src/b + src/c
    });
  }, 30_000);

  test('create cleans up after a sparse failure instead of leaving a half-built worktree', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      // `src/*` is rejected by `normalizeSparseDirs` before any worktree is created.
      const bad = createWorkspace({ worktreeRoot, sparseCheckout: () => ['src/*'] });
      await expect(bad.create(repo, 'starling/run-1/t01-bad', 'main')).rejects.toThrow(/cone mode/);
      expect((await git(repo, 'worktree', 'list', '--porcelain')).split('worktree ').length).toBe(2);
    });
  }, 20_000);
});

describe('prune debouncing', () => {
  test('removing many worktrees prunes once per interval, not once per removal', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const pruneCalls: number[] = [];
      const clock = { tick: 0, now: () => clock.tick };
      const { exec: coreExec } = await import('@starling/core');
      const counting = (async (cmd: string[], opts: { cwd: string }) => {
        if (cmd.includes('worktree') && cmd.includes('prune')) pruneCalls.push(clock.now());
        return coreExec(cmd, opts);
      }) as typeof coreExec;

      const ws = createWorkspace({ worktreeRoot, exec: counting, clock, pruneIntervalMs: 60_000 });
      const created: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        created.push((await ws.create(repo, `starling/run-1/t0${index}`, 'main')).path);
      }

      for (const path of created) {
        clock.tick += 1000;
        await ws.remove(path);
      }

      expect(pruneCalls).toHaveLength(1);

      // Past the interval, the next removal prunes again.
      clock.tick += 61_000;
      const last = await ws.create(repo, 'starling/run-1/t99', 'main');
      clock.tick += 1000;
      await ws.remove(last.path);
      expect(pruneCalls).toHaveLength(2);
    });
  }, 30_000);

  test('pruneIntervalMs 0 prunes after every removal', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      let prunes = 0;
      const { exec: coreExec } = await import('@starling/core');
      const counting = (async (cmd: string[], opts: { cwd: string }) => {
        if (cmd.includes('worktree') && cmd.includes('prune')) prunes += 1;
        return coreExec(cmd, opts);
      }) as typeof coreExec;

      const ws = createWorkspace({ worktreeRoot, exec: counting, pruneIntervalMs: 0 });
      for (let index = 0; index < 3; index += 1) {
        const { path } = await ws.create(repo, `starling/run-1/t0${index}`, 'main');
        await ws.remove(path);
      }

      expect(prunes).toBe(3);
    });
  }, 30_000);
});

describe('diskUsage', () => {
  test('counts files and bytes without following symlinks', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const { path } = await createWorkspace({ worktreeRoot }).create(repo, 'starling/run-1/t01', 'main');
      const usage = await diskUsage(path);

      expect(usage.path).toBe(normalizeKey(path));
      expect(usage.files).toBeGreaterThan(10);
      expect(usage.bytes).toBeGreaterThan(0);
      expect(usage.dirs).toBeGreaterThan(1);
    });
  }, 20_000);

  test('a missing directory reads as empty', async () => {
    const root = await makeTempDir('starling-disk-');
    try {
      const usage = await diskUsage(join(root, 'nope'));
      expect(usage).toEqual({ path: join(root, 'nope'), bytes: 0, files: 0, dirs: 0, symlinks: 0 });
    } finally {
      await removeDirs(root);
    }
  });
});
