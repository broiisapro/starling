import { afterAll, describe, expect, test } from 'bun:test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MergeResult } from '@starling/core';
import { exec as coreExec } from '@starling/core';
import {
  commitConflictedMerge,
  createGit,
  findConflictMarkers,
  findHunks,
  renderHunks,
  resetBranch,
} from './index.ts';
import {
  cleanupTempDirs,
  createBranch,
  createIntegrationBranch,
  createWorkspaceFor,
  git,
  makeRepo,
  rev,
} from './test-helpers.ts';

const INTEGRATION = 'starling/run1/integration';

const CONFLICTED = [
  'export function buttons(): string[] {',
  '<<<<<<< HEAD',
  "  return ['delete-all']",
  '=======',
  "  return ['sort-by-due']",
  '>>>>>>> starling/run1/date-sort',
  '}',
  '',
].join('\n');

afterAll(cleanupTempDirs);

describe('findHunks', () => {
  test('finds both sides of a standard conflict', () => {
    const hunks = findHunks(CONFLICTED);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.ours).toEqual(["  return ['delete-all']"]);
    expect(hunks[0]?.theirs).toEqual(["  return ['sort-by-due']"]);
    expect(hunks[0]?.open).toStartWith('<<<<<<< ');
    expect(hunks[0]?.close).toStartWith('>>>>>>> ');
  });

  test('finds several conflicts in one file', () => {
    expect(findHunks(`${CONFLICTED}${CONFLICTED}`)).toHaveLength(2);
  });

  test('drops the diff3 base section but keeps both sides', () => {
    const diff3 = [
      '<<<<<<< HEAD',
      'ours',
      '||||||| base',
      'original',
      '=======',
      'theirs',
      '>>>>>>> branch',
    ].join('\n');
    const hunks = findHunks(diff3);
    expect(hunks[0]?.ours).toEqual(['ours']);
    expect(hunks[0]?.theirs).toEqual(['theirs']);
  });

  test('returns nothing for a file without markers', () => {
    expect(findHunks('export const ok = true;\n')).toEqual([]);
  });
});

describe('renderHunks', () => {
  test('prefixes the file path and keeps the markers', () => {
    const rendered = renderHunks('src/ui/render.ts', CONFLICTED);
    expect(rendered.startsWith('--- src/ui/render.ts\n<<<<<<< HEAD')).toBe(true);
    expect(rendered).toContain("  return ['delete-all']");
    expect(rendered).toContain("  return ['sort-by-due']");
    expect(rendered).toContain('>>>>>>> starling/run1/date-sort');
  });

  test('trims a long side and says how many lines it hid', () => {
    const long = [
      '<<<<<<< HEAD',
      ...Array.from({ length: 20 }, (_, index) => `ours ${index}`),
      '=======',
      'theirs',
      '>>>>>>> branch',
    ].join('\n');
    const rendered = renderHunks('big.ts', long, { maxHunkLines: 3 });
    expect(rendered).toContain('ours 0');
    expect(rendered).toContain('ours 2');
    expect(rendered).not.toContain('ours 3');
    expect(rendered).toContain('… (17 more lines)');
  });

  test('caps the number of conflicts shown per file', () => {
    const many = Array.from({ length: 5 }, () => CONFLICTED).join('');
    const rendered = renderHunks('many.ts', many, { maxHunksPerFile: 2 });
    expect(rendered).toContain('… (3 more conflicts in this file)');
  });

  test('clamps a huge rendered block', () => {
    const huge = `<<<<<<< HEAD\n${'x'.repeat(5000)}\n=======\n${'y'.repeat(5000)}\n>>>>>>> branch`;
    const rendered = renderHunks('huge.ts', huge, { maxChars: 200 });
    expect(rendered.length).toBeLessThanOrEqual(200);
    expect(rendered.endsWith('…')).toBe(true);
  });

  test('returns an empty string when there is nothing to show', () => {
    expect(renderHunks('clean.ts', 'export {}\n')).toBe('');
  });
});

describe('commitConflictedMerge + findConflictMarkers (real git)', () => {
  test('commits the markers as a two-parent merge commit and finds them', async () => {
    const { repo, worktreeRoot } = await makeRepo({ 'app.ts': 'export const value = 0\n' });
    await createBranch(repo, 'task', { 'app.ts': 'export const value = 1\n' });
    await createBranch(repo, INTEGRATION, { 'app.ts': 'export const value = 2\n' }, { from: 'main' });
    const workspace = createWorkspaceFor(worktreeRoot);
    const gitRunner = createGit(coreExec);
    const worktree = await workspace.create(repo, 'resolve', INTEGRATION);

    const outcome = await commitConflictedMerge({
      git: gitRunner,
      worktreePath: worktree.path,
      taskBranch: 'task',
      message: 'merge(task): markers',
    });

    expect(outcome.clean).toBe(false);
    expect(outcome.conflictedFiles).toEqual(['app.ts']);
    expect(outcome.hunks).toHaveLength(1);
    expect(outcome.hunks[0]).toContain('<<<<<<< ');

    const parents = await git(repo, ['rev-list', '--parents', '-n', '1', outcome.commit]);
    expect(parents.split(' ')).toHaveLength(3);

    const markers = await findConflictMarkers(gitRunner, repo, 'resolve');
    expect(markers).toEqual([{ path: 'app.ts', line: 1, text: '<<<<<<< HEAD' }]);

    // Committing the markers cleared the in-progress merge, so the branch is a normal commit.
    expect(await git(repo, ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD']).catch(() => 'absent')).toBe(
      'absent',
    );
    await workspace.remove(worktree.path);
  });

  test('reports a clean merge instead of inventing a conflict', async () => {
    const { repo, worktreeRoot } = await makeRepo({ 'app.ts': 'export const value = 0\n' });
    await createBranch(repo, 'task', { 'other.ts': 'export {}\n' });
    await createIntegrationBranch(repo, INTEGRATION);
    const workspace = createWorkspaceFor(worktreeRoot);
    const worktree = await workspace.create(repo, 'resolve', INTEGRATION);

    const outcome = await commitConflictedMerge({
      git: createGit(coreExec),
      worktreePath: worktree.path,
      taskBranch: 'task',
      message: 'merge(task): markers',
    });

    expect(outcome.clean).toBe(true);
    expect(outcome.conflictedFiles).toEqual([]);
    expect(outcome.hunks).toEqual([]);
    expect(outcome.detail).toContain('no conflict');
    await workspace.remove(worktree.path);
  });

  test('findConflictMarkers returns [] when the branch is clean', async () => {
    const { repo } = await makeRepo();
    await createBranch(repo, 'clean', { 'a.ts': 'export {}\n' });
    expect(await findConflictMarkers(createGit(coreExec), repo, 'clean')).toEqual([]);
  });

  test('resetBranch moves a branch back to the marker commit', async () => {
    const { repo, worktreeRoot } = await makeRepo({ 'app.ts': 'base\n' });
    await createBranch(repo, 'task', { 'app.ts': 'task\n' });
    await createBranch(repo, INTEGRATION, { 'app.ts': 'integration\n' });
    const workspace = createWorkspaceFor(worktreeRoot);
    const worktree = await workspace.create(repo, 'resolve', INTEGRATION);
    const outcome = await commitConflictedMerge({
      git: createGit(coreExec),
      worktreePath: worktree.path,
      taskBranch: 'task',
      message: 'merge(task): markers',
    });
    await writeFile(join(worktree.path, 'app.ts'), 'resolved without markers\n');
    await workspace.commitAll(worktree.path, 'fix(task): resolve');
    const resolved = await rev(repo, 'resolve');
    expect(resolved).not.toBe(outcome.commit);

    await workspace.remove(worktree.path);
    await resetBranch(createGit(coreExec), repo, 'resolve', outcome.commit);
    expect(await rev(repo, 'resolve')).toBe(outcome.commit);
  });
});

describe('the resolver prompt shape (fixture, not git)', () => {
  test('a MergeResult is all the conflict plumbing needs', () => {
    const conflict: MergeResult = {
      taskKey: 'delete-all',
      status: 'conflict',
      conflictedFiles: ['src/ui/render.ts'],
      detail: 'CONFLICT (content): Merge conflict in src/ui/render.ts',
      ts: 1,
    };
    expect(conflict.conflictedFiles).toEqual(['src/ui/render.ts']);
  });
});
