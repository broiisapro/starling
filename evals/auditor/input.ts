import type { AuditInput } from '../lib/core';
import { makeGoal, makePlan, makeRepoMap, makeTaskRun } from '../lib/core-testing';
import type { AuditorCase } from './case';

/** Build the port input a real auditor will receive. Mock and real runs share this shape. */
export function makeAuditInputFor(testCase: AuditorCase): AuditInput {
  const goal = makeGoal({ text: testCase.task.goal, repoPath: '/tmp/sky-todo' });
  const map = makeRepoMap({ root: goal.repoPath, testCommand: 'bun test' });
  const plan = makePlan({ goalId: goal.id, tasks: [testCase.task] });
  const run = makeTaskRun({ taskKey: testCase.task.key, status: 'auditing', attempts: 1 });
  return {
    ctx: {
      goal,
      plan,
      map,
      task: testCase.task,
      branch: `starling/eval/${testCase.task.key}`,
      testCommand: map.testCommand,
    },
    run,
    diff: testCase.diff,
    changedFiles: testCase.changedFiles,
    attempt: 1,
  };
}
