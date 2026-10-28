import { describe, expect, test } from 'bun:test';
import { COMPARE_TIMEOUT_MS, parseComparePayload } from './api';
import { runStats } from './derive';
import { fixtureRun, secondRun } from './test-fixtures';

const a = runStats(fixtureRun(), 1_731_000_400_000);
const b = runStats(secondRun(fixtureRun()), 1_731_000_400_000);

describe('parseComparePayload', () => {
  test('accepts two run stats and derives rows', () => {
    const parsed = parseComparePayload({ a, b });
    expect(parsed?.a?.id).toBe(a.id);
    expect(parsed?.b?.id).toBe(b.id);
    expect(parsed?.rows?.map((row) => row.metric)).toContain('wall');
  });

  test('accepts a rows-only payload with the optional fields missing', () => {
    const parsed = parseComparePayload({
      rows: [{ metric: 'wall', a: 300_000, b: 400_000, delta: -100_000, better: 'a', format: 'duration' }],
    });
    expect(parsed?.rows).toHaveLength(1);
    expect(parsed?.rows?.[0]?.label).toBe('wall');
    expect(parsed?.rows?.[0]?.direction).toBe('lower');
  });

  test('rows win over snapshots when both are present', () => {
    const parsed = parseComparePayload({
      a,
      b,
      rows: [{ metric: 'merged', a: 9, b: 1, delta: 8, better: 'a', format: 'count', label: 'Merged' }],
    });
    expect(parsed?.rows).toHaveLength(1);
    expect(parsed?.rows?.[0]?.label).toBe('Merged');
  });

  test('filters malformed rows but keeps valid ones', () => {
    const parsed = parseComparePayload({
      rows: [
        { metric: 'wall', a: 1, b: 2, delta: -1, better: 'a' },
        { metric: 'oops' },
        { metric: 'merged', a: Number.NaN, b: 2, delta: 0, better: 'same' },
      ],
    });
    expect(parsed?.rows).toHaveLength(1);
  });

  test('returns undefined for junk, empty or mismatched shapes', () => {
    expect(parseComparePayload(undefined)).toBeUndefined();
    expect(parseComparePayload(null)).toBeUndefined();
    expect(parseComparePayload('nope')).toBeUndefined();
    expect(parseComparePayload({ rows: [] })).toBeUndefined();
    expect(parseComparePayload({ a: { id: 'x' } })).toBeUndefined();
    expect(parseComparePayload({ ok: true })).toBeUndefined();
  });

  test('a 2 s timeout is the contract', () => {
    expect(COMPARE_TIMEOUT_MS).toBe(2_000);
  });
});
