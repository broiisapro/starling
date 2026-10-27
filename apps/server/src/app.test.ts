import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PACKAGE as CORE_PACKAGE, StarlingError } from '@starling/core';
import { makeNodeInfo } from '@starling/core/testing';
import { createApp, startServer } from './app';
import { PACKAGE } from './index';
import { contentTypeFor, resolveStaticPath } from './static';
import { FakeEngine, makeHarness } from './test-support';

const tempDirs: string[] = [];

function makeWebDist(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'starling-webdist-'));
  tempDirs.push(dir);
  for (const [path, contents] of Object.entries(files)) {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('@starling/server app shell', () => {
  test('exports its package name and imports core', () => {
    expect(PACKAGE).toBe('@starling/server');
    expect(CORE_PACKAGE).toBe('@starling/core');
    expect(makeNodeInfo().status).toBe('online');
  });

  test('GET /api/health reports ok and the injected version', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: '9.9.9' });
  });

  test('an unknown API route is a JSON 404 with the error envelope', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.message).toContain('/api/nope');
  });

  test('an unknown non-API route is a plain 404 when no dashboard is configured', async () => {
    const { app } = makeHarness();
    const res = await app.request('/somewhere');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
  });

  test('CORS allows the Vite dev server and refuses other origins', async () => {
    const { app } = makeHarness();
    const allowed = await app.request('/api/health', {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    const refused = await app.request('/api/health', { headers: { origin: 'https://evil.example' } });
    expect(refused.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('a CORS preflight from the dev server is answered', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/runs', {
      method: 'OPTIONS',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  test('every request publishes one debug log event outside any run', async () => {
    const { app, published } = makeHarness();
    await app.request('/api/health');
    const logs = published.filter((event) => event.type === 'log');
    expect(logs).toHaveLength(1);
    const log = logs[0];
    if (log?.type !== 'log') throw new Error('expected a log event');
    expect(log.runId).toBe('*');
    expect(log.payload.level).toBe('debug');
    expect(log.payload.msg).toContain('GET /api/health → 200');
  });

  test('a StarlingError from the engine becomes its status and code', async () => {
    const engine = new FakeEngine();
    engine.startError = new StarlingError('INVALID_ARGUMENT', 'repoPath does not exist');
    const { app } = makeHarness({ engine });
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'add dark mode', repoPath: '/nope' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_ARGUMENT');
  });

  test('an unexpected engine failure is a 500 INTERNAL and is logged', async () => {
    const engine = new FakeEngine();
    engine.startError = new Error('kaboom');
    const { app, published } = makeHarness({ engine });
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'add dark mode', repoPath: '/tmp/repo' }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error).toEqual({ code: 'INTERNAL', message: 'kaboom' });
    const errors = published.filter((event) => event.type === 'log' && event.payload.level === 'error');
    expect(errors).toHaveLength(1);
  });

  test('startServer binds an ephemeral port and serves the API', async () => {
    const { deps } = makeHarness();
    const server = startServer(deps, { port: 0, hostname: '127.0.0.1' });
    try {
      expect(server.port).toBeGreaterThan(0);
      const res = await fetch(`${server.url}/api/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, version: '9.9.9' });
    } finally {
      server.stop();
    }
  });
});

describe('static hosting', () => {
  test('serves index.html at / and hashed assets with a long cache', async () => {
    const webDist = makeWebDist({
      'index.html': '<!doctype html><title>Starling</title>',
      'assets/app-abc123.js': 'console.log("hi")',
    });
    const { app } = makeHarness({ webDist });

    const index = await app.request('/');
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('Starling');
    expect(index.headers.get('content-type')).toContain('text/html');

    const asset = await app.request('/assets/app-abc123.js');
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(await asset.text()).toBe('console.log("hi")');
  });

  test('falls back to index.html for client-side routes but never for /api', async () => {
    const webDist = makeWebDist({ 'index.html': '<title>SPA</title>' });
    const { app } = makeHarness({ webDist });

    const deepLink = await app.request('/runs/abc/tasks/theme');
    expect(deepLink.status).toBe(200);
    expect(await deepLink.text()).toContain('SPA');

    const health = await app.request('/api/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, version: '9.9.9' });

    const apiMiss = await app.request('/api/definitely-not-a-route');
    expect(apiMiss.status).toBe(404);
    expect(apiMiss.headers.get('content-type')).toContain('application/json');
  });

  test('a missing index.html means this is not a dashboard build', async () => {
    const webDist = makeWebDist({ 'robots.txt': 'nope' });
    const { app } = makeHarness({ webDist });
    const res = await app.request('/runs/abc');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
  });

  test('HEAD returns headers without a body', async () => {
    const webDist = makeWebDist({ 'index.html': '<title>SPA</title>' });
    const { app } = makeHarness({ webDist });
    const res = await app.request('/', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toBe('');
  });

  test('path traversal never escapes the web root', async () => {
    const webDist = makeWebDist({ 'index.html': '<title>SPA</title>', 'secret.txt': 'inside' });
    expect(resolveStaticPath(webDist, '/../../etc/passwd')).toBeUndefined();
    expect(resolveStaticPath(webDist, '/%2e%2e/%2e%2e/etc/passwd')).toBeUndefined();
    expect(resolveStaticPath(webDist, '/secret.txt')).toBe(join(webDist, 'secret.txt'));
    expect(contentTypeFor('main.css')).toContain('text/css');
    expect(contentTypeFor('file.unknown')).toBe('application/octet-stream');

    const { app } = makeHarness({ webDist });
    const res = await app.request('/../../etc/passwd');
    expect(await res.text()).not.toContain('root:');
  });

  test('createApp without webDist never serves files', async () => {
    const app = createApp({ ...makeHarness().deps });
    const res = await app.request('/index.html');
    expect(res.status).toBe(404);
  });
});
