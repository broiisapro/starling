import { afterEach, describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import type { AgentEvent } from '@starling/core';
import { FakeClock, StarlingError } from '@starling/core';
import type { ReplayRunner } from '../src';
import { createReplayRunner } from '../src';
import { collectEvents, startArgs } from './helpers';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

function recorded(): AgentEvent[] {
  return [
    { runId: 'old', taskKey: 'old', sessionId: 'old', ts: 1_000, kind: 'session.started', data: {} },
    { runId: 'old', taskKey: 'old', sessionId: 'old', ts: 1_500, kind: 'text', data: { text: 'hi' } },
    { runId: 'old', taskKey: 'old', sessionId: 'old', ts: 2_500, kind: 'session.idle', data: {} },
  ];
}

function setup(events: AgentEvent[], speed = 1): { runner: ReplayRunner; clock: FakeClock } {
  const clock = new FakeClock(0);
  const runner = createReplayRunner({ events, clock, speed, newSessionId: () => 'ses_replay_1' });
  cleanups.push(() => runner.close());
  return { runner, clock };
}

describe('createReplayRunner', () => {
  test('replays in recorded order, remapping runId, taskKey and sessionId', async () => {
    const { runner, clock } = setup(recorded());
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    await runner.start(startArgs({ runId: 'run_new', taskKey: 't-new' }));
    expect(collector.events).toHaveLength(0);

    runner.tick();
    expect(collector.events.map((event) => event.kind)).toEqual(['session.started']);

    clock.advance(500);
    runner.tick();
    expect(collector.events.map((event) => event.kind)).toEqual(['session.started', 'text']);

    clock.advance(1_000);
    runner.tick();
    expect(collector.events.map((event) => event.kind)).toEqual(['session.started', 'text', 'session.idle']);
    expect(collector.events.every((event) => event.runId === 'run_new')).toBe(true);
    expect(collector.events.every((event) => event.taskKey === 't-new')).toBe(true);
    expect(collector.events.every((event) => event.sessionId === 'ses_replay_1')).toBe(true);
  });

  test('honours the original relative timing', async () => {
    const { runner, clock } = setup(recorded(), 1);
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    await runner.start(startArgs());
    clock.advance(499);
    runner.tick();
    expect(collector.events).toHaveLength(1); // only the event due at t=0
    clock.advance(1);
    runner.tick();
    expect(collector.events.map((event) => event.kind)).toEqual(['session.started', 'text']);
  });

  test('speed scales the gaps', async () => {
    const { runner, clock } = setup(recorded(), 2);
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    await runner.start(startArgs());
    runner.tick();
    clock.advance(249);
    runner.tick();
    expect(collector.kinds()).toEqual(['session.started']);
    clock.advance(1); // 500 ms of recording at 2× = 250 ms
    runner.tick();
    expect(collector.kinds()).toEqual(['session.started', 'text']);
  });

  test('done resolves when the recording is exhausted', async () => {
    const { runner, clock } = setup(recorded(), 4);
    await runner.start(startArgs());
    expect(runner.remaining).toBe(3);
    clock.advance(1_000);
    runner.tick();
    await runner.done();
    expect(runner.replayed).toBe(3);
    expect(runner.remaining).toBe(0);
  });

  test('close stops playback and resolves done', async () => {
    const { runner } = setup(recorded());
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    await runner.start(startArgs());
    await runner.close();
    runner.tick();
    await runner.done();
    expect(collector.events).toHaveLength(0);
  });

  test('reads a JSONL recording from disk', async () => {
    const path = `${tmpdir()}/starling-replay-${crypto.randomUUID()}.jsonl`;
    await Bun.write(
      path,
      recorded()
        .map((event) => JSON.stringify(event))
        .join('\n'),
    );
    cleanups.push(() => {
      void Bun.file(path).delete();
    });

    const clock = new FakeClock(0);
    const runner = createReplayRunner({ events: path, clock });
    cleanups.push(() => runner.close());
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    await runner.start(startArgs());
    clock.advance(10_000);
    runner.tick();
    expect(collector.kinds()).toEqual(['session.started', 'text', 'session.idle']);
  });

  test('send and abort emit a terminal idle so a caller can move on', async () => {
    const { runner } = setup(recorded());
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    const { sessionId } = await runner.start(startArgs());
    await runner.send(sessionId, 'fix it');
    expect(collector.events.at(-1)).toMatchObject({ kind: 'session.idle', data: { replay: true } });

    await runner.abort(sessionId);
    expect(collector.events.at(-1)?.data).toMatchObject({ replay: true, aborted: true });
  });

  test('rejects bad speeds, bad events and a second session', async () => {
    expect(() => createReplayRunner({ events: recorded(), speed: 0 })).toThrow(StarlingError);

    const bad = [{ ...recorded()[0], kind: 'not-a-kind' }] as unknown as AgentEvent[];
    expect(() => createReplayRunner({ events: bad })).toThrow(StarlingError);

    const { runner } = setup(recorded());
    await runner.start(startArgs());
    await expect(runner.start(startArgs())).rejects.toBeInstanceOf(StarlingError);
  });
});
