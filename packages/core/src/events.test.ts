import { describe, expect, test } from 'bun:test';
import type { StarlingEvent } from './contracts';
import { createEventBus } from './events';

function logEvent(ts = 1): StarlingEvent {
  return { type: 'log', runId: 'r1', ts, payload: { level: 'info', msg: 'hello' } };
}

describe('createEventBus', () => {
  test('fans out synchronously in subscription order', () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.subscribe((e) => seen.push(`a:${e.type}`));
    bus.subscribe((e) => seen.push(`b:${e.type}`));
    bus.publish(logEvent());
    expect(seen).toEqual(['a:log', 'b:log']);
  });

  test('unsubscribe stops delivery only for that subscriber', () => {
    const bus = createEventBus();
    const a: StarlingEvent[] = [];
    const b: StarlingEvent[] = [];
    const unsub = bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));
    bus.publish(logEvent(1));
    unsub();
    bus.publish(logEvent(2));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
  });

  test('a throwing subscriber is reported as an error log and does not break others', () => {
    const bus = createEventBus();
    const seen: StarlingEvent[] = [];
    bus.subscribe(() => {
      throw new Error('subscriber exploded');
    });
    bus.subscribe((e) => seen.push(e));
    bus.publish(logEvent());

    expect(seen).toHaveLength(2);
    // The error report is delivered first (to the healthy subscriber), then the original event.
    const report = seen[0];
    if (report?.type !== 'log') throw new Error('expected a log event');
    expect(report.payload.level).toBe('error');
    expect(report.payload.msg).toContain('subscriber exploded');
    expect(report.runId).toBe('r1');
    const original = seen[1];
    if (original?.type !== 'log') throw new Error('expected the original log event');
    expect(original.payload.level).toBe('info');
  });

  test('a throwing log subscriber cannot cause an infinite loop', () => {
    const bus = createEventBus();
    let calls = 0;
    bus.subscribe(() => {
      calls += 1;
      throw new Error('always');
    });
    bus.publish(logEvent());
    // original event + one error report, then the guard stops further recursion
    expect(calls).toBe(2);
  });

  test('subscribing during publish does not receive the in-flight event', () => {
    const bus = createEventBus();
    const late: StarlingEvent[] = [];
    bus.subscribe(() => {
      bus.subscribe((e) => late.push(e));
    });
    bus.publish(logEvent(1));
    expect(late).toHaveLength(0);
  });

  test('unsubscribing during publish is safe', () => {
    const bus = createEventBus();
    const seen: StarlingEvent[] = [];
    const unsub = bus.subscribe(() => {
      seen.push(logEvent());
      unsub();
    });
    bus.publish(logEvent(1));
    bus.publish(logEvent(2));
    expect(seen).toHaveLength(1);
  });
});
