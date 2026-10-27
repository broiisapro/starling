/**
 * Give the merge queue's integration worktree the repo's dependencies.
 *
 * The merger creates one long-lived worktree per integration branch (`<root>/_integration/<branch>`)
 * and runs the regression suite inside it. A worktree has no `node_modules`, so for any repo whose
 * tests import a dev dependency the suite dies with `Cannot find package …` and every merge is rolled
 * back as `tests-failed` — which is exactly what happened on the first real run (`sky-todo`'s tests
 * import `happy-dom`).
 *
 * The merger exposes `ensureIntegrationWorktree`, so this decorator can prepare the worktree before
 * delegating the merge. Everything else is inherited unchanged (`dispose`, `queue`, `preflight`).
 */
import type { MergeResult, Merger, TaskRun } from '@starling/core';
import { exec } from '@starling/core';
import { createGit, ensureIntegrationWorktree, type MergerService } from '@starling/merger';
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

  const merge = async (
    repo: string,
    integrationBranch: string,
    task: TaskRun,
    opts?: Parameters<Merger['merge']>[3],
  ): Promise<MergeResult> => {
    const key = `${repo}\u0000${integrationBranch}`;
    if (!prepared.has(key)) {
      const path = await ensureIntegrationWorktree({
        repo,
        integrationBranch,
        worktreeRoot: options.worktreeRoot,
        git,
      });
      linkNodeModules(repo, path);
      prepared.add(key);
    }
    return service.merge(repo, integrationBranch, task, opts);
  };

  const wrapped = Object.create(service) as MergerService;
  Object.defineProperty(wrapped, 'merge', { configurable: true, enumerable: true, value: merge });
  return wrapped;
}
