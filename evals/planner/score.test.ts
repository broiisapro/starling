import { describe, expect, test } from 'bun:test';
import type { Plan, TaskSpec } from '../lib/core';
import { makePlan } from '../lib/core-testing';
import { findPlannerCase, loadPlannerCases, loadRepoMap } from './cases';
import { referencePlan } from './reference';
import { type PlannerCheckName, type PlanScore, scorePlan } from './score';

const cases = loadPlannerCases();

function fixture(caseName: string): { plan: Plan; score: PlanScore } {
  const testCase = findPlannerCase(cases, caseName);
  const map = loadRepoMap(testCase.repomap);
  const goal = {
    id: 'goal-eval',
    text: testCase.goal,
    repoPath: map.root,
    baseBranch: 'main',
    createdAt: 0,
    constraints: [],
  };
  const plan = referencePlan(caseName, goal);
  return { plan, score: scorePlan(plan, testCase, map) };
}

function check(score: PlanScore, name: PlannerCheckName) {
  const found = score.checks.find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`missing check ${name}`);
  return found;
}

function cloneTasks(plan: Plan): TaskSpec[] {
  return plan.tasks.map((task) => ({
    ...task,
    deliverables: [...task.deliverables],
    definitionOfDone: [...task.definitionOfDone],
    dependsOn: [...task.dependsOn],
    lane: { owns: [...task.lane.owns], reads: [...task.lane.reads] },
  }));
}

/** Rescore an edited plan against the same case. */
function rescore(caseName: string, tasks: TaskSpec[]): PlanScore {
  const testCase = findPlannerCase(cases, caseName);
  const map = loadRepoMap(testCase.repomap);
  const goal = {
    id: 'goal-eval',
    text: testCase.goal,
    repoPath: map.root,
    baseBranch: 'main',
    createdAt: 0,
    constraints: [],
  };
  const plan = makePlan({ ...referencePlan(caseName, goal), tasks });
  return scorePlan(plan, testCase, map);
}

describe('scorePlan', () => {
  test('every reference plan scores at least 0.95', () => {
    for (const testCase of cases) {
      const { score } = fixture(testCase.name);
      expect(score.score).toBeGreaterThanOrEqual(0.95);
    }
  });

  test('a perfect reference plan scores 1.0 on every check', () => {
    const { score } = fixture('sky-todo-quick-wins');
    expect(score.score).toBe(1);
    expect(score.checks.every((entry) => entry.ok)).toBe(true);
  });

  test('overlapping concurrent lanes fail the validator check', () => {
    const { plan } = fixture('sky-todo-quick-wins');
    const tasks = cloneTasks(plan);
    const first = tasks[0];
    const second = tasks[1];
    if (first === undefined || second === undefined) throw new Error('fixture needs two tasks');
    first.lane.owns = ['src/shared/**'];
    second.lane.owns = ['src/shared/**'];
    const score = rescore('sky-todo-quick-wins', tasks);
    expect(check(score, 'validator').ok).toBe(false);
    expect(check(score, 'validator').score).toBe(0);
    expect(score.score).toBeLessThan(1);
  });

  test('dropping a feature lowers coverage', () => {
    const { plan } = fixture('sky-todo-quick-wins');
    const tasks = cloneTasks(plan).filter((task) => task.key !== 'tag-count');
    const score = rescore('sky-todo-quick-wins', tasks);
    const coverage = check(score, 'feature-coverage');
    expect(coverage.ok).toBe(false);
    expect(coverage.score).toBeCloseTo(2 / 3, 3);
  });

  test('a missing dependency edge fails dependency correctness', () => {
    const { plan } = fixture('sky-todo-launch-day');
    const tasks = cloneTasks(plan).map((task) =>
      task.key === 'due-badges' ? { ...task, dependsOn: [] } : task,
    );
    const score = rescore('sky-todo-launch-day', tasks);
    expect(check(score, 'dependencies').ok).toBe(false);
  });

  test('a spurious edge between disjoint features fails dependency correctness', () => {
    const { plan } = fixture('sky-todo-launch-day');
    const tasks = cloneTasks(plan).map((task) =>
      task.key === 'search' ? { ...task, dependsOn: ['theme'] } : task,
    );
    const score = rescore('sky-todo-launch-day', tasks);
    const deps = check(score, 'dependencies');
    expect(deps.ok).toBe(false);
    expect(deps.detail).toContain('spurious 1');
  });

  test('owning a forbidden shared file fails lane precision', () => {
    const { plan } = fixture('sky-todo-launch-day');
    const tasks = cloneTasks(plan).map((task) =>
      task.key === 'theme'
        ? { ...task, lane: { ...task.lane, owns: [...task.lane.owns, 'src/ui/render.ts'] } }
        : task,
    );
    const score = rescore('sky-todo-launch-day', tasks);
    const lanes = check(score, 'lane-precision');
    expect(lanes.ok).toBe(false);
    expect(lanes.detail).toContain('src/ui/render.ts');
  });

  test('a task without a test step fails DoD quality', () => {
    const { plan } = fixture('sky-todo-quick-wins');
    const tasks = cloneTasks(plan).map((task) =>
      task.key === 'today' ? { ...task, definitionOfDone: ['The header shows the date'] } : task,
    );
    const score = rescore('sky-todo-quick-wins', tasks);
    const dod = check(score, 'definition-of-done');
    expect(dod.ok).toBe(false);
    expect(dod.score).toBeCloseTo(2 / 3, 3);
  });

  test('a task count outside the answer-key range fails', () => {
    const { plan } = fixture('sky-todo-quick-wins');
    const tasks = cloneTasks(plan);
    const base = tasks[0];
    if (base === undefined) throw new Error('fixture needs a task');
    tasks.push({ ...base, key: 'extra', title: 'Extra unrelated task' });
    const score = rescore('sky-todo-quick-wins', tasks);
    expect(check(score, 'task-count').ok).toBe(false);
  });
});
