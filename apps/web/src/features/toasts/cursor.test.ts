import { describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core/browser';
import { cursorAt, EMPTY_CURSOR, newEventsSince } from './cursor';
import { logEvent, metricsEvent, planEvent, TS } from './test-events';

function info(ts: number, runId = 'run-1'): StarlingEvent {
  return { type: 'log', runId, ts, payload: { level: 'info', msg: `event ${ts}` } };
}

/** Push `events` through the cursor the way the host does, returning everything that toasted. */
function drain(events: StarlingEvent[]): StarlingEvent[] {
  let cursor = newEventsSince(undefined, events.slice(0, 2)).cursor;
  const fresh: StarlingEvent[] = [];
  for (let index = 2; index <= events.length; index += 1) {
    const step = newEventsSince(cursor, events.slice(0, index));
    cursor = step.cursor;
    fresh.push(...step.fresh);
  }
  return fresh;
}

describe('cursorAt', () => {
  test('an empty window has an empty cursor', () => {
    expect(cursorAt([])).toEqual(EMPTY_CURSOR);
  });

  test('the cursor records the last event identity and the window size', () => {
    const events = [info(TS), planEvent(TS + 1)];
    expect(cursorAt(events)).toEqual({ ts: TS + 1, type: 'repomap.ready', runId: 'run-1', count: 2 });
  });
});

describe('newEventsSince', () => {
  test('the first call primes the cursor and replays nothing', () => {
    const events = [info(TS), info(TS + 1), info(TS + 2)];
    const step = newEventsSince(undefined, events);
    expect(step.fresh).toEqual([]);
    expect(step.cursor.count).toBe(3);
  });

  test('appended events are fresh, in order, and only once', () => {
    const base = [info(TS), info(TS + 1)];
    const first = newEventsSince(undefined, base);
    const second = newEventsSince(first.cursor, [...base, info(TS + 2), info(TS + 3)]);
    expect(second.fresh.map((event) => event.ts)).toEqual([TS + 2, TS + 3]);
    const third = newEventsSince(second.cursor, [...base, info(TS + 2), info(TS + 3)]);
    expect(third.fresh).toEqual([]);
  });

  test('two events with the same ts/type/runId are counted by position, not identity', () => {
    const one = info(TS);
    const two = info(TS);
    const primed = newEventsSince(undefined, [one]);
    const step = newEventsSince(primed.cursor, [one, two]);
    expect(step.fresh).toHaveLength(1);
  });

  test('an empty baseline treats the first non-empty window as history', () => {
    const primed = newEventsSince(undefined, []);
    const step = newEventsSince(primed.cursor, [info(TS), info(TS + 1)]);
    expect(step.fresh).toEqual([]);
    expect(step.cursor.count).toBe(2);

    const next = newEventsSince(step.cursor, [info(TS), info(TS + 1), info(TS + 2)]);
    expect(next.fresh.map((event) => event.ts)).toEqual([TS + 2]);
  });

  test('a run switch re-filter does not replay the other run history', () => {
    const runA = [info(TS, 'a'), info(TS + 1, 'a'), info(TS + 2, 'a')];
    const primed = newEventsSince(undefined, runA);
    const switched = [info(TS + 100, 'b'), info(TS + 101, 'b')];
    const step = newEventsSince(primed.cursor, switched);
    expect(step.fresh).toEqual([]);
    expect(step.cursor.runId).toBe('b');
    expect(step.cursor.count).toBe(2);

    const live = newEventsSince(step.cursor, [...switched, info(TS + 102, 'b')]);
    expect(live.fresh.map((event) => event.ts)).toEqual([TS + 102]);
  });

  test('a cap slice returns only the events after the cursor', () => {
    const cap = 5;
    const primed = newEventsSince(undefined, [
      info(TS),
      info(TS + 1),
      info(TS + 2),
      info(TS + 3),
      info(TS + 4),
    ]);
    const sliced = [info(TS + 2), info(TS + 3), info(TS + 4), info(TS + 5), info(TS + 6)].slice(-cap);
    const step = newEventsSince(primed.cursor, sliced);
    expect(step.fresh.map((event) => event.ts)).toEqual([TS + 5, TS + 6]);
  });

  test('an evicted cursor reprimes instead of replaying the whole window', () => {
    const primed = newEventsSince(undefined, [info(TS), info(TS + 1)]);
    const evicted = [info(TS + 10), info(TS + 11), info(TS + 12)];
    const step = newEventsSince(primed.cursor, evicted);
    expect(step.fresh).toEqual([]);
    expect(step.cursor).toEqual(cursorAt(evicted));
  });

  test('a demo loop reset then replay does not storm', () => {
    const run = [info(TS), info(TS + 1), info(TS + 2)];
    const primed = newEventsSince(undefined, run);
    const reset = newEventsSince(primed.cursor, []);
    expect(reset.fresh).toEqual([]);
    expect(reset.cursor.count).toBe(0);
    const replayed = newEventsSince(reset.cursor, run);
    expect(replayed.fresh).toEqual([]);
  });

  test('a growing live window drains every new event exactly once', () => {
    const events = Array.from({ length: 12 }, (_, index) => info(TS + index));
    const fresh = drain(events);
    expect(fresh.map((event) => event.ts)).toEqual(events.slice(2).map((event) => event.ts));
  });

  test('metrics events are not special-cased', () => {
    const primed = newEventsSince(undefined, [metricsEvent(0)]);
    const step = newEventsSince(primed.cursor, [metricsEvent(0), metricsEvent(0.5, TS + 5_000)]);
    expect(step.fresh).toHaveLength(1);
    expect(logEvent('info').type).toBe('log');
  });
});
