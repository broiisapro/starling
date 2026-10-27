import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent, StartTaskOptions } from '@starling/core';
import { FakeClock, StarlingError } from '@starling/core';
import { makeAgentEvent, makeNodeInfo } from '@starling/core/testing';
import type { BundleOps } from './bundle-ops';
import { FLOCK_TOKEN_HEADER } from './http.ts';
import { createRegistry } from './registry.ts';
import { createRemoteNode } from './remote-node.ts';

const TOKEN = 'K7QM-3XPH';
const encoder = new TextEncoder();

interface FakePerch {
  url: string;
  calls: {
    info: number;
    start: StartTaskOptions[];
    prompt: string[];
    abort: number;
    collect: string[];
    bundle: string[];
    cleanup: number;
    sseAttempts: number;
    sseConnections: number;
  };
  emit(event: AgentEvent): void;
  closeEvents(): void;
  stop(): void;
}

interface FakePerchOptions {
  token?: string;
  hangTasks?: boolean;
  bundleBytes?: Uint8Array;
}

/**
 * An in-process perch implementing the locked Perch API. No sockets leave loopback, and it stops in
 * `afterEach`, so no server survives the suite (L23).
 */
function startFakePerch(options: FakePerchOptions = {}): FakePerch {
  const token = options.token ?? TOKEN;
  const info = makeNodeInfo({ id: 'air', kind: 'remote', name: 'M2 Air', maxSessions: 5 });
  const calls: FakePerch['calls'] = {
    info: 0,
    start: [],
    prompt: [],
    abort: 0,
    collect: [],
    bundle: [],
    cleanup: 0,
    sseAttempts: 0,
    sseConnections: 0,
  };
  let sse: ReadableStreamDefaultController<Uint8Array> | undefined;

  const authorized = (req: Request): boolean => req.headers.get(FLOCK_TOKEN_HEADER) === token;
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (path === '/perch/events') calls.sseAttempts += 1;
      if (!authorized(req)) return json({ error: 'bad join code' }, 401);

      if (path === '/perch/info') {
        calls.info += 1;
        return json(info);
      }
      if (path === '/perch/events') {
        calls.sseConnections += 1;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              sse = controller;
              controller.enqueue(encoder.encode(': connected\n\n'));
            },
            cancel() {
              sse = undefined;
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      if (path === '/perch/tasks' && req.method === 'POST') {
        if (options.hangTasks === true) return new Promise<Response>(() => {});
        const body = (await req.json()) as StartTaskOptions;
        calls.start.push(body);
        return json({
          nodeId: 'air',
          runId: body.runId,
          taskKey: body.taskKey,
          branch: body.branch,
          sessionId: `ses_fake_${calls.start.length}`,
        });
      }

      const match = /^\/perch\/tasks\/([^/]+)\/([^/]+)(\/[a-z]+)?$/.exec(path);
      if (match !== null) {
        const suffix = match[3];
        if (suffix === '/prompt' && req.method === 'POST') {
          const body = (await req.json()) as { prompt: string };
          calls.prompt.push(body.prompt);
          return json({ ok: true });
        }
        if (suffix === '/abort' && req.method === 'POST') {
          calls.abort += 1;
          return json({ ok: true });
        }
        if (suffix === '/collect' && req.method === 'POST') {
          const body = (await req.json()) as { baseRef: string };
          calls.collect.push(body.baseRef);
          return json({
            commit: 'deadbeef',
            diff: {
              files: [{ path: 'src/export.ts', added: 4, removed: 0 }],
              patch: '--- a/src/export.ts\n+++ b/src/export.ts\n+rows',
              truncated: false,
            },
            changedFiles: ['src/export.ts'],
          });
        }
        if (suffix === '/bundle') {
          calls.bundle.push(url.searchParams.get('base') ?? '');
          return new Response(options.bundleBytes ?? new Uint8Array([7, 7, 7]), {
            status: 200,
            headers: { 'content-type': 'application/octet-stream' },
          });
        }
        if (suffix === undefined && req.method === 'DELETE') {
          calls.cleanup += 1;
          return json({ ok: true });
        }
      }
      return json({ error: 'not found' }, 404);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    calls,
    emit(event) {
      sse?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    },
    closeEvents() {
      sse?.close();
      sse = undefined;
    },
    stop() {
      server.stop(true);
    },
  };
}

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'starling-flock-remote-'));
  temps.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const taskOpts: StartTaskOptions = {
  runId: 'run-01',
  taskKey: 'csv-export',
  title: 'CSV export',
  repo: { kind: 'bundle', url: 'http://hub.test/api/flock/bundle?ref=integration', token: TOKEN },
  fromRef: 'starling/run/integration',
  branch: 'starling/run/csv-export',
  prompt: 'add csv export',
  model: { provider: 'deepseek', model: 'deepseek-v4.1-flash' },
};

describe('RemoteNode against a fake perch', () => {
  test('start → SSE events → collect → bundle download → fetch into the hub repo', async () => {
    const perch = startFakePerch();
    const bundleDir = await tempDir();
    const fetched: Array<{ repo: string; bundlePath: string; ref: string; intoBranch: string }> = [];
    const bundleOps: Partial<BundleOps> = {
      async fetchBundle(repo, bundlePath, ref, intoBranch) {
        fetched.push({ repo, bundlePath, ref, intoBranch });
      },
    };
    const node = createRemoteNode({
      url: perch.url,
      token: TOKEN,
      info: makeNodeInfo({ id: 'air', kind: 'remote', url: perch.url }),
      bundleOps,
      bundleDir,
      reconnectMs: 10,
    });
    const events: AgentEvent[] = [];
    const unsubscribe = node.onEvent((event) => events.push(event));

    try {
      const handle = await node.startTask(taskOpts);
      expect(handle.sessionId).toBe('ses_fake_1');
      expect(perch.calls.start[0]?.taskKey).toBe('csv-export');
      expect(perch.calls.start[0]?.repo.kind).toBe('bundle');

      perch.emit(makeAgentEvent({ sessionId: handle.sessionId, kind: 'session.idle' }));
      await Bun.sleep(30);
      expect(events.map((event) => event.kind)).toContain('session.idle');

      const result = await node.collect(handle, '/hub/repo', 'starling/run/integration');
      expect(result.commit).toBe('deadbeef');
      expect(result.changedFiles).toEqual(['src/export.ts']);
      expect(perch.calls.collect).toEqual(['starling/run/integration']);
      expect(perch.calls.bundle).toEqual(['starling/run/integration']);
      expect(fetched).toHaveLength(1);
      expect(fetched[0]).toMatchObject({
        repo: '/hub/repo',
        ref: 'starling/run/csv-export',
        intoBranch: 'starling/run/csv-export',
      });
      expect(result.bundlePath).toContain('run-01-csv-export.bundle');
      expect(await Bun.file(result.bundlePath ?? '').bytes()).toEqual(new Uint8Array([7, 7, 7]));

      await node.sendPrompt(handle, 'fix the header row');
      expect(perch.calls.prompt).toEqual(['fix the header row']);
      await node.abort(handle);
      expect(perch.calls.abort).toBe(1);
      await node.cleanup(handle);
      expect(perch.calls.cleanup).toBe(1);
    } finally {
      unsubscribe();
      node.close();
      perch.stop();
    }
  });

  test('info() refreshes the cached NodeInfo and records latency', async () => {
    const perch = startFakePerch();
    const clock = new FakeClock(9_000);
    const node = createRemoteNode({
      url: `${perch.url}/`,
      token: TOKEN,
      info: makeNodeInfo({ id: 'air', kind: 'remote', name: 'stale' }),
      clock,
    });
    try {
      const info = await node.info();
      expect(info.id).toBe('air');
      expect(info.name).toBe('M2 Air');
      expect(info.url).toBe(perch.url);
      expect(info.lastSeen).toBe(9_000);
      expect(info.latencyMs).toBeGreaterThanOrEqual(0);
      expect(perch.calls.info).toBe(1);
    } finally {
      node.close();
      perch.stop();
    }
  });

  test('a rejected join code is NODE_AUTH, not a retryable outage', async () => {
    const perch = startFakePerch();
    const node = createRemoteNode({
      url: perch.url,
      token: 'WRONG-CODE',
      info: makeNodeInfo({ id: 'air', kind: 'remote' }),
    });
    try {
      const error = await node.startTask(taskOpts).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(StarlingError);
      expect((error as StarlingError).code).toBe('NODE_AUTH');
      expect((error as StarlingError).message).toContain('rejected the join code');
    } finally {
      node.close();
      perch.stop();
    }
  });

  test('a perch whose lid closes becomes NODE_OFFLINE and the registry announces left', async () => {
    const perch = startFakePerch();
    const clock = new FakeClock(1_000);
    const node = createRemoteNode({
      url: perch.url,
      token: TOKEN,
      info: makeNodeInfo({ id: 'air', kind: 'remote', lastSeen: 1_000 }),
      clock,
    });
    const registry = createRegistry({ clock, offlineAfterMs: 15_000, autoSweep: false });
    const left: string[] = [];
    registry.onChange((event) => {
      if (event.type === 'left') left.push(event.reason ?? '');
    });
    registry.add(node, makeNodeInfo({ id: 'air', kind: 'remote', lastSeen: 1_000 }));

    try {
      const handle = await node.startTask(taskOpts);
      expect(handle.sessionId).toBe('ses_fake_1');

      perch.stop();
      clock.advance(16_000);
      expect(registry.sweep()).toEqual(['air']);
      expect(left).toEqual(['heartbeat-timeout']);

      const error = await node.collect(handle, '/hub/repo', 'main').catch((err: unknown) => err);
      expect((error as StarlingError).code).toBe('NODE_OFFLINE');

      // Cleanup after a death is best effort and must not fail the run.
      await node.cleanup(handle);
    } finally {
      node.close();
      registry.close();
    }
  });

  test('a request that never answers times out as NODE_OFFLINE', async () => {
    const perch = startFakePerch({ hangTasks: true });
    const node = createRemoteNode({
      url: perch.url,
      token: TOKEN,
      info: makeNodeInfo({ id: 'air', kind: 'remote' }),
      timeoutMs: 40,
    });
    try {
      const error = await node.startTask(taskOpts).catch((err: unknown) => err);
      expect((error as StarlingError).code).toBe('NODE_OFFLINE');
      expect((error as StarlingError).message).toContain('timed out');
    } finally {
      node.close();
      perch.stop();
    }
  });

  test('the event stream reconnects after the perch drops it', async () => {
    const perch = startFakePerch();
    const node = createRemoteNode({
      url: perch.url,
      token: TOKEN,
      info: makeNodeInfo({ id: 'air', kind: 'remote' }),
      reconnectMs: 10,
    });
    const events: string[] = [];
    const unsubscribe = node.onEvent((event) => events.push(event.kind));
    try {
      await Bun.sleep(30);
      expect(perch.calls.sseConnections).toBe(1);

      perch.closeEvents();
      await Bun.sleep(60);
      expect(perch.calls.sseConnections).toBe(2);

      perch.emit(makeAgentEvent({ kind: 'text', sessionId: 'ses_fake_1' }));
      await Bun.sleep(30);
      expect(events).toEqual(['text']);
    } finally {
      unsubscribe();
      node.close();
      perch.stop();
    }
  });

  test('an event stream with a rejected code does not retry forever', async () => {
    const perch = startFakePerch();
    const node = createRemoteNode({
      url: perch.url,
      token: 'WRONG-CODE',
      info: makeNodeInfo({ id: 'air', kind: 'remote' }),
      reconnectMs: 10,
    });
    const unsubscribe = node.onEvent(() => {});
    try {
      await Bun.sleep(80);
      expect(perch.calls.sseAttempts).toBe(1);
      expect(node.lastEventError()?.code).toBe('NODE_AUTH');
    } finally {
      unsubscribe();
      node.close();
      perch.stop();
    }
  });

  test('cleanup tolerates an unreachable perch', async () => {
    const node = createRemoteNode({
      url: 'http://127.0.0.1:1',
      token: TOKEN,
      info: makeNodeInfo({ id: 'air', kind: 'remote' }),
      timeoutMs: 100,
    });
    try {
      await node.cleanup({
        nodeId: 'air',
        runId: 'run-01',
        taskKey: 'csv-export',
        branch: 'starling/run/csv-export',
        sessionId: 'ses_fake_1',
      });
    } finally {
      node.close();
    }
  });
});
