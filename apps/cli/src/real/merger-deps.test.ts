/**
 * The merge port must be serial: the engine calls `merge` as soon as a task passes audit, so two
 * tasks that finish together would otherwise run `git merge` in the same integration worktree and
 * collide on `index.lock` (found under load in the full suite; a task then fails with no retry).
 *
 * The fake service below records how many merges are in flight at once. The git side is real (a
 * throwaway repo) because the decorator also has to prepare the integration worktree, and a fake
 * git there would only test the fake.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MergeResult, TaskRun } from '@starling/core';
import { exec } from '@starling/core';
import type { MergeOptions, MergerService } from '@starling/merger';
import { tmpDir } from '../testing/tmp';
import { withMergerDependencies } from './merger-deps';

const TASK: TaskRun = {
  runId: 'run-1',
  taskKey: 'one',
  status: 'merging',
  attempts: 1,
  usage: { input: 0, output: 0, cached: 0 },
  costUsd: 0,
};

function result(taskKey: string): MergeResult {
  return {
    taskKey,
    status: 'merged',
    conflictedFiles: [],
    commit: 'abc1234',
    detail: 'merged',
    ts: 1,
  };
}

interface Recording {
  inFlight: number;
  peak: number;
  order: string[];
}

/** A merger whose `merge` is slow and observable; everything else is the zero-cost default. */
function fakeService(record: Recording): MergerService {
  const merge = async (
    _repo: string,
    _branch: string,
    task: TaskRun,
    _opts?: MergeOptions,
  ): Promise<MergeResult> => {
    record.inFlight += 1;
    record.peak = Math.max(record.peak, record.inFlight);
    record.order.push(task.taskKey);
    // Long enough that an unserialised pair definitely overlaps.
    await new Promise((resolve) => setTimeout(resolve, 25));
    record.inFlight -= 1;
    return result(task.taskKey);
  };
  return {
    merge,
    queue: () => {
      throw new Error('the decorator owns the queue');
    },
    preflight: async (repo: string, integrationBranch: string, branch: string) => ({
      clean: true,
      conflictedFiles: [],
      alreadyMerged: false,
      detail: 'clean',
      repo,
      integrationBranch,
      branch,
    }),
    integrationWorktreePath: () => '/tmp/unused',
    dispose: async () => undefined,
  } as unknown as MergerService;
}

async function makeRepo(): Promise<string> {
  const dir = tmpDir();
  writeFileSync(join(dir, 'package.json'), '{"name":"fixture","private":true}\n');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'base.ts'), 'export const base = 1;\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
  const git = (args: string[]) => exec(['git', ...args], { cwd: dir, timeoutMs: 20_000 });
  await git(['init', '-q', '-b', 'main']);
  await git(['add', '-A']);
  await git(['-c', 'user.email=f@x', '-c', 'user.name=F', 'commit', '-q', '-m', 'init']);
  await git(['branch', 'starling/x/integration']);
  return dir;
}

describe('withMergerDependencies', () => {
  let repo: string | undefined;

  afterEach(() => {
    repo = undefined;
  });

  test('two merges of the same branch never run at once', async () => {
    repo = await makeRepo();
    const record: Recording = { inFlight: 0, peak: 0, order: [] };
    const merger = withMergerDependencies({
      service: fakeService(record),
      worktreeRoot: join(repo, '..', `${repo.split('/').at(-1) ?? 'fixture'}-worktrees`),
    });

    const [first, second] = await Promise.all([
      merger.merge(repo, 'starling/x/integration', { ...TASK, taskKey: 'one' }, {}),
      merger.merge(repo, 'starling/x/integration', { ...TASK, taskKey: 'two' }, {}),
    ]);

    expect(record.peak).toBe(1);
    expect(record.order).toEqual(['one', 'two']);
    expect(first.taskKey).toBe('one');
    expect(second.taskKey).toBe('two');
  });

  test('the queue it exposes is the queue that merges', async () => {
    repo = await makeRepo();
    const record: Recording = { inFlight: 0, peak: 0, order: [] };
    const merger = withMergerDependencies({
      service: fakeService(record),
      worktreeRoot: join(repo, '..', `${repo.split('/').at(-1) ?? 'fixture'}-worktrees`),
    });

    expect(merger.queue()).toBe(merger.queue());

    const queued = merger.queue().enqueue(repo, 'starling/x/integration', TASK);
    await merger.merge(repo, 'starling/x/integration', { ...TASK, taskKey: 'direct' }, {});
    expect((await queued).taskKey).toBe('one');
    expect(record.order).toEqual(['one', 'direct']);
    expect(merger.queue().results()).toHaveLength(2);
  });

  test('preflight and dispose are inherited from the real merger', async () => {
    repo = await makeRepo();
    const record: Recording = { inFlight: 0, peak: 0, order: [] };
    const merger = withMergerDependencies({
      service: fakeService(record),
      worktreeRoot: join(repo, '..', `${repo.split('/').at(-1) ?? 'fixture'}-worktrees`),
    });

    expect(await merger.preflight(repo, 'starling/x/integration', 'starling/x/one')).toEqual({
      clean: true,
      conflictedFiles: [],
      alreadyMerged: false,
      detail: 'clean',
      repo,
      integrationBranch: 'starling/x/integration',
      branch: 'starling/x/one',
    });
    await merger.dispose();
  });
});
