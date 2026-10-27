import { describe, expect, test } from 'bun:test';
import type { ModelRef, Plan, PlanIssue } from '@starling/core';
import { FakeClock, isStarlingError } from '@starling/core';
import { MockLLM, makeGoal } from '@starling/core/testing';
import { createPlanner } from './planner';
import { draftOf, loadDraftFixture, loadRepoMapFixture, planOf, task } from './test-fixtures';
import { PLANNER_MAX_TASKS_LIMIT, validatePlan } from './validate';

const MODEL: ModelRef = { provider: 'deepseek', model: 'deepseek-v4.1-flash' };
const SHARED = { owns: ['src/ui/styles.css'], reads: [] };

function errorIssues(issues: PlanIssue[]): PlanIssue[] {
  return issues.filter((issue) => issue.severity === 'error');
}

function llmWith(drafts: unknown[]): MockLLM {
  return new MockLLM({ responses: drafts.map((draft) => ({ text: JSON.stringify(draft) })), model: MODEL });
}

describe('createPlanner — the happy path', () => {
  test('turns the launch-day fixture into a Plan with Starling-owned metadata', async () => {
    const clock = new FakeClock(1_731_000_009_000);
    const llm = llmWith([loadDraftFixture()]);
    const planner = createPlanner({ llm, clock });
    const goal = makeGoal({ id: 'goal-launch-day', text: 'Ship launch-day polish' });

    const { plan, issues } = await planner.plan(goal, loadRepoMapFixture());

    expect(plan.goalId).toBe('goal-launch-day');
    expect(plan.createdAt).toBe(clock.now());
    expect(plan.model).toEqual(MODEL);
    expect(plan.id).toHaveLength(26);
    expect(plan.tasks).toHaveLength(7);
    expect(plan.summary).toContain('lane-disjoint');
    expect(issues).toEqual([]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.role).toBe('planner');
    expect(llm.calls[0]?.maxTokens).toBe(8192);
    expect(llm.calls[0]?.temperature).toBe(0);
    expect(llm.calls[0]?.messages[0]?.content).toContain('Ship launch-day polish');
  });

  test('validate() uses the most recent repo map for glob warnings', async () => {
    const planner = createPlanner({ llm: llmWith([loadDraftFixture()]) });
    const goal = makeGoal();
    const { plan } = await planner.plan(goal, loadRepoMapFixture());

    expect(planner.validate(plan)).toEqual([]);

    const legacy = planOf([task('legacy', { lane: { owns: ['vendor/legacy/**'], reads: [] } })]);
    const warnings = planner.validate(legacy);
    expect(warnings.some((issue) => issue.message.includes('vendor/legacy/**'))).toBe(true);
  });

  test('validate() without a prior plan() cannot do glob-existence checks', () => {
    const planner = createPlanner({ llm: llmWith([]) });
    const legacy = planOf([task('legacy', { lane: { owns: ['vendor/legacy/**'], reads: [] } })]);
    const warnings = planner.validate(legacy);
    expect(warnings.some((issue) => issue.message.includes('vendor/legacy/**'))).toBe(false);
  });

  test('normalises keys, dependency references and globs', async () => {
    const draft = draftOf([
      task('Dates Fix', { lane: { owns: ['./src/lib/dates.ts/'], reads: [] } }),
      task('CSV Export!!', {
        dependsOn: ['Dates Fix'],
        lane: { owns: ['src/features/Export/'], reads: [] },
      }),
    ]);
    const planner = createPlanner({ llm: llmWith([draft]) });
    const { plan } = await planner.plan(makeGoal(), loadRepoMapFixture());

    expect(plan.tasks.map((entry) => entry.key)).toEqual(['t01-dates-fix', 't02-csv-export']);
    expect(plan.tasks[0]?.lane.owns).toEqual(['src/lib/dates.ts']);
    expect(plan.tasks[1]?.dependsOn).toEqual(['t01-dates-fix']);
    expect(plan.tasks[1]?.lane.owns).toEqual(['src/features/Export']);
  });
  test('plans a 60-task swarm without a count warning', async () => {
    const draft = draftOf(
      Array.from({ length: 60 }, (_, index) =>
        task(`cap-${index}`, { lane: { owns: [`src/features/f${index}/**`], reads: [] } }),
      ),
    );
    const planner = createPlanner({
      llm: llmWith([draft]),
      minTasks: 1,
      maxTasks: 60,
    });

    const { plan, issues } = await planner.plan(makeGoal(), loadRepoMapFixture());

    expect(plan.tasks).toHaveLength(60);
    expect(plan.tasks[0]?.key).toBe('t01-cap-0');
    expect(plan.tasks.at(-1)?.key).toBe('t60-cap-59');
    expect(issues).toEqual([]);
  });
});

describe('createPlanner — LLM repair loop', () => {
  test('an overlapping plan is fixed by the LLM on the first repair turn', async () => {
    const overlapping = draftOf([
      task('alpha', { lane: SHARED }),
      task('beta', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
    ]);
    const llm = llmWith([overlapping, loadDraftFixture()]);
    const planner = createPlanner({ llm });

    const { plan, issues } = await planner.plan(makeGoal(), loadRepoMapFixture());

    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.messages).toHaveLength(3);
    expect(llm.calls[1]?.messages[2]?.content).toContain('lane-overlap');
    expect(plan.tasks).toHaveLength(7);
    expect(issues).toEqual([]);
  });

  test('the model is asked at most maxRepairs times', async () => {
    const overlapping = draftOf([
      task('alpha', { lane: SHARED }),
      task('beta', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
    ]);
    const llm = new MockLLM({
      responder: () => ({ text: JSON.stringify(overlapping) }),
      model: MODEL,
    });
    const planner = createPlanner({ llm, maxRepairs: 2 });

    const { plan, issues } = await planner.plan(makeGoal(), loadRepoMapFixture());

    expect(llm.calls).toHaveLength(3); // first shot + two repairs
    expect(errorIssues(issues)).toEqual([]);
    expect(errorIssues(validatePlan(plan))).toEqual([]);
  });
});

describe('createPlanner — deterministic repair', () => {
  test('an overlapping plan is serialised when the model never fixes it', async () => {
    const overlapping = draftOf([
      task('alpha', { lane: SHARED }),
      task('beta', { lane: { owns: ['src/ui/styles.css'], reads: [] } }),
    ]);
    const llm = new MockLLM({
      responder: () => ({ text: JSON.stringify(overlapping) }),
      model: MODEL,
    });
    const planner = createPlanner({ llm, maxRepairs: 0 });

    const { plan, issues } = await planner.plan(makeGoal(), loadRepoMapFixture());

    expect(llm.calls).toHaveLength(1);
    expect(plan.tasks.find((entry) => entry.key.endsWith('-beta'))?.dependsOn).toEqual(['t01-alpha']);
    expect(issues.some((issue) => issue.code === 'lane-overlap')).toBe(true);
    expect(errorIssues(issues)).toEqual([]);
  });

  test('a cycle is repaired deterministically', async () => {
    const cyclic = draftOf([task('alpha', { dependsOn: ['beta'] }), task('beta', { dependsOn: ['alpha'] })]);
    const planner = createPlanner({
      llm: new MockLLM({ responder: () => ({ text: JSON.stringify(cyclic) }), model: MODEL }),
      maxRepairs: 0,
    });

    const { plan, issues } = await planner.plan(makeGoal(), loadRepoMapFixture());

    expect(plan.tasks.find((entry) => entry.key.endsWith('-beta'))?.dependsOn).toEqual([]);
    expect(issues.some((issue) => issue.code === 'cycle')).toBe(true);
    expect(errorIssues(issues)).toEqual([]);
  });

  test('a missing dependency is dropped deterministically', async () => {
    const dangling = draftOf([task('alpha', { dependsOn: ['ghost'] }), task('beta')]);
    const planner = createPlanner({
      llm: new MockLLM({ responder: () => ({ text: JSON.stringify(dangling) }), model: MODEL }),
      maxRepairs: 0,
    });

    const { plan, issues } = await planner.plan(makeGoal(), loadRepoMapFixture());

    expect(plan.tasks[0]?.dependsOn).toEqual([]);
    expect(issues.some((issue) => issue.code === 'missing-dep')).toBe(true);
    expect(errorIssues(issues)).toEqual([]);
  });

  test('tasks with no lane or no definition of done are dropped, with notices', async () => {
    const broken = draftOf([
      task('keeper'),
      task('no-lane', { lane: { owns: [], reads: [] } }),
      task('no-dod', { definitionOfDone: [] }),
    ]);
    const planner = createPlanner({
      llm: new MockLLM({ responder: () => ({ text: JSON.stringify(broken) }), model: MODEL }),
      maxRepairs: 0,
      minTasks: 1,
    });

    const { plan, issues } = await planner.plan(makeGoal(), loadRepoMapFixture());

    expect(plan.tasks.map((entry) => entry.key)).toEqual(['t01-keeper']);
    expect(issues.filter((issue) => issue.message.includes('dropped task'))).toHaveLength(2);
    expect(errorIssues(issues)).toEqual([]);
  });
});

describe('createPlanner — failure modes', () => {
  test('invalid JSON propagates as an LLM error', async () => {
    const llm = new MockLLM({ responses: [{ text: 'this is not json' }], model: MODEL });
    const planner = createPlanner({ llm });

    try {
      await planner.plan(makeGoal(), loadRepoMapFixture());
      throw new Error('expected plan() to reject');
    } catch (err) {
      expect(isStarlingError(err, 'LLM_ERROR')).toBe(true);
    }
  });

  test('a plan with no survivable tasks is rejected, not executed', async () => {
    const empty = draftOf([task('no-lane', { lane: { owns: [], reads: [] } })]);
    const planner = createPlanner({
      llm: new MockLLM({ responder: () => ({ text: JSON.stringify(empty) }), model: MODEL }),
      maxRepairs: 0,
      minTasks: 1,
    });

    try {
      await planner.plan(makeGoal(), loadRepoMapFixture());
      throw new Error('expected plan() to reject');
    } catch (err) {
      expect(isStarlingError(err, 'PLAN_INVALID')).toBe(true);
    }
  });

  test('rejects maxTasks outside 2..100', () => {
    const llm = llmWith([]);
    expect(() => createPlanner({ llm, maxTasks: 1 })).toThrow(/maxTasks/);
    expect(() => createPlanner({ llm, maxTasks: 101 })).toThrow(/maxTasks/);
    expect(() => createPlanner({ llm, minTasks: 0 })).toThrow(/minTasks/);
    expect(() => createPlanner({ llm, minTasks: 9, maxTasks: 3 })).toThrow(/minTasks/);
  });

  test('accepts swarm-sized bounds up to the exported hard limit', () => {
    const llm = llmWith([]);
    expect(() => createPlanner({ llm, maxTasks: 60 })).not.toThrow();
    expect(() => createPlanner({ llm, maxTasks: PLANNER_MAX_TASKS_LIMIT })).not.toThrow();
    expect(PLANNER_MAX_TASKS_LIMIT).toBe(100);
  });
});

describe('Plan shape', () => {
  test('every returned task keeps the contract fields and normalised types', async () => {
    const planner = createPlanner({ llm: llmWith([loadDraftFixture()]) });
    const { plan } = await planner.plan(makeGoal(), loadRepoMapFixture());
    for (const entry of plan.tasks as Plan['tasks']) {
      expect(typeof entry.key).toBe('string');
      expect(Array.isArray(entry.lane.owns)).toBe(true);
      expect(entry.definitionOfDone.length).toBeGreaterThan(0);
      expect(Number.isFinite(entry.estimateMin)).toBe(true);
    }
  });
});
