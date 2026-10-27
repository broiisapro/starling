import { describe, expect, test } from 'bun:test';
import { StarlingError } from '@starling/core';
import { makeHarness } from '../test-support';

const json = { 'content-type': 'application/json' };

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
    expect(calls).toEqual([{ path: 'fixtures/runs/sky-todo-launch-day.jsonl', speed: 8 }]);
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
      body: JSON.stringify({ path: 'nope.jsonl' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_ARGUMENT');
  });
});
