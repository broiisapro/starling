import { describe, expect, test } from 'bun:test';
import { immediateScheduler, MockNode, makeTaskSpec } from '@starling/core/testing';
import { nodeNameOf } from './run-status';
import { buildHarness, smallPlan } from './testing/harness';

describe('observability', () => {
  test('every dispatched task records the node name and the events stay contract-valid', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [new MockNode({ id: 'hub', schedule: immediateScheduler })],
      nodeInfo: { hub: { name: 'M5 Pro' } },
    });
    const run = await h.finish();

    expect(nodeNameOf(run.tasks.a)).toBe('M5 Pro');
    const running = h
      .ofType('task.status')
      .find((event) => event.payload.taskKey === 'a' && event.payload.to === 'running');
    expect(nodeNameOf(running?.payload.run)).toBe('M5 Pro');
  });

  test('no run.status event is published while core does not know the arm (feature detection)', async () => {
    const h = buildHarness({ plan: smallPlan([makeTaskSpec({ key: 'a' })]) });
    await h.finish();
    const unknown = h.events.filter((event) => (event.type as string) === 'run.status');
    expect(unknown).toHaveLength(0);
    // The run still reports every status through the run itself and run.finished.
    expect(h.ofType('run.finished')).toHaveLength(1);
  });

  test('policy actions carry a stable code alongside the human message', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      config: { maxParallel: 2 },
      nodes: [
        new MockNode({
          id: 'hub',
          schedule: immediateScheduler,
          events: [
            { kind: 'session.started', data: {} },
            {
              kind: 'session.error',
              data: { rateLimited: true, provider: 'opencode-go', retryAfterMs: 10 },
            },
            { kind: 'session.idle', data: {} },
          ],
        }),
      ],
    });
    await h.finish();
    const logs = h.policyLogs();
    expect(logs.length).toBeGreaterThanOrEqual(2);
    for (const entry of logs) {
      expect(entry.msg.startsWith(`[${entry.code}]`)).toBe(true);
    }
    expect(logs.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['rate-limit.backoff', 'parallelism.reduced']),
    );
  });
});
