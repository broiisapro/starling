import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { StarlingError } from '@starling/core';
import { makeHarness, REPO_ROOT } from '../test-support';

const json = { 'content-type': 'application/json' };
const FIXTURE = 'fixtures/runs/sky-todo-launch-day.jsonl';
const FIXTURE_ABS = join(REPO_ROOT, FIXTURE);

describe('POST /api/replay', () => {
  test('503 REPLAY_DISABLED when the server has no replay implementation', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/replay', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ path: 'fixtures/runs/sky-todo-launch-day.jsonl' }),
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('REPLAY_DISABLED');
  });

  test('starts a replay and returns its run id', async () => {
    const calls: Array<{ path: string; speed?: number }> = [];
    const { app } = makeHarness({
      replay: async (path, speed) => {
        calls.push(speed === undefined ? { path } : { path, speed });
        return { runId: '01replayed' };
      },
    });
    const res = await app.request('/api/replay', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ path: 'fixtures/runs/sky-todo-launch-day.jsonl', speed: 8 }),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ runId: '01replayed' });
    expect(calls).toEqual([{ path: FIXTURE_ABS, speed: 8 }]);
  });

  test('403 FORBIDDEN for a path outside fixtures/ and .starling/', async () => {
    const calls: string[] = [];
    const { app } = makeHarness({
      replay: async (path) => {
        calls.push(path);
        return { runId: 'x' };
      },
    });
    const res = await app.request('/api/replay', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ path: '/etc/passwd' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('fixtures');
    expect(calls).toEqual([]);
  });

  test('403 FORBIDDEN for a traversal out of fixtures/', async () => {
    const { app } = makeHarness({ replay: async () => ({ runId: 'x' }) });
    const res = await app.request('/api/replay', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ path: 'fixtures/../../package.json' }),
    });
    expect(res.status).toBe(403);
  });

  test('allows a recorded run under .starling/', async () => {
    const calls: string[] = [];
    const { app } = makeHarness({
      replay: async (path) => {
        calls.push(path);
        return { runId: 'x' };
      },
    });
    const res = await app.request('/api/replay', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ path: '.starling/runs/one.jsonl', speed: 2 }),
    });
    expect(res.status).toBe(202);
    expect(calls).toEqual([join(REPO_ROOT, '.starling/runs/one.jsonl')]);
  });

  test('requires a path', async () => {
    const { app } = makeHarness({ replay: async () => ({ runId: 'x' }) });
    const res = await app.request('/api/replay', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ speed: 2 }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('path');
  });

  test('rejects a non-positive speed', async () => {
    const { app } = makeHarness({ replay: async () => ({ runId: 'x' }) });
    const res = await app.request('/api/replay', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ path: 'run.jsonl', speed: 0 }),
    });
    expect(res.status).toBe(400);
  });

  test('surfaces a replay error from an injected implementation as 400', async () => {
    const { app } = makeHarness({
      replay: async () => {
        throw new StarlingError('INVALID_ARGUMENT', 'Cannot read replay file: nope.jsonl');
      },
    });
    const res = await app.request('/api/replay', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ path: 'fixtures/nope.jsonl' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_ARGUMENT');
  });
});
