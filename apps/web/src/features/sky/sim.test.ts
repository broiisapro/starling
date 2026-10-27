import { describe, expect, test } from 'bun:test';
import type { StarlingEvent, TaskRun, TaskStatus } from '@starling/core';
import {
  BASE_TS,
  makeAgentEvent,
  makeNodeInfo,
  makePlan,
  makeTaskRun,
  makeTaskSpec,
} from '@starling/core/testing';
import type { BehaviourKind } from './behaviour';
import { calmZone } from './layout';
import { statusColor } from './palette';
import { BIRDS_PER_FLOCK, createSky, MAX_BIRDS, MAX_TASKS, type SkySimulation, TRAIL_CAP } from './sim';

const HUB = makeNodeInfo({ id: 'hub', name: 'MacBook Pro', kind: 'local' });
const AIR = makeNodeInfo({
  id: 'air',
  name: 'MacBook Air',
  kind: 'remote',
  url: 'http://192.168.1.42:7778',
  latencyMs: 12,
});

function planOf(keys: readonly string[]) {
  return makePlan({ tasks: keys.map((key) => makeTaskSpec({ key, title: `Task ${key}` })) });
}

function runsOf(keys: readonly string[], status: TaskStatus, nodeId?: string): Record<string, TaskRun> {
  const out: Record<string, TaskRun> = {};
  for (const key of keys) out[key] = makeTaskRun({ taskKey: key, status, nodeId });
  return out;
}

function agentEvent(taskKey: string, ts: number): StarlingEvent {
  return {
    type: 'agent.event',
    runId: 'run-1',
    ts,
    payload: makeAgentEvent({ runId: 'run-1', taskKey, ts, kind: 'tool.call' }),
  };
}

function makeSim(width = 1200, height = 700, seed?: number): SkySimulation {
  return createSky({ width, height, seed: seed ?? 0x5eed });
}

function boot(
  sim: SkySimulation,
  keys: readonly string[],
  status: TaskStatus,
  nodes = [HUB],
  nodeId?: string,
): void {
  sim.setInput({
    runId: 'run-1',
    plan: planOf(keys),
    tasks: runsOf(keys, status, nodeId ?? nodes[0]?.id),
    nodes,
    recent: [],
  });
}

function advance(sim: SkySimulation, seconds: number, dt = 1 / 60): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) sim.step(dt);
}

/** Bounding box of a flock's leader over the last `seconds`, used for shape assertions. */
function leaderBox(sim: SkySimulation, key: string, seconds: number, dt = 1 / 60) {
  const flock = sim.findFlock(key);
  if (!flock) throw new Error(`missing flock ${key}`);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    sim.step(dt);
    minX = Math.min(minX, flock.leaderX);
    maxX = Math.max(maxX, flock.leaderX);
    minY = Math.min(minY, flock.leaderY);
    maxY = Math.max(maxY, flock.leaderY);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

describe('flocks and roosts', () => {
  test('one flock of 12 birds per task, all inside the sky', () => {
    const sim = makeSim();
    boot(sim, ['theme', 'search', 'csv'], 'running');
    expect(sim.flocks.length).toBe(3);
    expect(sim.flocks[0]?.birds).toBe(BIRDS_PER_FLOCK);

    advance(sim, 2);
    for (let i = 0; i < 3 * BIRDS_PER_FLOCK; i++) {
      expect(sim.birds.x[i]).toBeGreaterThan(0);
      expect(sim.birds.x[i]).toBeLessThan(sim.width);
      expect(sim.birds.y[i]).toBeGreaterThan(0);
      expect(sim.birds.y[i]).toBeLessThan(sim.height);
    }
  });

  test('caps at 30 tasks / 360 birds and reuses bird slots', () => {
    const sim = makeSim();
    const keys = Array.from({ length: 40 }, (_, i) => `t${i}`);
    boot(sim, keys, 'running');
    expect(sim.flocks.length).toBe(MAX_TASKS);
    const birds = sim.flocks.reduce((sum, flock) => sum + flock.birds, 0);
    expect(birds).toBe(MAX_BIRDS);
    expect(sim.birds.x.length).toBe(360);

    // Dropping back to 3 tasks frees slots; a later 30-task input must stay unique.
    boot(sim, keys.slice(0, 3), 'pending');
    boot(sim, keys.slice(0, 30), 'running');
    const offsets = new Set(sim.flocks.map((flock) => flock.birdOffset));
    expect(offsets.size).toBe(30);
  });

  test('hub roosts on the left, perches on the right, wire sags in the middle of the top third', () => {
    const sim = makeSim();
    boot(sim, ['a'], 'pending', [HUB, AIR]);
    const hub = sim.roosts.find((roost) => roost.nodeId === 'hub');
    const air = sim.roosts.find((roost) => roost.nodeId === 'air');
    expect(hub?.x).toBeLessThan(sim.width / 2);
    expect(air?.x).toBeGreaterThan(sim.width / 2);
    expect(hub?.name).toBe('MacBook Pro');
    expect(air?.name).toBe('MacBook Air');

    const middle = sim.wire.yAt((sim.wire.left + sim.wire.right) / 2);
    expect(middle).toBeGreaterThan(sim.wire.yAt(sim.wire.left));
    expect(sim.wire.yAt(sim.wire.left)).toBeLessThan(sim.height / 3);
  });
});

describe('determinism and activity', () => {
  test('same seed + same inputs + same dt → identical positions', () => {
    const keys = ['a', 'b', 'c'];
    const one = makeSim(1200, 700, 42);
    const two = makeSim(1200, 700, 42);
    boot(one, keys, 'running');
    boot(two, keys, 'running');
    advance(one, 3);
    advance(two, 3);

    for (let i = 0; i < keys.length; i++) {
      expect(one.flocks[i]?.leaderX).toBe(two.flocks[i]?.leaderX);
      expect(one.flocks[i]?.leaderY).toBe(two.flocks[i]?.leaderY);
    }
    for (let i = 0; i < MAX_BIRDS; i++) {
      expect(one.birds.x[i]).toBe(two.birds.x[i]);
      expect(one.birds.y[i]).toBe(two.birds.y[i]);
    }
  });

  test('a different seed spawns a different sky', () => {
    const one = makeSim(1200, 700, 1);
    const two = makeSim(1200, 700, 2);
    boot(one, ['a'], 'pending');
    boot(two, ['a'], 'pending');
    const different = Array.from({ length: BIRDS_PER_FLOCK }, (_, i) => one.birds.x[i] !== two.birds.x[i]);
    expect(different.some(Boolean)).toBe(true);
  });

  test('recent agent events raise activity; old events do not', () => {
    const sim = makeSim();
    const recent: StarlingEvent[] = Array.from({ length: 12 }, (_, i) => agentEvent('a', BASE_TS + i * 100));
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a', 'b']),
      tasks: runsOf(['a', 'b'], 'running'),
      nodes: [HUB],
      recent,
      now: BASE_TS + 2000,
    });
    expect(sim.findFlock('a')?.activity).toBe(1);
    expect(sim.findFlock('b')?.activity).toBe(0);

    const stale: StarlingEvent[] = Array.from({ length: 12 }, (_, i) =>
      agentEvent('a', BASE_TS - 60_000 + i * 100),
    );
    const fresh = makeSim();
    fresh.setInput({
      runId: 'run-1',
      plan: planOf(['a', 'b']),
      tasks: runsOf(['a', 'b'], 'running'),
      nodes: [HUB],
      recent: stale,
      now: BASE_TS,
    });
    fresh.step(1 / 60);
    expect(fresh.findFlock('a')?.activity).toBe(0);
  });

  test('a busy flock murmurs wider than an idle one', () => {
    const keys = ['a', 'b'];
    const idle = makeSim();
    boot(idle, keys, 'running');
    const idleBox = leaderBox(idle, 'a', 5);

    const busy = makeSim();
    const events: StarlingEvent[] = Array.from({ length: 12 }, (_, i) => agentEvent('a', BASE_TS + i * 50));
    busy.setInput({
      runId: 'run-1',
      plan: planOf(keys),
      tasks: runsOf(keys, 'running'),
      nodes: [HUB],
      recent: events,
      now: BASE_TS + 1000,
    });
    const busyBox = leaderBox(busy, 'a', 5);
    expect(busyBox.width).toBeGreaterThan(idleBox.width);
  });
});

describe('status → behaviour', () => {
  test('every status maps to a distinct, documented behaviour', () => {
    const expected: Record<TaskStatus, BehaviourKind> = {
      pending: 'perched',
      ready: 'hopping',
      running: 'murmur',
      auditing: 'circle',
      fixing: 'zigzag',
      merging: 'glide',
      merged: 'wirePerch',
      failed: 'fall',
      conflict: 'flicker',
      cancelled: 'fade',
    };
    for (const [status, kind] of Object.entries(expected)) {
      const sim = makeSim();
      boot(sim, ['a'], status as TaskStatus);
      const flock = sim.findFlock('a');
      expect(flock?.behaviour.kind).toBe(kind);
      expect(flock?.behaviour.tint).toBe(statusColor(status as TaskStatus));
    }
  });

  test('pending birds perch still on their node roost', () => {
    const sim = makeSim();
    boot(sim, ['a', 'b'], 'pending');
    advance(sim, 2);
    const roost = sim.roosts.find((candidate) => candidate.nodeId === 'hub');
    if (!roost) throw new Error('missing hub roost');
    for (const flock of sim.flocks) {
      // Perches alternate between two heights so a seven-flock crowd stays readable.
      const rowOffset = roost.y - 8 - flock.leaderY;
      expect(rowOffset).toBeGreaterThanOrEqual(0);
      expect(rowOffset).toBeLessThanOrEqual(11);
      expect(Math.abs(flock.leaderX - roost.x)).toBeLessThan(80);
    }
    // Birds are placed directly: a second is enough to settle, and they barely move.
    const before = sim.birds.y[0] ?? 0;
    sim.step(1 / 60);
    expect(Math.abs((sim.birds.y[0] ?? 0) - before)).toBeLessThan(1.5);
  });

  test('auditing is a tight amber circle, fixing a wide coral zig-zag', () => {
    const sim = makeSim();
    boot(sim, ['audit', 'fix'], 'running');
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['audit', 'fix']),
      tasks: {
        audit: makeTaskRun({ taskKey: 'audit', status: 'auditing', nodeId: 'hub' }),
        fix: makeTaskRun({ taskKey: 'fix', status: 'fixing', nodeId: 'hub' }),
      },
      nodes: [HUB],
    });
    advance(sim, 1);
    const audit = leaderBox(sim, 'audit', 2);
    const fix = leaderBox(sim, 'fix', 2);
    expect(audit.width).toBeLessThan(70);
    expect(fix.width).toBeGreaterThan(55);
    expect(sim.findFlock('audit')?.behaviour.tint).toBe(statusColor('auditing'));
    expect(sim.findFlock('fix')?.behaviour.tint).toBe(statusColor('fixing'));
  });

  test('failed flocks fall and grey out', () => {
    const sim = makeSim();
    boot(sim, ['a'], 'running');
    advance(sim, 1);
    const before = sim.findFlock('a')?.leaderY ?? 0;
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a']),
      tasks: { a: makeTaskRun({ taskKey: 'a', status: 'failed', nodeId: 'hub' }) },
      nodes: [HUB],
    });
    advance(sim, 3);
    const flock = sim.findFlock('a');
    expect(flock?.leaderY).toBeGreaterThan(before);
    expect(flock?.alpha).toBeLessThan(0.6);
  });

  test('cancelled flocks fade away', () => {
    const sim = makeSim();
    boot(sim, ['a'], 'cancelled');
    advance(sim, 5);
    expect(sim.findFlock('a')?.alpha).toBeLessThan(0.05);
  });
});

describe('the wire', () => {
  test('merging glides to the wire and merged flocks keep merge order', () => {
    const sim = makeSim();
    const keys = ['a', 'b', 'c'];
    boot(sim, keys, 'merging');
    advance(sim, 3);

    for (const key of keys) {
      const flock = sim.findFlock(key);
      if (!flock) throw new Error(`missing ${key}`);
      const wireY = sim.wire.yAt(flock.leaderX);
      expect(Math.abs(flock.leaderY - (wireY - 5))).toBeLessThan(22);
    }

    const slots = keys.map((key) => sim.findFlock(key)?.mergedSlot ?? -1);
    expect(slots).toEqual([0, 1, 2]);

    sim.setInput({
      runId: 'run-1',
      plan: planOf(keys),
      tasks: runsOf(keys, 'merged'),
      nodes: [HUB],
    });
    advance(sim, 2);
    const xs = keys.map((key) => sim.findFlock(key)?.leaderX ?? 0);
    expect(xs[1]).toBeGreaterThan(xs[0] ?? 0);
    expect(xs[2]).toBeGreaterThan(xs[1] ?? 0);
    for (const key of keys) {
      const flock = sim.findFlock(key);
      if (!flock) throw new Error(`missing ${key}`);
      expect(flock.behaviour.kind).toBe('wirePerch');
      expect(Math.abs(flock.leaderY - (sim.wire.yAt(flock.leaderX) - 5))).toBeLessThan(4);
    }
  });
});

describe('migration and node churn', () => {
  test('a nodeId change flies the flock across on a long arc with a trail', () => {
    const sim = makeSim();
    boot(sim, ['a'], 'running', [HUB, AIR], 'air');
    advance(sim, 1);
    const airSide = sim.findFlock('a')?.leaderX ?? 0;
    expect(airSide).toBeGreaterThan(sim.width / 2);

    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a']),
      tasks: { a: makeTaskRun({ taskKey: 'a', status: 'running', nodeId: 'hub' }) },
      nodes: [HUB, AIR],
    });
    const flock = sim.findFlock('a');
    expect(flock?.migration).not.toBeNull();
    expect(flock?.migration?.toNodeId).toBe('hub');

    advance(sim, 1.5);
    expect(flock?.trailLen ?? 0).toBeGreaterThan(2);
    expect(flock?.trailLen ?? 0).toBeLessThanOrEqual(TRAIL_CAP);

    advance(sim, 3);
    expect(flock?.migration).toBeNull();
    expect(flock?.leaderX ?? 0).toBeLessThan(sim.width / 2);
  });

  test('a task.migrated event starts the same arc', () => {
    const sim = makeSim();
    boot(sim, ['a'], 'running', [HUB, AIR], 'air');
    advance(sim, 0.5);
    const migrated: StarlingEvent = {
      type: 'task.migrated',
      runId: 'run-1',
      ts: BASE_TS + 5000,
      payload: { taskKey: 'a', fromNode: 'air', toNode: 'hub', reason: 'air went offline' },
    };
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a']),
      tasks: { a: makeTaskRun({ taskKey: 'a', status: 'running', nodeId: 'air' }) },
      nodes: [HUB, AIR],
      recent: [migrated],
      now: BASE_TS + 5000,
    });
    expect(sim.findFlock('a')?.migration?.toNodeId).toBe('hub');
  });

  test('a node that leaves dims its roost and scatters its birds', () => {
    const sim = makeSim();
    boot(sim, ['a', 'b'], 'running', [HUB, AIR], 'air');
    advance(sim, 1);
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a', 'b']),
      tasks: runsOf(['a', 'b'], 'running', 'air'),
      nodes: [HUB, { ...AIR, status: 'offline' }],
    });
    const roost = sim.roosts.find((candidate) => candidate.nodeId === 'air');
    expect(roost?.dimTarget).toBe(0.25);
    for (const flock of sim.flocks) {
      expect(flock.scatterUntil).toBeGreaterThan(sim.simTime);
    }

    // Scatter is visible: the birds pick up real outward speed.
    advance(sim, 0.35);
    let fastest = 0;
    for (let i = 0; i < 12; i++) {
      fastest = Math.max(fastest, Math.hypot(sim.birds.vx[i] ?? 0, sim.birds.vy[i] ?? 0));
    }
    expect(fastest).toBeGreaterThan(40);
  });

  test('a node that joins grows in from zero', () => {
    const sim = makeSim();
    boot(sim, ['a'], 'pending', [HUB]);
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a']),
      tasks: runsOf(['a'], 'pending'),
      nodes: [HUB, AIR],
    });
    const air = sim.roosts.find((candidate) => candidate.nodeId === 'air');
    expect(air?.grow).toBe(0);
    advance(sim, 2);
    expect(air?.grow).toBe(1);
  });
});

describe('hit testing and reduced motion', () => {
  test('hitTest returns the nearest leader, or nothing when the sky is empty there', () => {
    const sim = makeSim();
    boot(sim, ['a', 'b'], 'pending');
    advance(sim, 1);
    const flock = sim.findFlock('b');
    if (!flock) throw new Error('missing flock');
    expect(sim.hitTest(flock.leaderX + 4, flock.leaderY + 4)).toBe('b');
    expect(sim.hitTest(flock.leaderX + 4, flock.leaderY + 4, 2)).toBeUndefined();
    expect(sim.hitTest(5, 5)).toBeUndefined();
  });

  test('reduced motion parks every flock in its state zone and stops all motion', () => {
    const sim = makeSim(1200, 700);
    const statuses: TaskStatus[] = [
      'pending',
      'ready',
      'running',
      'auditing',
      'fixing',
      'merging',
      'merged',
      'conflict',
      'failed',
      'cancelled',
    ];
    const tasks: Record<string, TaskRun> = {};
    for (const status of statuses) {
      tasks[status] = makeTaskRun({ taskKey: status, status, nodeId: 'hub' });
    }
    sim.setInput({
      runId: 'run-1',
      plan: planOf(statuses),
      tasks,
      nodes: [HUB],
    });
    sim.setReducedMotion(true);
    expect(sim.reducedMotion).toBe(true);

    const before = Array.from(sim.birds.x);
    advance(sim, 2);
    const after = Array.from(sim.birds.x);
    expect(after).toEqual(before);

    for (const flock of sim.flocks) {
      const zone = calmZone(flock.status, sim.width, sim.height);
      const base = flock.birdOffset;
      for (let j = 0; j < flock.birds; j++) {
        const x = sim.birds.x[base + j] ?? 0;
        const y = sim.birds.y[base + j] ?? 0;
        if (flock.status === 'pending') {
          const roost = sim.roosts.find((candidate) => candidate.nodeId === flock.nodeId);
          const perchY = (roost?.y ?? sim.height - 26) - 8;
          expect(y).toBeGreaterThan(perchY - 30); // perched on the bottom roost
          expect(y).toBeLessThan(sim.height);
        } else if (flock.status === 'merged') {
          expect(Math.abs(y - (sim.wire.yAt(x) - 5))).toBeLessThan(12);
        } else {
          expect(x).toBeGreaterThanOrEqual(zone.x0);
          expect(x).toBeLessThanOrEqual(zone.x1);
          expect(y).toBeGreaterThanOrEqual(zone.y0);
          expect(y).toBeLessThanOrEqual(zone.y1);
        }
      }
    }
  });

  test('turning reduced motion off resumes the flocking', () => {
    const sim = makeSim();
    boot(sim, ['a'], 'running');
    sim.setReducedMotion(true);
    const before = sim.birds.x[0] ?? 0;
    sim.setReducedMotion(false);
    advance(sim, 1);
    expect(sim.birds.x[0]).not.toBe(before);
  });
});

describe('performance', () => {
  test('360 birds × 600 steps in under 250 ms', () => {
    const sim = makeSim(1440, 900);
    const keys = Array.from({ length: MAX_TASKS }, (_, i) => `task-${i}`);
    boot(sim, keys, 'running');
    advance(sim, 1);

    const started = performance.now();
    for (let i = 0; i < 600; i++) sim.step(1 / 60);
    const elapsed = performance.now() - started;
    expect(sim.flocks.length).toBe(30);
    expect(elapsed).toBeLessThan(250);
  });
});
