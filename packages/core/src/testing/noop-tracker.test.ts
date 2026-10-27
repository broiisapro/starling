import { describe, expect, test } from 'bun:test';
import { makeTaskRun } from './factories';
import { NoopTracker } from './noop-tracker';

describe('NoopTracker', () => {
  test('every call succeeds and is recorded', async () => {
    const tracker = new NoopTracker();
    const run = (await import('./factories')).makeRun();
    expect(await tracker.syncPlan(run)).toEqual({});
    expect(await tracker.openTaskPR(run, makeTaskRun(), 'body')).toBeUndefined();
    await tracker.onMerged(run, makeTaskRun());
    expect(await tracker.openFinalPR(run, 'body')).toBeUndefined();
    expect(tracker.calls.map((c) => c.method)).toEqual(['syncPlan', 'openTaskPR', 'onMerged', 'openFinalPR']);
  });
});
