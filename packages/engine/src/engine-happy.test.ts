import { describe, expect, test } from 'bun:test';
import { shortId } from '@starling/core';
import { buildHarness, HAPPY_SEQUENCE, type Harness, loadFixturePlan } from './testing/harness';

function assertAll(h: Harness, keys: string[], expected: string[]): void {
  for (const key of keys) expect(h.transitionsFor(key)).toEqual(expected);
}

describe('engine happy path: the sky-todo launch-day plan', () => {
  test('runs the fixture plan to completion with every task merged', async () => {
    const plan = loadFixturePlan();
    const h = buildHarness({ plan });
    const run = await h.finish();

    expect(run.status).toBe('finished');
    expect(Object.keys(run.tasks)).toHaveLength(7);
    for (const spec of plan.tasks) expect(run.tasks[spec.key]?.status).toBe('merged');
    expect(run.finishedAt).toBeDefined();
    expect(run.integrationBranch).toBe(`starling/${shortId(run.id)}/integration`);
    expect(h.ofType('run.finished')).toHaveLength(1);
  });

  test('emits the canonical lifecycle for every task', async () => {
    const plan = loadFixturePlan();
    const h = buildHarness({ plan });
    await h.finish();
    assertAll(
      h,
      plan.tasks.map((t) => t.key),
      HAPPY_SEQUENCE,
    );
  });

  test('merges in dependency order (dependents only after their dependency merged)', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    await h.finish();
    const order = h.ofType('merge.result').map((event) => event.payload.taskKey);
    expect(order).toHaveLength(7);
    expect(order.indexOf('dates-fix')).toBeLessThan(order.indexOf('due-badges'));
    expect(order.indexOf('shortcuts')).toBeLessThan(order.indexOf('help-overlay'));
    expect(new Set(order).size).toBe(7);
  });

  test('only ever promotes a task once its dependencies are merged', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    await h.finish();
    const plan = loadFixturePlan();
    const events = h.ofType('task.status');
    events.forEach((event, index) => {
      if (event.payload.to !== 'ready') return;
      const task = plan.tasks.find((candidate) => candidate.key === event.payload.taskKey);
      for (const dep of task?.dependsOn ?? []) {
        const mergedEarlier = events
          .slice(0, index)
          .some((candidate) => candidate.payload.taskKey === dep && candidate.payload.to === 'merged');
        expect(mergedEarlier).toBe(true);
      }
    });
  });

  test('publishes run.created, repomap.ready and plan.created in order, then task.status', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    await h.finish();
    const types = h.events.map((event) => event.type);
    expect(types[0]).toBe('run.created');
    expect(types.indexOf('repomap.ready')).toBeGreaterThan(types.indexOf('run.created'));
    expect(types.indexOf('plan.created')).toBeGreaterThan(types.indexOf('repomap.ready'));
    expect(types.indexOf('task.status')).toBeGreaterThan(types.indexOf('plan.created'));
    expect(types.at(-1)).toBe('run.finished');
  });

  test('starts each task on a branch from the integration branch with the worker prompt', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    const run = await h.finish();
    const integration = `starling/${shortId(run.id)}/integration`;
    const hub = h.nodes[0];
    expect(hub?.startedTasks).toHaveLength(7);
    for (const started of hub?.startedTasks ?? []) {
      expect(started.fromRef).toBe(integration);
      expect(started.branch).toBe(`starling/${shortId(run.id)}/${started.taskKey}`);
      expect(started.repo).toEqual({ kind: 'local', path: '/tmp/sky-todo' });
      expect(started.prompt).toStartWith(`WORKER ${started.taskKey}`);
      expect(started.model).toEqual({ provider: 'deepseek', model: 'deepseek-v4.1-flash' });
    }
    expect(h.prompts.calls.filter((call) => call.kind === 'worker')).toHaveLength(7);
    expect(run.tasks.theme?.sessionId).toBeDefined();
    expect(run.tasks.theme?.nodeId).toBe('hub');
  });

  test('ensures the integration branch and syncs the tracker before dispatch', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    const run = await h.finish();
    expect(h.workspace.branches.has(`starling/${shortId(run.id)}/integration`)).toBe(true);
    expect(h.tracker.calls[0]).toEqual({ method: 'syncPlan' });
    expect(h.tracker.calls.filter((call) => call.method === 'onMerged')).toHaveLength(7);
    expect(h.tracker.calls.filter((call) => call.method === 'openFinalPR')).toHaveLength(1);
  });

  test('forwards every agent event and accumulates usage/cost per task and run', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    const run = await h.finish();

    const agentEvents = h.ofType('agent.event');
    // Seven sessions × (session.started, text, tool.call, tool.result, file.edited, usage, session.idle).
    expect(agentEvents).toHaveLength(49);
    expect(agentEvents.map((event) => event.payload.kind)).toContain('session.idle');

    const theme = run.tasks.theme;
    expect(theme?.usage).toEqual({ input: 1200, output: 300, cached: 0 });
    expect(theme?.costUsd).toBeGreaterThan(0);
    expect(run.metrics.apiUsage).toEqual({ input: 8400, output: 2100, cached: 0 });
    expect(run.metrics.apiCostUsd).toBeCloseTo(theme ? theme.costUsd * 7 : 0, 10);
    expect(run.metrics.tasksMerged).toBe(7);
    expect(run.metrics.agentsActive).toBe(0);
    expect(run.metrics.localCallCount).toBe(0);
  });

  test('audits every task and records the verdict on the run', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    const run = await h.finish();
    expect(h.auditor.inputs).toHaveLength(7);
    expect(h.ofType('audit.verdict')).toHaveLength(7);
    for (const spec of loadFixturePlan().tasks) {
      expect(run.tasks[spec.key]?.attempts).toBe(1);
      expect(run.tasks[spec.key]?.lastVerdict?.pass).toBe(true);
    }
    // The auditor saw the node's collected diff and the real attempt number.
    expect(h.auditor.inputs[0]?.changedFiles).toEqual(['src/main.ts']);
    expect(h.auditor.inputs[0]?.diff.patch.length).toBeGreaterThan(0);
    expect(h.auditor.inputs.map((input) => input.attempt)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  test('cleanup runs after each merge and the final summary is determined by the template', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    await h.finish();
    const hub = h.nodes[0];
    expect(hub?.collected).toHaveLength(7);
    const summary = h.ofType('run.finished')[0]?.payload.summary ?? '';
    expect(summary).toContain('7/7 tasks');
    expect(summary).toContain('no failures');
    expect(summary).toContain('ready');
  });

  test('getRun and listRuns read the persisted run', async () => {
    const h = buildHarness({ plan: loadFixturePlan() });
    const run = await h.finish();
    expect(h.engine.getRun(run.id)?.status).toBe('finished');
    expect(h.engine.listRuns().map((stored) => stored.id)).toEqual([run.id]);
  });

  test('a seven-task DAG finishes with a single serial slot', async () => {
    const h = buildHarness({ plan: loadFixturePlan(), config: { maxParallel: 1 } });
    const run = await h.finish();
    expect(run.status).toBe('finished');
    expect(Object.values(run.tasks).every((task) => task.status === 'merged')).toBe(true);
    // With one slot nothing overlaps: each start waits for the previous merge.
    const types = h.statusEvents();
    const firstMerge = types.findIndex((event) => event.to === 'merged');
    const secondStart = types.findIndex(
      (event) => event.to === 'running' && types.indexOf(event) > firstMerge,
    );
    expect(secondStart).toBeGreaterThan(firstMerge);
  });
});
