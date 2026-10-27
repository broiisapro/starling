import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { FakeClock } from '@starling/core';
import { createMerger, parseMergeTree } from './index.ts';
import {
  cleanupTempDirs,
  commitOnCurrent,
  createBranch,
  createIntegrationBranch,
  makeRepo,
  makeTask,
  rev,
} from './test-helpers.ts';

const INTEGRATION = 'starling/run1/integration';
const TASK = 'starling/run1/theme';

afterAll(cleanupTempDirs);

describe('parseMergeTree', () => {
  test('a clean merge prints only the result tree oid', () => {
    expect(parseMergeTree('7ecfe13be81080f4f4e9b520e79344e1f0b627de\n')).toEqual({
      tree: '7ecfe13be81080f4f4e9b520e79344e1f0b627de',
      conflictedFiles: [],
      messages: '',
    });
  });

  test('conflicted paths appear before the blank line and messages after it', () => {
    const parsed = parseMergeTree(
      [
        'a872a07acf9f6d6d9511fa8668a97f62f93a6d21',
        'src/a.ts',
        'src/b c.ts',
        '',
        'Auto-merging src/a.ts',
        'CONFLICT (content): Merge conflict in src/a.ts',
        '',
      ].join('\n'),
    );

    expect(parsed.tree).toBe('a872a07acf9f6d6d9511fa8668a97f62f93a6d21');
    expect(parsed.conflictedFiles).toEqual(['src/a.ts', 'src/b c.ts']);
    expect(parsed.messages).toContain('CONFLICT (content)');
  });

  test('an empty output has no tree and no conflicts', () => {
    expect(parseMergeTree('')).toEqual({ tree: undefined, conflictedFiles: [], messages: '' });
  });
});

describe('preflight', () => {
  test('predicts a clean merge and the real merge then succeeds', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'theme.ts': 'export {};\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = createMerger({ worktreeRoot, clock: new FakeClock(3_000) });

    const prediction = await merger.preflight(repo, INTEGRATION, TASK);

    expect(prediction.clean).toBe(true);
    expect(prediction.conflictedFiles).toEqual([]);
    expect(prediction.alreadyMerged).toBe(false);
    expect(prediction.repo).toBe(repo);
    expect(prediction.detail).toContain('no conflicts');

    const result = await merger.merge(repo, INTEGRATION, makeTask(TASK), {});
    expect(result.status).toBe('merged');
    await merger.dispose();
  });

  test('predicts the same conflicted files the real merge reports', async () => {
    const { repo, worktreeRoot } = await makeRepo({ 'app.txt': 'base\n' });
    await createBranch(repo, TASK, { 'app.txt': 'task\n' });
    await commitOnCurrent(repo, { 'app.txt': 'main\n' }, 'main edit');
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = createMerger({ worktreeRoot, clock: new FakeClock(3_000) });

    const prediction = await merger.preflight(repo, INTEGRATION, TASK);
    const result = await merger.merge(repo, INTEGRATION, makeTask(TASK), {});

    expect(prediction.clean).toBe(false);
    expect(prediction.conflictedFiles).toEqual(['app.txt']);
    expect(result.status).toBe('conflict');
    expect(result.conflictedFiles).toEqual(prediction.conflictedFiles);
    expect(prediction.detail).toContain('conflicted file');
    await merger.dispose();
  });

  test('reports an already-merged branch without a merge-tree run', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = createMerger({ worktreeRoot, clock: new FakeClock(3_000) });
    await merger.merge(repo, INTEGRATION, makeTask(TASK), {});

    const prediction = await merger.preflight(repo, INTEGRATION, TASK);

    expect(prediction.clean).toBe(true);
    expect(prediction.alreadyMerged).toBe(true);
    expect(prediction.detail).toContain('already an ancestor');
    await merger.dispose();
  });

  test('does not create a worktree or move the integration branch', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = createMerger({ worktreeRoot, clock: new FakeClock(3_000) });
    const before = await rev(repo, INTEGRATION);
    const worktree = merger.integrationWorktreePath(INTEGRATION);

    await merger.preflight(repo, INTEGRATION, TASK);

    expect(await rev(repo, INTEGRATION)).toBe(before);
    expect(existsSync(worktree)).toBe(false);
    await merger.dispose();
  });

  test('rejects a branch that does not exist', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createIntegrationBranch(repo, INTEGRATION);
    const merger = createMerger({ worktreeRoot, clock: new FakeClock(3_000) });

    await expect(merger.preflight(repo, INTEGRATION, 'starling/run1/ghost')).rejects.toMatchObject({
      code: 'MERGE_ERROR',
    });
    await merger.dispose();
  });

  test('rejects an integration branch that does not exist', async () => {
    const { repo, worktreeRoot } = await makeRepo();
    await createBranch(repo, TASK, { 'a.txt': 'a\n' });
    const merger = createMerger({ worktreeRoot, clock: new FakeClock(3_000) });

    await expect(merger.preflight(repo, INTEGRATION, TASK)).rejects.toMatchObject({ code: 'MERGE_ERROR' });
    await merger.dispose();
  });
});
