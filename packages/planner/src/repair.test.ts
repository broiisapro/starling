import { describe, expect, test } from 'bun:test';
import type { PlanIssue } from '@starling/core';
import { repairPlan } from './repair';
import { loadPlanFixture, planOf, task } from './test-fixtures';
import { validatePlan } from './validate';

function errorsOf(plan: ReturnType<typeof planOf>): PlanIssue[] {
  return validatePlan(plan).filter((issue) => issue.severity === 'error');
}

describe('repairPlan — task hygiene', () => {
  test('drops duplicate keys, keeping the first and explaining itself', () => {
    const first = task('dup');
    const outcome = repairPlan(
      planOf([first, task('dup', { lane: { owns: ['src/features/other/**'], reads: [] } })]),
    );
    expect(outcome.plan.tasks.map((entry) => entry.key)).toEqual(['dup']);
    expect(outcome.plan.tasks[0]?.lane.owns).toEqual(first.lane.owns);
    expect(outcome.notices.some((notice) => notice.message.includes('duplicate task key'))).toBe(true);
  });

  test('drops tasks that own nothing or cannot be verified', () => {
    const outcome = repairPlan(
      planOf([
        task('keep'),
        task('no-lane', { lane: { owns: [], reads: [] } }),
        task('no-dod', { definitionOfDone: [] }),
      ]),
    );
    expect(outcome.plan.tasks.map((entry) => entry.key)).toEqual(['keep']);
    expect(outcome.notices).toHaveLength(2);
    expect(outcome.notices.every((notice) => notice.severity === 'warn')).toBe(true);
  });

  test('drops dangling dependencies', () => {
    const outcome = repairPlan(planOf([task('a', { dependsOn: ['ghost', 'b'] }), task('b')]));
    expect(outcome.plan.tasks[0]?.dependsOn).toEqual(['b']);
    expect(outcome.notices[0]?.code).toBe('missing-dep');
    expect(outcome.notices[0]?.taskKeys).toEqual(['a', 'ghost']);
  });
});

describe('repairPlan — cycles', () => {
  test('breaks a two-node cycle by dropping the newest edge', () => {
    const outcome = repairPlan(planOf([task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })]));
    // "b" was added last, so b -> a is the edge that goes.
    expect(outcome.plan.tasks[0]?.dependsOn).toEqual(['b']);
    expect(outcome.plan.tasks[1]?.dependsOn).toEqual([]);
    expect(outcome.notices[0]?.code).toBe('cycle');
    expect(errorsOf(outcome.plan)).toEqual([]);
  });

  test('breaks a self-dependency', () => {
    const outcome = repairPlan(planOf([task('loop', { dependsOn: ['loop'] }), task('other')]));
    expect(outcome.plan.tasks[0]?.dependsOn).toEqual([]);
    expect(outcome.notices[0]?.message).toContain('loop -> loop');
    expect(errorsOf(outcome.plan)).toEqual([]);
  });

  test('breaks a three-node cycle and keeps the DAG valid', () => {
    const outcome = repairPlan(
      planOf([
        task('a', { dependsOn: ['b'] }),
        task('b', { dependsOn: ['c'] }),
        task('c', { dependsOn: ['a'] }),
      ]),
    );
    expect(errorsOf(outcome.plan)).toEqual([]);
    expect(outcome.notices.filter((notice) => notice.code === 'cycle')).toHaveLength(1);
  });
});

describe('repairPlan — lane overlaps', () => {
  test('serialises an overlapping pair in key order, regardless of array order', () => {
    const shared = { owns: ['src/ui/styles.css'], reads: [] };
    const outcome = repairPlan(
      planOf([
        task('beta', { lane: shared }),
        task('alpha', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
      ]),
    );
    const beta = outcome.plan.tasks.find((entry) => entry.key === 'beta');
    const alpha = outcome.plan.tasks.find((entry) => entry.key === 'alpha');
    expect(beta?.dependsOn).toEqual(['alpha']);
    expect(alpha?.dependsOn).toEqual([]);
    expect(outcome.notices[0]?.code).toBe('lane-overlap');
    expect(errorsOf(outcome.plan)).toEqual([]);
  });

  test('serialises every overlap in a three-way fan-in', () => {
    const shared = { owns: ['src/features/shared/**'], reads: [] };
    const outcome = repairPlan(
      planOf([task('a', { lane: shared }), task('b', { lane: shared }), task('c', { lane: shared })]),
    );
    const deps = Object.fromEntries(outcome.plan.tasks.map((entry) => [entry.key, entry.dependsOn]));
    expect(deps).toEqual({ a: [], b: ['a'], c: ['a', 'b'] });
    expect(errorsOf(outcome.plan)).toEqual([]);
  });

  test('leaves an already-serialised overlap alone', () => {
    const shared = { owns: ['src/ui/styles.css'], reads: [] };
    const outcome = repairPlan(
      planOf([
        task('first', { lane: shared }),
        task('second', { lane: { owns: ['src/ui/styles.css'], reads: [] }, dependsOn: ['first'] }),
      ]),
    );
    expect(outcome.notices).toEqual([]);
    expect(outcome.plan.tasks[1]?.dependsOn).toEqual(['first']);
  });
});

describe('repairPlan — purity', () => {
  test('a clean plan is returned unchanged with no notices', () => {
    const fixture = loadPlanFixture();
    const outcome = repairPlan(fixture);
    expect(outcome.notices).toEqual([]);
    expect(outcome.plan.tasks).toEqual(fixture.tasks);
  });

  test('never mutates the input plan', () => {
    const input = planOf([
      task('beta', { lane: { owns: ['src/ui/styles.css'], reads: [] }, dependsOn: ['ghost'] }),
      task('alpha', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
    ]);
    const before = JSON.stringify(input);
    repairPlan(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
