import { describe, expect, test } from 'bun:test';
import type { MockScriptContext } from '@starling/core/testing';
import { immediateScheduler, MockNode, makeTaskSpec } from '@starling/core/testing';
import type { StartRunInput } from './handshake';
import { buildHarness, smallPlan } from './testing/harness';

const STARTED = { kind: 'session.started' as const, data: {} };

/**
 * One task burns $1.50 of API tokens (1M input @ $0.30/M + 1M output @ $1.20/M), which makes a
 * $1 cap cross both the 80% warning and the hard stop on the very next transition.
 */
function expensiveNode(): MockNode {
  return new MockNode({
    id: 'hub',
    schedule: immediateScheduler,
    events: (_ctx: MockScriptContext) => [
      STARTED,
      { kind: 'usage', data: { input: 1_000_000, output: 1_000_000, cached: 0 } },
      { kind: 'session.idle', data: {} },
    ],
  });
}

function threeTasks() {
  return smallPlan(
    ['a', 'b', 'c'].map((key) => makeTaskSpec({ key, lane: { owns: [`src/${key}/**`], reads: [] } })),
  );
}

describe('budget policy', () => {
  test('warns at 80%, stops at 100%, lets running work finish and names what was skipped', async () => {
    const h = buildHarness({
      plan: threeTasks(),
      nodes: [expensiveNode()],
      config: { maxParallel: 1, budget: { maxUsd: 1 } },
    });
    const run = await h.finish();

    // a ran and merged; b and c were never dispatched.
    expect(h.nodes[0]?.startedTasks).toHaveLength(1);
    expect(run.tasks.a?.status).toBe('merged');
    expect(run.tasks.b?.status).toBe('cancelled');
    expect(run.tasks.c?.status).toBe('cancelled');
    expect(run.status).toBe('finished');
    expect(run.metrics.apiCostUsd).toBeCloseTo(1.5, 5);

    expect(h.policyLogs('budget.warn')).toHaveLength(1);
    expect(h.policyLogs('budget.warn')[0]?.msg).toContain('80%');
    expect(h.policyLogs('budget.stop')).toHaveLength(1);
    expect(h.policyLogs('budget.stop')[0]?.msg).toContain('$1');
    expect(h.policyLogs('budget.skipped')).toHaveLength(1);
    expect(h.policyLogs('budget.skipped')[0]?.msg).toContain('Skipping 2');

    const summary = h.ofType('run.finished')[0]?.payload.summary ?? '';
    expect(summary).toContain('Budget cap $1.00 reached');
    expect(summary).toContain('2 tasks skipped');
  });

  test('a warn-only spend keeps dispatching', async () => {
    const h = buildHarness({
      plan: threeTasks(),
      nodes: [expensiveNode()],
      config: { maxParallel: 1, budget: { maxUsd: 5 } },
    });
    const run = await h.finish();
    expect(h.nodes[0]?.startedTasks).toHaveLength(3);
    expect(Object.values(run.tasks).every((task) => task.status === 'merged')).toBe(true);
    expect(h.policyLogs('budget.warn')).toHaveLength(1);
    expect(h.policyLogs('budget.stop')).toHaveLength(0);
  });

  test('an additive StartRunInput budgetUsd (--budget) wins over the configured cap', async () => {
    const h = buildHarness({
      plan: threeTasks(),
      nodes: [expensiveNode()],
      config: { maxParallel: 1, budget: { maxUsd: 5 } },
    });
    const input = {
      goal: 'spend carefully',
      repoPath: '/tmp/sky-todo',
      budgetUsd: 0.5,
    } as unknown as StartRunInput;
    const runId = await h.start(input);
    const run = await h.engine.waitForFinish(runId);

    expect(h.nodes[0]?.startedTasks).toHaveLength(1);
    expect(run.tasks.b?.status).toBe('cancelled');
    expect(h.policyLogs('budget.stop')[0]?.msg).toContain('$0.5');
  });

  test('a policies.budgetUsd override beats both', async () => {
    const h = buildHarness({
      plan: threeTasks(),
      nodes: [expensiveNode()],
      config: { maxParallel: 1, budget: { maxUsd: 5 } },
      policies: { budgetUsd: 0.25 },
    });
    const run = await h.finish();
    expect(run.tasks.a?.status).toBe('merged');
    expect(run.tasks.b?.status).toBe('cancelled');
  });
});
