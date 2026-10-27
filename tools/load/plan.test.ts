import { describe, expect, test } from 'bun:test';
import { makeGoal } from '../../packages/core/src/testing/index.ts';
import { planFromDraft, validatePlan } from '../../packages/planner/src/index.ts';
import {
  buildPlanDraft,
  buildScriptedEvents,
  buildTaskSpecs,
  EVENTS_PER_TASK,
  fileForTask,
  INDEPENDENT_TASKS,
  TASK_COUNT,
  taskKeyFor,
} from './plan.ts';

describe('load plan', () => {
  test('generates thirty unique, lane-disjoint tasks with valid dependencies', () => {
    const draft = buildPlanDraft();
    const goal = makeGoal();
    const plan = planFromDraft(draft, goal, { provider: 'deepseek', model: 'deepseek-v4.1-flash' }, 1);
    const issues = validatePlan(plan, { maxTasks: 12 });

    expect(plan.tasks).toHaveLength(TASK_COUNT);
    expect(new Set(plan.tasks.map((task) => task.key)).size).toBe(TASK_COUNT);
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    // A 30-task plan is above the planner's advisory ceiling, so exactly one warning is expected.
    expect(issues.filter((issue) => issue.severity === 'warn')).toHaveLength(1);
    for (const task of plan.tasks) {
      expect(task.definitionOfDone.some((item) => item.toLowerCase().includes('test'))).toBe(true);
      expect(task.lane.owns).toHaveLength(1);
    }
  });

  test('the first twenty tasks are roots and the rest have exactly one dependency', () => {
    const tasks = buildTaskSpecs();
    for (const [index, task] of tasks.entries()) {
      if (index < INDEPENDENT_TASKS) {
        expect(task.dependsOn).toEqual([]);
      } else {
        expect(task.dependsOn).toEqual([taskKeyFor(index - INDEPENDENT_TASKS)]);
      }
    }
  });

  test('every task lane names its own src/task-NN directory', () => {
    const tasks = buildTaskSpecs();
    const lanes = tasks.map((task) => task.lane.owns[0]);
    expect(new Set(lanes).size).toBe(tasks.length);
    expect(fileForTask('t04-fix-the-overdue-calculation')).toBe('src/task-04/index.ts');
  });
});

describe('scripted agent events', () => {
  test('exactly 300 events, starting and ending with the session edges', () => {
    const events = buildScriptedEvents('t01-add-the-search-input');
    expect(events).toHaveLength(EVENTS_PER_TASK);
    expect(events[0]?.kind).toBe('session.started');
    expect(events.at(-1)?.kind).toBe('session.idle');
    expect(events.every((event) => event.taskKey === 't01-add-the-search-input')).toBe(true);
  });

  test('timestamps are ordered and usage samples are present', () => {
    const events = buildScriptedEvents('t02-wire-the-filter-chips');
    const kinds = new Set(events.map((event) => event.kind));
    expect(kinds.has('usage')).toBe(true);
    expect(kinds.has('file.edited')).toBe(true);
    expect(kinds.has('tool.call')).toBe(true);
    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1]?.ts ?? 0;
      const current = events[index]?.ts ?? 0;
      expect(current).toBeGreaterThanOrEqual(previous);
    }
  });

  test('the same task and seed produce identical transcripts', () => {
    const a = buildScriptedEvents('t03-extract-the-date-helper', { count: 40, seed: 3 });
    const b = buildScriptedEvents('t03-extract-the-date-helper', { count: 40, seed: 3 });
    expect(a).toEqual(b);
  });
});
