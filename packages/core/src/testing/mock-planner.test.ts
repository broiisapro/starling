import { describe, expect, test } from 'bun:test';
import { makeGoal, makePlan } from './factories';
import { MockPlanner } from './mock-planner';
import { makeRepoMap } from './mock-repomap';

describe('MockPlanner', () => {
  test('builds a plan from the goal when unscripted', async () => {
    const planner = new MockPlanner();
    const goal = makeGoal();
    const { plan, issues } = await planner.plan(goal, makeRepoMap());
    expect(plan.goalId).toBe(goal.id);
    expect(issues).toEqual([]);
    expect(planner.planCalls).toHaveLength(1);
  });

  test('returns scripted plans and validation issues', async () => {
    const goal = makeGoal();
    const scripted = makePlan({ goalId: goal.id, summary: 'scripted' });
    const issue = {
      severity: 'warn' as const,
      code: 'empty-dod' as const,
      message: 'missing DoD',
      taskKeys: ['theme'],
    };
    const planner = new MockPlanner({ results: [{ plan: scripted, issues: [issue] }], issues: [issue] });
    expect((await planner.plan(goal, makeRepoMap())).plan.summary).toBe('scripted');
    expect(planner.validate(scripted)).toEqual([issue]);
    expect(planner.validateCalls).toHaveLength(1);
  });

  test('a custom builder sees the goal and map', async () => {
    const planner = new MockPlanner({
      build: (goal, map) => makePlan({ goalId: goal.id, summary: `${map.files.length} files` }),
    });
    const goal = makeGoal();
    const { plan } = await planner.plan(goal, makeRepoMap());
    expect(plan.summary).toBe('4 files');
  });
});
