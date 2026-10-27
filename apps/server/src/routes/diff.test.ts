import { describe, expect, test } from 'bun:test';
import type { DiffSummary, StarlingEvent } from '@starling/core';
import { makeAuditVerdict, makeRun } from '@starling/core/testing';
import { FakeEngine, makeHarness } from '../test-support';
import { latestTaskDiff } from './diff';

const DIFF: DiffSummary = {
  files: [{ path: 'src/theme.ts', added: 12, removed: 1 }],
  patch: '+++ b/src/theme.ts\n+export const dark = true;',
  truncated: false,
};

function eventWithDiff(runId: string, taskKey: string, diff: unknown, ts = 100): StarlingEvent {
  return {
    type: 'audit.verdict',
    runId,
    ts,
    payload: { ...makeAuditVerdict({ taskKey }), diff },
  } as unknown as StarlingEvent;
}

describe('latestTaskDiff', () => {
  test('finds a diff on the newest event that carries one', () => {
    const run = makeRun();
    const events = [
      eventWithDiff(run.id, 'theme', { ...DIFF, patch: 'old' }, 100),
      eventWithDiff(run.id, 'theme', DIFF, 200),
      { type: 'log', runId: run.id, ts: 300, payload: { level: 'info', msg: 'after' } } as StarlingEvent,
    ];
    expect(latestTaskDiff(events, 'theme')?.patch).toBe(DIFF.patch);
  });

  test('accepts a future task.diff event and a TaskResult-shaped payload', () => {
    const run = makeRun();
    const taskDiff = {
      type: 'task.diff',
      runId: run.id,
      ts: 100,
      payload: { taskKey: 'theme', diff: DIFF },
    } as unknown as StarlingEvent;
    expect(latestTaskDiff([taskDiff], 'theme')).toEqual(DIFF);

    const result = {
      type: 'task.status',
      runId: run.id,
      ts: 100,
      payload: { taskKey: 'theme', run: makeRun().tasks.theme, result: { diff: DIFF } },
    } as unknown as StarlingEvent;
    expect(latestTaskDiff([result], 'theme')).toEqual(DIFF);
  });

  test('ignores malformed diffs and other tasks', () => {
    const run = makeRun();
    const bad = eventWithDiff(run.id, 'theme', { files: 'nope' });
    const other = eventWithDiff(run.id, 'search', DIFF);
    expect(latestTaskDiff([bad, other], 'theme')).toBeUndefined();
  });
});

describe('GET /api/runs/:id/diff/:taskKey', () => {
  test('returns the latest recorded diff', async () => {
    const run = makeRun();
    const { app, store } = makeHarness({ engine: new FakeEngine([run]) });
    store.appendEvent(eventWithDiff(run.id, 'theme', DIFF, 100));

    const res = await app.request(`/api/runs/${run.id}/diff/theme`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DIFF);
  });

  test('404s when nothing has been recorded yet', async () => {
    const run = makeRun();
    const { app } = makeHarness({ engine: new FakeEngine([run]) });
    const res = await app.request(`/api/runs/${run.id}/diff/theme`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  test('404s for a task outside the plan', async () => {
    const run = makeRun();
    const { app } = makeHarness({ engine: new FakeEngine([run]) });
    const res = await app.request(`/api/runs/${run.id}/diff/nope`);
    expect(res.status).toBe(404);
  });

  test('404 RUN_NOT_FOUND for an unknown run', async () => {
    const { app } = makeHarness();
    const res = await app.request('/api/runs/01missing/diff/theme');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('RUN_NOT_FOUND');
  });
});
