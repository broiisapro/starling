import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeClock, isStarlingError } from '@starling/core';
import { commitFile, git, initRepo, makeTempDir, removeDirs, writeFileIn } from './testing/temp-repo.ts';
import { createWorkspace, type WorkspaceWithBundles } from './workspace.ts';

interface BundleFixture {
  root: string;
  hub: string;
  ws: WorkspaceWithBundles;
}

async function withBundleFixture<T>(fn: (ctx: BundleFixture) => Promise<T>): Promise<T> {
  const root = await makeTempDir('starling-ws-bundle-');
  try {
    const hub = await initRepo(join(root, 'hub'));
    const ws = createWorkspace({ worktreeRoot: join(root, 'worktrees'), clock: new FakeClock(1_700_000) });
    return await fn({ root, hub, ws });
  } finally {
    await removeDirs(root);
  }
}

/** A clone pretending to be a perch: its own identity, no shared config with the hub. */
async function clonePerch(ws: WorkspaceWithBundles, bundle: string, dest: string) {
  const cloned = await ws.cloneFromBundle(bundle, dest, 'refs/heads/main');
  await git(dest, 'config', 'user.name', 'Perch Agent');
  await git(dest, 'config', 'user.email', 'perch@starling.local');
  return cloned;
}

describe('bundle round trip', () => {
  test('hub → perch → commit → thin bundle → fetch back → diff matches', async () => {
    await withBundleFixture(async ({ root, hub, ws }) => {
      const outbound = await ws.createBundle(hub, 'refs/heads/main');
      expect(existsSync(outbound)).toBe(true);
      expect(outbound).toContain(join('bundles', 'main-1700000-'));

      const perchDir = join(root, 'perch', 'work');
      const cloned = await clonePerch(ws, outbound, perchDir);
      expect(cloned).toEqual({ path: perchDir, branch: 'main' });
      expect((await git(perchDir, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe('main');

      // The perch does a task on its own branch and sends the range back.
      await git(perchDir, 'checkout', '-q', '-b', 'feature/from-perch');
      const perchSha = await commitFile(perchDir, 'feature.txt', 'from perch\n', 'perch work');
      const inbound = await ws.createBundle(perchDir, 'refs/heads/feature/from-perch', {
        base: 'refs/heads/main',
      });

      await ws.fetchBundle(hub, inbound, 'refs/heads/feature/from-perch', 'feature/from-perch');

      expect((await git(hub, 'rev-parse', 'feature/from-perch')).trim()).toBe(perchSha);
      expect((await git(hub, 'show', 'feature/from-perch:feature.txt')).trim()).toBe('from perch');

      // The hub can now audit the branch exactly as the perch saw it.
      const worktree = await ws.create(hub, 'feature/from-perch', 'feature/from-perch');
      const summary = await ws.diff(worktree.path, 'main');
      expect(summary.files).toEqual([{ path: 'feature.txt', added: 1, removed: 0 }]);
      expect(summary.patch).toContain('+from perch');
    });
  }, 20_000);
});

describe('createBundle', () => {
  test('writes to an explicit outPath', async () => {
    await withBundleFixture(async ({ root, hub, ws }) => {
      const outPath = join(root, 'exports', 'main.bundle');
      const written = await ws.createBundle(hub, 'refs/heads/main', { outPath });

      expect(written).toBe(outPath);
      expect(existsSync(outPath)).toBe(true);
      expect((await git(hub, 'bundle', 'verify', outPath)).length).toBeGreaterThan(0);
    });
  });

  test('rejects an unknown ref or base with INVALID_ARGUMENT', async () => {
    await withBundleFixture(async ({ hub, ws }) => {
      try {
        await ws.createBundle(hub, 'refs/heads/missing');
        throw new Error('expected a throw');
      } catch (err) {
        expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
      }

      try {
        await ws.createBundle(hub, 'refs/heads/main', { base: 'refs/heads/missing' });
        throw new Error('expected a throw');
      } catch (err) {
        expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
      }
    });
  });
});

describe('cloneFromBundle', () => {
  test('refuses a non-empty destination', async () => {
    await withBundleFixture(async ({ root, hub, ws }) => {
      const bundle = await ws.createBundle(hub, 'refs/heads/main');
      const dest = join(root, 'occupied');
      await mkdir(dest, { recursive: true });
      await writeFileIn(dest, 'existing.txt', 'hands off\n');

      try {
        await ws.cloneFromBundle(bundle, dest, 'refs/heads/main');
        throw new Error('expected a throw');
      } catch (err) {
        expect(isStarlingError(err, 'WORKSPACE_ERROR')).toBe(true);
        expect((err as Error).message).toContain('not empty');
      }
    });
  });

  test('rejects a missing bundle file', async () => {
    await withBundleFixture(async ({ root, ws }) => {
      await expect(
        ws.cloneFromBundle(join(root, 'nope.bundle'), join(root, 'dest'), 'refs/heads/main'),
      ).rejects.toThrow();
    });
  });

  test('checks out a named branch from the bundle', async () => {
    await withBundleFixture(async ({ root, hub, ws }) => {
      await git(hub, 'checkout', '-q', '-b', 'feature/named');
      await commitFile(hub, 'named.txt', 'named\n', 'named branch');
      const bundle = await ws.createBundle(hub, 'refs/heads/feature/named');
      await git(hub, 'checkout', '-q', 'main');

      const cloned = await ws.cloneFromBundle(bundle, join(root, 'elsewhere'), 'refs/heads/feature/named');

      expect(cloned.branch).toBe('feature/named');
      expect((await git(cloned.path, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe('feature/named');
      expect((await git(cloned.path, 'rev-parse', 'HEAD')).trim()).toBe(
        (await git(hub, 'rev-parse', 'refs/heads/feature/named')).trim(),
      );
    });
  });
});

describe('fetchBundle', () => {
  test('forces an update when the branch already exists in the hub', async () => {
    await withBundleFixture(async ({ root, hub, ws }) => {
      const first = await ws.createBundle(hub, 'refs/heads/main');
      const perchDir = join(root, 'perch');
      await clonePerch(ws, first, perchDir);
      await git(perchDir, 'checkout', '-q', '-b', 'feature/long-lived');

      const firstSha = await commitFile(perchDir, 'one.txt', 'one\n', 'first');
      const firstBundle = await ws.createBundle(perchDir, 'refs/heads/feature/long-lived', {
        base: 'refs/heads/main',
      });
      await ws.fetchBundle(hub, firstBundle, 'refs/heads/feature/long-lived', 'feature/long-lived');
      expect((await git(hub, 'rev-parse', 'feature/long-lived')).trim()).toBe(firstSha);

      const secondSha = await commitFile(perchDir, 'two.txt', 'two\n', 'second');
      const secondBundle = await ws.createBundle(perchDir, 'refs/heads/feature/long-lived', {
        base: 'refs/heads/main',
      });
      await ws.fetchBundle(hub, secondBundle, 'refs/heads/feature/long-lived', 'feature/long-lived');

      expect((await git(hub, 'rev-parse', 'feature/long-lived')).trim()).toBe(secondSha);
      expect((await git(hub, 'show', 'feature/long-lived:two.txt')).trim()).toBe('two');
    });
  }, 20_000);

  test('updates a branch that is checked out in a hub worktree', async () => {
    await withBundleFixture(async ({ root, hub, ws }) => {
      // The hub has the branch checked out for an audit.
      await ws.ensureIntegrationBranch(hub, 'main', 'target');
      const worktree = await ws.create(hub, 'target', 'target');

      // A perch produces a newer commit on that branch.
      const emptyBundle = await ws.createBundle(hub, 'refs/heads/main');
      const perchDir = join(root, 'perch-checked-out');
      await clonePerch(ws, emptyBundle, perchDir);
      await git(perchDir, 'checkout', '-q', '-B', 'target', 'main');
      const sha = await commitFile(perchDir, 'target.txt', 'target work\n', 'target work');
      const bundle = await ws.createBundle(perchDir, 'refs/heads/target', { base: 'refs/heads/main' });

      await ws.fetchBundle(hub, bundle, 'refs/heads/target', 'target');

      expect((await git(hub, 'rev-parse', 'target')).trim()).toBe(sha);
      expect((await git(hub, 'show', 'target:target.txt')).trim()).toBe('target work');
      // The temp ref used by the checked-out fallback is gone.
      const tempRefs = (await git(hub, 'for-each-ref', 'refs/starling/tmp')).trim();
      expect(tempRefs).toBe('');
      expect(existsSync(worktree.path)).toBe(true);
    });
  }, 20_000);

  test('rejects a missing bundle file', async () => {
    await withBundleFixture(async ({ root, hub, ws }) => {
      await expect(
        ws.fetchBundle(hub, join(root, 'ghost.bundle'), 'refs/heads/main', 'main'),
      ).rejects.toThrow();
    });
  });
});
