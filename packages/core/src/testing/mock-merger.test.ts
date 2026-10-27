import { describe, expect, test } from 'bun:test';
import type { MergeResult } from '../contracts';
import { makeTaskRun } from './factories';
import { MockMerger } from './mock-auditor';

describe('MockMerger', () => {
  test('merges by default with a fake commit', async () => {
    const merger = new MockMerger();
    const result = await merger.merge(
      '/repo',
      'starling/abc/integration',
      makeTaskRun({ taskKey: 'theme' }),
      {},
    );
    expect(result.status).toBe('merged');
    expect(result.commit).toBe('mock-merge-1');
    expect(merger.calls).toEqual([
      { repo: '/repo', integrationBranch: 'starling/abc/integration', taskKey: 'theme' },
    ]);
  });

  test('scripted conflicts are returned per task', async () => {
    const conflict: MergeResult = {
      taskKey: 'search',
      status: 'conflict',
      conflictedFiles: ['src/main.ts'],
      detail: 'overlap',
      ts: 1,
    };
    const merger = new MockMerger({ script: { search: [conflict] } });
    const result = await merger.merge('/repo', 'integration', makeTaskRun({ taskKey: 'search' }), {});
    expect(result.status).toBe('conflict');
    expect(result.conflictedFiles).toEqual(['src/main.ts']);
  });

  test('defaultStatus can be tests-failed', async () => {
    const merger = new MockMerger({ defaultStatus: 'tests-failed' });
    const result = await merger.merge('/repo', 'integration', makeTaskRun(), {});
    expect(result.status).toBe('tests-failed');
    expect(result.commit).toBeUndefined();
  });
});
