import { afterEach, describe, expect, test } from 'bun:test';
import type { OpencodeRunner } from '../src';
import { createOpencodeRunner } from '../src';
import type { FakePromptHandler } from './fake-opencode';
import { createFakeOpencodeServer } from './fake-opencode';
import { collectEvents, delay, eventually, startArgs } from './helpers';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

function setup(
  onPrompt: FakePromptHandler,
  reconnectMinMs = 10,
): {
  server: ReturnType<typeof createFakeOpencodeServer>;
  runner: OpencodeRunner;
} {
  const server = createFakeOpencodeServer({ password: 'pw', onPrompt });
  const runner = createOpencodeRunner({
    mode: 'attach',
    url: server.url,
    password: 'pw',
    textDebounceMs: 15,
    reconnect: { minMs: reconnectMinMs, maxMs: 40 },
  });
  cleanups.push(async () => {
    await runner.close();
    server.close();
  });
  return { server, runner };
}

describe('session demultiplexing', () => {
  test('interleaved events from two sessions keep their own runId and taskKey', async () => {
    const { runner } = setup(async ({ sessionId, emit, setActive }) => {
      for (const word of ['one', 'two', 'three']) {
        emit({
          type: 'message.part.delta',
          data: { sessionID: sessionId, messageID: 'm', partID: 'p', field: 'text', delta: word },
        });
        await delay(3);
      }
      setActive(false);
      emit({ type: 'session.idle', data: { sessionID: sessionId } });
    });

    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    const [a, b] = await Promise.all([
      runner.start(startArgs({ runId: 'run_a', taskKey: 't-a', dir: '/tmp/a' })),
      runner.start(startArgs({ runId: 'run_b', taskKey: 't-b', dir: '/tmp/b' })),
    ]);

    await eventually(() => collector.events.filter((event) => event.kind === 'session.idle').length === 2);

    const forA = collector.events.filter((event) => event.sessionId === a.sessionId);
    const forB = collector.events.filter((event) => event.sessionId === b.sessionId);
    expect(forA.every((event) => event.runId === 'run_a' && event.taskKey === 't-a')).toBe(true);
    expect(forB.every((event) => event.runId === 'run_b' && event.taskKey === 't-b')).toBe(true);

    expect(forA.filter((event) => event.kind === 'text').map((event) => event.data.text)).toEqual([
      'onetwothree',
    ]);
    expect(forB.filter((event) => event.kind === 'text').map((event) => event.data.text)).toEqual([
      'onetwothree',
    ]);
    expect(forA.at(-1)?.kind).toBe('session.idle');
    expect(forB.at(-1)?.kind).toBe('session.idle');
  });
});

describe('SSE reconnection', () => {
  test('reconnects after the stream drops and keeps delivering events', async () => {
    let finishTurn: () => void = () => {};
    const { server, runner } = setup(({ sessionId, emit, setActive }) => {
      emit({
        type: 'message.part.delta',
        data: { sessionID: sessionId, messageID: 'm', partID: 'p', field: 'text', delta: 'before' },
      });
      return new Promise<void>((resolve) => {
        finishTurn = () => {
          emit({
            type: 'message.part.delta',
            data: {
              sessionID: sessionId,
              messageID: 'm',
              partID: 'p2',
              field: 'text',
              delta: 'after',
            },
          });
          setActive(false);
          emit({ type: 'session.idle', data: { sessionID: sessionId } });
          resolve();
        };
      });
    });

    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    await runner.start(startArgs());
    await collector.waitFor('text');

    server.dropSse();
    await eventually(() => server.sseConnections >= 2);

    finishTurn();
    await collector.waitFor('session.idle');

    const texts = collector.events
      .filter((event) => event.kind === 'text')
      .map((event) => String(event.data.text));
    expect(texts).toEqual(['before', 'after']);
  });

  test('resync after reconnect reports an idle that was missed while disconnected', async () => {
    const { server, runner } = setup(({ sessionId, emit, setActive }) => {
      emit({
        type: 'message.part.delta',
        data: { sessionID: sessionId, messageID: 'm', partID: 'p', field: 'text', delta: 'half' },
      });
      setActive(true);
      // Never emits idle: the runner has to notice via /api/session/active.
    });

    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    const { sessionId } = await runner.start(startArgs());
    await collector.waitFor('text');

    server.setActive(sessionId, false);
    server.dropSse();

    await collector.waitFor('session.idle');
    // The resync runs before the reconnect attempt, so the idle can arrive first.
    await eventually(() => server.sseConnections >= 2);
  });
});
