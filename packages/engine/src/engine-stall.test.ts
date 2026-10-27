import { describe, expect, test } from 'bun:test';
import type { MockScriptContext } from '@starling/core/testing';
import { makeTaskSpec } from '@starling/core/testing';
import { buildHarness, FakeTimers, smallPlan, waitFor } from './testing/harness';
import { PatientNode } from './testing/nodes';

const STARTED = { kind: 'session.started' as const, data: {} };

function planOne() {
  return smallPlan([makeTaskSpec({ key: 'a' })]);
}

describe('stall policy', () => {
  test('a silent session is aborted, the prompt is resent once, and the task still lands', async () => {
    const timers = new FakeTimers();
    const node = new PatientNode({
      id: 'hub',
      info: { kind: 'local', maxSessions: 8 },
      events: (ctx: MockScriptContext) =>
        ctx.pass === 1 ? [STARTED] : [STARTED, { kind: 'session.idle', data: {} }],
    });
    const h = buildHarness({
      plan: planOne(),
      nodes: [node],
      timers,
      policies: { stallAfterMs: 1_000 },
    });

    const runId = await h.start();
    await waitFor(() => node.startedTasks.length === 1);
    h.clock.advance(1_000);
    timers.fireTimeouts();

    const run = await h.engine.waitForFinish(runId);
    expect(node.abortCalls).toHaveLength(1);
    expect(node.prompts).toHaveLength(1);
    expect(node.prompts[0]?.prompt).toContain('WORKER a');
    // The recovery spent one attempt; the successful audit is the second.
    expect(run.tasks.a?.attempts).toBe(2);
    expect(run.tasks.a?.status).toBe('merged');
    // Same session: no second startTask and no trip through `ready`.
    expect(node.startedTasks).toHaveLength(1);
    expect(h.transitionsFor('a')).toEqual([
      'pending->ready',
      'ready->running',
      'running->auditing',
      'auditing->merging',
      'merging->merged',
    ]);

    expect(h.policyLogs('stall.detected')).toHaveLength(1);
    expect(h.policyLogs('stall.retry')).toHaveLength(1);
    expect(h.policyLogs('stall.detected')[0]?.msg).toContain('no agent event for 1s');
  });

  test('a second stall fails the task with a reason instead of looping', async () => {
    const timers = new FakeTimers();
    const node = new PatientNode({
      id: 'hub',
      info: { kind: 'local', maxSessions: 8 },
      events: [STARTED],
    });
    const h = buildHarness({
      plan: planOne(),
      nodes: [node],
      timers,
      policies: { stallAfterMs: 1_000 },
    });

    const runId = await h.start();
    await waitFor(() => node.startedTasks.length === 1);
    h.clock.advance(1_000);
    timers.fireTimeouts();
    await waitFor(() => node.prompts.length === 1);

    h.clock.advance(1_000);
    timers.fireTimeouts();

    const run = await h.engine.waitForFinish(runId);
    expect(run.tasks.a?.status).toBe('failed');
    expect(run.status).toBe('failed');
    expect(node.abortCalls).toHaveLength(2);
    expect(h.policyLogs('stall.failed')).toHaveLength(1);
    expect(h.policyLogs('stall.failed')[0]?.msg).toContain('no recovery left');
    // One attempt from the first recovery; the failure does not invent another.
    expect(run.tasks.a?.attempts).toBe(1);
  });

  test('an expired stall with recovery disabled fails immediately', async () => {
    const timers = new FakeTimers();
    const node = new PatientNode({
      id: 'hub',
      info: { kind: 'local', maxSessions: 8 },
      events: [STARTED],
    });
    const h = buildHarness({
      plan: planOne(),
      nodes: [node],
      timers,
      policies: { stallAfterMs: 500, maxStallRetries: 0 },
    });

    const runId = await h.start();
    await waitFor(() => node.startedTasks.length === 1);
    h.clock.advance(500);
    timers.fireTimeouts();

    const run = await h.engine.waitForFinish(runId);
    expect(run.tasks.a?.status).toBe('failed');
    expect(node.prompts).toHaveLength(0);
    expect(h.policyLogs('stall.failed')).toHaveLength(1);
  });

  test('the watchdog is not armed when stallAfterMs is 0 and leaves no timers behind', async () => {
    const timers = new FakeTimers();
    const h = buildHarness({ plan: planOne(), timers, policies: { stallAfterMs: 0 } });
    const run = await h.finish();
    expect(run.status).toBe('finished');
    expect(timers.pendingTimeouts).toBe(0);
    expect(timers.active).toBe(0);
  });
});
