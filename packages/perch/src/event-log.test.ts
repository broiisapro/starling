import { describe, expect, test } from 'bun:test';
import { makeAgentEvent } from '@starling/core/testing';
import { createEventLog, EVENT_REPLAY_LIMIT } from './event-log';

const event = (taskKey = 'theme') => makeAgentEvent({ taskKey, kind: 'text' });

describe('event log', () => {
  test('appends with contiguous ids and replays everything after a resume point', () => {
    const log = createEventLog(10);
    expect(log.nextId()).toBe(1);

    for (let i = 0; i < 4; i += 1) log.append(event());
    expect(log.size()).toBe(4);
    expect(log.nextId()).toBe(5);

    expect(log.since(0)?.id).toBe(1);
    expect(log.since(2)?.id).toBe(3);
    expect(log.since(4)).toBeUndefined();
  });

  test('drops the oldest events past the limit but keeps the ids monotonic', () => {
    const log = createEventLog(3);
    for (let i = 0; i < 5; i += 1) log.append(event(`t${i}`));

    expect(log.size()).toBe(3);
    expect(log.nextId()).toBe(6);
    // A client that fell further behind than the buffer gets the oldest event we still have.
    expect(log.since(0)?.id).toBe(3);
    expect(log.since(3)?.id).toBe(4);
    expect(log.since(5)).toBeUndefined();
  });

  test('notifies waiters on every append and unsubscribes cleanly', () => {
    const log = createEventLog();
    let calls = 0;
    const off = log.onChange(() => {
      calls += 1;
    });
    log.append(event());
    log.append(event());
    off();
    log.append(event());
    expect(calls).toBe(2);
  });

  test('defaults to a 500-event window and rejects a nonsense limit', () => {
    expect(EVENT_REPLAY_LIMIT).toBe(500);
    const log = createEventLog();
    for (let i = 0; i < EVENT_REPLAY_LIMIT + 10; i += 1) log.append(event());
    expect(log.size()).toBe(EVENT_REPLAY_LIMIT);
    expect(log.since(0)?.id).toBe(11);
    expect(() => createEventLog(0)).toThrow(RangeError);
  });
});
