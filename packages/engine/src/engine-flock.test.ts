import { describe, expect, test } from 'bun:test';
import type { MockScriptContext } from '@starling/core/testing';
import {
  immediateScheduler,
  MockAuditor,
  type MockEventScript,
  MockNode,
  makeTaskSpec,
} from '@starling/core/testing';
import { buildHarness, smallPlan, waitFor } from './testing/harness';

const START_ONLY = [{ kind: 'session.started' as const, data: {} }];

function air(events?: MockEventScript): MockNode {
  return new MockNode({
    id: 'air',
    info: { kind: 'remote', name: 'M2 Air', maxSessions: 5 },
    ...(events === undefined ? {} : { events }),
  });
}

/** Prefer the perch while it is dispatchable, then fall back to the hub. */
function perchFirst(): { pick: (nodes: Array<{ id: string }>) => string | undefined } {
  return {
    pick: (nodes) => {
      const airNode = nodes.find((node) => node.id === 'air');
      if (airNode !== undefined) return airNode.id;
      return nodes.find((node) => node.id === 'hub')?.id ?? nodes[0]?.id;
    },
  };
}

const BUNDLE: { bundleUrlFor: (ref: string) => { url: string; token: string } } = {
  bundleUrlFor: (ref) => ({ url: `http://hub:7777/api/flock/bundle?ref=${ref}`, token: 'JOIN-CODE' }),
};

describe('flock: rescheduling when a perch disappears', () => {
  test('a node death mid-task moves the task to another node and it finishes', async () => {
    const plane = air(START_ONLY);
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [new MockNode({ id: 'hub', schedule: immediateScheduler }), plane],
      scheduler: perchFirst(),
      ...BUNDLE,
    });
    const runId = await h.start();
    await waitFor(() => plane.startedTasks.length === 1);
    const before = h.engine.getRun(runId)?.tasks.a;
    expect(before?.status).toBe('running');
    expect(before?.nodeId).toBe('air');

    plane.simulateDeath('lid closed');
    h.registry.remove('air');

    const run = await h.engine.waitForFinish(runId);
    expect(run.tasks.a?.status).toBe('merged');
    expect(run.tasks.a?.nodeId).toBe('hub');
    expect(run.status).toBe('finished');
    expect(h.transitionsFor('a')).toEqual([
      'pending->ready',
      'ready->running',
      'running->ready',
      'ready->running',
      'running->auditing',
      'auditing->merging',
      'merging->merged',
    ]);

    const migrated = h.ofType('task.migrated');
    expect(migrated).toHaveLength(1);
    expect(migrated[0]?.payload).toMatchObject({ taskKey: 'a', fromNode: 'air', toNode: 'hub' });
    expect(h.ofType('node.left')).toHaveLength(1);
    expect(h.nodes[0]?.startedTasks).toHaveLength(1);
    expect(plane.startedTasks).toHaveLength(1);
    // The attempt count is untouched by the migration.
    expect(run.tasks.a?.attempts).toBe(1);
  });

  test('a node lost during the audit re-runs the task and ignores the stale verdict', async () => {
    const plane = air();
    let audits = 0;
    const audit = new MockAuditor({
      decorate: (verdict) => {
        audits += 1;
        if (audits === 1) {
          plane.simulateDeath('offline during audit');
          h.registry.remove('air');
        }
        return verdict;
      },
    });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [new MockNode({ id: 'hub', schedule: immediateScheduler }), plane],
      nodeInfo: { air: { latencyMs: 1 } },
      audit,
      scheduler: { pick: (nodes) => (nodes.some((n) => n.id === 'air') ? 'air' : 'hub') },
      ...BUNDLE,
    });
    const run = await h.finish();

    expect(audit.inputs).toHaveLength(2);
    expect(run.tasks.a?.status).toBe('merged');
    expect(run.tasks.a?.attempts).toBe(1);
    expect(run.tasks.a?.nodeId).toBe('hub');
    expect(h.statusEvents().filter((event) => event.to === 'auditing')).toHaveLength(2);
  });

  test('node.joined is published and the new perch receives later tasks', async () => {
    const plane = air();
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' }), makeTaskSpec({ key: 'b' }), makeTaskSpec({ key: 'c' })]),
      nodes: [new MockNode({ id: 'hub' })],
      config: { maxParallel: 2 },
      scheduler: {
        pick: (nodes, task) => (task.key === 'a' ? 'hub' : (nodes.find((n) => n.id === 'air')?.id ?? 'hub')),
      },
      ...BUNDLE,
    });
    const runId = await h.start();
    h.registry.add(plane, {
      id: 'air',
      name: 'M2 Air',
      kind: 'remote',
      platform: 'darwin',
      arch: 'arm64',
      cpuCores: 8,
      memGb: 16,
      maxSessions: 5,
      activeSessions: 0,
      localModels: [],
      status: 'online',
      lastSeen: h.clock.now(),
      latencyMs: 3,
    });
    const run = await h.engine.waitForFinish(runId);

    expect(h.ofType('node.joined')).toHaveLength(1);
    expect(plane.startedTasks.length).toBeGreaterThanOrEqual(1);
    expect(Object.values(run.tasks).every((task) => task.status === 'merged')).toBe(true);
    expect(h.ofType('task.migrated')).toHaveLength(0);
  });
});

describe('flock: capacity and parallelism', () => {
  function activeCurve(events: Array<{ taskKey: string; to: string }>): number {
    const active = new Set<string>();
    let max = 0;
    for (const event of events) {
      if (
        event.to === 'running' ||
        event.to === 'fixing' ||
        event.to === 'auditing' ||
        event.to === 'merging'
      ) {
        active.add(event.taskKey);
      } else if (event.to === 'ready' || event.to === 'merged' || event.to === 'failed') {
        active.delete(event.taskKey);
      } else if (event.to === 'conflict' || event.to === 'cancelled') {
        active.delete(event.taskKey);
      }
      max = Math.max(max, active.size);
    }
    return max;
  }

  const five = smallPlan(
    ['a', 'b', 'c', 'd', 'e'].map((key) =>
      makeTaskSpec({ key, lane: { owns: [`src/${key}/**`], reads: [] } }),
    ),
  );

  test('maxParallel is respected at every instant and actually parallelises', async () => {
    const h = buildHarness({ plan: five, config: { maxParallel: 3 } });
    const run = await h.finish();
    expect(activeCurve(h.statusEvents())).toBe(3);
    expect(Object.values(run.tasks).every((task) => task.status === 'merged')).toBe(true);
  });

  test('registry capacity caps dispatch below maxParallel', async () => {
    const h = buildHarness({ plan: five, config: { maxParallel: 8 }, nodeInfo: { hub: { maxSessions: 2 } } });
    const run = await h.finish();
    expect(activeCurve(h.statusEvents())).toBe(2);
    expect(Object.values(run.tasks).every((task) => task.status === 'merged')).toBe(true);
  });

  test('a remote node receives a git bundle instead of a local path', async () => {
    const plane = air();
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [new MockNode({ id: 'hub', schedule: immediateScheduler }), plane],
      scheduler: { pick: (nodes) => nodes.find((node) => node.id === 'air')?.id ?? nodes[0]?.id },
      bundleUrlFor: (ref) => ({ url: `http://hub:7777/api/flock/bundle?ref=${ref}`, token: 'JOIN-CODE' }),
    });
    const run = await h.finish();

    expect(plane.startedTasks).toHaveLength(1);
    const repo = plane.startedTasks[0]?.repo;
    expect(repo?.kind).toBe('bundle');
    if (repo?.kind !== 'bundle') throw new Error('expected a bundle repo');
    expect(repo.url).toContain('ref=');
    expect(repo.url).toContain(run.integrationBranch ?? '');
    expect(repo.token).toBe('JOIN-CODE');
    expect(h.nodes[0]?.startedTasks).toHaveLength(0);
  });

  test('a remote node is skipped when the hub has no bundle URL', async () => {
    const plane = air();
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [new MockNode({ id: 'hub', schedule: immediateScheduler }), plane],
      scheduler: { pick: (nodes) => nodes.find((node) => node.id === 'air')?.id ?? nodes[0]?.id },
    });
    const run = await h.finish();
    expect(plane.startedTasks).toHaveLength(0);
    expect(h.nodes[0]?.startedTasks).toHaveLength(1);
    expect(run.status).toBe('finished');
    expect(h.logs('warn').some((msg) => msg.includes('no bundleUrlFor'))).toBe(true);
  });
});

describe('flock: budget', () => {
  test('the API budget cap stops dispatch and cancels the undispatched tail', async () => {
    const five = smallPlan(
      ['a', 'b', 'c', 'd', 'e'].map((key) =>
        makeTaskSpec({ key, lane: { owns: [`src/${key}/**`], reads: [] } }),
      ),
    );
    const h = buildHarness({
      plan: five,
      config: { maxParallel: 1, budget: { maxUsd: 0.001 } },
    });
    const run = await h.finish();

    expect(h.nodes[0]?.startedTasks).toHaveLength(2);
    expect(run.tasks.a?.status).toBe('merged');
    expect(run.tasks.b?.status).toBe('merged');
    expect(run.tasks.c?.status).toBe('cancelled');
    expect(run.tasks.d?.status).toBe('cancelled');
    expect(run.tasks.e?.status).toBe('cancelled');
    expect(run.metrics.tasksMerged).toBe(2);
    expect(run.status).toBe('finished');
    expect(h.logs('warn').some((msg) => msg.includes('budget'))).toBe(true);
  });

  test('a run that starts over budget dispatches nothing', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      config: { budget: { maxUsd: 0 } },
    });
    const run = await h.finish();
    expect(h.nodes[0]?.startedTasks).toHaveLength(0);
    expect(run.tasks.a?.status).toBe('cancelled');
    expect(run.status).toBe('failed');
  });
});

describe('flock: usage split', () => {
  test('a full-local worker model is accounted as local and saves API cost', async () => {
    const localNode = new MockNode({
      id: 'hub',
      schedule: immediateScheduler,
      events: (ctx: MockScriptContext) => [
        { kind: 'session.started', data: { model: { provider: 'ollama', model: 'qwen3.6:35b-a3b' } } },
        { kind: 'usage', data: { input: 1000, output: 500, cached: 0 } },
        { kind: 'session.idle', data: {} },
        { kind: 'text', data: { text: ctx.taskKey } },
      ],
    });
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [localNode],
    });
    const run = await h.finish();
    expect(run.metrics.localUsage).toEqual({ input: 1000, output: 500, cached: 0 });
    expect(run.metrics.localCallCount).toBe(1);
    expect(run.metrics.apiUsage).toEqual({ input: 0, output: 0, cached: 0 });
    expect(run.metrics.apiCostUsd).toBe(0);
    expect(run.metrics.estSavedUsd).toBeGreaterThan(0);
    expect(run.tasks.a?.costUsd).toBe(0);
  });
});
