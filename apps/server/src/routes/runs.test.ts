import { describe, expect, test } from 'bun:test';
import { BASE_TS, makeRun } from '@starling/core/testing';
import { FakeEngine, makeHarness } from '../test-support';

const json = { 'content-type': 'application/json' };

describe('GET /api/runs', () => {
  test('lists runs most recent first', async () => {
    const older = makeRun({ startedAt: BASE_TS });
    const newer = makeRun({ startedAt: BASE_TS + 5_000 });
    const { app, store } = makeHarness({ engine: new FakeEngine([older, newer]) });
    store.saveRun(older);
    store.saveRun(newer);

    const res = await app.request('/api/runs');
    expect(res.status).toBe(200);
    const runs = (await res.json()) as Array<{ id: string }>;
    expect(runs.map((run) => run.id)).toEqual([newer.id, older.id]);
  });

  test('returns an empty list before any run exists', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/runs');
    expect(await res.json()).toEqual([]);
  });

  test('finds a run the engine knows but the store has not persisted yet', async () => {
    const run = makeRun();
    const { app } = makeHarness({ engine: new FakeEngine([run]) });
    const res = await app.request(`/api/runs/${run.id}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(run.id);
  });

  test('unknown runs are 404 RUN_NOT_FOUND', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/runs/01missing');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RUN_NOT_FOUND');
  });
});

describe('POST /api/runs', () => {
  test('starts a run and returns its id', async () => {
    const { app, engine } = makeHarness();
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        goal: 'Add dark mode and fix the overdue dates',
        repoPath: '/tmp/sky-todo',
        maxParallel: 4,
        dryRun: true,
        baseBranch: 'trunk',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string };
    expect(body.runId).toBeString();
    expect(engine.started).toEqual([
      {
        goal: 'Add dark mode and fix the overdue dates',
        repoPath: '/tmp/sky-todo',
        dryRun: true,
        maxParallel: 4,
        baseBranch: 'trunk',
      },
    ]);
  });

  test('omits optionals the caller did not send', async () => {
    const { app, engine } = makeHarness();
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ goal: 'Ship it', repoPath: '.' }),
    });
    expect(res.status).toBe(201);
    expect(engine.started[0]).toEqual({ goal: 'Ship it', repoPath: '.' });
  });

  test('trims whitespace-only fields into a 400', async () => {
    const { app, engine } = makeHarness();
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ goal: '   ', repoPath: '.' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_BODY');
    expect(body.error.message).toContain('goal');
    expect(engine.started).toHaveLength(0);
  });

  test('rejects a body that is not JSON', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: json,
      body: '{not json',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('JSON');
  });

  test('rejects an out-of-range maxParallel', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ goal: 'Ship it', repoPath: '.', maxParallel: 0 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('maxParallel');
  });

  test('rejects a non-integer maxParallel', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/runs', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ goal: 'Ship it', repoPath: '.', maxParallel: 2.5 }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/runs/:id/cancel', () => {
  test('cancels a known run', async () => {
    const run = makeRun();
    const { app, engine } = makeHarness({ engine: new FakeEngine([run]) });
    const res = await app.request(`/api/runs/${run.id}/cancel`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(engine.cancelled).toEqual([run.id]);
  });

  test('404s for an unknown run', async () => {
    const { app, engine } = makeHarness();
    const res = await app.request('/api/runs/01missing/cancel', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(engine.cancelled).toEqual([]);
  });
});

describe('POST /api/runs/:id/tasks/:key/abort', () => {
  test('aborts a task that belongs to the run', async () => {
    const run = makeRun();
    const { app, engine } = makeHarness({ engine: new FakeEngine([run]) });
    const res = await app.request(`/api/runs/${run.id}/tasks/theme/abort`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(engine.aborted).toEqual([{ runId: run.id, taskKey: 'theme' }]);
  });

  test('404s for an unknown task', async () => {
    const run = makeRun();
    const { app } = makeHarness({ engine: new FakeEngine([run]) });
    const res = await app.request(`/api/runs/${run.id}/tasks/nope/abort`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('nope');
  });

  test('404s for an unknown run', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/runs/01missing/tasks/theme/abort', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RUN_NOT_FOUND');
  });
});
