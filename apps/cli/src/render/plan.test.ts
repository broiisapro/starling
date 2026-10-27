import { describe, expect, test } from 'bun:test';
import type { Plan } from '@starling/core';
import { makeTaskSpec } from '@starling/core/testing';
import { analyzePlan, findCycles, planHealth } from '../plan-health';
import { GOAL_TEXT, PLAN } from '../testing/fixtures';
import { fixedPalette, plainPalette } from './palette';
import { renderLaneMatrix, renderPlan } from './plan';

describe('analyzePlan', () => {
  test('a clean plan has no issues', () => {
    expect(analyzePlan(PLAN)).toEqual([]);
    expect(planHealth([])).toEqual({ acyclic: true, lanesDisjoint: true, everyTaskHasDod: true });
  });

  test('flags overlapping lanes between tasks that can run together', () => {
    const overlapping = makeTaskSpec({
      key: 'search-copy',
      lane: { owns: ['src/features/search/**'], reads: [] },
      dependsOn: [],
    });
    const plan: Plan = { ...PLAN, tasks: [...PLAN.tasks, overlapping] };
    const issues = analyzePlan(plan);
    const overlap = issues.find((issue) => issue.code === 'lane-overlap');
    expect(overlap).toBeDefined();
    expect(overlap?.taskKeys).toEqual(['search', 'search-copy']);
    expect(planHealth(issues).lanesDisjoint).toBe(false);
  });

  test('does not flag overlap between dependent tasks', () => {
    const plan: Plan = {
      ...PLAN,
      tasks: PLAN.tasks.map((task) =>
        task.key === 'help' ? { ...task, lane: { ...task.lane, owns: ['src/features/search/**'] } } : task,
      ),
    };
    expect(analyzePlan(plan).some((issue) => issue.code === 'lane-overlap')).toBe(false);
  });

  test('detects cycles, missing dependencies, empty DoD and empty lanes', () => {
    const plan: Plan = {
      ...PLAN,
      tasks: [
        makeTaskSpec({ key: 'a', dependsOn: ['b'], lane: { owns: [], reads: [] } }),
        makeTaskSpec({ key: 'b', dependsOn: ['a'], definitionOfDone: [] }),
        makeTaskSpec({ key: 'c', dependsOn: ['ghost'] }),
      ],
    };
    const issues = analyzePlan(plan);
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain('cycle');
    expect(codes).toContain('missing-dep');
    expect(codes).toContain('empty-dod');
    expect(codes).toContain('empty-lane');
    expect(findCycles(plan)).toEqual([['a', 'b', 'a']]);
  });

  test('flags duplicate task keys', () => {
    const duplicate = makeTaskSpec({ key: 'theme' });
    const issues = analyzePlan({ ...PLAN, tasks: [...PLAN.tasks, duplicate] });
    expect(issues.some((issue) => issue.code === 'other' && issue.message.includes('theme'))).toBe(true);
  });
});

describe('renderPlan', () => {
  const plain = plainPalette();

  test('renders a task table, lane matrix and health checks (non-TTY snapshot)', () => {
    const text = renderPlan(PLAN, analyzePlan(PLAN), { palette: plain, goal: GOAL_TEXT, width: 100 });
    expect(text).not.toContain('\x1b[');
    expect(text).toContain('Starling plan');
    expect(text).toContain('DARK mode'.toLowerCase());
    expect(text).toContain('Lane matrix');
    expect(text).toContain('✔ acyclic');
    expect(text).toContain('No issues');
    expect(text).toMatchSnapshot();
  });

  test('colours status glyphs on a TTY', () => {
    const text = renderPlan(PLAN, analyzePlan(PLAN), {
      palette: fixedPalette(true),
      goal: GOAL_TEXT,
      width: 100,
      badge: 'dry run',
    });
    expect(text).toContain('\x1b[');
    expect(text).toContain('dry run');
    expect(text).toMatchSnapshot();
  });

  test('lists issues with severity and affected keys', () => {
    const plan: Plan = {
      ...PLAN,
      tasks: [
        makeTaskSpec({ key: 'a', dependsOn: ['b'], lane: { owns: [], reads: [] } }),
        makeTaskSpec({ key: 'b', dependsOn: ['a'], definitionOfDone: [] }),
      ],
    };
    const text = renderPlan(plan, analyzePlan(plan), { palette: plain, width: 100 });
    expect(text).toContain('Issues (');
    expect(text).toContain('cycle');
    expect(text).toContain('empty-dod');
    expect(text).toContain('empty-lane');
  });

  test('lane matrix marks overlaps and truncates long plans', () => {
    const many = [
      ...PLAN.tasks,
      ...Array.from({ length: 9 }, (_, index) =>
        makeTaskSpec({ key: `extra-${index}`, lane: { owns: [`extra/${index}/**`], reads: [] } }),
      ),
    ];
    const table = renderLaneMatrix({ ...PLAN, tasks: many }, plain);
    expect(table).toContain('showing the first 10 of 12 tasks');
    const overlap = renderLaneMatrix(
      {
        ...PLAN,
        tasks: [
          makeTaskSpec({ key: 'a', lane: { owns: ['src/**'], reads: [] } }),
          makeTaskSpec({ key: 'b', lane: { owns: ['src/features/**'], reads: [] } }),
        ],
      },
      plain,
    );
    expect(overlap).toContain('✘');
  });
});
