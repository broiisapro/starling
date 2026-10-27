import { describe, expect, test } from 'bun:test';
import type { PlanIssue } from '@starling/core';
import { StarlingError } from '@starling/core';
import { MockAuditor, MockLLM, MockNode, makeTaskSpec } from '@starling/core/testing';
import { buildHarness, FakeTimers, smallPlan, waitFor } from './testing/harness';

const START_ONLY = [{ kind: 'session.started' as const, data: {} }];

function stuckNode(): MockNode {
  return new MockNode({ id: 'hub', info: { kind: 'local', maxSessions: 8 }, events: START_ONLY });
}

describe('dry run', () => {
  test('plans, publishes plan.created, dispatches nothing and stops as planned', async () => {
    const timers = new FakeTimers();
    const h = buildHarness({ plan: smallPlan(), timers });
    const runId = await h.start({ dryRun: true });
    const run = await h.engine.waitForFinish(runId);

    expect(run.status).toBe('planned');
    expect(run.plan?.tasks).toHaveLength(3);
    expect(h.nodes[0]?.startedTasks).toHaveLength(0);
    expect(h.statusEvents()).toHaveLength(0);
    expect(h.ofType('run.finished')).toHaveLength(0);
    expect(h.ofType('plan.created')).toHaveLength(1);
    expect(h.tracker.calls).toHaveLength(0);
    expect(h.workspace.branches.has('main')).toBe(true);
    expect(h.ofType('metrics').length).toBeGreaterThanOrEqual(1);
    expect(timers.active).toBe(0);
    expect(h.logs('info').some((msg) => msg.includes('Dry run'))).toBe(true);
  });

  test('a dry run still reports plan issues without refusing the plan', async () => {
    const issues: PlanIssue[] = [
      { severity: 'error', code: 'cycle', message: 'a → b → a', taskKeys: ['a', 'b'] },
    ];
    const h = buildHarness({ plan: smallPlan(), issues });
    const run = await h.finish({ dryRun: true });
    expect(run.status).toBe('planned');
    expect(h.ofType('plan.created')[0]?.payload.issues).toHaveLength(1);
  });
});

describe('planning failures', () => {
  const errorIssue: PlanIssue = {
    severity: 'error',
    code: 'lane-overlap',
    message: 'a and b own the same file',
    taskKeys: ['a', 'b'],
  };

  test('an error-level plan issue refuses dispatch and fails the run', async () => {
    const h = buildHarness({ plan: smallPlan(), issues: [errorIssue] });
    const run = await h.finish();
    expect(run.status).toBe('failed');
    expect(h.nodes[0]?.startedTasks).toHaveLength(0);
    expect(h.ofType('plan.created')).toHaveLength(1);
    expect(h.logs('error').some((msg) => msg.includes('refusing to dispatch'))).toBe(true);
    expect(h.ofType('run.finished')[0]?.payload.summary).toContain('ended:');
  });

  test('a mapping failure fails the run instead of leaving it in mapping', async () => {
    const h = buildHarness({ plan: smallPlan() });
    h.deps.repoMapper.map = async () => {
      throw new Error('repo not readable');
    };
    const run = await h.finish();
    expect(run.status).toBe('failed');
    expect(h.logs('error').some((msg) => msg.includes('repo not readable'))).toBe(true);
    expect(h.ofType('run.finished')).toHaveLength(1);
  });

  test('a planner failure fails the run', async () => {
    const h = buildHarness({ plan: smallPlan() });
    h.deps.planner.plan = async () => {
      throw new Error('model refused');
    };
    const run = await h.finish();
    expect(run.status).toBe('failed');
    expect(h.ofType('repomap.ready')).toHaveLength(1);
    expect(h.ofType('plan.created')).toHaveLength(0);
  });

  test('start rejects an empty goal and a missing repo path', async () => {
    const h = buildHarness();
    await expect(h.engine.start({ goal: '  ', repoPath: '/tmp/sky-todo' })).rejects.toBeInstanceOf(
      StarlingError,
    );
    await expect(h.engine.start({ goal: 'do it', repoPath: '' })).rejects.toBeInstanceOf(StarlingError);
  });

  test('waitForFinish rejects for an unknown run', async () => {
    const h = buildHarness();
    await expect(h.engine.waitForFinish('nope')).rejects.toBeInstanceOf(StarlingError);
  });
});

describe('cancellation', () => {
  test('cancel aborts the live session and cancels unfinished tasks', async () => {
    const node = stuckNode();
    let aborts = 0;
    const originalAbort = node.abort.bind(node);
    node.abort = async (handle) => {
      aborts += 1;
      return originalAbort(handle);
    };
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' }), makeTaskSpec({ key: 'b', dependsOn: ['a'] })]),
      nodes: [node],
    });
    const runId = await h.start();
    await waitFor(() => node.startedTasks.length === 1);
    await h.engine.cancel(runId);
    const run = await h.engine.waitForFinish(runId);

    expect(aborts).toBe(1);
    expect(run.status).toBe('cancelled');
    expect(run.tasks.a?.status).toBe('cancelled');
    expect(run.tasks.b?.status).toBe('cancelled');
    expect(h.transitionsFor('a')).toEqual(['pending->ready', 'ready->running', 'running->cancelled']);
    expect(h.ofType('run.finished')[0]?.payload.summary).toContain('was cancelled');
    expect(h.tracker.calls.some((call) => call.method === 'openFinalPR')).toBe(false);
  });

  test('cancel after the run finished is a no-op', async () => {
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]) });
    const run = await h.finish();
    await h.engine.cancel(run.id);
    expect(h.engine.getRun(run.id)?.status).toBe('finished');
  });

  test('cancel for an unknown run rejects', async () => {
    const h = buildHarness();
    await expect(h.engine.cancel('missing')).rejects.toBeInstanceOf(StarlingError);
  });
});

describe('abortTask', () => {
  test('aborting one running task cancels it and finishes the run', async () => {
    const node = stuckNode();
    let aborts = 0;
    const originalAbort = node.abort.bind(node);
    node.abort = async (handle) => {
      aborts += 1;
      return originalAbort(handle);
    };
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]), nodes: [node] });
    const runId = await h.start();
    await waitFor(() => node.startedTasks.length === 1);
    await h.engine.abortTask(runId, 'a');
    const run = await h.engine.waitForFinish(runId);

    expect(aborts).toBe(1);
    expect(run.tasks.a?.status).toBe('cancelled');
    expect(run.status).toBe('failed');
  });

  test('aborting an unknown task rejects with INVALID_ARGUMENT', async () => {
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]) });
    const run = await h.finish();
    try {
      await h.engine.abortTask(run.id, 'nope');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StarlingError);
      expect((err as StarlingError).code).toBe('INVALID_ARGUMENT');
    }
  });

  test('aborting an already merged task does nothing', async () => {
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]) });
    const run = await h.finish();
    await h.engine.abortTask(run.id, 'a');
    expect(h.engine.getRun(run.id)?.tasks.a?.status).toBe('merged');
  });
});

describe('writer summary', () => {
  test('the writer model replaces the template summary and its usage is metered locally', async () => {
    const writer = new MockLLM({ responses: [{ text: 'Seven birds, one wire. 🐦' }] });
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]), writer });
    const run = await h.finish();

    expect(h.ofType('run.finished')[0]?.payload.summary).toBe('Seven birds, one wire. 🐦');
    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0]?.role).toBe('writer');
    expect(writer.calls[0]?.messages[0]?.content).toContain('Tasks: 1 total');
    expect(run.metrics.localCallCount).toBe(1);
    expect(run.metrics.localUsage).toEqual({ input: 100, output: 20, cached: 0 });
  });

  test('a failing writer falls back to the template and logs a warning', async () => {
    const writer = new MockLLM();
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]), writer });
    const run = await h.finish();
    expect(run.status).toBe('finished');
    expect(h.ofType('run.finished')[0]?.payload.summary).toContain('1/1 tasks');
    expect(h.logs('warn').some((msg) => msg.includes('writer model failed'))).toBe(true);
  });
});

describe('metrics throttle', () => {
  test('metrics are throttled to about once a second while every task still reports', async () => {
    const timers = new FakeTimers();
    let advance = (_ms: number): void => {};
    const audit = new MockAuditor({
      decorate: (verdict) => {
        // Simulate a run where each audit takes 700 ms of wall-clock time.
        advance(700);
        return verdict;
      },
    });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' }), makeTaskSpec({ key: 'b' }), makeTaskSpec({ key: 'c' })]),
      audit,
      config: { maxParallel: 1 },
      timers,
    });
    advance = (ms) => h.clock.advance(ms);
    const run = await h.finish();

    const metrics = h.ofType('metrics').map((event) => event.payload);
    expect(metrics.length).toBeGreaterThanOrEqual(3);
    expect(metrics.length).toBeLessThan(h.statusEvents().length);
    expect(metrics.at(-1)?.tasksMerged).toBe(3);
    expect(run.metrics.tasksMerged).toBe(3);
    expect(timers.intervalMs).toBe(5000);
    expect(timers.active).toBe(0);
  });

  test('heartbeat timers are registered during a run and cleared at the end', async () => {
    const timers = new FakeTimers();
    const node = stuckNode();
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]), nodes: [node], timers });
    const runId = await h.start();
    await waitFor(() => node.startedTasks.length === 1);
    expect(timers.active).toBe(1);
    await h.engine.abortTask(runId, 'a');
    await h.engine.waitForFinish(runId);
    expect(timers.active).toBe(0);
  });
});
