import { describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core';
import { defaultConfig, isStarlingError } from '@starling/core';
import { compose } from './compose';

describe('compose', () => {
  test('real mode is not wired yet and says so with a code', () => {
    try {
      compose(defaultConfig, { mode: 'real' });
      throw new Error('expected compose(real) to throw');
    } catch (err) {
      expect(isStarlingError(err)).toBe(true);
      if (isStarlingError(err)) {
        expect(String(err.code)).toBe('NOT_WIRED');
        expect(err.message).toContain('epic 40');
      }
    }
  });

  test('mock mode returns the full §8 composition', () => {
    const composition = compose(defaultConfig, { mode: 'mock', stepMs: 0 });
    expect(typeof composition.engine.start).toBe('function');
    expect(typeof composition.engine.waitForFinish).toBe('function');
    expect(typeof composition.bus.publish).toBe('function');
    expect(typeof composition.store.saveRun).toBe('function');
    expect(composition.flock).toBeDefined();
    expect(composition.flock?.registry.list()).toHaveLength(2);
  });

  test('runs a goal end to end through the mock engine', async () => {
    const composition = compose(defaultConfig, { mode: 'mock', stepMs: 0 });
    const events: StarlingEvent[] = [];
    composition.bus.subscribe((event) => events.push(event));

    const { runId } = await composition.engine.start({
      goal: 'Add CSV export with escaping',
      repoPath: '/tmp/sky-todo',
    });
    const run = await composition.engine.waitForFinish(runId);

    expect(run.status).toBe('finished');
    expect(run.plan?.tasks).toHaveLength(5);
    expect(run.integrationBranch).toMatch(/^starling\/[a-z0-9]{6}\/integration$/);
    const merged = Object.values(run.tasks).filter((task) => task.status === 'merged');
    expect(merged).toHaveLength(5);
    expect(run.metrics.tasksMerged).toBe(5);
    expect(run.metrics.tasksFailed).toBe(0);
    expect(run.tasks.tests?.attempts).toBe(2);
    expect(run.tasks.theme).toBeUndefined();

    const types = new Set(events.map((event) => event.type));
    for (const type of [
      'run.created',
      'repomap.ready',
      'plan.created',
      'task.status',
      'agent.event',
      'audit.verdict',
      'merge.result',
      'metrics',
      'node.joined',
      'run.finished',
    ]) {
      expect(types.has(type as StarlingEvent['type'])).toBe(true);
    }
    const finished = events.find((event) => event.type === 'run.finished');
    expect(finished?.payload).toMatchObject({ run: { status: 'finished' } });
    expect(composition.engine.getRun(runId)?.status).toBe('finished');
    expect(composition.engine.listRuns().map((entry) => entry.id)).toContain(runId);
  });

  test('a dry run stops after planning', async () => {
    const composition = compose(defaultConfig, { mode: 'mock', stepMs: 0 });
    const { runId } = await composition.engine.start({
      goal: 'Add keyboard shortcuts',
      repoPath: '/tmp/sky-todo',
      dryRun: true,
    });
    const run = await composition.engine.waitForFinish(runId);
    expect(run.status).toBe('finished');
    expect(run.plan?.tasks).toHaveLength(5);
    expect(Object.values(run.tasks).every((task) => task.status === 'pending')).toBe(true);
    expect(run.metrics.tasksMerged).toBe(0);
  });

  test('cancels a run that is still mapping', async () => {
    const composition = compose(defaultConfig, { mode: 'mock', stepMs: 20 });
    const { runId } = await composition.engine.start({ goal: 'Do a thing', repoPath: '/tmp/repo' });
    await composition.engine.cancel(runId);
    const run = await composition.engine.waitForFinish(runId);
    expect(run.status).toBe('cancelled');
  });

  test('rejects an empty goal and an unknown run', async () => {
    const composition = compose(defaultConfig, { mode: 'mock', stepMs: 0 });
    await expect(composition.engine.start({ goal: '  ', repoPath: '/tmp/repo' })).rejects.toThrow();
    await expect(composition.engine.waitForFinish('missing')).rejects.toThrow();
  });

  test('the mock flock registers, heartbeats and bundles', async () => {
    const composition = compose(defaultConfig, { mode: 'mock', stepMs: 0 });
    const flock = composition.flock;
    if (flock === undefined) throw new Error('mock flock missing');
    const join = flock.joinInfo();
    expect(flock.verifyToken(join.code)).toBe(true);
    expect(flock.verifyToken('nope')).toBe(false);

    const hub = flock.registry.list()[0];
    if (hub === undefined) throw new Error('hub missing');
    const info = { ...hub, id: 'perch-7788', name: 'M2 Air', kind: 'remote' as const };
    const { nodeId } = await flock.register({ url: 'http://192.168.1.50:7788', info });
    expect(nodeId).toBe('perch-7788');
    expect(flock.registry.list()).toHaveLength(3);

    flock.heartbeat({ nodeId, info: { ...info, activeSessions: 3 } });
    const updated = flock.registry.list().find((node) => node.id === nodeId);
    expect(updated?.activeSessions).toBe(3);

    const bundle = await flock.bundle('starling/abc/integration');
    expect(bundle.path).toContain('starling-abc-integration.bundle');

    await flock.close();
  });
});
