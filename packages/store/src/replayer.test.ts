import { describe, expect, test } from 'bun:test';
import { createEventBus, FakeClock, isStarlingError, type StarlingEvent } from '@starling/core';
import { importJsonl } from './jsonl';
import { createReplayer, MAX_REPLAY_GAP_MS } from './replayer';
import { FIXTURE_RECORDING, makeLogEvent } from './test-utils';

const fixture = importJsonl(FIXTURE_RECORDING);

function scaledGaps(events: readonly StarlingEvent[], speed: number): number[] {
  return events.slice(1).map((event, index) => {
    const previous = events[index] as StarlingEvent;
    const gap = Math.max(0, event.ts - previous.ts);
    const scaled = Number.isFinite(speed) ? gap / speed : 0;
    return Math.min(scaled, MAX_REPLAY_GAP_MS);
  });
}

describe('createReplayer', () => {
  test('replays the 252-event fixture in order at speed 100 with scaled virtual timing', async () => {
    const bus = createEventBus();
    const clock = new FakeClock(0);
    const seen: { event: StarlingEvent; at: number }[] = [];
    bus.subscribe((event) => seen.push({ event, at: clock.now() }));

    const replayer = createReplayer({ events: fixture, bus, clock, speed: 100 });
    await replayer.start();
    await replayer.done;

    expect(seen).toHaveLength(252);
    expect(seen.map((entry) => entry.event.type)).toEqual(fixture.map((event) => event.type));
    expect(seen.map((entry) => entry.at)).toEqual([
      0,
      ...scaledGaps(fixture, 100).reduce<number[]>((acc, gap) => {
        acc.push((acc[acc.length - 1] ?? 0) + gap);
        return acc;
      }, []),
    ]);

    // Scaled timing is observable, not guessed at: the 5 s metrics ticks arrive 50 ms apart.
    const metricsAt = seen.filter((entry) => entry.event.type === 'metrics').map((entry) => entry.at);
    expect(metricsAt.length).toBeGreaterThan(1);
    const firstTick = metricsAt[0] ?? Number.NaN;
    const secondTick = metricsAt[1] ?? Number.NaN;
    expect(secondTick - firstTick).toBeCloseTo(50, 6);
  });

  test('speed Infinity publishes everything without advancing the clock', async () => {
    const bus = createEventBus();
    const clock = new FakeClock(500);
    const types: string[] = [];
    bus.subscribe((event) => types.push(event.type));

    const replayer = createReplayer({ events: fixture, bus, clock, speed: Number.POSITIVE_INFINITY });
    await replayer.start();

    expect(types).toHaveLength(252);
    expect(types).toEqual(fixture.map((event) => event.type));
    expect(clock.now()).toBe(500);
  });

  test('caps an idle gap at MAX_REPLAY_GAP_MS of scaled time', async () => {
    const bus = createEventBus();
    const clock = new FakeClock(0);
    const at: number[] = [];
    bus.subscribe(() => at.push(clock.now()));

    const events = [
      makeLogEvent('r1', 0, 'a'),
      makeLogEvent('r1', 10_000, 'b'),
      makeLogEvent('r1', 11_000, 'c'),
    ];
    const replayer = createReplayer({ events, bus, clock, speed: 1 });
    await replayer.start();

    expect(at).toEqual([0, MAX_REPLAY_GAP_MS, MAX_REPLAY_GAP_MS + 1000]);
  });

  test('stop() halts playback early and resolves done', async () => {
    const bus = createEventBus();
    const clock = new FakeClock(0);
    const seen: StarlingEvent[] = [];
    const replayer = createReplayer({ events: fixture, bus, clock, speed: 1 });

    bus.subscribe((event) => {
      seen.push(event);
      if (seen.length === 5) replayer.stop();
    });

    await replayer.start();
    await replayer.done;
    expect(seen).toHaveLength(5);
  });

  test('newRunId rewrites run-scoped ids but leaves flock events on "*"', async () => {
    const bus = createEventBus();
    const clock = new FakeClock(0);
    const seen: StarlingEvent[] = [];
    bus.subscribe((event) => seen.push(event));

    const newRunId = '01jd2k7m3p4q5r6s7t8v9w0zz';
    const replayer = createReplayer({
      events: fixture,
      bus,
      clock,
      speed: Number.POSITIVE_INFINITY,
      newRunId,
    });
    await replayer.start();

    expect(seen).toHaveLength(252);
    for (const event of seen) {
      if (event.runId === '*') continue;
      expect(event.runId).toBe(newRunId);
    }
    expect(seen.filter((event) => event.runId === '*')).toHaveLength(
      fixture.filter((event) => event.runId === '*').length,
    );

    const created = seen.find((event) => event.type === 'run.created');
    expect(created?.type).toBe('run.created');
    if (created?.type !== 'run.created') return;
    expect(created.payload.run.id).toBe(newRunId);
    expect(Object.values(created.payload.run.tasks).every((task) => task.runId === newRunId)).toBe(true);

    const status = seen.find((event) => event.type === 'task.status');
    expect(status?.type).toBe('task.status');
    if (status?.type === 'task.status') expect(status.payload.run.runId).toBe(newRunId);

    const agent = seen.find((event) => event.type === 'agent.event');
    expect(agent?.type).toBe('agent.event');
    if (agent?.type === 'agent.event') expect(agent.payload.runId).toBe(newRunId);
  });

  test('plays with real timers when the clock is not a FakeClock', async () => {
    const bus = createEventBus();
    const seen: number[] = [];
    bus.subscribe((event) => seen.push(event.ts));

    const events = [makeLogEvent('r1', 0), makeLogEvent('r1', 10), makeLogEvent('r1', 20)];
    const replayer = createReplayer({ events, bus, speed: 1 });
    const started = performance.now();
    await replayer.start();
    const elapsed = performance.now() - started;

    expect(seen).toEqual([0, 10, 20]);
    expect(elapsed).toBeGreaterThanOrEqual(10);
    expect(elapsed).toBeLessThan(1000);
  });

  test('rejects a non-positive speed', () => {
    const bus = createEventBus();
    expect(() => createReplayer({ events: [], bus, speed: 0 })).toThrow();
    try {
      createReplayer({ events: [], bus, speed: -1 });
      throw new Error('expected createReplayer to throw');
    } catch (err) {
      expect(isStarlingError(err, 'INVALID_ARGUMENT')).toBe(true);
    }
  });

  test('start() may only be called once', async () => {
    const bus = createEventBus();
    const replayer = createReplayer({ events: [makeLogEvent('r1', 0)], bus, clock: new FakeClock() });
    await replayer.start();
    await expect(replayer.start()).rejects.toThrow(/only be called once/);
  });
});
