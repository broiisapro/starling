import { describe, expect, test } from 'bun:test';
import { StarlingError } from '@starling/core';
import {
  backoffMs,
  isRetryableError,
  retryAfterMs,
  sleep,
  statusOf,
  withRetries,
  withTimeout,
} from './retry.ts';
import type { RetryOptions } from './types.ts';

const RETRY: RetryOptions = { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, maxRetryAfterMs: 1000 };

function httpError(status: number, headers: Record<string, string> = {}): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status, headers: new Headers(headers) });
}

describe('retry helpers', () => {
  test('parses Retry-After seconds and dates', () => {
    expect(retryAfterMs(new Headers({ 'retry-after': '2' }))).toBe(2000);
    const at = new Date(10_000).toUTCString();
    expect(retryAfterMs(new Headers({ 'retry-after': at }), 4000)).toBe(6000);
    expect(retryAfterMs(new Headers())).toBeUndefined();
  });

  test('classifies transient vs permanent failures', () => {
    expect(isRetryableError(httpError(429))).toBe(true);
    expect(isRetryableError(httpError(503))).toBe(true);
    expect(isRetryableError(httpError(400))).toBe(false);
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableError(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true);
    const aborted = new AbortController();
    aborted.abort(new Error('stop'));
    expect(isRetryableError(httpError(500), aborted.signal)).toBe(false);
  });

  test('reads status from plain errors and Starling errors', () => {
    expect(statusOf(httpError(418))).toBe(418);
    expect(statusOf(new StarlingError('LLM_ERROR', 'x', { details: { status: 502 } }))).toBe(502);
    expect(statusOf(new Error('no status'))).toBeUndefined();
  });

  test('backoff doubles and stays capped', () => {
    expect(backoffMs(1, RETRY, () => 0)).toBe(1);
    expect(backoffMs(2, RETRY, () => 0)).toBe(2);
    expect(backoffMs(9, RETRY, () => 0.5)).toBe(10);
  });

  test('retries 429, honours Retry-After and then succeeds', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const value = await withRetries(
      async (attempt) => {
        attempts = attempt;
        if (attempt < 3) throw httpError(429, { 'retry-after': '0' });
        return 'ok';
      },
      RETRY,
      { onRetry: ({ delayMs }) => delays.push(delayMs) },
    );
    expect(value).toBe('ok');
    expect(attempts).toBe(3);
    expect(delays).toEqual([0, 0]);
  });

  test('gives up after maxAttempts', async () => {
    let calls = 0;
    await expect(
      withRetries(
        async () => {
          calls++;
          throw httpError(500);
        },
        { ...RETRY, maxAttempts: 2 },
      ),
    ).rejects.toThrow('HTTP 500');
    expect(calls).toBe(2);
  });

  test('sleep rejects when the signal aborts', async () => {
    const controller = new AbortController();
    const waiting = sleep(5_000, controller.signal);
    controller.abort(new Error('cancelled'));
    await expect(waiting).rejects.toThrow('cancelled');
  });

  test('withTimeout aborts after the deadline and can be disposed', async () => {
    const handle = withTimeout(undefined, 5);
    expect(handle.signal.aborted).toBe(false);
    await sleep(20);
    expect(handle.didTimeout()).toBe(true);
    expect(handle.signal.aborted).toBe(true);
    handle.dispose();
  });
});
