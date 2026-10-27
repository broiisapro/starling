/**
 * The stress harness, at test scale: same code path, small numbers, so `bun test` proves the harness
 * itself still works (and that 6 concurrent worktrees stay clean) without spending a minute and a
 * gigabyte on every test run. The real 60-worktree measurement is `bun tools/stress/worktrees.ts`.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTempDir, removeDirs } from '../../packages/workspace/src/testing/temp-repo.ts';
import { percentile, runStress, summarize } from './harness.ts';
import { formatReport } from './worktrees.ts';

describe('percentile / summarize', () => {
  test('linear interpolation, and empty input is zero', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([5], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5], 0)).toBe(1);
  });

  test('summarize carries counts, failures and the tail', () => {
    const stat = summarize('create', [10, 20, 30, 40], 1);
    expect(stat).toMatchObject({ operation: 'create', count: 4, failures: 1, maxMs: 40, totalMs: 100 });
    expect(stat.p50Ms).toBe(25);
  });
});

describe('runStress (small)', () => {
  test('every operation succeeds and cleanup leaves nothing behind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'starling-stress-test-'));
    try {
      const report = await runStress({
        root,
        files: 120,
        worktrees: 6,
        conflictPairs: 2,
        bundles: 2,
        sparse: true,
      });

      expect(report.failures).toEqual([]);
      expect(report.ok).toBe(true);
      expect(report.worktrees).toBe(6);
      expect(report.checks.commits).toBe(6);
      expect(report.checks.diffs).toBe(6);
      expect(report.checks.conflictsFound).toBe(2);
      expect(report.checks.bundlesFetched).toBe(2);
      expect(report.checks.worktreesRemoved).toBe(6);
      expect(report.checks.worktreesRegisteredAfter).toBe(1);
      expect(report.checks.conflictingPaths).toEqual(['shared/pair-0.txt', 'shared/pair-1.txt']);

      const operations = new Map(report.operations.map((operation) => [operation.operation, operation]));
      for (const name of [
        'create',
        'commit',
        'diff',
        'predict-conflicts',
        'bundle-create',
        'bundle-fetch',
        'remove',
        'create-sparse',
      ]) {
        expect(operations.get(name)?.failures).toBe(0);
        expect(operations.get(name)?.count).toBeGreaterThan(0);
      }

      expect(report.disk.perWorktreeAvgBytes).toBeGreaterThan(0);
      expect(report.disk.fullWorktreeFiles).toBeGreaterThan(100);
      expect(report.disk.sparse?.files).toBeGreaterThan(0);
      expect(report.disk.sparse?.ratioOfFull).toBeLessThan(1);

      expect(formatReport(report)).toContain('Starling workspace stress');
      expect(formatReport(report)).toContain('sparse lane');

      // Cleaned up (no --keep) and the report says so.
      expect(report.kept).toBe(false);
      expect(report.repo.startsWith(root)).toBe(true);
      expect(existsSync(join(root, 'repo'))).toBe(false);
    } finally {
      await removeDirs(root);
    }
  }, 180_000);

  test('--keep leaves the repo on disk', async () => {
    const root = await makeTempDir('starling-stress-keep-');
    try {
      const report = await runStress({
        root,
        files: 60,
        worktrees: 4,
        conflictPairs: 1,
        bundles: 1,
        sparse: false,
        keep: true,
      });

      expect(report.kept).toBe(true);
      expect(existsSync(join(root, 'repo', '.git'))).toBe(true);
      expect(report.disk.sparse).toBeUndefined();
    } finally {
      await removeDirs(root);
    }
  }, 120_000);
});
