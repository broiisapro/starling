import { describe, expect, test } from 'bun:test';
import { StarlingConfigSchema } from '@starling/core';
import { FakeTimers } from '../testing/harness';
import { DEFAULT_STALL_AFTER_MS, StallWatchdog, stallAfterMsFrom, stallDecision } from './stall';

describe('StallWatchdog', () => {
  test('fires once for a task with no activity, then forgets it', () => {
    const timers = new FakeTimers();
    const stalled: string[] = [];
    const watchdog = new StallWatchdog({
      stallAfterMs: 1_000,
      timers,
      onStall: (key) => stalled.push(key),
    });
    watchdog.track('a');
    expect(timers.pendingTimeouts).toBe(1);

    timers.fireTimeouts();
    expect(stalled).toEqual(['a']);
    expect(watchdog.size).toBe(0);
    expect(timers.pendingTimeouts).toBe(0);
  });

  test('an agent event pushes the deadline out instead of letting it fire', () => {
    const timers = new FakeTimers();
    const stalled: string[] = [];
    const watchdog = new StallWatchdog({ stallAfterMs: 500, timers, onStall: (k) => stalled.push(k) });
    watchdog.track('a');
    watchdog.touch('a');
    // The first timer is gone; only the re-armed one can fire.
    expect(timers.pendingTimeouts).toBe(1);
    timers.fireTimeouts();
    expect(stalled).toEqual(['a']);
  });

  test('untrack cancels the deadline and stop clears every task', () => {
    const timers = new FakeTimers();
    const stalled: string[] = [];
    const watchdog = new StallWatchdog({ stallAfterMs: 500, timers, onStall: (k) => stalled.push(k) });
    watchdog.track('a');
    watchdog.track('b');
    watchdog.untrack('a');
    expect(watchdog.size).toBe(1);
    watchdog.stop();
    expect(watchdog.size).toBe(0);
    expect(timers.pendingTimeouts).toBe(0);
    timers.fireTimeouts();
    expect(stalled).toEqual([]);
  });

  test('touching an untracked task does not arm it', () => {
    const timers = new FakeTimers();
    const watchdog = new StallWatchdog({ stallAfterMs: 500, timers, onStall: () => {} });
    watchdog.touch('ghost');
    expect(watchdog.size).toBe(0);
    expect(timers.pendingTimeouts).toBe(0);
  });
});

describe('stallDecision', () => {
  test('recovers once, then fails', () => {
    expect(stallDecision({ stallRetries: 0, attempts: 0, maxAttempts: 3 })).toBe('retry');
    expect(stallDecision({ stallRetries: 1, attempts: 1, maxAttempts: 3 })).toBe('fail');
  });

  test('never spends more attempts than the audit budget allows', () => {
    expect(stallDecision({ stallRetries: 0, attempts: 3, maxAttempts: 3 })).toBe('fail');
    expect(stallDecision({ stallRetries: 0, attempts: 2, maxAttempts: 3 })).toBe('retry');
  });

  test('maxStallRetries = 0 disables recovery', () => {
    expect(stallDecision({ stallRetries: 0, attempts: 0, maxAttempts: 3, maxStallRetries: 0 })).toBe('fail');
  });
});

describe('stallAfterMsFrom', () => {
  test('defaults to four minutes when neither config nor policies name a value', () => {
    expect(DEFAULT_STALL_AFTER_MS).toBe(240_000);
    expect(stallAfterMsFrom(StarlingConfigSchema.parse({}))).toBe(DEFAULT_STALL_AFTER_MS);
  });

  test('feature-detects an additive config field', () => {
    const config = { ...StarlingConfigSchema.parse({}), stallAfterMs: 1_500 } as never;
    expect(stallAfterMsFrom(config)).toBe(1_500);
    const off = { ...StarlingConfigSchema.parse({}), stallAfterMs: 0 } as never;
    expect(stallAfterMsFrom(off)).toBe(0);
  });
});
