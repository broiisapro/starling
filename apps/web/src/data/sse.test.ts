import { beforeEach, describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core';
import { demoEvents } from './demo';
import {
  connectEvents,
  connectRunEvents,
  DEFAULT_BACKOFF,
  type EventSourceFactory,
  type EventSourceLike,
  nextBackoffDelay,
  parseSseEvent,
  runEventsUrl,
  type SseTimers,
  withSince,
} from './sse';

const events = demoEvents();
const first = events[0];
if (first === undefined) throw new Error('fixture is empty');

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];

  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event('open'));
  }

  error(): void {
    this.onerror?.(new Event('error'));
  }

  message(data: string): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const factory: EventSourceFactory = (url) => new FakeEventSource(url);

function fakeTimers(): { timers: SseTimers; tick(ms: number): void; pending(): number } {
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

const noJitter = { random: () => 0.5, jitterRatio: 0 };

beforeEach(() => {
  FakeEventSource.instances = [];
});

describe('SSE client', () => {
  test('opens the events endpoint and reports connecting → live', () => {
    const statuses: string[] = [];
    const handle = connectEvents({
      url: '/api/events',
      onEvent: () => {},
      onStatus: (status) => statuses.push(status),
      factory,
    });

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe('/api/events');
    expect(handle.status).toBe('connecting');

    FakeEventSource.instances[0]?.open();
    expect(handle.status).toBe('live');
    expect(statuses).toEqual(['connecting', 'live']);
    handle.close();
  });

  test('parses an event, forwards it and remembers the resume timestamp', () => {
    const received: StarlingEvent[] = [];
    const handle = connectEvents({ url: '/api/events', onEvent: (event) => received.push(event), factory });
    FakeEventSource.instances[0]?.open();
    FakeEventSource.instances[0]?.message(JSON.stringify(first));

    expect(received).toEqual([first]);
    expect(handle.lastTs).toBe(first.ts);
    handle.close();
  });

  test('reports malformed frames instead of crashing the stream', () => {
    const errors: string[] = [];
    const received: StarlingEvent[] = [];
    const handle = connectEvents({
      url: '/api/events',
      onEvent: (event) => received.push(event),
      onError: (error) => errors.push(error.code),
      factory,
    });
    FakeEventSource.instances[0]?.message('{not json');
    FakeEventSource.instances[0]?.message('{"type":"metrics"}');

    expect(received).toEqual([]);
    expect(errors).toEqual(['UNKNOWN', 'UNKNOWN']);
    expect(handle.status).toBe('connecting');
    handle.close();
  });

  test('reconnects after an error and resumes from ?since=', () => {
    const timers = fakeTimers();
    const handle = connectEvents({
      url: '/api/events',
      onEvent: () => {},
      factory,
      timers: timers.timers,
      backoff: noJitter,
    });

    FakeEventSource.instances[0]?.open();
    FakeEventSource.instances[0]?.message(JSON.stringify(first));
    FakeEventSource.instances[0]?.error();

    expect(handle.status).toBe('offline');
    expect(timers.pending()).toBe(1);

    timers.tick(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    timers.tick(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]?.url).toBe(`/api/events?since=${first.ts}`);
    handle.close();
  });

  test('backs off exponentially across repeated failures', () => {
    const timers = fakeTimers();
    const delays: number[] = [];
    const handle = connectEvents({
      url: '/api/events',
      onEvent: () => {},
      onStatus: (_status, detail) => {
        if (detail.delayMs !== undefined) delays.push(detail.delayMs);
      },
      factory,
      timers: timers.timers,
      backoff: noJitter,
    });

    FakeEventSource.instances[0]?.error();
    timers.tick(1_000);
    FakeEventSource.instances[1]?.error();
    timers.tick(2_000);
    FakeEventSource.instances[2]?.error();

    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(timers.pending()).toBe(1);
    handle.close();
  });

  test('respects maxRetries and gives up', () => {
    const timers = fakeTimers();
    const handle = connectEvents({
      url: '/api/events',
      onEvent: () => {},
      factory,
      timers: timers.timers,
      maxRetries: 0,
    });

    FakeEventSource.instances[0]?.error();
    expect(handle.status).toBe('offline');
    expect(timers.pending()).toBe(0);
    expect(FakeEventSource.instances).toHaveLength(1);
    handle.close();
  });

  test('close() cancels a pending reconnect and the live source', () => {
    const timers = fakeTimers();
    const handle = connectEvents({
      url: '/api/events',
      onEvent: () => {},
      factory,
      timers: timers.timers,
      backoff: noJitter,
    });

    FakeEventSource.instances[0]?.error();
    expect(timers.pending()).toBe(1);
    const source = FakeEventSource.instances[0];
    handle.close();
    expect(source?.closed).toBe(true);
    expect(timers.pending()).toBe(0);

    timers.tick(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  test('a fresh open resets the backoff attempt counter', () => {
    const timers = fakeTimers();
    const handle = connectEvents({
      url: '/api/events',
      onEvent: () => {},
      factory,
      timers: timers.timers,
      backoff: noJitter,
    });

    FakeEventSource.instances[0]?.error();
    timers.tick(1_000);
    FakeEventSource.instances[1]?.open();
    FakeEventSource.instances[1]?.error();
    timers.tick(1_000);

    expect(FakeEventSource.instances).toHaveLength(3);
    handle.close();
  });

  test('nextBackoffDelay grows, jitters and caps', () => {
    expect(nextBackoffDelay(0, { ...DEFAULT_BACKOFF, ...noJitter })).toBe(1_000);
    expect(nextBackoffDelay(1, { ...DEFAULT_BACKOFF, ...noJitter })).toBe(2_000);
    expect(nextBackoffDelay(3, { ...DEFAULT_BACKOFF, ...noJitter })).toBe(8_000);
    expect(nextBackoffDelay(10, { ...DEFAULT_BACKOFF, ...noJitter })).toBe(30_000);
    expect(
      nextBackoffDelay(0, { ...DEFAULT_BACKOFF, baseMs: 1_000, random: () => 0, jitterRatio: 0.2 }),
    ).toBe(800);
  });

  test('runEventsUrl and withSince encode ids and compose with existing query strings', () => {
    expect(runEventsUrl('01jd2k7m3p4q5r6s7t8v9w0x1y')).toBe('/api/runs/01jd2k7m3p4q5r6s7t8v9w0x1y/events');
    expect(runEventsUrl('run 1')).toBe('/api/runs/run%201/events');
    expect(withSince('/api/runs/a/events', 42)).toBe('/api/runs/a/events?since=42');
    expect(withSince('/api/events?x=1', 42)).toBe('/api/events?x=1&since=42');
    expect(withSince('/api/events', undefined)).toBe('/api/events');
  });

  test('connectRunEvents points at the per-run endpoint', () => {
    const handle = connectRunEvents('run-1', { onEvent: () => {}, factory });
    expect(FakeEventSource.instances[0]?.url).toBe('/api/runs/run-1/events');
    handle.close();
  });

  test('parseSseEvent throws without an error handler and returns undefined with one', () => {
    expect(() => parseSseEvent('nope')).toThrow();
    expect(parseSseEvent('nope', () => {})).toBeUndefined();
    expect(parseSseEvent(JSON.stringify(first))).toEqual(first);
  });
});
