import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { exec as coreExec, type MergeResult, StarlingError, systemClock, type TaskRun } from '@starling/core';
import { createGit, outputTail } from './git.ts';
import { DEFAULT_TEST_TIMEOUT_MS, mergeTask } from './merge.ts';
import { runPreflight } from './preflight.ts';
import { createMergeQueue } from './queue.ts';
import type { ExecFn, MergeOptions, MergerOptions, MergerService } from './types.ts';
import { canonicalPath, ensureIntegrationWorktree, integrationWorktreePath } from './worktree.ts';

type MergeMethod = (
  repo: string,
  integrationBranch: string,
  task: TaskRun,
  opts?: MergeOptions,
) => Promise<MergeResult>;

/**
 * Create the production `Merger`.
 *
 * ```ts
 * const merger = createMerger({ worktreeRoot: '/tmp/starling-worktrees' });
 * const result = await merger.queue().enqueue(repo, 'starling/abc123/integration', taskRun, {
 *   testCommand: 'bun test',
 *   title: 'CSV export',
 * });
 * ```
 *
 * One merger instance is expected per run. It owns the integration worktree(s) it creates; call
 * `dispose()` after the queue has drained to remove them.
 */
export function createMerger(options: MergerOptions): MergerService {
  if (options.worktreeRoot.trim().length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', 'createMerger() needs a worktreeRoot');
  }
  if (options.testTimeoutMs !== undefined && options.testTimeoutMs <= 0) {
    throw new StarlingError('INVALID_ARGUMENT', 'testTimeoutMs must be greater than 0');
  }

  const execFn: ExecFn = options.exec ?? coreExec;
  const clock = options.clock ?? systemClock;
  const testTimeoutMs = options.testTimeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;
  // Resolve once: git reports worktree paths through realpath and the comparison must match.
  const worktreeRoot = canonicalPath(options.worktreeRoot);
  const git = createGit(execFn);

  /** Worktrees this merger created, keyed by repo + branch, so `dispose()` removes exactly ours. */
  const owned = new Map<string, { repo: string; path: string }>();

  const integrationWorktree = async (repo: string, integrationBranch: string): Promise<string> => {
    const path = await ensureIntegrationWorktree({ repo, integrationBranch, worktreeRoot, git });
    owned.set(`${repo}\u0000${integrationBranch}`, { repo, path });
    return path;
  };

  const merge: MergeMethod = (repo, integrationBranch, task, opts = {}) =>
    mergeTask(
      { git, exec: execFn, clock, testTimeoutMs, integrationWorktree },
      repo,
      integrationBranch,
      task,
      opts,
    );

  const queue = createMergeQueue({ merge, clock });

  const preflight: MergerService['preflight'] = (repo, integrationBranch, branch) =>
    runPreflight(git, repo, integrationBranch, branch);

  const dispose: MergerService['dispose'] = async () => {
    const failures: string[] = [];
    for (const { repo, path } of owned.values()) {
      const remove = await git.run(repo, ['worktree', 'remove', '--force', path]);
      if (remove.code === 0 || !existsSync(path)) continue;

      // `worktree remove` can refuse when the worktree is locked or its gitdir is odd; the directory
      // is Starling-owned, so falling back to rm + prune is safe.
      await rm(path, { recursive: true, force: true });
      await git.run(repo, ['worktree', 'prune']);
      if (existsSync(path)) {
        failures.push(`${path}: ${outputTail(remove)}`);
      }
    }
    owned.clear();
    if (failures.length > 0) {
      throw new StarlingError('MERGE_ERROR', `Could not remove ${failures.length} integration worktree(s)`, {
        details: { failures },
      });
    }
  };

  return {
    merge,
    queue: () => queue,
    preflight,
    integrationWorktreePath: (integrationBranch) => integrationWorktreePath(worktreeRoot, integrationBranch),
    dispose,
  };
}
