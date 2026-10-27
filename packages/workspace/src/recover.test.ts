/**
 * Crash recovery (`recoverWorkspace`, the future `starling gc`).
 *
 * Age is driven by a `FakeClock` far in the future, so "older than 12 hours" is deterministic while
 * every other signal (reflog entries, mtimes) is real.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeClock } from '@starling/core';
import { DEFAULT_OLDER_THAN_HOURS, isIntegrationBranch, recoverWorkspace, runIdOf } from './recover.ts';
import { normalizeKey } from './repo.ts';
import { commitFile, git, initRepo, makeTempDir, removeDirs } from './testing/temp-repo.ts';
import { createWorkspace } from './workspace.ts';

const HOUR = 3_600_000;

interface Fixture {
  root: string;
  repo: string;
  worktreeRoot: string;
}

async function withRepo<T>(fn: (ctx: Fixture) => Promise<T>): Promise<T> {
  const root = await makeTempDir('starling-gc-');
  try {
    const repo = await initRepo(join(root, 'repo'));
    const worktrees = join(root, 'worktrees');
    // Create before canonicalising: on macOS /var is a symlink to /private/var, and a path that does
    // not exist yet cannot be resolved, which would make the report's spelling differ from git's.
    await mkdir(worktrees, { recursive: true });
    const worktreeRoot = normalizeKey(worktrees);
    return await fn({ root, repo, worktreeRoot });
  } finally {
    await removeDirs(root);
  }
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
  return (await git(repo, 'branch', '--list', branch)).trim() !== '';
}

describe('runIdOf / isIntegrationBranch', () => {
  test('reads the run segment out of a Starling branch', () => {
    expect(runIdOf('starling/01abc/t03-csv')).toBe('01abc');
    expect(runIdOf('starling/01abc/integration')).toBe('01abc');
    expect(runIdOf('starling/01abc')).toBe('01abc');
    expect(runIdOf('feature/x')).toBeUndefined();
    expect(runIdOf('starling/')).toBeUndefined();
  });

  test('recognises the protected integration branch', () => {
    expect(isIntegrationBranch('starling/01abc/integration')).toBe(true);
    expect(isIntegrationBranch('starling/01abc/t01-integration')).toBe(false);
    expect(isIntegrationBranch('other/01abc/integration')).toBe(false);
  });

  test('the default age window is a fixed, documented value', () => {
    expect(DEFAULT_OLDER_THAN_HOURS).toBe(12);
  });
});

describe('dry run', () => {
  test('reports dead worktrees and branches without touching anything', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      const dead = await ws.create(repo, 'starling/runA/t01-api', 'main');
      await ws.create(repo, 'starling/runA/t02-cli', 'main');

      const clock = new FakeClock(Date.now() + 48 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { dryRun: true, clock });

      expect(report.dryRun).toBe(true);
      expect(report.entries.map((entry) => entry.branch).sort()).toEqual([
        'starling/runA/t01-api',
        'starling/runA/t02-cli',
      ]);
      expect(report.entries.every((entry) => entry.kind === 'worktree')).toBe(true);
      expect(report.entries.every((entry) => entry.reason === 'dead-run')).toBe(true);
      expect(report.entries.every((entry) => entry.actions.includes('remove-worktree'))).toBe(true);
      expect(report.entries.every((entry) => entry.actions.includes('delete-branch'))).toBe(true);

      // Nothing changed.
      expect(existsSync(dead.path)).toBe(true);
      expect(await branchExists(repo, 'starling/runA/t01-api')).toBe(true);
      expect(report.removed.worktrees).toEqual([]);
      expect(report.removed.branches).toEqual([]);
    });
  }, 30_000);
});

describe('collecting dead runs', () => {
  test('removes the worktrees, deletes the branches and leaves only the main checkout', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      const first = await ws.create(repo, 'starling/runA/t01-api', 'main');
      const second = await ws.create(repo, 'starling/runA/t02-cli', 'main');
      await commitFile(first.path, 'api.ts', 'export const api = 1;\n', 'api work');
      await branchExists(repo, 'starling/runA/t01-api');

      const clock = new FakeClock(Date.now() + 40 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock });

      expect(report.errors).toEqual([]);
      expect(report.removed.worktrees.sort()).toEqual([first.path, second.path].sort());
      expect(report.removed.branches.sort()).toEqual(
        ['starling/runA/t01-api', 'starling/runA/t02-cli'].sort(),
      );
      expect(existsSync(first.path)).toBe(false);
      expect(existsSync(second.path)).toBe(false);
      expect(await branchExists(repo, 'starling/runA/t01-api')).toBe(false);
      expect(await branchExists(repo, 'starling/runA/t02-cli')).toBe(false);
      expect((await git(repo, 'worktree', 'list', '--porcelain')).split('worktree ').length).toBe(2);
    });
  }, 30_000);

  test('keeps a run whose id is live', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      const live = await ws.create(repo, 'starling/liveRun/t01-api', 'main');
      const dead = await ws.create(repo, 'starling/deadRun/t01-api', 'main');

      const clock = new FakeClock(Date.now() + 48 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, {
        clock,
        liveRunIds: ['liveRun'],
      });

      expect(report.kept.live).toContain('starling/liveRun/t01-api');
      expect(existsSync(live.path)).toBe(true);
      expect(await branchExists(repo, 'starling/liveRun/t01-api')).toBe(true);
      expect(report.removed.worktrees).toEqual([dead.path]);
    });
  }, 30_000);

  test('keeps worktrees younger than the window', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      const fresh = await ws.create(repo, 'starling/runA/t01-api', 'main');

      const report = await recoverWorkspace(repo, worktreeRoot, { olderThanHours: 12 });

      expect(report.kept.young).toContain('starling/runA/t01-api');
      expect(report.entries).toEqual([]);
      expect(existsSync(fresh.path)).toBe(true);
      expect(await branchExists(repo, 'starling/runA/t01-api')).toBe(true);
    });
  }, 30_000);

  test('a newer commit inside an old worktree keeps it alive', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      const active = await ws.create(repo, 'starling/runA/t01-api', 'main');
      // The clock says "two days later", but the worktree was touched just now.
      const clock = new FakeClock(Date.now() + 48 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock, olderThanHours: 72 });

      expect(report.kept.young).toContain('starling/runA/t01-api');
      expect(existsSync(active.path)).toBe(true);
    });
  }, 30_000);

  test('olderThanHours 0 collects everything, including the run just started', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      const { path } = await ws.create(repo, 'starling/runA/t01-api', 'main');

      const report = await recoverWorkspace(repo, worktreeRoot, { olderThanHours: 0 });

      expect(report.removed.worktrees).toEqual([path]);
      expect(await branchExists(repo, 'starling/runA/t01-api')).toBe(false);
    });
  }, 30_000);

  test('rejects a negative window instead of guessing', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      await expect(recoverWorkspace(repo, worktreeRoot, { olderThanHours: -1 })).rejects.toThrow(
        /olderThanHours/,
      );
    });
  }, 20_000);
});

describe('integration branches', () => {
  test('are protected by default, even for a dead run', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      await ws.ensureIntegrationBranch(repo, 'main', 'starling/runA/integration');
      const integration = await ws.create(repo, 'starling/runA/integration', 'starling/runA/integration');

      const clock = new FakeClock(Date.now() + 96 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock });

      expect(report.kept.protected).toContain('starling/runA/integration');
      expect(existsSync(integration.path)).toBe(true);
      expect(await branchExists(repo, 'starling/runA/integration')).toBe(true);
    });
  }, 30_000);

  test('includeIntegration collects them when the operator asks', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      await ws.ensureIntegrationBranch(repo, 'main', 'starling/runA/integration');
      const integration = await ws.create(repo, 'starling/runA/integration', 'starling/runA/integration');

      const clock = new FakeClock(Date.now() + 96 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock, includeIntegration: true });

      expect(report.removed.worktrees).toEqual([integration.path]);
      expect(await branchExists(repo, 'starling/runA/integration')).toBe(false);
    });
  }, 30_000);
});

describe('orphans that are not worktrees', () => {
  test('a leftover Starling branch with no worktree is collected after the window', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      await git(repo, 'branch', 'starling/runA/t09-cleanup');

      const clock = new FakeClock(Date.now() + 48 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock });

      expect(report.entries).toEqual([
        {
          kind: 'branch',
          reason: 'orphan-branch',
          branch: 'starling/runA/t09-cleanup',
          runId: 'runA',
          lastActivityTs: expect.any(Number),
          ageHours: expect.any(Number),
          actions: ['delete-branch'],
        },
      ]);
      expect(await branchExists(repo, 'starling/runA/t09-cleanup')).toBe(false);
    });
  }, 30_000);

  test('branches outside the Starling namespace are never touched', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      await git(repo, 'branch', 'feature/mine');

      const clock = new FakeClock(Date.now() + 96 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock, olderThanHours: 0 });

      expect(report.entries).toEqual([]);
      expect(await branchExists(repo, 'feature/mine')).toBe(true);
    });
  }, 30_000);

  test('removes an unregistered directory whose .git points into this repo', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      const { path } = await ws.create(repo, 'starling/runA/t01-api', 'main');

      // Simulate an interrupted `worktree add`: the registration is gone, the directory is not.
      const adminRoot = join(repo, '.git', 'worktrees');
      for (const name of readdirSync(adminRoot)) {
        const gitdirFile = join(adminRoot, name, 'gitdir');
        const pointer = readdirSync(join(adminRoot, name)).includes('gitdir')
          ? (await Bun.file(gitdirFile).text()).trim()
          : '';
        if (pointer === join(path, '.git')) {
          await removeDirs(join(adminRoot, name));
        }
      }
      await git(repo, 'branch', '-D', 'starling/runA/t01-api');
      expect((await git(repo, 'worktree', 'list', '--porcelain')).includes(path)).toBe(false);
      expect(existsSync(path)).toBe(true);

      const clock = new FakeClock(Date.now() + 48 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock });

      expect(report.entries).toHaveLength(1);
      expect(report.entries[0]?.kind).toBe('directory');
      expect(report.entries[0]?.reason).toBe('unregistered-directory');
      expect(report.removed.directories).toEqual([path]);
      expect(existsSync(path)).toBe(false);
    });
  }, 30_000);

  test('a directory that is not ours is left alone', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      await mkdir(join(worktreeRoot, 'someone-elses-dir'), { recursive: true });
      await writeFile(join(worktreeRoot, 'someone-elses-dir', 'notes.txt'), 'hi\n');

      const clock = new FakeClock(Date.now() + 96 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock, olderThanHours: 0 });

      expect(report.entries).toEqual([]);
      expect(report.kept.foreign).toContain(join(worktreeRoot, 'someone-elses-dir'));
      expect(existsSync(join(worktreeRoot, 'someone-elses-dir', 'notes.txt'))).toBe(true);
    });
  }, 30_000);

  test('a worktree outside the root is never collected', async () => {
    await withRepo(async ({ root, repo, worktreeRoot }) => {
      const outside = join(root, 'elsewhere');
      await git(repo, 'worktree', 'add', '-q', outside, '-b', 'starling/runA/t-out');

      const clock = new FakeClock(Date.now() + 96 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock, olderThanHours: 0 });

      expect(report.entries).toEqual([]);
      expect(report.kept.foreign).toContain('starling/runA/t-out');
      expect(existsSync(outside)).toBe(true);
    });
  }, 30_000);

  test('bundle files under the worktree root are not treated as worktrees', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      const { path } = await ws.create(repo, 'starling/runA/t01-api', 'main');
      await commitFile(path, 'api.ts', 'export const api = 1;\n', 'api');
      const bundle = await ws.createBundle(repo, 'starling/runA/t01-api');

      const clock = new FakeClock(Date.now() + 96 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock, olderThanHours: 0 });

      expect(report.entries.some((entry) => entry.path?.endsWith('.bundle'))).toBe(false);
      expect(existsSync(bundle)).toBe(true);
    });
  }, 30_000);
});

describe('stale registrations', () => {
  test('prunes a registration whose directory vanished, without failing the run', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      const { path } = await ws.create(repo, 'starling/runA/t01-api', 'main');
      await removeDirs(path);

      const clock = new FakeClock(Date.now() + 48 * HOUR);
      const report = await recoverWorkspace(repo, worktreeRoot, { clock });

      expect(report.errors).toEqual([]);
      expect(report.entries).toHaveLength(1);
      expect(report.entries[0]?.reason).toBe('missing-directory');
      expect(report.entries[0]?.actions).toContain('prune-registration');
      expect(report.removed.registrations).toBe(1);
      expect(await branchExists(repo, 'starling/runA/t01-api')).toBe(false);
      expect((await git(repo, 'worktree', 'list', '--porcelain')).split('worktree ').length).toBe(2);
    });
  }, 30_000);
});

describe('report shape', () => {
  test('is JSON-serialisable and carries the scan counts', async () => {
    await withRepo(async ({ repo, worktreeRoot }) => {
      const ws = createWorkspace({ worktreeRoot });
      await ws.create(repo, 'starling/runA/t01-api', 'main');
      await git(repo, 'branch', 'starling/runA/t09-orphan');

      const report = await recoverWorkspace(repo, worktreeRoot, {
        dryRun: true,
        clock: new FakeClock(Date.now() + 48 * HOUR),
      });

      expect(report.scanned.worktrees).toBe(2);
      expect(report.scanned.branches).toBe(2);
      expect(report.cutoffTs).toBeLessThan(report.repo ? Number.POSITIVE_INFINITY : 0);
      expect(JSON.parse(JSON.stringify(report))).toEqual(report);
      expect(report.worktreeRoot).toBe(worktreeRoot);
      expect(report.repo).toBe(normalizeKey(repo));
    });
  }, 30_000);
});
