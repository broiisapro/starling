import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec as coreExec, isStarlingError } from '@starling/core';
import { PATCH_LIMIT_BYTES } from './diff.ts';
import { normalizeKey } from './repo.ts';
import { commitFile, git, initRepo, makeTempDir, removeDirs, writeFileIn } from './testing/temp-repo.ts';
import { GIT_TOO_OLD_CODE } from './version.ts';
import { createWorkspace, type WorkspaceWithBundles } from './workspace.ts';

interface Fixture {
  root: string;
  repo: string;
  worktreeRoot: string;
  ws: WorkspaceWithBundles;
}

/** Fresh temp root + repo + workspace for one test; always cleaned up. */
async function withFixture<T>(fn: (ctx: Fixture) => Promise<T>): Promise<T> {
  const root = await makeTempDir('starling-ws-test-');
  try {
    const repo = await initRepo(join(root, 'repo'));
    const worktreeRoot = join(root, 'worktrees');
    const ws = createWorkspace({ worktreeRoot });
    return await fn({ root, repo, worktreeRoot: normalizeKey(worktreeRoot), ws });
  } finally {
    await removeDirs(root);
  }
}

async function worktreeCount(repo: string): Promise<number> {
  const output = await git(repo, 'worktree', 'list', '--porcelain');
  return output.split('\n').filter((line) => line.startsWith('worktree ')).length;
}

describe('worktrees', () => {
  test('create makes a worktree at a sanitised path and checks out a new branch', async () => {
    await withFixture(async ({ repo, worktreeRoot, ws }) => {
      const result = await ws.create(repo, 'starling/run1/t01-api', 'main');

      expect(result.branch).toBe('starling/run1/t01-api');
      expect(result.path).toBe(join(worktreeRoot, 'starling-run1-t01-api'));
      expect(existsSync(join(result.path, 'README.md'))).toBe(true);
      expect((await git(result.path, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe(
        'starling/run1/t01-api',
      );
      expect(await worktreeCount(repo)).toBe(2);
    });
  });

  test('create reuses the existing worktree for the same branch', async () => {
    await withFixture(async ({ repo, ws }) => {
      const first = await ws.create(repo, 'starling/run1/t01-api', 'main');
      const second = await ws.create(repo, 'starling/run1/t01-api', 'main');

      expect(second.path).toBe(first.path);
      expect(await worktreeCount(repo)).toBe(2);
    });
  });

  test('create checks out an existing branch instead of creating it again', async () => {
    await withFixture(async ({ repo, ws }) => {
      const mainSha = (await git(repo, 'rev-parse', 'main')).trim();
      await git(repo, 'branch', 'feature/existing');

      const { path } = await ws.create(repo, 'feature/existing', 'main');

      expect((await git(path, 'rev-parse', 'HEAD')).trim()).toBe(mainSha);
      expect((await git(path, 'rev-parse', '--abbrev-ref', 'HEAD')).trim()).toBe('feature/existing');
    });
  });

  test('20 concurrent create calls all succeed with distinct worktrees', async () => {
    await withFixture(async ({ repo, worktreeRoot, ws }) => {
      const branches = Array.from({ length: 20 }, (_, index) => `starling/run1/t${index}-task`);

      const created = await Promise.all(branches.map((branch) => ws.create(repo, branch, 'main')));

      const paths = new Set(created.map((entry) => entry.path));
      expect(paths.size).toBe(20);
      for (const [index, entry] of created.entries()) {
        expect(entry.path).toBe(join(worktreeRoot, `starling-run1-t${index}-task`));
        expect(existsSync(entry.path)).toBe(true);
      }
      expect(await worktreeCount(repo)).toBe(21);
    });
  }, 30_000);

  test('concurrent ensureIntegrationBranch calls create exactly one branch', async () => {
    await withFixture(async ({ repo, ws }) => {
      await Promise.all(
        Array.from({ length: 10 }, () =>
          ws.ensureIntegrationBranch(repo, 'main', 'starling/run1/integration'),
        ),
      );

      expect((await git(repo, 'rev-parse', 'starling/run1/integration')).trim()).toBe(
        (await git(repo, 'rev-parse', 'main')).trim(),
      );
    });
  });

  test('ensureIntegrationBranch is idempotent and never moves an existing branch', async () => {
    await withFixture(async ({ repo, ws }) => {
      await ws.ensureIntegrationBranch(repo, 'main', 'starling/run1/integration');
      const integration = await ws.create(repo, 'starling/run1/integration', 'starling/run1/integration');
      const firstSha = await commitFile(
        integration.path,
        'only-on-integration.txt',
        'x\n',
        'integration work',
      );

      await ws.ensureIntegrationBranch(repo, 'main', 'starling/run1/integration');

      expect((await git(repo, 'rev-parse', 'starling/run1/integration')).trim()).toBe(firstSha);
    });
  });

  test('ensureIntegrationBranch fails clearly when the base ref does not exist', async () => {
    await withFixture(async ({ repo, ws }) => {
      try {
        await ws.ensureIntegrationBranch(repo, 'nope', 'starling/run1/integration');
        throw new Error('expected a throw');
      } catch (err) {
        expect(isStarlingError(err, 'WORKSPACE_ERROR')).toBe(true);
        expect((err as Error).message).toContain('nope');
      }
    });
  });

  test('remove deletes a dirty worktree and is idempotent', async () => {
    await withFixture(async ({ repo, ws }) => {
      const { path } = await ws.create(repo, 'starling/run1/t01-api', 'main');
      await writeFileIn(path, 'uncommitted.txt', 'work in progress\n');

      await ws.remove(path);
      expect(existsSync(path)).toBe(false);
      expect(await worktreeCount(repo)).toBe(1);

      await ws.remove(path); // second call must not throw
      expect(await worktreeCount(repo)).toBe(1);
    });
  });

  test('rejects a path that is not a git repository', async () => {
    await withFixture(async ({ root, ws }) => {
      const notARepo = join(root, 'plain-dir');
      await mkdir(notARepo, { recursive: true });

      try {
        await ws.create(notARepo, 'x/y', 'main');
        throw new Error('expected a throw');
      } catch (err) {
        expect(isStarlingError(err, 'WORKSPACE_ERROR')).toBe(true);
        expect((err as Error).message).toContain('not a git repository');
      }
    });
  });
});

describe('diff and changed files', () => {
  test('reports committed, staged, unstaged and untracked work and ignores ignored files', async () => {
    await withFixture(async ({ repo, ws }) => {
      await writeFileIn(repo, '.gitignore', 'ignored.txt\n');
      await git(repo, 'add', '-A');
      await git(repo, 'commit', '-qm', 'ignore file');

      const { path } = await ws.create(repo, 'starling/run1/t01-api', 'main');
      await commitFile(path, 'committed.txt', 'committed line\n', 'worker commit');
      await writeFileIn(path, 'staged.txt', 'staged line\n');
      await git(path, 'add', 'staged.txt');
      await writeFileIn(path, 'README.md', '# demo changed\n');
      await writeFileIn(path, 'untracked.txt', 'fresh file\nfresh line\n');
      await writeFileIn(path, 'ignored.txt', 'never counted\n');

      const summary = await ws.diff(path, 'main');
      const changed = await ws.changedFiles(path, 'main');

      expect(new Set(summary.files.map((file) => file.path))).toEqual(
        new Set(['committed.txt', 'staged.txt', 'README.md', 'untracked.txt']),
      );
      expect(changed.sort()).toEqual(['README.md', 'committed.txt', 'staged.txt', 'untracked.txt']);
      expect(summary.truncated).toBe(false);
      expect(summary.patch).toContain('+committed line');
      expect(summary.patch).toContain('+staged line');
      expect(summary.patch).toContain('+# demo changed');
      expect(summary.patch).toContain('+fresh line');
      expect(summary.patch).not.toContain('never counted');

      const untracked = summary.files.find((file) => file.path === 'untracked.txt');
      expect(untracked?.added).toBe(2);
      expect(untracked?.removed).toBe(0);
    });
  });

  test('truncates a patch over 200 KB and says so', async () => {
    await withFixture(async ({ repo, ws }) => {
      const { path } = await ws.create(repo, 'starling/run1/t01-api', 'main');
      await writeFileIn(path, 'huge.log', `${'a'.repeat(400)}\n`.repeat(800)); // ~320 KB

      const summary = await ws.diff(path, 'main');

      expect(summary.truncated).toBe(true);
      expect(Buffer.byteLength(summary.patch, 'utf8')).toBeLessThanOrEqual(PATCH_LIMIT_BYTES);
      expect(summary.files.some((file) => file.path === 'huge.log')).toBe(true);
    });
  });

  test('diff fails clearly for an unknown base ref', async () => {
    await withFixture(async ({ repo, ws }) => {
      const { path } = await ws.create(repo, 'starling/run1/t01-api', 'main');
      await expect(ws.diff(path, 'no-such-branch')).rejects.toThrow();
    });
  });
});

describe('predictConflicts', () => {
  test('returns no conflicts for disjoint branches and reports a conflicting path', async () => {
    await withFixture(async ({ repo, ws }) => {
      await writeFileIn(repo, 'shared.txt', 'one\ntwo\nthree\n');
      await git(repo, 'add', '-A');
      await git(repo, 'commit', '-qm', 'shared file');

      const ours = await ws.create(repo, 'starling/run1/ours', 'main');
      await writeFileIn(ours.path, 'shared.txt', 'ONE\ntwo\nthree\n');
      await commitFile(ours.path, 'ours-only.txt', 'ours\n', 'ours');

      const clean = await ws.create(repo, 'starling/run1/clean', 'main');
      await commitFile(clean.path, 'clean-only.txt', 'clean\n', 'clean');

      const theirs = await ws.create(repo, 'starling/run1/theirs', 'main');
      await writeFileIn(theirs.path, 'shared.txt', 'ONE!\ntwo\nthree\n');
      await commitFile(theirs.path, 'theirs-only.txt', 'theirs\n', 'theirs');

      expect(await ws.predictConflicts(repo, 'starling/run1/ours', 'starling/run1/clean')).toEqual([]);
      expect(await ws.predictConflicts(repo, 'starling/run1/ours', 'starling/run1/theirs')).toEqual([
        'shared.txt',
      ]);
    });
  });

  test('refuses to guess on git older than 2.38', async () => {
    await withFixture(async ({ repo, root }) => {
      const fakeExec = (async (cmd: string[], opts: { cwd: string }) => {
        if (cmd[1] === 'version') {
          return { code: 0, stdout: 'git version 2.30.1\n', stderr: '', durationMs: 1 };
        }
        return coreExec(cmd, opts);
      }) as typeof coreExec;
      const ws = createWorkspace({ worktreeRoot: join(root, 'old-wt'), exec: fakeExec });

      try {
        await ws.predictConflicts(repo, 'main', 'main');
        throw new Error('expected a throw');
      } catch (err) {
        expect(isStarlingError(err) && err.code === GIT_TOO_OLD_CODE).toBe(true);
        expect((err as { details?: { found?: string } }).details?.found).toBe('2.30.1');
      }
    });
  });
});

describe('commitAll', () => {
  test('returns undefined when the worktree is clean', async () => {
    await withFixture(async ({ repo, ws }) => {
      const { path } = await ws.create(repo, 'starling/run1/t01-api', 'main');
      expect(await ws.commitAll(path, 'nothing to do')).toBeUndefined();
    });
  });

  test('stages everything, commits it and returns the sha; a second call is a no-op', async () => {
    await withFixture(async ({ repo, ws }) => {
      const { path } = await ws.create(repo, 'starling/run1/t01-api', 'main');
      await writeFileIn(path, 'src/new.ts', 'export const x = 1;\n');
      await writeFileIn(path, 'notes.txt', 'hello\n');

      const sha = await ws.commitAll(path, 'feat: add sources');

      expect(sha).toBeDefined();
      expect(sha ?? '').toMatch(/^[0-9a-f]{40}$/);
      expect((await git(path, 'rev-parse', 'HEAD')).trim()).toBe(sha ?? 'missing');
      expect((await git(path, 'log', '-1', '--format=%s')).trim()).toBe('feat: add sources');
      expect((await git(path, 'status', '--porcelain')).trim()).toBe('');
      expect(await ws.commitAll(path, 'again')).toBeUndefined();
    });
  });

  test('falls back to the Starling Bot identity without touching global config', async () => {
    await withFixture(async ({ repo, ws }) => {
      await git(repo, 'config', '--local', 'user.name', '');
      await git(repo, 'config', '--local', 'user.email', '');

      const { path } = await ws.create(repo, 'starling/run1/t01-api', 'main');
      await writeFileIn(path, 'file.txt', 'content\n');
      const sha = await ws.commitAll(path, 'chore: commit with fallback');

      expect(sha).toBeDefined();
      expect((await git(path, 'log', '-1', '--format=%an <%ae>')).trim()).toBe(
        'Starling Bot <starling@localhost>',
      );
    });
  });

  test('rejects an empty commit message', async () => {
    await withFixture(async ({ repo, ws }) => {
      const { path } = await ws.create(repo, 'starling/run1/t01-api', 'main');
      await writeFileIn(path, 'file.txt', 'content\n');
      await expect(ws.commitAll(path, '  ')).rejects.toThrow();
    });
  });
});

describe('worktree reuse after a lost directory', () => {
  test('create recovers when a registered worktree directory vanished', async () => {
    await withFixture(async ({ repo, ws }) => {
      const { path } = await ws.create(repo, 'starling/run1/t01-api', 'main');
      await removeDirs(path);

      const again = await ws.create(repo, 'starling/run1/t01-api', 'main');
      expect(again.path).toBe(path);
      expect(existsSync(join(path, 'README.md'))).toBe(true);
      expect(await worktreeCount(repo)).toBe(2);
    });
  });
});

describe('diff shape', () => {
  test('patch is a string and files are plain objects, matching the DiffSummary contract', async () => {
    await withFixture(async ({ repo, ws }) => {
      const { path } = await ws.create(repo, 'starling/run1/t01-api', 'main');
      await commitFile(path, 'a.txt', 'a\n', 'a');
      const summary = await ws.diff(path, 'main');
      const fromDisk = await readFile(join(path, 'a.txt'), 'utf8');

      expect(typeof summary.patch).toBe('string');
      expect(fromDisk).toBe('a\n');
      expect(Object.keys(summary).sort()).toEqual(['files', 'patch', 'truncated']);
      expect(summary.files[0]).toEqual({ path: 'a.txt', added: 1, removed: 0 });
    });
  });
});
