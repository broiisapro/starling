/**
 * Epic 47 behaviour tests: the join moment, the leave caption, work cues, landing order and the
 * final sweep. Everything runs against the pure sim — no DOM, no canvas, no audio.
 */
import { describe, expect, test } from 'bun:test';
import type { StarlingEvent, TaskRun, TaskStatus } from '@starling/core';
import {
  BASE_TS,
  makeAgentEvent,
  makeNodeInfo,
  makePlan,
  makeRun,
  makeTaskRun,
  makeTaskSpec,
} from '@starling/core/testing';
import { liveSparks, noticeText, RIPPLE_LIFE } from './cues';
import { roostLabelFont } from './layout';
import { withStressTasks } from './replay';
import { createSky, LANDING_SHIMMER, type SkySimulation, SWEEP_DURATION } from './sim';

const HUB = makeNodeInfo({ id: 'hub', name: 'MacBook Pro', kind: 'local', activeSessions: 3 });
const AIR = makeNodeInfo({
  id: 'air',
  name: 'MacBook Air',
  kind: 'remote',
  url: 'http://192.168.1.42:7778',
  activeSessions: 0,
  maxSessions: 5,
});

function planOf(keys: readonly string[]) {
  return makePlan({ tasks: keys.map((key) => makeTaskSpec({ key, title: `Task ${key}` })) });
}

function runsOf(keys: readonly string[], status: TaskStatus, nodeId = 'hub'): Record<string, TaskRun> {
  const out: Record<string, TaskRun> = {};
  for (const key of keys) out[key] = makeTaskRun({ taskKey: key, status, nodeId });
  return out;
}

function joinEvent(ts: number): StarlingEvent {
  return { type: 'node.joined', runId: '*', ts, payload: { node: { ...AIR, lastSeen: ts } } };
}

function leaveEvent(ts: number): StarlingEvent {
  return {
    type: 'node.left',
    runId: '*',
    ts,
    payload: { nodeId: 'air', reason: 'heartbeat lost' },
  };
}

function agentEvent(taskKey: string, ts: number, kind: 'file.edited' | 'tool.call'): StarlingEvent {
  return {
    type: 'agent.event',
    runId: 'run-1',
    ts,
    payload: makeAgentEvent({ runId: 'run-1', taskKey, ts, kind }),
  };
}

function makeSim(width = 1200, height = 700): SkySimulation {
  return createSky({ width, height, seed: 0x5eed });
}

function boot(
  sim: SkySimulation,
  keys: readonly string[],
  status: TaskStatus,
  nodes = [HUB],
  nodeId = nodes[0]?.id,
  recent: StarlingEvent[] = [],
  now?: number,
): void {
  sim.setInput({
    runId: 'run-1',
    plan: planOf(keys),
    tasks: runsOf(keys, status, nodeId),
    nodes,
    recent,
    now,
  });
}

function advance(sim: SkySimulation, seconds: number, dt = 1 / 60): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) sim.step(dt);
}

describe('roost labels', () => {
  test('are projector-sized at 1080p and never unreadable on a laptop', () => {
    // The shell gives the Sky 816 px of height at 1920×1080 (see the C1 projector measurement).
    expect(roostLabelFont(816)).toBeGreaterThanOrEqual(18);
    expect(roostLabelFont(700)).toBeGreaterThanOrEqual(18);
    expect(roostLabelFont(420)).toBeGreaterThanOrEqual(15);
    expect(roostLabelFont(2000)).toBeLessThanOrEqual(24);
  });

  test('roosts carry the session gauge, the hub crown and a busy glow', () => {
    const sim = makeSim();
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a']),
      tasks: runsOf(['a'], 'running'),
      nodes: [HUB, AIR],
    });
    const hub = sim.roosts.find((roost) => roost.nodeId === 'hub');
    const air = sim.roosts.find((roost) => roost.nodeId === 'air');
    expect(hub?.activeSessions).toBe(3);
    expect(hub?.maxSessions).toBe(8);
    expect(hub?.isHub).toBe(true);
    expect(air?.isHub).toBe(false);
    expect(air?.maxSessions).toBe(5);
    expect(hub?.busy).toBe(0);

    advance(sim, 1.5);
    expect(hub?.busy).toBeGreaterThan(0.15);
    expect(air?.busy).toBe(0);
  });
});

describe('the join moment', () => {
  test('a joining roost grows from zero, ripples and announces itself', () => {
    const sim = makeSim();
    boot(sim, ['a'], 'pending', [HUB], 'hub', [], BASE_TS);
    const ts = BASE_TS + 90_000;
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a']),
      tasks: runsOf(['a'], 'pending'),
      nodes: [HUB, { ...AIR, lastSeen: ts }],
      recent: [joinEvent(ts)],
      now: ts,
    });

    const air = sim.roosts.find((roost) => roost.nodeId === 'air');
    expect(air?.grow).toBe(0);
    expect(air?.ripple).toBe(0);
    const notice = sim.notices.find((candidate) => candidate.nodeId === 'air');
    expect(notice?.kind).toBe('joined');
    expect(notice ? noticeText(notice) : '').toBe('🪺 MacBook Air joined the flock');
    expect(sim.drainAudioCues().joins).toBe(1);

    advance(sim, 2);
    expect(air?.grow).toBe(1);
    expect(air?.ripple).toBe(-1);
    advance(sim, 2);
    expect(sim.notices.length).toBe(0);
  });

  test('a replayed join that is already old does not replay the ripple', () => {
    const sim = makeSim();
    const ts = BASE_TS + 90_000;
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a']),
      tasks: runsOf(['a'], 'pending'),
      nodes: [HUB, AIR],
      recent: [joinEvent(ts)],
      now: ts + 9000,
    });
    const air = sim.roosts.find((roost) => roost.nodeId === 'air');
    expect(air?.ripple ?? 0).toBeGreaterThan(RIPPLE_LIFE);
  });

  test('a leaving roost dims, scatters and says it has flown away', () => {
    const sim = makeSim();
    boot(sim, ['a'], 'running', [HUB, AIR], 'air', [], BASE_TS);
    advance(sim, 1);
    const ts = BASE_TS + 5000;
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a']),
      tasks: runsOf(['a'], 'running', 'air'),
      nodes: [HUB, { ...AIR, status: 'offline' }],
      recent: [leaveEvent(ts)],
      now: ts,
    });
    const air = sim.roosts.find((roost) => roost.nodeId === 'air');
    expect(air?.dimTarget).toBe(0.25);
    expect(air?.left).toBe(0);
    const notice = sim.notices.find((candidate) => candidate.kind === 'left');
    expect(notice ? noticeText(notice) : '').toBe('MacBook Air has flown away');
    advance(sim, 1.5);
    expect(air?.dim).toBeLessThan(0.6);
  });
});

describe('work cues', () => {
  test('file.edited throws sparks that decay, tool.call makes the flock beat', () => {
    const sim = makeSim();
    const ts = BASE_TS + 1000;
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a']),
      tasks: runsOf(['a'], 'running'),
      nodes: [HUB],
      recent: [agentEvent('a', ts, 'file.edited'), agentEvent('a', ts + 1, 'tool.call')],
      now: ts + 1,
    });
    const flock = sim.findFlock('a');
    expect(liveSparks(sim.sparks)).toBeGreaterThan(0);
    expect(flock?.beat).toBe(1);

    // Re-delivering the same events does not double-spawn or re-beat.
    const before = liveSparks(sim.sparks);
    sim.setInput({
      runId: 'run-1',
      plan: planOf(['a']),
      tasks: runsOf(['a'], 'running'),
      nodes: [HUB],
      recent: [agentEvent('a', ts, 'file.edited'), agentEvent('a', ts + 1, 'tool.call')],
      now: ts + 1,
    });
    expect(liveSparks(sim.sparks)).toBe(before);

    advance(sim, 1.2);
    expect(liveSparks(sim.sparks)).toBe(0);
    expect(flock?.beat ?? 1).toBeLessThan(0.05);
  });

  test('working flocks loop low above their own roost, not in the middle of the sky', () => {
    const sim = makeSim(1200, 700);
    boot(sim, ['a'], 'running');
    advance(sim, 5);
    const flock = sim.findFlock('a');
    expect(flock?.leaderY ?? 0).toBeGreaterThan(sim.height * 0.55);
    expect(flock?.leaderX ?? 0).toBeLessThan(sim.width * 0.5);
  });
});

describe('the wire', () => {
  test('landings happen in merge order and shimmer as they arrive', () => {
    const sim = makeSim();
    const keys = ['a', 'b', 'c'];
    boot(sim, keys, 'running');

    sim.setInput({
      runId: 'run-1',
      plan: planOf(keys),
      tasks: {
        a: makeTaskRun({ taskKey: 'a', status: 'merged', nodeId: 'hub' }),
        b: makeTaskRun({ taskKey: 'b', status: 'merging', nodeId: 'hub' }),
        c: makeTaskRun({ taskKey: 'c', status: 'running', nodeId: 'hub' }),
      },
      nodes: [HUB],
    });
    expect(sim.drainAudioCues().landings).toBe(1);

    sim.setInput({
      runId: 'run-1',
      plan: planOf(keys),
      tasks: {
        a: makeTaskRun({ taskKey: 'a', status: 'merged', nodeId: 'hub' }),
        b: makeTaskRun({ taskKey: 'b', status: 'merged', nodeId: 'hub' }),
        c: makeTaskRun({ taskKey: 'c', status: 'merged', nodeId: 'hub' }),
      },
      nodes: [HUB],
    });
    const cues = sim.drainAudioCues();
    expect(cues.landings).toBe(2);

    const a = sim.findFlock('a');
    const b = sim.findFlock('b');
    const c = sim.findFlock('c');
    expect([a?.landedSeq, b?.landedSeq, c?.landedSeq]).toEqual([1, 2, 3]);
    expect([a?.mergedSlot, b?.mergedSlot, c?.mergedSlot]).toEqual([0, 1, 2]);
    // Just landed → still inside the shimmer window.
    expect(a?.statusTime ?? 0).toBeLessThan(LANDING_SHIMMER);
    // Landed flocks spread along the wire in merge order.
    advance(sim, 2.5);
    expect(b?.leaderX ?? 0).toBeGreaterThan(a?.leaderX ?? 0);
    expect(c?.leaderX ?? 0).toBeGreaterThan(b?.leaderX ?? 0);
  });

  test('a finished run triggers one all-landed sweep with a caption', () => {
    const sim = makeSim();
    const keys = ['a', 'b'];
    boot(sim, keys, 'merged');
    expect(sim.sweepProgress()).toBe(-1);

    sim.setInput({
      runId: 'run-1',
      plan: planOf(keys),
      tasks: runsOf(keys, 'merged'),
      nodes: [HUB],
      status: 'finished',
    });
    expect(sim.sweepProgress()).toBe(0);
    const caption = sim.notices.find((notice) => notice.kind === 'finished');
    expect(caption?.name).toBe('All 2 birds landed');

    // Merged flocks lift in merge order during the wave.
    advance(sim, 0.6);
    const a = sim.findFlock('a');
    expect(a?.leaderY ?? 0).toBeLessThan(sim.wire.yAt(a?.leaderX ?? 0) - 10);

    advance(sim, SWEEP_DURATION);
    expect(sim.sweepProgress()).toBe(-1);

    // Prop updates after the finish do not restart it.
    sim.setInput({
      runId: 'run-1',
      plan: planOf(keys),
      tasks: runsOf(keys, 'merged'),
      nodes: [HUB],
      status: 'finished',
    });
    expect(sim.sweepProgress()).toBe(-1);
  });
});

describe('stress mode', () => {
  test('inflates a frame to 30 synthetic flocks without touching the real plan', () => {
    const run = makeRun({
      plan: planOf(['theme']),
      tasks: { theme: makeTaskRun({ taskKey: 'theme', status: 'running', nodeId: 'hub' }) },
    });
    const stressed = withStressTasks(run, [HUB, AIR]);
    expect(Object.keys(stressed?.tasks ?? {}).length).toBe(31);
    expect(stressed?.tasks['stress-01']?.taskKey).toBe('stress-01');
    expect(stressed?.tasks.theme?.status).toBe('running');
    // Synthetic tasks alternate onto the remote so both roosts fill.
    expect(stressed?.tasks['stress-02']?.nodeId).toBe('air');
    expect(withStressTasks(undefined, [HUB])).toBeUndefined();
  });
});
