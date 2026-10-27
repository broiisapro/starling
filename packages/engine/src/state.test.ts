import { describe, expect, test } from 'bun:test';
import { makePlan, makeRun, makeTaskRun, makeTaskSpec } from '@starling/core/testing';
import {
  activeByNode,
  activeCount,
  allTasksTerminal,
  createTaskRuns,
  dependenciesMerged,
  dependentsToCancel,
  promotableTaskKeys,
  readyTaskKeys,
  unfinishedTaskKeys,
} from './state';

const plan = makePlan({
  goalId: 'g',
  tasks: [
    makeTaskSpec({ key: 'a', dependsOn: [] }),
    makeTaskSpec({ key: 'b', dependsOn: [] }),
    makeTaskSpec({ key: 'c', dependsOn: ['a'] }),
    makeTaskSpec({ key: 'd', dependsOn: ['a', 'b'] }),
    makeTaskSpec({ key: 'e', dependsOn: ['c'] }),
  ],
});

function run(overrides: Parameters<typeof makeRun>[0] = {}) {
  return makeRun({ id: 'run-1', plan, ...overrides });
}

describe('createTaskRuns', () => {
  test('creates one pending task per plan task with zeroed usage', () => {
    const tasks = createTaskRuns('run-9', plan);
    expect(Object.keys(tasks)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(tasks.a?.status).toBe('pending');
    expect(tasks.a?.runId).toBe('run-9');
    expect(tasks.a?.usage).toEqual({ input: 0, output: 0, cached: 0 });
    expect(tasks.a?.attempts).toBe(0);
  });
});

describe('dependency readiness', () => {
  test('a task is ready only when all of its dependencies merged', () => {
    const tasks = createTaskRuns('r', plan);
    expect(dependenciesMerged(plan.tasks[2] as never, tasks)).toBe(false);
    tasks.a = makeTaskRun({ status: 'merged' });
    expect(dependenciesMerged(plan.tasks[2] as never, tasks)).toBe(true);
    expect(dependenciesMerged(plan.tasks[3] as never, tasks)).toBe(false);
    tasks.b = makeTaskRun({ status: 'merged' });
    expect(dependenciesMerged(plan.tasks[3] as never, tasks)).toBe(true);
  });

  test('promotable keys are pending tasks with merged dependencies', () => {
    const tasks = createTaskRuns('r', plan);
    expect(promotableTaskKeys(run({ tasks }))).toEqual(['a', 'b']);
    tasks.a = makeTaskRun({ status: 'merged' });
    // `a` is merged; `b` is still pending, `c` becomes promotable.
    expect(promotableTaskKeys(run({ tasks }))).toEqual(['b', 'c']);
  });

  test('ready keys only include promoted tasks, in plan order', () => {
    const tasks = createTaskRuns('r', plan);
    tasks.b = makeTaskRun({ status: 'ready' });
    tasks.a = makeTaskRun({ status: 'ready' });
    expect(readyTaskKeys(run({ tasks }))).toEqual(['a', 'b']);
  });

  test('a task whose dependency failed is never ready', () => {
    const tasks = createTaskRuns('r', plan);
    tasks.a = makeTaskRun({ status: 'failed' });
    tasks.b = makeTaskRun({ status: 'merged' });
    tasks.c = makeTaskRun({ status: 'pending' });
    expect(promotableTaskKeys(run({ tasks }))).not.toContain('c');
  });
});

describe('run accounting', () => {
  test('activeCount counts the four in-flight statuses only', () => {
    const tasks = createTaskRuns('r', plan);
    tasks.a = makeTaskRun({ status: 'running' });
    tasks.b = makeTaskRun({ status: 'fixing' });
    tasks.c = makeTaskRun({ status: 'auditing' });
    tasks.d = makeTaskRun({ status: 'merging' });
    tasks.e = makeTaskRun({ status: 'merged' });
    expect(activeCount(run({ tasks }))).toBe(4);
  });

  test('activeByNode groups only in-flight assignments', () => {
    const tasks = createTaskRuns('r', plan);
    tasks.a = makeTaskRun({ status: 'running', nodeId: 'hub' });
    tasks.b = makeTaskRun({ status: 'auditing', nodeId: 'hub' });
    tasks.c = makeTaskRun({ status: 'running', nodeId: 'air' });
    tasks.d = makeTaskRun({ status: 'merged', nodeId: 'hub' });
    tasks.e = makeTaskRun({ status: 'failed', nodeId: 'air' });
    expect(activeByNode(run({ tasks }))).toEqual({ hub: 2, air: 1 });
  });

  test('allTasksTerminal ignores the plan order', () => {
    const tasks = createTaskRuns('r', plan);
    expect(allTasksTerminal(run({ tasks }))).toBe(false);
    tasks.a = makeTaskRun({ status: 'merged' });
    tasks.b = makeTaskRun({ status: 'failed' });
    tasks.c = makeTaskRun({ status: 'cancelled' });
    tasks.d = makeTaskRun({ status: 'conflict' });
    tasks.e = makeTaskRun({ status: 'merged' });
    expect(allTasksTerminal(run({ tasks }))).toBe(true);
  });

  test('unfinishedTaskKeys lists everything not terminal', () => {
    const tasks = createTaskRuns('r', plan);
    tasks.a = makeTaskRun({ taskKey: 'a', status: 'merged' });
    tasks.b = makeTaskRun({ taskKey: 'b', status: 'running' });
    expect(unfinishedTaskKeys(run({ tasks }))).toEqual(['b', 'c', 'd', 'e']);
  });
});

describe('dependentsToCancel', () => {
  test('walks the DAG transitively', () => {
    const tasks = createTaskRuns('r', plan);
    expect(dependentsToCancel(run({ tasks }), 'a')).toEqual(['c', 'd', 'e']);
  });

  test('skips dependents that already finished', () => {
    const tasks = createTaskRuns('r', plan);
    tasks.c = makeTaskRun({ status: 'merged' });
    expect(dependentsToCancel(run({ tasks }), 'a')).toEqual(['d']);
  });

  test('returns nothing for a leaf task', () => {
    expect(dependentsToCancel(run({ tasks: createTaskRuns('r', plan) }), 'e')).toEqual([]);
  });
});
