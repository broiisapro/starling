import { describe, expect, test } from 'bun:test';
import type { Plan } from '../lib/core';
import { makePlan, makeTaskSpec } from '../lib/core-testing';
import { validatePlan } from './validate';

function plan(tasks: Plan['tasks']): Plan {
  return makePlan({ tasks });
}

describe('validatePlan', () => {
  test('a disjoint, acyclic plan has no issues', () => {
    const issues = validatePlan(
      plan([
        makeTaskSpec({ key: 'a', lane: { owns: ['src/a/**'], reads: [] } }),
        makeTaskSpec({ key: 'b', lane: { owns: ['src/b/**'], reads: [] } }),
      ]),
    );
    expect(issues).toEqual([]);
  });

  test('reports a dependency cycle', () => {
    const issues = validatePlan(
      plan([
        makeTaskSpec({ key: 'a', dependsOn: ['b'], lane: { owns: ['src/a/**'], reads: [] } }),
        makeTaskSpec({ key: 'b', dependsOn: ['a'], lane: { owns: ['src/b/**'], reads: [] } }),
      ]),
    );
    expect(issues.map((issue) => issue.code)).toContain('cycle');
  });

  test('reports missing dependencies, empty lanes and empty DoDs', () => {
    const issues = validatePlan(
      plan([
        makeTaskSpec({
          key: 'a',
          dependsOn: ['ghost'],
          lane: { owns: [], reads: [] },
          definitionOfDone: [],
        }),
      ]),
    );
    expect(issues.map((issue) => issue.code).sort()).toEqual(['empty-dod', 'empty-lane', 'missing-dep']);
  });

  test('accepts a shared lane when a dependency serialises the tasks', () => {
    const issues = validatePlan(
      plan([
        makeTaskSpec({ key: 'a', lane: { owns: ['src/ui/render.ts'], reads: [] } }),
        makeTaskSpec({
          key: 'b',
          dependsOn: ['a'],
          lane: { owns: ['src/ui/render.ts'], reads: [] },
        }),
      ]),
    );
    expect(issues.filter((issue) => issue.code === 'lane-overlap')).toEqual([]);
  });

  test('flags a shared lane for concurrent tasks', () => {
    const issues = validatePlan(
      plan([
        makeTaskSpec({ key: 'a', lane: { owns: ['src/ui/render.ts'], reads: [] } }),
        makeTaskSpec({ key: 'b', lane: { owns: ['src/ui/**'], reads: [] } }),
      ]),
    );
    expect(issues.map((issue) => issue.code)).toContain('lane-overlap');
  });
});
