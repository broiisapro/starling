import { describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '../../packages/core/src/index.ts';
import { compareCounts, consumeSse, createClientState, eventKey, keyCounts } from './sse.ts';

function logEvent(ts: number, msg: string): StarlingEvent {
  return { type: 'log', runId: 'r1', ts, payload: { level: 'info', msg } };
}

function finishedEvent(ts: number): StarlingEvent {
  // `consumeSse` only inspects `type`/`ts`; the payload shape is the reducer's business.
  return {
    type: 'run.finished',
    runId: 'r1',
    ts,
    payload: { run: {} as never, summary: 'done' },
  };
}

function sseBody(events: readonly StarlingEvent[]): string {
  const frames = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  return `: connected\n\n${frames}`;
}

describe('event keys and multiset comparison', () => {
  test('keys distinguish task sessions and types', () => {
    const a = eventKey({
      type: 'agent.event',
      runId: 'r1',
      ts: 10,
      payload: {
        runId: 'r1',
        taskKey: 'a',
        sessionId: 's1',
        ts: 10,
        kind: 'text',
        data: {},
      },
    });
    const b = eventKey({
      type: 'agent.event',
      runId: 'r1',
      ts: 10,
      payload: {
        runId: 'r1',
        taskKey: 'b',
        sessionId: 's1',
        ts: 10,
        kind: 'text',
        data: {},
      },
    });
    expect(a).not.toBe(b);
  });

  test('reports missing and duplicate frames', () => {
    const expected = keyCounts([logEvent(1, 'a'), logEvent(2, 'b'), logEvent(2, 'b')]);
    const actual = keyCounts([logEvent(1, 'a'), logEvent(2, 'b'), logEvent(2, 'b'), logEvent(2, 'b')]);
    expect(compareCounts(expected, actual)).toEqual({ missing: 0, duplicates: 1 });
    expect(compareCounts(actual, expected)).toEqual({ missing: 1, duplicates: 0 });
  });
});

describe('SSE consumer', () => {
  test('separates backlog from live and sees the terminal event', async () => {
    const now = Date.now();
    const events = [
      logEvent(now - 1_000, 'backlog'),
      logEvent(now + 5_000, 'live'),
      finishedEvent(now + 5_001),
    ];
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(sseBody(events), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    });

    try {
      const state = createClientState(0);
      const controller = new AbortController();
      await consumeSse(`http://127.0.0.1:${server.port}/events`, state, controller.signal);
      expect(state.received).toBe(3);
      expect(state.backlogEvents).toBe(1);
      expect(state.liveLatency.length).toBe(2);
      expect(state.sawFinished).toBe(true);
      expect(state.errors).toEqual([]);
    } finally {
      server.stop(true);
    }
  });

  test('a comment-only stream delivers nothing and never finishes', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Response(': keep-alive\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    });
    try {
      const state = createClientState(1);
      await consumeSse(`http://127.0.0.1:${server.port}/events`, state, new AbortController().signal);
      expect(state.received).toBe(0);
      expect(state.sawFinished).toBe(false);
    } finally {
      server.stop(true);
    }
  });
});
