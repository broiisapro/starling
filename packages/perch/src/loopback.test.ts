import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TaskHandle } from '@starling/core';
import { MockNode } from '@starling/core/testing';
import { type PerchHandle, startPerch } from './perch-daemon';
import type { OsFacts } from './perch-info';
import {
  authHeaders,
  type FakeHub,
  makeStartTaskOptions,
  openSse,
  readSseEvents,
  startFakeHub,
  TEST_CODE,
  waitFor,
} from './test-helpers';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface LoopPerch {
  node: MockNode;
  dir: string;
  bundlePath: string;
  facts: OsFacts;
}

/** Each perch gets its own cache dir and its own fake result bundle. */
async function makePerch(name: string, bundle: string): Promise<LoopPerch> {
  const dir = await mkdtemp(join(tmpdir(), 'starling-perch-loop-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const bundlePath = join(dir, 'result.bundle');
  await writeFile(bundlePath, bundle);

  return {
    node: new MockNode({
      id: `local-${name.replace(/\s+/g, '-').toLowerCase()}`,
      info: { name, maxSessions: 3 },
      result: { bundlePath },
    }),
    dir,
    bundlePath,
    facts: {
      hostname: `${name.replace(/\s+/g, '-').toLowerCase()}.local`,
      computerName: name,
      platform: 'darwin',
      arch: 'arm64',
      cpuCores: 8,
      memGb: 16,
    },
  };
}

async function launch(local: LoopPerch, hub: FakeHub, name: string): Promise<PerchHandle> {
  const perch = await startPerch({
    node: local.node,
    hub: hub.url,
    code: TEST_CODE,
    port: 0,
    publicHost: '127.0.0.1',
    name,
    maxSessions: 3,
    lendModels: false,
    os: async () => local.facts,
    heartbeatMs: 15,
    backoffMs: 5,
    maxBackoffMs: 25,
  });
  cleanups.push(() => perch.stop());
  return perch;
}

const countHeartbeats = (hub: FakeHub, nodeId: string): number =>
  hub.heartbeats.filter((beat) => beat.nodeId === nodeId && beat.accepted).length;

describe('two perches on one machine', () => {
  test('both register, run a task, stream events, collect and serve their own bundle', async () => {
    const hub = startFakeHub();
    cleanups.push(() => hub.stop());

    const localA = await makePerch('Perch A', 'BUNDLE-A');
    const localB = await makePerch('Perch B', 'BUNDLE-B');
    const perchA = await launch(localA, hub, 'Perch A');
    const perchB = await launch(localB, hub, 'Perch B');

    await waitFor(() => hub.registrations.length === 2, 'both perches to register');
    expect(new Set(hub.registrations.map((reg) => reg.nodeId)).size).toBe(2);
    expect(hub.registrations.every((reg) => reg.token === TEST_CODE)).toBe(true);
    expect(hub.registrations.every((reg) => reg.info.kind === 'remote')).toBe(true);
    expect(hub.registrations.every((reg) => reg.info.url?.startsWith('http://127.0.0.1:'))).toBe(true);

    const runs: Array<[PerchHandle, string, string]> = [
      [perchA, 'BUNDLE-A', 'run-a'],
      [perchB, 'BUNDLE-B', 'run-b'],
    ];

    for (const [perch, bundle, runId] of runs) {
      const sse = await openSse(`${perch.url}/perch/events`);
      cleanups.push(() => sse.close());

      const started = await fetch(`${perch.url}/perch/tasks`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(makeStartTaskOptions({ runId, taskKey: 'theme' })),
      });
      expect(started.status).toBe(200);
      const handle = (await started.json()) as TaskHandle;
      expect(handle.runId).toBe(runId);

      const events = await readSseEvents(sse.response, 7);
      expect(events.map((event) => event.kind)).toEqual([
        'session.started',
        'text',
        'tool.call',
        'tool.result',
        'file.edited',
        'usage',
        'session.idle',
      ]);
      expect(events.every((event) => event.runId === runId)).toBe(true);
      expect(events.every((event) => event.sessionId === handle.sessionId)).toBe(true);
      sse.close();

      const collected = await fetch(`${perch.url}/perch/tasks/${runId}/theme/collect`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ baseRef: 'main' }),
      });
      expect(collected.status).toBe(200);
      const result = (await collected.json()) as { commit: string; changedFiles: string[] };
      expect(result.commit).toBe('mock-node-commit-1');
      expect(result.changedFiles).toEqual(['src/main.ts']);

      const downloaded = await fetch(`${perch.url}/perch/tasks/${runId}/theme/bundle?base=main`, {
        headers: authHeaders(),
      });
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers.get('content-type')).toBe('application/octet-stream');
      expect(await downloaded.text()).toBe(bundle);
    }

    // Both nodes are visible to the hub with their own URL and name.
    const byName = new Map(hub.registrations.map((reg) => [reg.info.name, reg]));
    expect(byName.get('Perch A')?.url).toBe(perchA.url);
    expect(byName.get('Perch B')?.url).toBe(perchB.url);
  });

  test('stopping one perch stops its heartbeats; the other keeps beating', async () => {
    const hub = startFakeHub();
    cleanups.push(() => hub.stop());

    const localA = await makePerch('Perch A', 'A');
    const localB = await makePerch('Perch B', 'B');
    const perchA = await launch(localA, hub, 'Perch A');
    const perchB = await launch(localB, hub, 'Perch B');

    await waitFor(() => hub.registrations.length === 2, 'both perches to register');
    const idA = hub.registrations.find((reg) => reg.info.name === 'Perch A')?.nodeId;
    const idB = hub.registrations.find((reg) => reg.info.name === 'Perch B')?.nodeId;
    expect(idA).toBeDefined();
    expect(idB).toBeDefined();

    await waitFor(
      () => countHeartbeats(hub, idA ?? '') >= 2 && countHeartbeats(hub, idB ?? '') >= 2,
      'heartbeats from both perches',
    );
    const beatsB = countHeartbeats(hub, idB ?? '');

    await perchA.stop();
    const afterStopA = countHeartbeats(hub, idA ?? '');
    expect(hub.heartbeats.filter((beat) => beat.nodeId === idA).at(-1)?.info.status).toBe('offline');

    await Bun.sleep(90);
    expect(countHeartbeats(hub, idA ?? '')).toBe(afterStopA);
    expect(countHeartbeats(hub, idB ?? '')).toBeGreaterThan(beatsB);
    expect(perchB.url).not.toBe(perchA.url);
  });
});
