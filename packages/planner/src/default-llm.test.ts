import { describe, expect, test } from 'bun:test';
import { isStarlingError } from '@starling/core';
import { MockLLM, makeGoal } from '@starling/core/testing';
import { createPlanner } from './planner';
import { loadDraftFixture, loadRepoMapFixture } from './test-fixtures';

describe('createPlanner without an explicit LLM', () => {
  test('is constructible: the model can be resolved from the environment later', () => {
    const planner = createPlanner({});
    expect(typeof planner.plan).toBe('function');
    expect(typeof planner.validate).toBe('function');
  });

  test('resolving a bad STARLING_LLM_PROFILE fails before any request is made', async () => {
    const previous = process.env.STARLING_LLM_PROFILE;
    process.env.STARLING_LLM_PROFILE = 'definitely-not-a-profile';
    try {
      const planner = createPlanner({});
      const error = await planner.plan(makeGoal(), loadRepoMapFixture()).catch((err: unknown) => err);
      expect(isStarlingError(error, 'CONFIG_INVALID')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.STARLING_LLM_PROFILE;
      else process.env.STARLING_LLM_PROFILE = previous;
    }
  });

  test('an injected LLM wins and is used once per turn', async () => {
    const llm = new MockLLM({ responses: [{ text: JSON.stringify(loadDraftFixture()) }] });
    const planner = createPlanner({ llm, maxRepairs: 0 });
    const { plan } = await planner.plan(makeGoal(), loadRepoMapFixture());
    expect(plan.tasks).toHaveLength(7);
    expect(llm.calls).toHaveLength(1);
  });
});
