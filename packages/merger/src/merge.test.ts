import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { FakeClock, isStarlingError } from '@starling/core';
import { createMerger, type MergerService } from './index.ts';
import {
  cleanupTempDirs,
  commitOnCurrent,
  createBranch,
  createIntegrationBranch,
  git,
  gitResult,
  hasFile,
  makeRepo,
  makeTask,
  rev,
  writeFiles,
} from './test-helpers.ts';

const INTEGRATION = 'starling/run1/integration';
const TASK = 'starling/run1/theme';

afterAll(cleanupTempDirs);

function mergerFor(worktreeRoot: string, testTimeoutMs?: number): MergerService {
  return createMerger({ worktreeRoot, clock: new FakeClock(1_000), testTimeoutMs });
}

describe('merge: clean merges', () => {
  test('merges a task branch into the integration branch and reports the merge commit', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'src/theme.ts': 'export const theme = "dark";\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    const result = await merger.merge(repo, INTEGRATION, makeTask(TASK), {});

    expect(result.status).toBe('merged');
    expect(result.taskKey).toBe('theme');
    expect(result.conflictedFiles).toEqual([]);
    expect(result.commit).toBe(await rev(repo, INTEGRATION));
    expect(await hasFile(repo, INTEGRATION, 'src/theme.ts')).toBe(true);
    expect(result.ts).toBe(1_000);
    expect(result.detail).toContain('Merged');
    await merger.dispose();
  });

  test('creates a --no-ff merge commit whose message uses the task title', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    await merger.merge(repo, INTEGRATION, makeTask(TASK), { title: 'Dark mode with a toggle' });

    expect(await git(repo, ['log', '-1', '--format=%s', INTEGRATION])).toBe(
      'merge(theme): Dark mode with a toggle',
    );
    const parents = (await git(repo, ['rev-list', '--parents', '-n', '1', INTEGRATION])).split(' ');
    expect(parents).toHaveLength(3);
    await merger.dispose();
  });

  test('falls back to the branch name when no title is given', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    await merger.merge(repo, INTEGRATION, makeTask(TASK), {});

    expect(await git(repo, ['log', '-1', '--format=%s', INTEGRATION])).toBe(`merge(theme): ${TASK}`);
    await merger.dispose();
  });

  test('skips a branch that is already an ancestor of the integration branch', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    const first = await merger.merge(repo, INTEGRATION, makeTask(TASK), {});
    const second = await merger.merge(repo, INTEGRATION, makeTask(TASK), {});
    const head = await rev(repo, INTEGRATION);

    expect(first.status).toBe('merged');
    expect(second.status).toBe('skipped');
    expect(second.commit).toBeUndefined();
    expect(second.detail).toContain('already merged');
    expect(head).toBe(first.commit ?? '');
    await merger.dispose();
  });
});

describe('merge: conflicts', () => {
  test('aborts on conflict, reports the files and leaves the integration branch untouched', async () => {
    const { repo, worktreeRoot } = await makeRepo({ 'app.txt': 'base\n' });
    await createBranch(repo, TASK, { 'app.txt': 'task\n' });
    await commitOnCurrent(repo, { 'app.txt': 'main\n' }, 'main edit');
    await createIntegrationBranch(repo, INTEGRATION);
    const before = await rev(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    const result = await merger.merge(repo, INTEGRATION, makeTask(TASK), {});

    expect(result.status).toBe('conflict');
    expect(result.conflictedFiles).toEqual(['app.txt']);
    expect(result.commit).toBeUndefined();
    expect(await rev(repo, INTEGRATION)).toBe(before);
    expect(result.detail).toContain('aborted');

    const worktree = merger.integrationWorktreePath(INTEGRATION);
    expect(await git(worktree, ['status', '--porcelain'])).toBe('');
    expect((await gitResult(worktree, ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD'])).code).not.toBe(0);
    await merger.dispose();
  });

  test('a conflict does not stop the next clean branch from merging', async () => {
    const { repo, worktreeRoot } = await makeRepo({ 'app.txt': 'base\n' });
    await createBranch(repo, TASK, { 'app.txt': 'task\n' });
    await createBranch(repo, 'starling/run1/docs', { 'docs.md': 'docs\n' });
    await commitOnCurrent(repo, { 'app.txt': 'main\n' }, 'main edit');
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    const conflict = await merger.merge(repo, INTEGRATION, makeTask(TASK), {});
    const clean = await merger.merge(repo, INTEGRATION, makeTask('starling/run1/docs', 'docs'), {});

    expect(conflict.status).toBe('conflict');
    expect(clean.status).toBe('merged');
    expect(await hasFile(repo, INTEGRATION, 'docs.md')).toBe(true);
    expect(await hasFile(repo, INTEGRATION, 'app.txt')).toBe(true);
    expect(await git(repo, ['log', '-1', '--format=%s', INTEGRATION])).toBe(
      'merge(docs): starling/run1/docs',
    );
    await merger.dispose();
  });
});

describe('merge: the test gate', () => {
  test('keeps the merge when the regression suite is green', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'ok.txt': 'ok\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    const result = await merger.merge(repo, INTEGRATION, makeTask(TASK), { testCommand: 'test -f ok.txt' });

    expect(result.status).toBe('merged');
    expect(result.detail).toContain('tests passed');
    expect(await hasFile(repo, INTEGRATION, 'ok.txt')).toBe(true);
    await merger.dispose();
  });

  test('rolls the integration branch back when the suite fails, keeping the output tail', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { BROKEN: 'oops\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const before = await rev(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    const result = await merger.merge(repo, INTEGRATION, makeTask(TASK), {
      testCommand: 'test ! -f BROKEN',
    });

    expect(result.status).toBe('tests-failed');
    expect(result.commit).toBeDefined();
    expect(result.detail).toContain('tests failed');
    expect(result.detail).toContain('Rolled');
    expect(await rev(repo, INTEGRATION)).toBe(before);
    expect(await hasFile(repo, INTEGRATION, 'BROKEN')).toBe(false);
    expect(await git(merger.integrationWorktreePath(INTEGRATION), ['status', '--porcelain'])).toBe('');
    await merger.dispose();
  });

  test('includes the failing command output in the detail', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    const result = await merger.merge(repo, INTEGRATION, makeTask(TASK), {
      testCommand: 'echo "assertion boom" >&2; exit 7',
    });

    expect(result.status).toBe('tests-failed');
    expect(result.detail).toContain('exit 7');
    expect(result.detail).toContain('assertion boom');
    await merger.dispose();
  });

  test('treats a suite that exceeds testTimeoutMs as failed and rolls back', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const before = await rev(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot, 150);

    const result = await merger.merge(repo, INTEGRATION, makeTask(TASK), { testCommand: 'sleep 5' });

    expect(result.status).toBe('tests-failed');
    expect(result.detail).toContain('timed out');
    expect(await rev(repo, INTEGRATION)).toBe(before);
    await merger.dispose();
  });

  test('refuses to roll back when HEAD is no longer the merge commit we created', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    // The test command moves HEAD and then fails: rolling back with HEAD~1 would drop the drift
    // commit, so the merger must refuse instead of silently deleting it.
    const failure = merger.merge(repo, INTEGRATION, makeTask(TASK), {
      testCommand: 'git commit --allow-empty --quiet -m drift; false',
    });

    await expect(failure).rejects.toMatchObject({ code: 'MERGE_ERROR' });
    await merger.dispose();
  });
});

describe('merge: validation and worktree lifecycle', () => {
  test('rejects a task without a branch', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    const failure = merger.merge(repo, INTEGRATION, makeTask(undefined), {});
    await expect(failure).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await merger.dispose();
  });

  test('rejects a missing task branch with a MERGE_ERROR', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    try {
      await merger.merge(repo, INTEGRATION, makeTask('starling/run1/ghost'), {});
      throw new Error('expected merge to fail');
    } catch (err) {
      expect(isStarlingError(err, 'MERGE_ERROR')).toBe(true);
      expect(String(err)).toContain('starling/run1/ghost');
    }
    await merger.dispose();
  });

  test('rejects a missing integration branch with a MERGE_ERROR', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    const merger = mergerFor(worktreeRoot);

    const failure = merger.merge(repo, INTEGRATION, makeTask(TASK), {});
    await expect(failure).rejects.toMatchObject({ code: 'MERGE_ERROR' });
    await merger.dispose();
  });

  test('reuses one integration worktree for every merge on the branch', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createBranch(repo, 'starling/run1/docs', { 'docs.md': 'd\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);
    const path = merger.integrationWorktreePath(INTEGRATION);

    expect((await git(repo, ['worktree', 'list'])).split('\n')).toHaveLength(1);
    await merger.merge(repo, INTEGRATION, makeTask(TASK), {});
    const afterFirst = await git(repo, ['worktree', 'list', '--porcelain']);
    await merger.merge(repo, INTEGRATION, makeTask('starling/run1/docs', 'docs'), {});
    const afterSecond = await git(repo, ['worktree', 'list', '--porcelain']);

    expect(afterFirst).toContain(`worktree ${path}`);
    expect(
      afterSecond.match(new RegExp(`worktree ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')),
    ).toHaveLength(1);
    expect((await git(repo, ['worktree', 'list'])).split('\n')).toHaveLength(2);
    await merger.dispose();
  });

  test('recovers a dirty integration worktree left behind by a crashed merge', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createBranch(repo, 'starling/run1/docs', { 'docs.md': 'd\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);

    await merger.merge(repo, INTEGRATION, makeTask(TASK), {});
    const worktree = merger.integrationWorktreePath(INTEGRATION);
    await writeFiles(worktree, { 'scratch.txt': 'left over\n' });
    expect(await git(worktree, ['status', '--porcelain'])).not.toBe('');

    const result = await merger.merge(repo, INTEGRATION, makeTask('starling/run1/docs', 'docs'), {});

    expect(result.status).toBe('merged');
    expect(await git(worktree, ['status', '--porcelain'])).toBe('');
    expect(await hasFile(repo, INTEGRATION, 'scratch.txt')).toBe(false);
    await merger.dispose();
  });

  test('dispose removes the integration worktree', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = mergerFor(worktreeRoot);
    await merger.merge(repo, INTEGRATION, makeTask(TASK), {});
    const worktree = merger.integrationWorktreePath(INTEGRATION);

    await merger.dispose();

    expect(existsSync(worktree)).toBe(false);
    expect((await git(repo, ['worktree', 'list'])).split('\n')).toHaveLength(1);
    expect(await hasFile(repo, INTEGRATION, 'a.txt')).toBe(true);
  });

  test('rejects an empty worktreeRoot at construction', () => {
    expect(() => createMerger({ worktreeRoot: '  ' })).toThrow();
  });
});
