import { describe, expect, test } from 'bun:test';
import { FakeClock, systemClock } from './clock';
import { isStarlingError, StarlingError, toStarlingError } from './errors';
import { matchesAny } from './glob';
import { newId, shortId } from './ids';
import {
  addUsage,
  DEFAULT_SAVED_MODEL,
  emptyMetrics,
  emptyUsage,
  estimateSavedUsd,
  PRICING,
  usageCostUsd,
  withCall,
} from './metrics';

describe('ids', () => {
  test('newId is a lowercase 26-char ULID', () => {
    const id = newId();
    expect(id).toHaveLength(26);
    expect(id).toBe(id.toLowerCase());
    expect(/^[0-9a-hjkmnp-tv-z]{26}$/.test(id)).toBe(true);
  });

  test('ids are unique and roughly time-sortable', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect(new Set(ids).size).toBe(50);
    expect((ids[0]?.slice(0, 10) ?? '') <= (ids[49]?.slice(0, 10) ?? '')).toBe(true);
  });

  test('shortId takes the random tail', () => {
    const id = newId();
    expect(shortId(id)).toHaveLength(6);
    expect(shortId(id)).toBe(id.slice(-6));
    expect(shortId('ABC')).toBe('abc');
  });
});

describe('errors', () => {
  test('StarlingError carries a code, message and cause', () => {
    const cause = new Error('git exploded');
    const err = new StarlingError('EXEC_FAILED', 'git failed', { cause, details: { cmd: ['git'] } });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('StarlingError');
    expect(err.code).toBe('EXEC_FAILED');
    expect(err.cause).toBe(cause);
    expect(err.details).toEqual({ cmd: ['git'] });
  });

  test('isStarlingError narrows by code', () => {
    const err = new StarlingError('MERGE_ERROR', 'conflict');
    expect(isStarlingError(err)).toBe(true);
    expect(isStarlingError(err, 'MERGE_ERROR')).toBe(true);
    expect(isStarlingError(err, 'EXEC_TIMEOUT')).toBe(false);
    expect(isStarlingError(new Error('plain'))).toBe(false);
  });

  test('toStarlingError wraps unknown values without double-wrapping', () => {
    const wrapped = toStarlingError('nope', 'UNKNOWN', 'something broke');
    expect(wrapped.code).toBe('UNKNOWN');
    expect(wrapped.message).toBe('something broke');
    const already = new StarlingError('LLM_ERROR', 'keep me');
    expect(toStarlingError(already, 'UNKNOWN')).toBe(already);
  });
});

describe('clock', () => {
  test('systemClock returns wall-clock milliseconds', () => {
    const before = Date.now();
    const now = systemClock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  test('FakeClock advances and jumps deterministically', () => {
    const clock = new FakeClock(1000);
    expect(clock.now()).toBe(1000);
    expect(clock.advance(250)).toBe(1250);
    expect(clock.set(42)).toBe(42);
    expect(() => clock.advance(-1)).toThrow(RangeError);
  });
});

describe('metrics', () => {
  test('emptyMetrics starts at zero', () => {
    const metrics = emptyMetrics();
    expect(metrics.tasksMerged).toBe(0);
    expect(metrics.apiUsage).toEqual(emptyUsage());
    expect(metrics.estSavedUsd).toBe(0);
  });

  test('addUsage sums tokens without mutating inputs', () => {
    const a = { input: 10, output: 5, cached: 2 };
    const b = { input: 1, output: 2, cached: 3 };
    expect(addUsage(a, b)).toEqual({ input: 11, output: 7, cached: 5 });
    expect(a).toEqual({ input: 10, output: 5, cached: 2 });
  });

  test('usageCostUsd prices cached input separately', () => {
    const cost = usageCostUsd('deepseek-v4.1-flash', {
      input: 1_000_000,
      output: 1_000_000,
      cached: 500_000,
    });
    // 0.5M uncached * $0.30 + 0.5M cached * $0.006 + 1M output * $1.20 (DeepSeek peak rates)
    expect(cost).toBeCloseTo(0.15 + 0.003 + 1.2, 6);
  });

  test('unknown models are free rather than crashing the meter', () => {
    expect(usageCostUsd('mystery-model', { input: 1000, output: 1000, cached: 0 })).toBe(0);
  });

  test('local models cost zero and estimateSavedUsd prices them as DeepSeek', () => {
    const pricing = PRICING['qwen3.6:35b-a3b'];
    expect(pricing?.outputPerM).toBe(0);
    const saved = estimateSavedUsd({ input: 1_000_000, output: 1_000_000, cached: 0 });
    expect(saved).toBeCloseTo(1.5, 6);
    expect(DEFAULT_SAVED_MODEL).toBe('deepseek-v4.1-flash');
  });

  test('withCall accumulates api and local usage into the right buckets', () => {
    let metrics = emptyMetrics();
    metrics = withCall(metrics, {
      usage: { input: 1000, output: 500, cached: 0 },
      model: 'deepseek-v4.1-flash',
      local: false,
    });
    metrics = withCall(metrics, {
      usage: { input: 2000, output: 100, cached: 0 },
      model: 'qwen3.6:35b-a3b',
      local: true,
    });
    expect(metrics.apiUsage).toEqual({ input: 1000, output: 500, cached: 0 });
    expect(metrics.apiCostUsd).toBeCloseTo(usageCostUsd('deepseek-v4.1-flash', metrics.apiUsage), 9);
    expect(metrics.localUsage).toEqual({ input: 2000, output: 100, cached: 0 });
    expect(metrics.localCallCount).toBe(1);
    expect(metrics.estSavedUsd).toBeGreaterThan(0);
  });
});

describe('glob public surface', () => {
  test('matchesAny is importable from core index', async () => {
    const core = await import('./index');
    expect(core.matchesAny('src/main.ts', ['src/**'])).toBe(true);
    expect(typeof matchesAny).toBe('function');
  });
});
