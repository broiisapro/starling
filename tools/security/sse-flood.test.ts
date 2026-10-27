/**
 * Probes: the SSE streams (`/api/events`, `/api/runs/:id/events`).
 *
 * The stream is unauthenticated, keeps one bus subscriber per connection and queues every frame in a
 * promise chain until the socket drains. That is correct for one dashboard tab; it is a resource bug
 * when the caller is a LAN peer that opens thousands of tabs and never reads.
 *
 * Probes that must hold (plain tests):
 *  - a stalled reader does not stop a healthy one from receiving frames (per-connection queues);
 *  - a closed connection unsubscribes from the bus, so a closed tab leaves nothing behind.
 *
 * Probe that is `test.failing`: there is no cap on concurrent streams. A hub should refuse the 65th
 * with 429/503 rather than let the process run out of descriptors or memory.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import type { EventBus, StarlingEvent } from '../../packages/core/src/index.ts';
import { createEventBus } from '../../packages/core/src/index.ts';
import { startProbeServer, wait } from './support.ts';

const MAX_EXPECTED_STREAMS = 64;

interface CountingBus extends EventBus {
  active(): number;
}

function countingBus(): CountingBus {
  const inner = createEventBus();
  let active = 0;
  return {
    publish: (event: StarlingEvent) => inner.publish(event),
    subscribe: (fn) => {
      active += 1;
      const unsubscribe = inner.subscribe(fn);
      return () => {
        active -= 1;
        unsubscribe();
      };
    },
    active: () => active,
  };
}

const bus = countingBus();
const server = startProbeServer({ bus });

afterAll(() => server.stop());

let seq = 0;
function publishLog(): void {
  seq += 1;
  bus.publish({
    type: 'log',
    runId: '*',
    ts: Date.now(),
    payload: { level: 'info', msg: `probe frame ${seq}` },
  });
}

describe('SSE backpressure isolation', () => {
  test('a stalled reader does not starve a healthy one', async () => {
    // Stalled: fetch and deliberately never read the body.
    const stalled = await fetch(`${server.url}/api/events`);
    const healthy = await fetch(`${server.url}/api/events`);
    const reader = healthy.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let text = '';
    const pump = (async () => {
      const deadline = Date.now() + 3000;
      while (text.split('\n\n').filter((block) => block.startsWith('data:')).length < 20) {
        if (Date.now() > deadline) throw new Error('healthy SSE client received nothing');
        const { value, done } = (await reader?.read()) ?? { value: undefined, done: true };
        if (done) break;
        if (value !== undefined) text += decoder.decode(value, { stream: true });
      }
    })();

    for (let i = 0; i < 20; i += 1) publishLog();
    await pump;
    expect(text).toContain('probe frame');
    await reader?.cancel();
    await stalled.body?.cancel();
  });

  test('a closed connection unsubscribes from the bus', async () => {
    // Let the previous test's aborted connections finish their cleanup first.
    await wait(250);
    expect(bus.active()).toBe(0);

    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const connections = await Promise.all(
      controllers.map((controller) =>
        fetch(`${server.url}/api/events`, { signal: controller.signal }).then((response) => response),
      ),
    );
    await wait(50);
    expect(bus.active()).toBe(3);
    for (const connection of connections) await connection.body?.cancel();
    await wait(250);
    expect(bus.active()).toBe(0);
  });
});

describe('SSE stream cap', () => {
  test.failing('refuses streams beyond a documented cap', async () => {
    const controllers: AbortController[] = [];
    const responses: Response[] = [];
    try {
      for (let i = 0; i < MAX_EXPECTED_STREAMS + 16; i += 1) {
        const controller = new AbortController();
        controllers.push(controller);
        responses.push(await fetch(`${server.url}/api/events`, { signal: controller.signal }));
      }
      const accepted = responses.filter((response) => response.status === 200).length;
      expect(accepted).toBeLessThanOrEqual(MAX_EXPECTED_STREAMS);
    } finally {
      for (const response of responses) await response.body?.cancel();
      for (const controller of controllers) controller.abort();
    }
  });
});
