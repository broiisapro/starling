import { describe, expect, test } from 'bun:test';
import { StarlingError } from '@starling/core';
import {
  detectRateLimit,
  looksRateLimited,
  ProviderRateLimiter,
  type ProviderRateLimiterOptions,
  rateLimitFromError,
} from './opencode/rate-limit';

describe('rate-limit detection', () => {
  test('recognises the usual provider phrasings', () => {
    for (const text of [
      '429 Too Many Requests',
      'provider overloaded, try again later',
      'Rate limit exceeded for opencode-go',
      'status 503 service temporarily unavailable',
      'weekly quota reached',
    ]) {
      expect(looksRateLimited(text)).toBe(true);
    }
    expect(looksRateLimited('file not found')).toBe(false);
    expect(looksRateLimited('assertion failed: 4 !== 5')).toBe(false);
  });

  test('reads status, provider and retry-after from a normalised session.error', () => {
    const signal = detectRateLimit({
      name: 'ProviderError',
      message: 'rate limited',
      status: 429,
      retryAfterMs: 2500,
      model: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
    });
    expect(signal).toEqual({
      provider: 'opencode-go',
      retryAfterMs: 2500,
      detail: 'ProviderError rate limited',
    });
  });

  test('an ordinary error is not a rate limit', () => {
    expect(detectRateLimit({ name: 'ToolError', message: 'ENOENT' })).toBeUndefined();
    expect(
      detectRateLimit({ name: 'ProviderError', message: 'invalid api key', status: 401 }),
    ).toBeUndefined();
  });

  test('a runner error carrying details is recognised from the thrown value', () => {
    const err = new StarlingError('RUNNER_ERROR', 'opencode POST /prompt failed with 429', {
      details: { status: 429, rateLimited: true },
    });
    expect(rateLimitFromError(err)?.detail).toContain('429');
    expect(rateLimitFromError(new Error('boom'))).toBeUndefined();
  });
});

/** A limiter whose clock and sleep are simulated so every wait is instant and inspectable. */
function fakeLimiter(overrides: ProviderRateLimiterOptions = {}) {
  let now = 1_000;
  const sleeps: number[] = [];
  const limiter = new ProviderRateLimiter({
    capacity: 2,
    refillMs: 1_000,
    baseBackoffMs: 1_000,
    maxBackoffMs: 8_000,
    jitterRatio: 0,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 0.5,
    ...overrides,
  });
  return {
    limiter,
    sleeps,
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('ProviderRateLimiter (token bucket per provider)', () => {
  test('a burst spends the tokens and then paces itself', async () => {
    const f = fakeLimiter();
    await f.limiter.acquire('opencode-go');
    await f.limiter.acquire('opencode-go');
    expect(f.limiter.tokens('opencode-go')).toBe(0);
    expect(f.limiter.waitMs('opencode-go')).toBe(1_000);

    await f.limiter.acquire('opencode-go');
    expect(f.sleeps).toEqual([1_000]);
    expect(f.limiter.tokens('opencode-go')).toBe(0);
  });

  test('providers have independent buckets', async () => {
    const f = fakeLimiter();
    await f.limiter.acquire('opencode-go');
    await f.limiter.acquire('opencode-go');
    // A different provider is untouched by the first one's spend.
    await f.limiter.acquire('deepseek');
    expect(f.sleeps).toEqual([]);
    expect(f.limiter.tokens('deepseek')).toBe(1);
  });

  test('tokens refill with time and never exceed capacity', () => {
    const f = fakeLimiter();
    expect(f.limiter.tokens('p')).toBe(2);
    f.advance(10_000);
    expect(f.limiter.tokens('p')).toBe(2);
  });

  test('a penalty blocks every session of that provider and backs off exponentially', async () => {
    const f = fakeLimiter();
    const first = f.limiter.penalize('opencode-go');
    const second = f.limiter.penalize('opencode-go');
    expect(first).toBe(1_000);
    expect(second).toBe(2_000);
    expect(f.limiter.blockedFor('opencode-go')).toBeGreaterThanOrEqual(2_000);

    await f.limiter.acquire('opencode-go');
    expect(f.sleeps).toEqual([2_000]);
  });

  test('a server retry-after wins, jitter stays within the configured band', () => {
    const f = fakeLimiter({ jitterRatio: 0.25, random: () => 1 });
    const applied = f.limiter.penalize('p', 2_000);
    expect(applied).toBe(2_500);
  });

  test('success resets the exponential streak', () => {
    const f = fakeLimiter();
    f.limiter.penalize('p');
    f.limiter.penalize('p');
    expect(f.limiter.snapshot('p').streak).toBe(2);
    f.limiter.reward('p');
    expect(f.limiter.snapshot('p').streak).toBe(0);
    expect(f.limiter.penalize('p')).toBe(1_000);
  });

  test('an aborted acquire resolves without consuming a token', async () => {
    const f = fakeLimiter({ capacity: 1 });
    await f.limiter.acquire('p');
    const abort = new AbortController();
    abort.abort();
    await f.limiter.acquire('p', abort.signal);
    expect(f.sleeps).toEqual([]);
    expect(f.limiter.tokens('p')).toBe(0);
  });
});
