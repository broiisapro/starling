import { describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core';
import { isStarlingError } from '@starling/core';
import {
  DEMO_LOOP_PAUSE_MS,
  type DemoTimers,
  demoDurationMs,
  demoEvents,
  demoTimeline,
  parseJsonl,
  playDemo,
  rebaseEvents,
  scaledDelay,
} from './demo';

const events = demoEvents();

function fakeTimers(): { timers: DemoTimers; tick(ms: number): void; pending(): number } {
  let now = 0;
  let nextId = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      setTimeout(handler, ms) {
        const id = nextId++;
        queue.set(id, { at: now + Math.max(0, ms), fn: handler });
        return id;
      },
      clearTimeout(handle) {
        queue.delete(handle as number);
      },
    },
    tick(ms) {
      now += Math.max(0, ms);
      let ran = true;
      while (ran) {
        ran = false;
        for (const [id, entry] of [...queue]) {
          if (entry.at <= now) {
            queue.delete(id);
            entry.fn();
            ran = true;
          }
        }
      }
    },
    pending() {
      return queue.size;
    },
  };
}

function at(index: number): StarlingEvent {
  const event = events[index];
  if (event === undefined) throw new Error(`fixture has no event ${index}`);
  return event;
}

describe('demo fixture parsing', () => {
  test('loads all 252 recorded events in order', () => {
    expect(events).toHaveLength(252);
    expect(events[0]?.type).toBe('run.created');
    expect(events.at(-1)?.type).toBe('run.finished');
    for (let index = 1; index < events.length; index += 1) {
      const previous = events[index - 1];
      const current = events[index];
      if (previous === undefined || current === undefined) throw new Error('gap');
      expect(current.ts).toBeGreaterThanOrEqual(previous.ts);
    }
  });

  test('caches the parsed fixture', () => {
    expect(demoEvents()).toBe(events);
  });

  test('refuses malformed JSON with a StarlingError', () => {
    try {
      parseJsonl(`${JSON.stringify(at(0))}\nnot json\n`, 'broken.jsonl');
      throw new Error('expected a throw');
    } catch (error) {
      expect(isStarlingError(error, 'INVALID_ARGUMENT')).toBe(true);
      expect((error as Error).message).toContain('line 2');
    }
  });

  test('refuses events that break the contract', () => {
    expect(() => parseJsonl('{"type":"metrics","runId":"x","ts":1}\n')).toThrow();
  });

  test('skips blank lines', () => {
    expect(parseJsonl(`${JSON.stringify(at(0))}\n\n`)).toHaveLength(1);
  });
});

describe('demo timing', () => {
  test('scales the recorded gaps by speed and never goes negative', () => {
    expect(scaledDelay(at(0), at(2), 1)).toBe(1_000);
    expect(scaledDelay(at(0), at(2), 4)).toBe(250);
    expect(scaledDelay(at(0), at(2), 16)).toBe(63);
    expect(scaledDelay(at(2), at(0), 1)).toBe(0);
  });

  test('builds a timeline whose first event is immediate', () => {
    const timeline = demoTimeline(events, 4);
    expect(timeline).toHaveLength(events.length);
    expect(timeline[0]).toBe(0);
    expect(timeline[1]).toBe(scaledDelay(at(0), at(1), 4));
    expect(demoDurationMs(events, 1)).toBe(356_000);
    expect(demoDurationMs(events, 4)).toBe(89_000);
    expect(demoDurationMs(events, 16)).toBe(22_250);
  });

  test('delivers the first event synchronously, then follows the recorded gaps', () => {
    const timers = fakeTimers();
    const seen: StarlingEvent[] = [];
    playDemo({
      events: [at(0), at(2), at(3)],
      speed: 1,
      loop: false,
      timers: timers.timers,
      onEvent: (event) => seen.push(event),
    });

    expect(seen).toEqual([at(0)]);
    const firstGap = scaledDelay(at(0), at(2), 1);
    timers.tick(firstGap);
    expect(seen).toEqual([at(0), at(2)]);
    timers.tick(scaledDelay(at(2), at(3), 1));
    expect(seen).toHaveLength(3);
  });

  test('uses the chosen speed for every hop', () => {
    const timers = fakeTimers();
    const seen: StarlingEvent[] = [];
    playDemo({
      events: [at(0), at(2)],
      speed: 16,
      loop: false,
      timers: timers.timers,
      onEvent: (event) => seen.push(event),
    });

    const gap = scaledDelay(at(0), at(2), 16);
    timers.tick(gap - 1);
    expect(seen).toHaveLength(1);
    timers.tick(1);
    expect(seen).toHaveLength(2);
  });

  test('loops after a three-second pause and replays from the start', () => {
    const timers = fakeTimers();
    const seen: StarlingEvent[] = [];
    let loops = 0;
    playDemo({
      events: [at(0), at(2)],
      speed: 1,
      loopPauseMs: DEMO_LOOP_PAUSE_MS,
      timers: timers.timers,
      onEvent: (event) => seen.push(event),
      onLoop: () => {
        loops += 1;
      },
    });

    timers.tick(scaledDelay(at(0), at(2), 1));
    expect(seen).toHaveLength(2);
    expect(loops).toBe(0);

    timers.tick(DEMO_LOOP_PAUSE_MS - 1);
    expect(loops).toBe(0);
    timers.tick(1);
    expect(loops).toBe(1);
    expect(seen).toHaveLength(3);
    expect(seen[2]).toEqual(at(0));
  });

  test('stop() cancels pending timers and delivers nothing else', () => {
    const timers = fakeTimers();
    const seen: StarlingEvent[] = [];
    const handle = playDemo({
      events: [at(0), at(2), at(3)],
      speed: 1,
      timers: timers.timers,
      onEvent: (event) => seen.push(event),
    });

    handle.stop();
    timers.tick(60_000);
    expect(seen).toHaveLength(1);
    expect(timers.pending()).toBe(0);
  });

  test('an empty fixture ends without scheduling anything', () => {
    const timers = fakeTimers();
    let ended = false;
    playDemo({
      events: [],
      loop: false,
      timers: timers.timers,
      onEvent: () => {
        throw new Error('should not emit');
      },
      onStatus: (status) => {
        if (status === 'ended') ended = true;
      },
    });
    expect(ended).toBe(true);
    expect(timers.pending()).toBe(0);
  });
});

describe('rebaseEvents', () => {
  const NOW = 1_900_000_000_000;

  test('lands the first event at `now` and preserves every gap', () => {
    const rebased = rebaseEvents(events, NOW);
    expect(rebased).toHaveLength(events.length);
    expect(rebased[0]?.ts).toBe(NOW);
    for (let index = 1; index < events.length; index += 1) {
      const original = (events[index]?.ts ?? 0) - (events[index - 1]?.ts ?? 0);
      const shifted = (rebased[index]?.ts ?? 0) - (rebased[index - 1]?.ts ?? 0);
      expect(shifted).toBe(original);
    }
  });

  test('shifts the payload clocks the panels read, leaving durations alone', () => {
    const rebased = rebaseEvents(events, NOW);
    const offset = NOW - (events[0]?.ts ?? 0);

    const firstRun = rebased[0];
    if (firstRun?.type !== 'run.created') throw new Error('first event is not run.created');
    const originalRun = events[0];
    if (originalRun?.type !== 'run.created') throw new Error('first event is not run.created');
    expect(firstRun.payload.run.startedAt).toBe(originalRun.payload.run.startedAt + offset);
    expect(firstRun.payload.run.goal.createdAt).toBe(originalRun.payload.run.goal.createdAt + offset);
    expect(firstRun.payload.run.metrics.elapsedMs).toBe(originalRun.payload.run.metrics.elapsedMs);

    const nodeIndex = events.findIndex((event) => event.type === 'node.joined');
    const nodeEvent = rebased[nodeIndex];
    const originalNodeEvent = events[nodeIndex];
    if (nodeEvent?.type !== 'node.joined' || originalNodeEvent?.type !== 'node.joined') {
      throw new Error('fixture has no node.joined');
    }
    expect(nodeEvent.payload.node.lastSeen).toBe(originalNodeEvent.payload.node.lastSeen + offset);
    expect(nodeEvent.payload.node.lastSeen).toBeLessThan(NOW + 3_600_000);

    const taskEvent = rebased.find(
      (event) => event.type === 'task.status' && event.payload.run.finishedAt !== undefined,
    );
    if (taskEvent?.type !== 'task.status' || taskEvent.payload.run.startedAt === undefined) {
      throw new Error('fixture has no finished task');
    }
    expect(Number.isFinite(taskEvent.payload.run.finishedAt)).toBe(true);
    expect(
      (taskEvent.payload.run.finishedAt ?? 0) - (taskEvent.payload.run.startedAt ?? 0),
    ).toBeGreaterThan(0);
  });

  test('never mutates the source log and tolerates an empty one', () => {
    const before = events[0]?.ts;
    rebaseEvents(events, NOW);
    expect(events[0]?.ts).toBe(before);
    expect(rebaseEvents([], NOW)).toEqual([]);
  });
});
