import { type Clock, type MergeResult, StarlingError, type TaskRun } from '@starling/core';
import { type Git, outputTail } from './git.ts';
import { assertBranch, assertGitRepo, isAncestor } from './refs.ts';
import { runSuite } from './suite.ts';
import type { ExecFn, MergeOptions } from './types.ts';

export interface MergeDeps {
  git: Git;
  exec: ExecFn;
  clock: Clock;
  testTimeoutMs: number;
  /** Ensures (and returns) the long-lived worktree for `integrationBranch`. */
  integrationWorktree(repo: string, integrationBranch: string): Promise<string>;
}

/** Unmerged paths from an in-progress merge. Empty means the failure was not a content conflict. */
async function unmergedFiles(git: Git, path: string): Promise<string[]> {
  const result = await git.run(path, ['diff', '--name-only', '--diff-filter=U']);
  if (result.code !== 0) return [];
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Abort an in-progress merge; a plain reset is the fallback when `--abort` refuses. */
async function abortMerge(git: Git, path: string): Promise<void> {
  const mergeHead = await git.run(path, ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD']);
  if (mergeHead.code !== 0) return;

  const abort = await git.run(path, ['merge', '--abort']);
  if (abort.code === 0) return;

  const reset = await git.run(path, ['reset', '--hard', 'HEAD']);
  if (reset.code !== 0) {
    throw new StarlingError('MERGE_ERROR', `Could not abort the conflicted merge in ${path}`, {
      details: { path, tail: outputTail(abort) },
    });
  }
}

/**
 * Rewind the integration branch by exactly the merge commit we created.
 *
 * The guard matters: a test command (or a git hook) can itself move HEAD, and blindly running
 * `reset --hard HEAD~1` would then delete someone else's commit. We only rewind when HEAD is a merge
 * commit whose first parent is the tip we merged onto.
 */
async function rollbackMerge(
  git: Git,
  path: string,
  mergeCommit: string,
  firstParent: string,
): Promise<void> {
  const head = (await git.must(path, ['rev-parse', 'HEAD'])).trim();
  if (head !== mergeCommit) {
    throw new StarlingError(
      'MERGE_ERROR',
      `Refusing to roll back: HEAD is ${head}, not the merge commit ${mergeCommit}`,
      { details: { path, head, mergeCommit } },
    );
  }

  const parents = (await git.must(path, ['rev-list', '--parents', '-n', '1', 'HEAD'])).trim().split(/\s+/);
  if (parents.length !== 3 || parents[1] !== firstParent) {
    throw new StarlingError('MERGE_ERROR', 'Refusing to roll back: HEAD is not the merge commit we created', {
      details: { path, parents, firstParent },
    });
  }

  const reset = await git.run(path, ['reset', '--hard', 'HEAD~1']);
  if (reset.code !== 0) {
    throw new StarlingError('MERGE_ERROR', `Could not roll back ${mergeCommit} on the integration branch`, {
      details: { path, mergeCommit, tail: outputTail(reset) },
    });
  }
}

/**
 * Land one task branch on the integration branch, verify it and roll back if the suite is red.
 *
 * Every outcome that returns normally leaves the integration branch green: `merged` (tests passed or
 * no test command), `skipped` (nothing to do), `conflict`/`tests-failed` (branch unchanged).
 */
export async function mergeTask(
  deps: MergeDeps,
  repo: string,
  integrationBranch: string,
  task: TaskRun,
  opts: MergeOptions = {},
): Promise<MergeResult> {
  const ts = (): number => deps.clock.now();
  const branch = task.branch?.trim() ?? '';
  if (branch.length === 0) {
    throw new StarlingError('INVALID_ARGUMENT', `Task "${task.taskKey}" has no branch to merge`);
  }

  await assertGitRepo(deps.git, repo);
  await assertBranch(deps.git, repo, integrationBranch, 'integration');
  await assertBranch(deps.git, repo, branch, 'task');

  if (await isAncestor(deps.git, repo, branch, integrationBranch)) {
    return {
      taskKey: task.taskKey,
      status: 'skipped',
      conflictedFiles: [],
      detail: `"${branch}" is already merged into "${integrationBranch}"`,
      ts: ts(),
    };
  }

  const worktree = await deps.integrationWorktree(repo, integrationBranch);
  const headBefore = (await deps.git.must(worktree, ['rev-parse', 'HEAD'])).trim();
  const message = `merge(${task.taskKey}): ${opts.title?.trim() || branch}`;

  const merge = await deps.git.run(worktree, [
    '-c',
    'commit.gpgsign=false',
    'merge',
    '--no-ff',
    '--no-edit',
    '-m',
    message,
    branch,
  ]);

  if (merge.code !== 0) {
    const conflictedFiles = await unmergedFiles(deps.git, worktree);
    await abortMerge(deps.git, worktree);

    if (conflictedFiles.length > 0) {
      const headAfterAbort = (await deps.git.must(worktree, ['rev-parse', 'HEAD'])).trim();
      if (headAfterAbort !== headBefore) {
        throw new StarlingError(
          'MERGE_ERROR',
          `Conflict abort left "${integrationBranch}" at ${headAfterAbort} instead of ${headBefore}`,
          { details: { repo, integrationBranch, headBefore, headAfterAbort } },
        );
      }
      return {
        taskKey: task.taskKey,
        status: 'conflict',
        conflictedFiles,
        detail: `Merging "${branch}" into "${integrationBranch}" conflicted in ${conflictedFiles.length} file(s); merge aborted`,
        ts: ts(),
      };
    }

    throw new StarlingError('MERGE_ERROR', `git merge of "${branch}" into "${integrationBranch}" failed`, {
      details: { repo, integrationBranch, branch, tail: outputTail(merge) },
    });
  }

  const commit = (await deps.git.must(worktree, ['rev-parse', 'HEAD'])).trim();
  if (commit === headBefore) {
    return {
      taskKey: task.taskKey,
      status: 'skipped',
      conflictedFiles: [],
      detail: `"${branch}" produced no new commit on "${integrationBranch}"`,
      ts: ts(),
    };
  }

  const testCommand = opts.testCommand?.trim() ?? '';
  if (testCommand.length === 0) {
    return {
      taskKey: task.taskKey,
      status: 'merged',
      conflictedFiles: [],
      commit,
      detail: `Merged "${branch}" into "${integrationBranch}" at ${commit}; no test command configured`,
      ts: ts(),
    };
  }

  const tests = await runSuite(deps.exec, worktree, testCommand, {
    timeoutMs: deps.testTimeoutMs,
    taskKey: task.taskKey,
  });
  if (tests.ok) {
    return {
      taskKey: task.taskKey,
      status: 'merged',
      conflictedFiles: [],
      commit,
      detail: `Merged "${branch}" into "${integrationBranch}" at ${commit}; ${tests.detail}`,
      ts: ts(),
    };
  }

  await rollbackMerge(deps.git, worktree, commit, headBefore);
  return {
    taskKey: task.taskKey,
    status: 'tests-failed',
    conflictedFiles: [],
    commit,
    detail: `Rolled "${integrationBranch}" back to ${headBefore} after ${commit}: ${tests.detail}`,
    ts: ts(),
  };
}
