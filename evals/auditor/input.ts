import type { AuditInput } from '../lib/core';
import { makeGoal, makePlan, makeRepoMap, makeTaskRun } from '../lib/core-testing';
import type { AuditorCase } from './case';
import { makeCaseWorktree } from './worktree';

/**
 * Build the port input a real auditor will receive. Mock and real runs share this shape.
 *
 * `run.worktreePath` points at a throwaway worktree (see `worktree.ts`) so the auditor's `tests`
 * check runs a real command in a real directory, exactly as it does in production.
 */
export function makeAuditInputFor(testCase: AuditorCase): AuditInput {
  const worktree = makeCaseWorktree(testCase);
  const goal = makeGoal({ text: testCase.task.goal, repoPath: worktree.path });
  const map = makeRepoMap({ root: goal.repoPath, testCommand: worktree.testCommand, lintCommand: undefined });
  const plan = makePlan({ goalId: goal.id, tasks: [testCase.task] });
  const run = makeTaskRun({
    taskKey: testCase.task.key,
    status: 'auditing',
    attempts: 1,
    worktreePath: worktree.path,
  });
  return {
    ctx: {
      goal,
      plan,
      map,
      task: testCase.task,
      branch: `starling/eval/${testCase.task.key}`,
      testCommand: worktree.testCommand,
    },
    run,
    diff: testCase.diff,
    changedFiles: testCase.changedFiles,
    attempt: 1,
  };
}
