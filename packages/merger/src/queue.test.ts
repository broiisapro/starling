import { afterAll, describe, expect, test } from 'bun:test';
import { FakeClock, type MergeResult } from '@starling/core';
import { createMerger, type MergeQueue } from './index.ts';
import {
  cleanupTempDirs,
  createBranch,
  createIntegrationBranch,
  git,
  hasFile,
  makeRepo,
  makeTask,
  type TestRepo,
} from './test-helpers.ts';

const INTEGRATION = 'starling/run1/integration';

afterAll(cleanupTempDirs);

function setup(repo: TestRepo): { merger: ReturnType<typeof createMerger>; queue: MergeQueue } {
  const merger = createMerger({ worktreeRoot: repo.worktreeRoot, clock: new FakeClock(2_000) });
  return { merger, queue: merger.queue() };
}

describe('MergeQueue', () => {
  test('serialises three concurrent enqueues in FIFO order and keeps a linear history', async () => {
    const testRepo = await makeRepo();
    await createBranch(testRepo.repo, 'starling/run1/a', { 'a.txt': 'a\n' });
    await createBranch(testRepo.repo, 'starling/run1/b', { 'b.txt': 'b\n' });
    await createBranch(testRepo.repo, 'starling/run1/c', { 'c.txt': 'c\n' });
    await createIntegrationBranch(testRepo.repo, INTEGRATION);
    const { merger, queue } = setup(testRepo);
    const order: string[] = [];
    const unsubscribe = queue.onResult((result) => order.push(result.taskKey));

    const results = await Promise.all([
      queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/a', 'a'), {}),
      queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/b', 'b'), {}),
      queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/c', 'c'), {}),
    ]);

    expect(results.map((result) => result.status)).toEqual(['merged', 'merged', 'merged']);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(queue.results().map((result) => result.taskKey)).toEqual(['a', 'b', 'c']);
    expect(await hasFile(testRepo.repo, INTEGRATION, 'a.txt')).toBe(true);
    expect(await hasFile(testRepo.repo, INTEGRATION, 'b.txt')).toBe(true);
    expect(await hasFile(testRepo.repo, INTEGRATION, 'c.txt')).toBe(true);
    // Every merge is a real merge commit on the first-parent chain: init + three merges.
    expect(await git(testRepo.repo, ['rev-list', '--first-parent', '--count', INTEGRATION])).toBe('4');
    expect(
      (await git(testRepo.repo, ['log', '--first-parent', '--format=%s', INTEGRATION]))
        .split('\n')
        .slice(0, 3),
    ).toEqual(['merge(c): starling/run1/c', 'merge(b): starling/run1/b', 'merge(a): starling/run1/a']);
    unsubscribe();
    await merger.dispose();
  });

  test('pending() reports queued work oldest-first and empties as merges land', async () => {
    const testRepo = await makeRepo();
    await createBranch(testRepo.repo, 'starling/run1/a', { 'a.txt': 'a\n' });
    await createBranch(testRepo.repo, 'starling/run1/b', { 'b.txt': 'b\n' });
    await createIntegrationBranch(testRepo.repo, INTEGRATION);
    const { merger, queue } = setup(testRepo);

    const first = queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/a', 'a'), {});
    const second = queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/b', 'b'), {});

    expect(queue.pending().map((entry) => entry.taskKey)).toEqual(['a', 'b']);
    expect(queue.pending().map((entry) => entry.state)).toEqual(['queued', 'queued']);
    expect(queue.pending()[0]?.id).not.toBe(queue.pending()[1]?.id);

    await Promise.all([first, second]);
    expect(queue.pending()).toEqual([]);
    expect(queue.results()).toHaveLength(2);
    await merger.dispose();
  });

  test('onResult notifies subscribers until they unsubscribe', async () => {
    const testRepo = await makeRepo();
    await createBranch(testRepo.repo, 'starling/run1/a', { 'a.txt': 'a\n' });
    await createBranch(testRepo.repo, 'starling/run1/b', { 'b.txt': 'b\n' });
    await createIntegrationBranch(testRepo.repo, INTEGRATION);
    const { merger, queue } = setup(testRepo);
    const seen: MergeResult[] = [];
    const unsubscribe = queue.onResult((result) => seen.push(result));

    await queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/a', 'a'), {});
    expect(seen.map((result) => result.taskKey)).toEqual(['a']);

    unsubscribe();
    await queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/b', 'b'), {});
    expect(seen.map((result) => result.taskKey)).toEqual(['a']);
    await merger.dispose();
  });

  test('a rejected merge does not poison the queue for the next task', async () => {
    const testRepo = await makeRepo();
    await createBranch(testRepo.repo, 'starling/run1/good', { 'good.txt': 'ok\n' });
    await createIntegrationBranch(testRepo.repo, INTEGRATION);
    const { merger, queue } = setup(testRepo);

    const missing = queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/ghost', 'ghost'), {});
    const good = queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/good', 'good'), {});

    await expect(missing).rejects.toMatchObject({ code: 'MERGE_ERROR' });
    const result = await good;
    expect(result.status).toBe('merged');
    expect(await hasFile(testRepo.repo, INTEGRATION, 'good.txt')).toBe(true);
    await merger.dispose();
  });

  test('queues per integration branch: two branches merge into separate worktrees', async () => {
    const testRepo = await makeRepo();
    await createBranch(testRepo.repo, 'starling/run1/a', { 'a.txt': 'a\n' });
    await createBranch(testRepo.repo, 'starling/run1/b', { 'b.txt': 'b\n' });
    await createIntegrationBranch(testRepo.repo, 'starling/run1/int-a');
    await createIntegrationBranch(testRepo.repo, 'starling/run1/int-b');
    const { merger, queue } = setup(testRepo);

    const [a, b] = await Promise.all([
      queue.enqueue(testRepo.repo, 'starling/run1/int-a', makeTask('starling/run1/a', 'a'), {}),
      queue.enqueue(testRepo.repo, 'starling/run1/int-b', makeTask('starling/run1/b', 'b'), {}),
    ]);

    expect(a.status).toBe('merged');
    expect(b.status).toBe('merged');
    expect(merger.integrationWorktreePath('starling/run1/int-a')).not.toBe(
      merger.integrationWorktreePath('starling/run1/int-b'),
    );
    expect(await hasFile(testRepo.repo, 'starling/run1/int-a', 'a.txt')).toBe(true);
    expect(await hasFile(testRepo.repo, 'starling/run1/int-a', 'b.txt')).toBe(false);
    expect(await hasFile(testRepo.repo, 'starling/run1/int-b', 'b.txt')).toBe(true);
    await merger.dispose();
  });

  test('FIFO order holds with a slow, test-gated first merge', async () => {
    const testRepo = await makeRepo();
    await createBranch(testRepo.repo, 'starling/run1/slow', { 'slow.txt': 's\n' });
    await createBranch(testRepo.repo, 'starling/run1/fast', { 'fast.txt': 'f\n' });
    await createIntegrationBranch(testRepo.repo, INTEGRATION);
    const { merger, queue } = setup(testRepo);
    const order: string[] = [];
    queue.onResult((result) => order.push(result.taskKey));

    const slow = queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/slow', 'slow'), {
      testCommand: 'sleep 0.2',
    });
    const fast = queue.enqueue(testRepo.repo, INTEGRATION, makeTask('starling/run1/fast', 'fast'), {});

    const [slowResult, fastResult] = await Promise.all([slow, fast]);
    expect(slowResult.status).toBe('merged');
    expect(fastResult.status).toBe('merged');
    expect(order).toEqual(['slow', 'fast']);
    expect(await git(testRepo.repo, ['log', '-1', '--format=%s', INTEGRATION])).toBe(
      'merge(fast): starling/run1/fast',
    );
    await merger.dispose();
  });
});
