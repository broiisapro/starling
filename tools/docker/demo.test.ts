/**
 * Tests for the Docker demo server (no Docker required).
 *
 * Everything binds `127.0.0.1:0` and reads the real launch-day fixture, so the assertions are about
 * the same code path the image runs: REST, SSE, static files, the read-only engine and a clean stop.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DockerDemo, DockerDemoOptions } from './demo.ts';
import {
  DEFAULT_DEMO_SPEED,
  DEFAULT_FIXTURE_PATH,
  DEFAULT_PORT,
  demoOptionsFromEnv,
  startDockerDemo,
} from './demo.ts';

const FIXTURE = join(import.meta.dir, '../../fixtures/runs/sky-todo-launch-day.jsonl');

let webDist = '';
const running: DockerDemo[] = [];

beforeAll(async () => {
  webDist = await mkdtemp(join(tmpdir(), 'starling-docker-webdist-'));
  await mkdir(join(webDist, 'assets'), { recursive: true });
  await writeFile(
    join(webDist, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>',
  );
  await writeFile(join(webDist, 'assets/app.js'), 'console.log("starling");');
});

afterAll(async () => {
  for (const demo of running) demo.stop();
  if (webDist !== '') await rm(webDist, { recursive: true, force: true });
});

async function startTestDemo(overrides: DockerDemoOptions = {}): Promise<DockerDemo> {
  const demo = await startDockerDemo({
    port: 0,
    hostname: '127.0.0.1',
    speed: 1_000,
    loop: false,
    fixture: FIXTURE,
    webDist,
    ...overrides,
  });
  running.push(demo);
  return demo;
}

describe('demoOptionsFromEnv', () => {
  test('defaults match the documented container config', () => {
    const options = demoOptionsFromEnv({});
    expect(options.port).toBe(DEFAULT_PORT);
    expect(options.speed).toBe(DEFAULT_DEMO_SPEED);
    expect(options.hostname).toBe('0.0.0.0');
    expect(options.fixture).toBe(DEFAULT_FIXTURE_PATH);
    expect(options.webDist.endsWith(join('apps', 'web', 'dist'))).toBe(true);
  });

  test('PORT wins over STARLING_PORT, and port 0 stays 0', () => {
    expect(demoOptionsFromEnv({ PORT: '8080', STARLING_PORT: '9999' }).port).toBe(8080);
    expect(demoOptionsFromEnv({ STARLING_PORT: '1234' }).port).toBe(1234);
    expect(demoOptionsFromEnv({ PORT: '0' }).port).toBe(0);
  });

  test('invalid values fall back instead of crash-looping a container', () => {
    expect(demoOptionsFromEnv({ PORT: 'eighty' }).port).toBe(DEFAULT_PORT);
    expect(demoOptionsFromEnv({ PORT: '70000' }).port).toBe(DEFAULT_PORT);
    expect(demoOptionsFromEnv({ STARLING_DEMO_SPEED: '-3' }).speed).toBe(DEFAULT_DEMO_SPEED);
  });

  test('reads the fixture and speed overrides', () => {
    const options = demoOptionsFromEnv({
      STARLING_DEMO_SPEED: '20',
      STARLING_DEMO_FIXTURE: '/tmp/other.jsonl',
    });
    expect(options.speed).toBe(20);
    expect(options.fixture).toBe('/tmp/other.jsonl');
  });
});

describe('startDockerDemo', () => {
  test('serves /api/health', async () => {
    const demo = await startTestDemo();
    const response = await fetch(`${demo.url}/api/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version.length).toBeGreaterThan(0);
  });

  test('lists the replayed run in /api/runs', async () => {
    const demo = await startTestDemo();
    const response = await fetch(`${demo.url}/api/runs`);
    expect(response.status).toBe(200);
    const runs = (await response.json()) as { id: string; tasks: Record<string, unknown> }[];
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0]?.id).toBe(demo.runId);
    expect(Object.keys(runs[0]?.tasks ?? {}).length).toBeGreaterThan(0);
  });

  test('streams recorded events as SSE frames', async () => {
    const demo = await startTestDemo();
    const response = await fetch(`${demo.url}/api/runs/${demo.runId}/events?since=0`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) return;

    const decoder = new TextDecoder();
    let text = '';
    // First frame is the `: connected` comment, then the backlog; Bun may coalesce them.
    for (let i = 0; i < 3; i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes('data:')) break;
    }
    await reader.cancel();
    expect(text).toContain('data:');
    expect(text).toContain('"type":"run.created"');
  });

  test('serves index.html and assets from webDist, with an SPA fallback', async () => {
    const demo = await startTestDemo();
    const root = await fetch(`${demo.url}/`);
    expect(root.status).toBe(200);
    expect(root.headers.get('content-type')).toContain('text/html');
    expect(await root.text()).toContain('<div id="root"></div>');

    const asset = await fetch(`${demo.url}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('text/javascript');

    const deep = await fetch(`${demo.url}/runs/some-client-route`);
    expect(deep.status).toBe(200);
    expect(await deep.text()).toContain('<div id="root"></div>');
  });

  test('is read-only: starting a run answers 501, never spawns an agent', async () => {
    const demo = await startTestDemo();
    const response = await fetch(`${demo.url}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'do something', repoPath: '.' }),
    });
    expect(response.status).toBe(501);
    expect(await response.text()).toContain('NOT_IMPLEMENTED');
  });

  test('stop is idempotent and closes the listener', async () => {
    const demo = await startTestDemo();
    const url = `${demo.url}/api/health`;
    expect((await fetch(url)).status).toBe(200);
    demo.stop();
    demo.stop();
    let failed = false;
    try {
      await fetch(url);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });
});
