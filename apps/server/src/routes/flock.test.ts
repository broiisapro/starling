import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeNodeInfo } from '@starling/core/testing';
import { FakeFlock, makeFlockWithTwoNodes, makeHarness } from '../test-support';

const json = { 'content-type': 'application/json' };
const TOKEN = { 'x-flock-token': 'TEST-CODE' };

const tempDirs: string[] = [];
function makeTempFile(name: string, contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'starling-bundle-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const remoteInfo = () =>
  makeNodeInfo({
    id: 'air',
    name: 'M2 Air',
    kind: 'remote',
    url: 'http://192.168.1.20:7778',
    maxSessions: 5,
  });

describe('GET /api/nodes', () => {
  test('puts the hub first, then perches by name', async () => {
    const { app } = makeHarness({ flock: makeFlockWithTwoNodes() });
    const res = await app.request('/api/nodes');
    expect(res.status).toBe(200);
    const nodes = (await res.json()) as Array<{ id: string; kind: string; name: string }>;
    expect(nodes.map((node) => node.id)).toEqual(['hub', 'air']);
    expect(nodes[0]?.kind).toBe('local');
  });

  test('is an empty list when no flock hub is configured', async () => {
    const { app } = makeHarness({ flock: null });
    const res = await app.request('/api/nodes');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe('GET /api/flock/join', () => {
  test('returns the join info without a token', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/flock/join');
    expect(res.status).toBe(200);
    const join = (await res.json()) as { code: string; hubUrl: string; command: string };
    expect(join.code).toBe('TEST-CODE');
    expect(join.hubUrl).toBe('http://localhost:7777');
    expect(join.command).toBe('starling perch --hub http://localhost:7777 --code TEST-CODE');
  });

  test('503 FLOCK_DISABLED without a flock hub', async () => {
    const { app } = makeHarness({ flock: null });
    const res = await app.request('/api/flock/join');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FLOCK_DISABLED');
  });
});

describe('POST /api/flock/register', () => {
  test('rejects a missing token with 401', async () => {
    const { app, flock } = makeHarness();
    const res = await app.request('/api/flock/register', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ url: 'http://192.168.1.20:7778', info: remoteInfo() }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHORIZED');
    expect(flock?.registered).toHaveLength(0);
  });

  test('rejects a wrong token with 401', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/flock/register', {
      method: 'POST',
      headers: { ...json, 'x-flock-token': 'WRONG' },
      body: JSON.stringify({ url: 'http://192.168.1.20:7778', info: remoteInfo() }),
    });
    expect(res.status).toBe(401);
  });

  test('registers a perch and returns its node id', async () => {
    const { app, flock } = makeHarness();
    const res = await app.request('/api/flock/register', {
      method: 'POST',
      headers: { ...json, ...TOKEN },
      body: JSON.stringify({ url: 'http://192.168.1.20:7778', info: remoteInfo() }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ nodeId: 'air' });
    expect(flock?.registered[0]?.url).toBe('http://192.168.1.20:7778');
    expect(flock?.registered[0]?.info.id).toBe('air');
  });

  test('validates the NodeInfo payload against the contract schema', async () => {
    const { app, flock } = makeHarness();
    const res = await app.request('/api/flock/register', {
      method: 'POST',
      headers: { ...json, ...TOKEN },
      body: JSON.stringify({ url: 'http://192.168.1.20:7778', info: { id: 'air' } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_BODY');
    expect(body.error.message).toContain('info.maxSessions');
    expect(flock?.registered).toHaveLength(0);
  });

  test('requires a url', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/flock/register', {
      method: 'POST',
      headers: { ...json, ...TOKEN },
      body: JSON.stringify({ info: remoteInfo() }),
    });
    expect(res.status).toBe(400);
  });

  test('503 FLOCK_DISABLED without a flock hub', async () => {
    const { app } = makeHarness({ flock: null });
    const res = await app.request('/api/flock/register', {
      method: 'POST',
      headers: { ...json, ...TOKEN },
      body: JSON.stringify({ url: 'http://192.168.1.20:7778', info: remoteInfo() }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FLOCK_DISABLED');
  });
});

describe('POST /api/flock/heartbeat', () => {
  test('accepts a heartbeat from a registered perch', async () => {
    const { app, flock } = makeHarness();
    const res = await app.request('/api/flock/heartbeat', {
      method: 'POST',
      headers: { ...json, ...TOKEN },
      body: JSON.stringify({ nodeId: 'air', info: remoteInfo() }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(flock?.heartbeats[0]?.nodeId).toBe('air');
  });

  test('rejects a heartbeat without a token', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/flock/heartbeat', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ nodeId: 'air', info: remoteInfo() }),
    });
    expect(res.status).toBe(401);
  });

  test('requires nodeId', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/flock/heartbeat', {
      method: 'POST',
      headers: { ...json, ...TOKEN },
      body: JSON.stringify({ info: remoteInfo() }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('nodeId');
  });
});

describe('GET /api/flock/bundle', () => {
  test('streams the bundle as application/octet-stream', async () => {
    const bundlePath = makeTempFile('repo.bundle', 'PACK\0bundle-bytes');
    const { app, flock } = makeHarness({ flock: new FakeFlock({ bundlePath }) });
    const res = await app.request('/api/flock/bundle?ref=starling/abc/integration', {
      headers: TOKEN,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-length')).toBe(String(readFileSync(bundlePath).byteLength));
    expect(res.headers.get('content-disposition')).toContain('.bundle');
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(bytes)).toBe('PACK\0bundle-bytes');
    expect(flock?.bundled).toEqual(['starling/abc/integration']);
  });

  test('requires the flock token', async () => {
    const bundlePath = makeTempFile('repo.bundle', 'PACK');
    const { app } = makeHarness({ flock: new FakeFlock({ bundlePath }) });
    const res = await app.request('/api/flock/bundle?ref=main');
    expect(res.status).toBe(401);
  });

  test('requires a ref', async () => {
    const bundlePath = makeTempFile('repo.bundle', 'PACK');
    const { app } = makeHarness({ flock: new FakeFlock({ bundlePath }) });
    const res = await app.request('/api/flock/bundle', { headers: TOKEN });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_QUERY');
  });

  test('404s when the hub produced no bundle file', async () => {
    const { app } = makeHarness({
      flock: new FakeFlock({ bundlePath: '/tmp/starling-definitely-missing.bundle' }),
    });
    const res = await app.request('/api/flock/bundle?ref=main', { headers: TOKEN });
    expect(res.status).toBe(404);
  });

  test('503 FLOCK_DISABLED without a flock hub', async () => {
    const { app } = makeHarness({ flock: null });
    const res = await app.request('/api/flock/bundle?ref=main', { headers: TOKEN });
    expect(res.status).toBe(503);
  });
});
