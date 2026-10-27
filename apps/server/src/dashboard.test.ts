import { afterEach, describe, expect, test } from 'bun:test';
import type { StarlingEvent } from '@starling/core';
import { createEventBus } from '@starling/core';
import { startDashboard } from './dashboard';
import { type DevLiveServer, startDevLive } from './dev-live';
import { makeHarness } from './test-support';

const servers: Array<() => void> = [];

afterEach(() => {
  for (const stop of servers.splice(0)) stop();
});

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 4_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('timed out waiting for the dashboard');
}

describe('startDashboard', () => {
  test('binds the API and serves health + public config', async () => {
    const { deps } = makeHarness({ publicConfig: { profile: 'opencode' } });
    const handle = startDashboard({ ...deps, port: 0, hostname: '127.0.0.1' });
    servers.push(() => handle.stop());
    expect(handle.port).toBeGreaterThan(0);

    const health = await fetch(`${handle.url}/api/health`);
    expect(await health.json()).toEqual({ ok: true, version: '9.9.9' });
    const config = (await (await fetch(`${handle.url}/api/config/public`)).json()) as {
      profile: string;
    };
    expect(config.profile).toBe('opencode');
  });

  test('stop() closes an open SSE stream instead of leaving it subscribed', async () => {
    const inner = createEventBus();
    let subscribers = 0;
    const bus = {
      publish: inner.publish,
      subscribe: (fn: (event: StarlingEvent) => void) => {
        subscribers += 1;
        const unsubscribe = inner.subscribe(fn);
        return () => {
          subscribers -= 1;
          unsubscribe();
        };
      },
    };
    const { deps } = makeHarness({ bus });
    const baseline = subscribers;
    const handle = startDashboard({ ...deps, bus, port: 0, hostname: '127.0.0.1' });
    const response = await fetch(`${handle.url}/api/events`);
    const reader = response.body?.getReader();
    if (reader === undefined) throw new Error('no SSE body');
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain(': connected');
    expect(subscribers).toBe(baseline + 1);

    handle.stop();
    expect(subscribers).toBe(baseline);
    const closed = await Promise.race([
      (async () => {
        // Drain whatever was queued, then observe the close. A force-closed socket surfaces as
        // ECONNRESET; either way the stream is gone.
        try {
          let done = false;
          while (!done) done = (await reader.read()).done === true;
        } catch {
          return true;
        }
        return true;
      })(),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    expect(closed).toBe(true);
  });
});

describe('dev:live scripted engine', () => {
  test('runs a realistic three-task run end to end over the real routes', async () => {
    const live: DevLiveServer = startDevLive({ port: 0, speed: 60, autoplay: true });
    servers.push(() => live.stop());

    const run = await waitFor(async () => {
      const runs = (await (await fetch(`${live.url}/api/runs`)).json()) as Array<{
        id: string;
        status: string;
        tasks: Record<string, { status: string }>;
      }>;
      const first = runs[0];
      return first?.status === 'finished' ? first : undefined;
    });

    const tasks = Object.values(run.tasks);
    expect(tasks).toHaveLength(3);
    expect(tasks.every((task) => task.status === 'merged')).toBe(true);

    const config = (await (await fetch(`${live.url}/api/config/public`)).json()) as {
      version: string;
      flockEnabled: boolean;
      models: Record<string, string>;
    };
    expect(config.version).toBeString();
    expect(config.flockEnabled).toBe(true);
    expect(config.models.auditor).toBeString();

    const join = (await (await fetch(`${live.url}/api/flock/join`)).json()) as { command: string };
    expect(join.command).toContain('starling perch');

    const diff = await fetch(`${live.url}/api/runs/${run.id}/diff/theme`);
    expect(diff.status).toBe(200);
    expect(((await diff.json()) as { files: unknown[] }).files.length).toBeGreaterThan(0);

    const verdicts = (await (await fetch(`${live.url}/api/runs/${run.id}`)).json()) as {
      tasks: Record<string, { lastVerdict?: { pass: boolean } }>;
    };
    expect(verdicts.tasks.search?.lastVerdict?.pass).toBe(true);
  });

  test('a second POST /api/runs starts a new scripted run and the picker can follow it', async () => {
    const live = startDevLive({ port: 0, speed: 120, autoplay: false });
    servers.push(() => live.stop());

    const created = await fetch(`${live.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'Ship a smaller thing', repoPath: 'examples/sky-todo' }),
    });
    expect(created.status).toBe(201);
    const { runId } = (await created.json()) as { runId: string };
    expect(runId).toBeString();
    const run = await waitFor(async () => {
      const body = (await (await fetch(`${live.url}/api/runs/${runId}`)).json()) as {
        status: string;
      };
      return body.status === 'finished' ? body : undefined;
    });
    expect(run.status).toBe('finished');
  });
});
