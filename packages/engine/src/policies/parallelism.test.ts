import { describe, expect, test } from 'bun:test';
import { AimdLimit } from './parallelism';

function aimd(max = 8, recoverAfterMs = 1_000) {
  let now = 10_000;
  const limiter = new AimdLimit({ max, recoverAfterMs, now: () => now });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe('AimdLimit', () => {
  test('starts at the configured maximum', () => {
    const { limiter } = aimd(8);
    expect(limiter.limit).toBe(8);
  });

  test('halves on a rate limit, down to the floor of one', () => {
    const { limiter } = aimd(8);
    expect(limiter.onRateLimit()).toEqual({ from: 8, to: 4, reason: 'provider rate limit' });
    expect(limiter.onRateLimit()).toEqual({ from: 4, to: 2, reason: 'provider rate limit' });
    expect(limiter.onRateLimit()).toEqual({ from: 2, to: 1, reason: 'provider rate limit' });
    expect(limiter.onRateLimit()).toBeUndefined();
    expect(limiter.limit).toBe(1);
  });

  test('does not grow while the provider is still hot', () => {
    const { limiter, advance } = aimd(8, 1_000);
    limiter.onRateLimit();
    advance(500);
    expect(limiter.onProgress()).toBeUndefined();
    expect(limiter.limit).toBe(4);
  });

  test('grows by one per landed task once the quiet window passed, capped at max', () => {
    const { limiter, advance } = aimd(3, 1_000);
    limiter.onRateLimit(); // 3 → 1? floor(3/2) = 1
    expect(limiter.limit).toBe(1);
    advance(1_000);
    expect(limiter.onProgress()).toEqual({ from: 1, to: 2, reason: 'provider recovered' });
    expect(limiter.onProgress()).toEqual({ from: 2, to: 3, reason: 'provider recovered' });
    expect(limiter.onProgress()).toBeUndefined();
  });
});
