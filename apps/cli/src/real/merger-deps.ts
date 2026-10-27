/**
 * The merge port the engine gets: serialised, and with the integration worktree's dependencies ready.
 *
 * Two problems meet here, both invisible to per-package tests and both hit by the real pipeline:
 *
 * 1. **Concurrent merges.** `Merger` (core) has one `merge` method and the engine calls it directly
 *    as soon as a task passes audit. Tasks that finish auditing together therefore run `git merge`
 *    in the *same* integration worktree at the same time, and the loser dies on
 *    `Unable to create …/index.lock: File exists` — which the engine reports as `merger threw`, then
 *    `failed`, with no retry. `@starling/merger` already ships the serial queue for this
 *    (`createMergeQueue`, documented as the production path), but only behind `merger.queue()`.
 *    The composition owns the port, so it hands the engine a `merge` that goes *through* that queue.
 * 2. **A worktree has no dependencies.** The merger's integration worktree is a fresh checkout, so a
 *    suite that imports a dev dependency dies with `Cannot find package …` and every merge rolls back
 *    as `tests-failed` (sky-todo's tests import `happy-dom`). Preparation happens inside the
 *    serialised path, once per repo + branch, so it cannot race with a merge either.
 *
 * `preflight`, `integrationWorktreePath` and `dispose` are inherited unchanged from the real merger.
 */
import type { MergeResult, TaskRun } from '@starling/core';
import { exec, systemClock } from '@starling/core';
import {
  createGit,
  createMergeQueue,
  ensureIntegrationWorktree,
  type MergeOptions,
  type MergeQueue,
  type MergerService,
} from '@starling/merger';
import { linkNodeModules } from './workspace-deps';

export interface MergerDepsOptions {
  service: MergerService;
  worktreeRoot: string;
}

export function withMergerDependencies(options: MergerDepsOptions): MergerService {
  const { service } = options;
  const git = createGit(exec);
  /** Repo + branch pairs already prepared, so the (idempotent but chatty) git call runs once. */
  const prepared = new Set<string>();

  const prepare = async (repo: string, integrationBranch: string): Promise<void> => {
    const key = `${repo}\u0000${integrationBranch}`;
    if (prepared.has(key)) return;
    const path = await ensureIntegrationWorktree({
      repo,
      integrationBranch,
      worktreeRoot: options.worktreeRoot,
      git,
    });
    linkNodeModules(repo, path);
    prepared.add(key);
  };

  /** The serialised implementation the queue chains: prepare, then the real merge. */
  const mergeOne = async (
    repo: string,
    integrationBranch: string,
    task: TaskRun,
    opts: MergeOptions,
  ): Promise<MergeResult> => {
    await prepare(repo, integrationBranch);
    return service.merge(repo, integrationBranch, task, opts);
  };

  const queue: MergeQueue = createMergeQueue({ merge: mergeOne, clock: systemClock });

  const wrapped = Object.create(service) as MergerService;
  Object.defineProperties(wrapped, {
    // One `merge` at a time per repo + integration branch, which is what the git index needs.
    merge: {
      configurable: true,
      enumerable: true,
      value: (repo: string, integrationBranch: string, task: TaskRun, opts?: MergeOptions) =>
        queue.enqueue(repo, integrationBranch, task, opts ?? {}),
    },
    // The queue the dashboard renders is the queue that actually merges.
    queue: { configurable: true, enumerable: true, value: () => queue },
  });
  return wrapped;
}
