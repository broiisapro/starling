import { describe, expect, test } from 'bun:test';
import type { AgentEvent, ExecutionNode } from '@starling/core';
import { isStarlingError } from '@starling/core';
import { makeAgentEvent } from '@starling/core/testing';
import { watchForIdle } from './idle.ts';

interface FakeNode {
  node: ExecutionNode;
  emit(event: AgentEvent): void;
  listening(): number;
}

/** Only `onEvent` is used by the watch; everything else is intentionally absent. */
function fakeNode(): FakeNode {
  const listeners = new Set<(event: AgentEvent) => void>();
  const node = {
    id: 'fake',
    onEvent(fn: (event: AgentEvent) => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  } as unknown as ExecutionNode; // reason: the watch never touches the rest of the port
  return {
    node,
    emit(event) {
      for (const listener of [...listeners]) listener(event);
    },
    listening: () => listeners.size,
  };
}

const RUN = 'run1';
const KEY = 'delete-all';

describe('watchForIdle', () => {
  test('resolves when the session goes idle, and unsubscribes', async () => {
    const fake = fakeNode();
    const watch = watchForIdle(fake.node, { runId: RUN, taskKey: KEY, timeoutMs: 0 });
    watch.attach('ses_1');

    fake.emit(makeAgentEvent({ runId: RUN, taskKey: KEY, sessionId: 'ses_1', kind: 'session.idle' }));

    await watch.done;
    expect(fake.listening()).toBe(0);
  });

  test('ignores idle events from another session', async () => {
    const fake = fakeNode();
    const watch = watchForIdle(fake.node, { runId: RUN, taskKey: KEY, timeoutMs: 0 });
    watch.attach('ses_1');

    fake.emit(makeAgentEvent({ runId: RUN, taskKey: KEY, sessionId: 'ses_other', kind: 'session.idle' }));
    fake.emit(makeAgentEvent({ runId: RUN, taskKey: KEY, sessionId: 'ses_1', kind: 'session.idle' }));

    await watch.done; // resolves on the second event, not the first
  });

  test('replays an idle event that arrived before the handle did', async () => {
    const fake = fakeNode();
    const watch = watchForIdle(fake.node, { runId: RUN, taskKey: KEY, timeoutMs: 0 });

    fake.emit(makeAgentEvent({ runId: RUN, taskKey: KEY, sessionId: 'ses_1', kind: 'session.idle' }));
    watch.attach('ses_1');

    await watch.done;
  });

  test('drops events for other tasks and runs', async () => {
    const fake = fakeNode();
    const watch = watchForIdle(fake.node, { runId: RUN, taskKey: KEY, timeoutMs: 0 });
    watch.attach('ses_1');

    fake.emit(makeAgentEvent({ runId: 'other-run', taskKey: KEY, sessionId: 'ses_1', kind: 'session.idle' }));
    fake.emit(
      makeAgentEvent({ runId: RUN, taskKey: 'other-task', sessionId: 'ses_1', kind: 'session.idle' }),
    );
    fake.emit(makeAgentEvent({ runId: RUN, taskKey: KEY, sessionId: 'ses_1', kind: 'session.idle' }));

    await watch.done;
  });

  test('rejects on session.error instead of treating it as finished work', async () => {
    const fake = fakeNode();
    const watch = watchForIdle(fake.node, { runId: RUN, taskKey: KEY, timeoutMs: 0 });
    watch.attach('ses_1');

    fake.emit(
      makeAgentEvent({
        runId: RUN,
        taskKey: KEY,
        sessionId: 'ses_1',
        kind: 'session.error',
        data: { reason: 'provider exploded' },
      }),
    );

    await expect(watch.done).rejects.toMatchObject({ code: 'RUNNER_ERROR' });
  });

  test('rejects when the session never goes idle', async () => {
    const fake = fakeNode();
    const watch = watchForIdle(fake.node, { runId: RUN, taskKey: KEY, timeoutMs: 5 });

    try {
      await watch.done;
      throw new Error('expected the watchdog to fire');
    } catch (err) {
      expect(isStarlingError(err, 'RUNNER_ERROR')).toBe(true);
    }
    expect(fake.listening()).toBe(0);
  });

  test('stop() unsubscribes without settling', async () => {
    const fake = fakeNode();
    const watch = watchForIdle(fake.node, { runId: RUN, taskKey: KEY, timeoutMs: 0 });
    watch.attach('ses_1');
    watch.stop();
    watch.stop();
    expect(fake.listening()).toBe(0);
  });
});
