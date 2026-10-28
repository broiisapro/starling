import { describe, expect, test } from 'bun:test';
import type { Run } from '@starling/core/browser';
import { serialBaseline } from './derive';
import {
  BASELINE_VALUE,
  baselineFor,
  defaultSelection,
  isLiveRun,
  runLabel,
  SAME_RUN_NOTICE,
} from './selection';
import { fixtureRun, secondRun } from './test-fixtures';

const a = fixtureRun();
const b = secondRun(a);

function selection(runs: readonly Run[], activeRunId: string | undefined, params = {}) {
  return defaultSelection(runs, activeRunId, params);
}

describe('defaultSelection', () => {
  test('has nothing to show when there are no runs', () => {
    expect(selection([], undefined)).toBeUndefined();
  });

  test('with one run, compares it against its serial baseline', () => {
    const picked = selection([a], a.id);
    expect(picked?.a.id).toBe(a.id);
    expect(picked?.baseline).toBe(true);
    expect(picked?.b).toBeUndefined();
    expect(picked?.source).toBe('baseline');
  });

  test('with two runs, compares the active run with the other one', () => {
    const picked = selection([a, b], a.id);
    expect(picked?.a.id).toBe(a.id);
    expect(picked?.b?.id).toBe(b.id);
    expect(picked?.baseline).toBe(false);
    expect(picked?.source).toBe('default');
  });

  test('honours ?a= and ?b=', () => {
    const picked = selection([a, b], a.id, { a: b.id, b: a.id });
    expect(picked?.a.id).toBe(b.id);
    expect(picked?.b?.id).toBe(a.id);
    expect(picked?.source).toBe('url');
  });

  test('honours b=baseline', () => {
    const picked = selection([a, b], a.id, { a: b.id, b: BASELINE_VALUE });
    expect(picked?.a.id).toBe(b.id);
    expect(picked?.baseline).toBe(true);
    expect(picked?.source).toBe('baseline');
  });

  test('an unknown run id falls back to a sensible pair', () => {
    const picked = selection([a, b], a.id, { a: 'not-a-run' });
    expect(picked?.a.id).toBe(a.id);
    expect(picked?.b?.id).toBe(b.id);
  });

  test('a valid A with a missing B picks the next run, not a dead picker', () => {
    const picked = selection([a, b], a.id, { a: b.id });
    expect(picked?.a.id).toBe(b.id);
    expect(picked?.b?.id).toBe(a.id);
  });

  test('the same run on both sides is explicit, not silently swapped', () => {
    const picked = selection([a, b], a.id, { a: a.id, b: a.id });
    expect(picked?.a.id).toBe(a.id);
    expect(picked?.b?.id).toBe(a.id);
    expect(picked?.source).toBe('same-run');
    expect(picked?.notice).toBe(SAME_RUN_NOTICE);
  });

  test('the active run is preferred over the newest one', () => {
    const picked = selection([a, b], b.id);
    expect(picked?.a.id).toBe(b.id);
    expect(picked?.b?.id).toBe(a.id);
  });
});

describe('baselineFor', () => {
  test('builds the synthetic run only for the baseline side', () => {
    const baselineSelection = selection([a], a.id);
    expect(baselineSelection).toBeDefined();
    if (baselineSelection === undefined) return;
    const baseline = baselineFor(baselineSelection, a.finishedAt ?? 0);
    expect(baseline?.id).toBe(`${a.id}:serial`);

    const pairSelection = selection([a, b], a.id);
    expect(pairSelection).toBeDefined();
    if (pairSelection === undefined) return;
    expect(baselineFor(pairSelection, a.finishedAt ?? 0)?.id).toBe(b.id);
  });

  test('the baseline is stable for a finished run', () => {
    const once = serialBaseline(a, a.finishedAt ?? 0);
    const twice = serialBaseline(a, a.finishedAt ?? 0);
    expect(once.finishedAt).toBe(twice.finishedAt);
    expect(once.tasks.theme?.startedAt).toBe(twice.tasks.theme?.startedAt);
  });
});

describe('runLabel and isLiveRun', () => {
  test('long goals are clipped, never a raw id', () => {
    const label = runLabel(a, 20);
    expect(label.length).toBeLessThanOrEqual(20);
    expect(label.endsWith('…')).toBe(true);
  });

  test('every non-terminal run is live', () => {
    expect(isLiveRun({ ...a, status: 'running' })).toBe(true);
    expect(isLiveRun({ ...a, status: 'planned' })).toBe(true);
    expect(isLiveRun({ ...a, status: 'finished' })).toBe(false);
    expect(isLiveRun({ ...a, status: 'failed' })).toBe(false);
  });
});
