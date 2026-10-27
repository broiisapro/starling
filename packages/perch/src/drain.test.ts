import { afterEach, describe, expect, test } from 'bun:test';
import { FakeClock } from '@starling/core';
import { MockNode } from '@starling/core/testing';
import type { PerchHealthProbes } from './health';
import { type PerchHandle, startPerch } from './perch-daemon';
import type { OsFacts } from './perch-info';
import {
  authHeaders,
  createHubFetch,
  type HubCall,
  makeStartTaskOptions,
  type PerchHarness,
  startPerchApp,
  TEST_CODE,
} from './test-helpers';

/**
 * Graceful drain: refuse new work, tell the hub there are no free slots, wait for the hub to delete
 * the tasks, abort whatever is left at the timeout, then stop. The clock and the sleep are injected,
 * so none of this depends on wall time.
 */

const FACTS: OsFacts = {
  hostname: 'air.local',
  computerName: 'Drain Perch',
  platform: 'darwin',
  arch: 'arm64',
  cpuCores: 8,
  memGb: 16,
};

const runningApps: PerchHarness[] = [];
const runningPerches: PerchHandle[] = [];

afterEach(async () => {
  for (const harness of runningApps.splice(0)) await harness.close();
  for (const perch of runningPerches.splice(0)) await perch.stop();
});

function appWithProbes(clock: FakeClock): PerchHarness & { clock: FakeClock } {
  const health: PerchHealthProbes = {
    draining: () => false,
    now: () => clock.now(),
    git: () => ({ ok: true, detail: 'git version 2.45.0' }),
    runner: () => ({ ok: true, detail: 'perch-1 · online · 0/5 sessions' }),
    worktreeRoot: () => ({ ok: true, detail: 'writable' }),
    freeBytes: () => 100 * 1024 ** 3,
    sessions: () => ({ active: 0, max: 5 }),
    hub: () => ({ configured: false, heartbeatMs: 3000 }),
  };
  const started = startPerchApp({ clock, health });
  runningApps.push(started);
  return Object.assign(started, { clock });
}

async function postTask(url: string, overrides: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${url}/perch/tasks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ ...makeStartTaskOptions(), ...overrides }),
  });
}

async function deleteTask(url: string, runId = 'run-1', key = 'theme'): Promise<Response> {
  return fetch(`${url}/perch/tasks/${runId}/${key}`, { method: 'DELETE', headers: authHeaders() });
}

describe('draining the Perch API', () => {
  test('refuses a new task with 503 draining but still replays an existing handle', async () => {
    const { url, app: perchApp, clock } = appWithProbes(new FakeClock(1000));
    const first = await postTask(url);
    expect(first.status).toBe(200);

    perchApp.setDraining(true);
    expect(perchApp.isDraining()).toBe(true);

    const refused = await postTask(url, { taskKey: 'another', branch: 'starling/run1/another' });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({
      error: {
        code: 'draining',
        message: 'this perch is draining for a restart and accepts no new tasks',
      },
    });

    // A hub that lost the 200 for the first POST retries while we drain: same handle, no new agent.
    const retried = await postTask(url);
    expect(retried.status).toBe(200);
    expect(await retried.json()).toEqual(await first.json());
    expect(perchApp.handles()).toHaveLength(1);
    expect(clock.now()).toBe(1000);
  });

  test('leaving drain mode accepts tasks again', async () => {
    const { url, app: perchApp } = appWithProbes(new FakeClock(1000));
    perchApp.setDraining(true);
    expect((await postTask(url)).status).toBe(503);
    perchApp.setDraining(false);
    expect((await postTask(url)).status).toBe(200);
  });

  test('drainTasks waits for the hub DELETE, then reports the finished task', async () => {
    const { url, app: perchApp, clock, node } = appWithProbes(new FakeClock(1000));
    await postTask(url);
    let deleted = false;

    const report = await perchApp.drainTasks({
      timeoutMs: 500,
      pollMs: 10,
      now: () => clock.now(),
      sleep: async (ms) => {
        if (!deleted) {
          deleted = true;
          expect((await deleteTask(url)).status).toBe(200);
        }
        clock.advance(ms);
      },
    });

    expect(report).toEqual({ finished: ['theme'], aborted: [], waitedMs: 10 });
    expect(perchApp.isDraining()).toBe(true);
    expect(perchApp.handles()).toHaveLength(0);
    expect(node.prompts).toHaveLength(0);
  });

  test('drainTasks aborts whatever the hub has not deleted by the timeout', async () => {
    const { url, app: perchApp, clock, node } = appWithProbes(new FakeClock(1000));
    await postTask(url);
    const events: string[] = [];
    node.onEvent((event) => events.push(event.kind));

    const report = await perchApp.drainTasks({
      timeoutMs: 50,
      pollMs: 25,
      now: () => clock.now(),
      sleep: async (ms) => {
        clock.advance(ms);
      },
    });

    expect(report.finished).toEqual([]);
    expect(report.aborted).toEqual(['theme']);
    expect(report.waitedMs).toBe(50);
    expect(events).toContain('session.error');
    expect(perchApp.handles()).toHaveLength(0);
  });

  test('a timed-out abort still reports the tasks the hub deleted in time', async () => {
    const { url, app: perchApp, clock } = appWithProbes(new FakeClock(1000));
    await postTask(url);
    await postTask(url, { taskKey: 'docs', branch: 'starling/run1/docs' });

    const report = await perchApp.drainTasks({
      timeoutMs: 30,
      pollMs: 10,
      now: () => clock.now(),
      sleep: async (ms) => {
        if (clock.now() === 1000) await deleteTask(url, 'run-1', 'docs');
        clock.advance(ms);
      },
    });

    expect(report.finished).toEqual(['docs']);
    expect(report.aborted).toEqual(['theme']);
    expect(report.waitedMs).toBe(30);
  });

  test('draining with no handles returns an empty report without sleeping', async () => {
    const { app: perchApp, clock } = appWithProbes(new FakeClock(1000));
    let slept = 0;
    const report = await perchApp.drainTasks({
      now: () => clock.now(),
      sleep: async () => {
        slept += 1;
      },
    });
    expect(report).toEqual({ finished: [], aborted: [], waitedMs: 0 });
    expect(slept).toBe(0);
  });

  test('a zero timeout aborts immediately', async () => {
    const { url, app: perchApp, clock } = appWithProbes(new FakeClock(1000));
    await postTask(url);
    const report = await perchApp.drainTasks({ timeoutMs: 0, now: () => clock.now() });
    expect(report.aborted).toEqual(['theme']);
    expect(report.waitedMs).toBe(0);
  });
});

function heartbeats(calls: HubCall[]): HubCall[] {
  return calls.filter((call) => call.path === '/api/flock/heartbeat');
}

async function launch(hub: ReturnType<typeof createHubFetch>, clock: FakeClock): Promise<PerchHandle> {
  const perch = await startPerch({
    node: new MockNode({ id: 'perch-local' }),
    hub: 'http://hub.test',
    code: TEST_CODE,
    fetch: hub.fetch,
    port: 0,
    publicHost: '127.0.0.1',
    name: 'Drain Perch',
    maxSessions: 5,
    lendModels: false,
    os: async () => FACTS,
    clock,
    heartbeatMs: 60_000,
  });
  runningPerches.push(perch);
  return perch;
}

describe('PerchHandle.drain', () => {
  test('drains, advertises zero free slots, then stops the API', async () => {
    const clock = new FakeClock(1000);
    const hub = createHubFetch();
    const perch = await launch(hub, clock);

    const started = await postTask(perch.url);
    expect(started.status).toBe(200);

    const report = await perch.drain({
      timeoutMs: 1000,
      pollMs: 10,
      sleep: async (ms) => {
        await deleteTask(perch.url);
        clock.advance(ms);
      },
    });

    expect(report.finished).toEqual(['theme']);
    expect(report.aborted).toEqual([]);
    // The hub was told about the drain: one session in use, so one slot advertised.
    const draining = heartbeats(hub.calls).find(
      (call) => call.body.info?.maxSessions === 1 && call.body.info?.activeSessions === 1,
    );
    expect(draining).toBeDefined();
    // And the final heartbeat is the offline farewell.
    expect(heartbeats(hub.calls).at(-1)?.body.info?.status).toBe('offline');

    // The API port is closed once the drain finishes.
    let refused = false;
    try {
      await fetch(`${perch.url}/perch/info`, { headers: authHeaders() });
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
  });

  test('refuses new tasks while a drain is in flight and aborts the rest at the timeout', async () => {
    const clock = new FakeClock(1000);
    const hub = createHubFetch();
    const perch = await launch(hub, clock);
    await postTask(perch.url);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const draining = perch.drain({
      timeoutMs: 100,
      pollMs: 20,
      sleep: async (ms) => {
        await gate;
        clock.advance(ms);
      },
    });

    const refused = await postTask(perch.url, { taskKey: 'later', branch: 'starling/run1/later' });
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('draining');

    release();
    const report = await draining;
    expect(report.aborted).toEqual(['theme']);
    expect(report.waitedMs).toBe(100);
  });

  test('drain is idempotent and an already-stopped perch reports nothing to do', async () => {
    const hub = createHubFetch();
    const perch = await launch(hub, new FakeClock(1000));
    const first = await perch.drain({ sleep: async () => undefined });
    const second = await perch.drain({ sleep: async () => undefined });
    expect(second).toEqual(first);

    const other = await launch(hub, new FakeClock(1000));
    await other.stop();
    expect(await other.drain()).toEqual({ finished: [], aborted: [], waitedMs: 0 });
  });

  test('a perch with no hub can drain too', async () => {
    const clock = new FakeClock(1000);
    const perch = await startPerch({
      node: new MockNode({ id: 'perch-local' }),
      code: TEST_CODE,
      port: 0,
      publicHost: '127.0.0.1',
      name: 'Lonely Perch',
      lendModels: false,
      os: async () => FACTS,
      clock,
      heartbeatMs: 60_000,
    });
    runningPerches.push(perch);

    const report = await perch.drain({
      timeoutMs: 10,
      pollMs: 5,
      sleep: async (ms) => {
        clock.advance(ms);
      },
    });
    // Nothing was in flight, so the drain returns immediately without spending the timeout.
    expect(report).toEqual({ finished: [], aborted: [], waitedMs: 0 });
  });
});
