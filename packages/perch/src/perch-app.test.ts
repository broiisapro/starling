import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEventBus,
  type EventBus,
  type NodeInfo,
  type StarlingEvent,
  type TaskHandle,
} from '@starling/core';
import { MockNode } from '@starling/core/testing';
import { createPerchApp } from './perch-app';
import {
  authHeaders,
  makeStartTaskOptions,
  openSse,
  readSseEvents,
  readSseText,
  staticInfo,
  TEST_CODE,
} from './test-helpers';

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function setup(
  opts: { node?: MockNode; info?: () => Promise<NodeInfo>; keepAliveMs?: number; bus?: EventBus } = {},
): {
  app: ReturnType<typeof createPerchApp>;
  node: MockNode;
  url: string;
} {
  const node = opts.node ?? new MockNode({ id: 'perch-1', info: { maxSessions: 5 } });
  const app = createPerchApp({
    node,
    token: TEST_CODE,
    info: opts.info ?? staticInfo(),
    keepAliveMs: opts.keepAliveMs ?? 25,
    bus: opts.bus,
  });
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: app.fetch });
  cleanups.push(async () => {
    await app.close();
    server.stop(true);
  });
  return { app, node, url: `http://127.0.0.1:${server.port}` };
}

async function postTask(
  url: string,
  overrides: Parameters<typeof makeStartTaskOptions>[0] = {},
): Promise<Response> {
  return fetch(`${url}/perch/tasks`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(makeStartTaskOptions(overrides)),
  });
}

async function startTask(
  url: string,
  overrides: Parameters<typeof makeStartTaskOptions>[0] = {},
): Promise<TaskHandle> {
  const res = await postTask(url, overrides);
  expect(res.status).toBe(200);
  return (await res.json()) as TaskHandle;
}

describe('Perch API', () => {
  test('GET /perch/info returns the node info', async () => {
    const { url } = setup({ info: staticInfo({ activeSessions: 2, status: 'busy' }) });
    const res = await fetch(`${url}/perch/info`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const info = (await res.json()) as NodeInfo;
    expect(info.id).toBe('perch-1');
    expect(info.kind).toBe('remote');
    expect(info.activeSessions).toBe(2);
    expect(info.status).toBe('busy');
  });

  test('every route rejects a missing or wrong token with 401', async () => {
    const { url } = setup();
    const routes: Array<[string, string]> = [
      ['GET', '/perch/info'],
      ['POST', '/perch/tasks'],
      ['POST', '/perch/tasks/run-1/theme/prompt'],
      ['POST', '/perch/tasks/run-1/theme/abort'],
      ['POST', '/perch/tasks/run-1/theme/collect'],
      ['GET', '/perch/tasks/run-1/theme/bundle'],
      ['DELETE', '/perch/tasks/run-1/theme'],
      ['GET', '/perch/events'],
    ];

    for (const [method, path] of routes) {
      const missing = await fetch(`${url}${path}`, { method });
      expect(missing.status).toBe(401);
      const wrong = await fetch(`${url}${path}`, {
        method,
        headers: { 'x-flock-token': 'NOT-THE-CODE' },
      });
      expect(wrong.status).toBe(401);
      expect(await wrong.json()).toEqual({
        error: { code: 'unauthorized', message: 'missing or invalid x-flock-token' },
      });
    }
  });

  test('POST /perch/tasks starts a bundle task and returns its handle', async () => {
    const { url, node, app } = setup();
    const opts = makeStartTaskOptions();
    const handle = await startTask(url);

    expect(handle).toEqual({
      nodeId: 'perch-1',
      runId: 'run-1',
      taskKey: 'theme',
      branch: 'starling/run1/theme',
      sessionId: handle.sessionId,
    });
    expect(node.startedTasks).toHaveLength(1);
    expect(node.startedTasks[0]).toEqual(opts);
    expect(app.handles()).toEqual([handle]);
  });

  test('a retried POST /perch/tasks returns the same session instead of starting twice', async () => {
    const { url, node } = setup();
    const first = await startTask(url);
    const retried = await postTask(url);
    expect(retried.status).toBe(200);
    expect((await retried.json()) as TaskHandle).toEqual(first);
    expect(node.startedTasks).toHaveLength(1);
  });

  test('POST /perch/tasks validates the body and refuses local repos', async () => {
    const { url, node } = setup();

    const malformed = await fetch(`${url}/perch/tasks`, {
      method: 'POST',
      headers: authHeaders(),
      body: '{ not json',
    });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe('invalid-json');

    const invalid = await fetch(`${url}/perch/tasks`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ runId: 'run-1' }),
    });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe('invalid-body');

    const local = await postTask(url, {
      repo: { kind: 'local', path: '/Users/hub/secret-repo' },
    });
    expect(local.status).toBe(400);
    expect(((await local.json()) as { error: { code: string } }).error.code).toBe('invalid-repo');
    expect(node.startedTasks).toHaveLength(0);
  });

  test('prompt is forwarded to the same session', async () => {
    const { url, node } = setup();
    await startTask(url);

    const res = await fetch(`${url}/perch/tasks/run-1/theme/prompt`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: 'Tests fail: add a theme test.' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(node.prompts).toEqual([{ taskKey: 'theme', prompt: 'Tests fail: add a theme test.' }]);

    const unknown = await fetch(`${url}/perch/tasks/run-1/ghost/prompt`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ prompt: 'hello?' }),
    });
    expect(unknown.status).toBe(404);
    expect(((await unknown.json()) as { error: { code: string } }).error.code).toBe('unknown-task');
  });

  test('abort reaches the node', async () => {
    const { url, node } = setup();
    await startTask(url);
    const events: string[] = [];
    node.onEvent((event) => events.push(event.kind));

    const res = await fetch(`${url}/perch/tasks/run-1/theme/abort`, {
      method: 'POST',
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(events).toContain('session.error');

    const collect = await fetch(`${url}/perch/tasks/run-1/theme/collect`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ baseRef: 'main' }),
    });
    // MockNode's session is gone after abort; the app surfaces the StarlingError as a JSON error.
    expect(collect.status).toBe(500);
    expect(((await collect.json()) as { error: { code: string } }).error.code).toBe('RUNNER_ERROR');
  });

  test('collect returns the result shape and caches it for the bundle route', async () => {
    const { url, node } = setup();
    await startTask(url);

    const res = await fetch(`${url}/perch/tasks/run-1/theme/collect`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ baseRef: 'main' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['changedFiles', 'commit', 'diff']);
    expect(body.commit).toBe('mock-node-commit-1');
    expect(node.collected).toHaveLength(1);

    const invalid = await fetch(`${url}/perch/tasks/run-1/theme/collect`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ baseRef: '' }),
    });
    expect(invalid.status).toBe(400);
  });

  test('the bundle route streams the cached bundlePath and explains every miss', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'starling-perch-app-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const bundlePath = join(dir, 'theme.bundle');
    const contents = 'PACK fake-git-bundle';
    await writeFile(bundlePath, contents);

    const node = new MockNode({ id: 'perch-1', result: { bundlePath } });
    const { url } = setup({ node });

    // Before collect: 409, not a confusing 404.
    await startTask(url);
    const early = await fetch(`${url}/perch/tasks/run-1/theme/bundle?base=main`, {
      headers: authHeaders(),
    });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe('not-collected');

    await fetch(`${url}/perch/tasks/run-1/theme/collect`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ baseRef: 'main' }),
    });

    const res = await fetch(`${url}/perch/tasks/run-1/theme/bundle?base=main`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(await res.text()).toBe(contents);

    const emptyBase = await fetch(`${url}/perch/tasks/run-1/theme/bundle?base=`, {
      headers: authHeaders(),
    });
    expect(emptyBase.status).toBe(400);

    const unknown = await fetch(`${url}/perch/tasks/run-1/ghost/bundle`, { headers: authHeaders() });
    expect(unknown.status).toBe(404);
  });

  test('a task with no changes has no bundle', async () => {
    const { url } = setup();
    await startTask(url);
    await fetch(`${url}/perch/tasks/run-1/theme/collect`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ baseRef: 'main' }),
    });

    const res = await fetch(`${url}/perch/tasks/run-1/theme/bundle`, { headers: authHeaders() });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('no-bundle');
  });

  test('DELETE cleans up and is idempotent', async () => {
    const { url, node, app } = setup();
    await startTask(url);

    const first = await fetch(`${url}/perch/tasks/run-1/theme`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(app.handles()).toHaveLength(0);

    // A hub retrying after a dropped response must not see an error.
    const second = await fetch(`${url}/perch/tasks/run-1/theme`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    expect(second.status).toBe(200);
    expect(node.startedTasks).toHaveLength(1);
  });

  test('SSE streams the agent events in order', async () => {
    const { url } = setup();
    const sse = await openSse(`${url}/perch/events`);
    cleanups.push(() => sse.close());

    const handle = await startTask(url);
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
    expect(events.every((event) => event.taskKey === 'theme')).toBe(true);
    expect(events.every((event) => event.sessionId === handle.sessionId)).toBe(true);
    expect(events.every((event) => event.runId === 'run-1')).toBe(true);
  });

  test('SSE sends keep-alive comments on an idle stream', async () => {
    const { url } = setup({ keepAliveMs: 10 });
    const sse = await openSse(`${url}/perch/events`);
    cleanups.push(() => sse.close());

    const text = await readSseText(sse.response, (seen) => seen.includes(': keep-alive'));
    expect(text).toContain(': keep-alive');
  });

  test('close() aborts every in-flight session', async () => {
    const { url, node, app } = setup();
    await startTask(url);
    const events: string[] = [];
    node.onEvent((event) => events.push(event.kind));

    await app.close();
    expect(events).toContain('session.error');
    expect(app.handles()).toHaveLength(0);
  });

  test('publishes perch lifecycle logs on the event bus', async () => {
    const bus = createEventBus();
    const seen: StarlingEvent[] = [];
    bus.subscribe((event) => seen.push(event));

    const { url } = setup({ bus });
    await startTask(url);

    const accepted = seen.find(
      (event) => event.type === 'log' && event.payload.msg.includes('perch accepted'),
    );
    expect(accepted?.type).toBe('log');
    if (accepted?.type === 'log') {
      expect(accepted.runId).toBe('*');
      expect(accepted.payload.level).toBe('info');
      expect(accepted.payload.taskKey).toBe('theme');
    }
  });

  test('unknown routes are JSON 404s', async () => {
    const { url } = setup();
    const res = await fetch(`${url}/perch/nope`, { headers: authHeaders() });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'not-found', message: 'no perch route for GET /perch/nope' },
    });
  });
});
