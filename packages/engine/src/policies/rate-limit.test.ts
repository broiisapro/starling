import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '@starling/core';
import { policyLogPayload, policyMessage } from './log';
import { rateLimitSignal } from './rate-limit';

function event(kind: AgentEvent['kind'], data: Record<string, unknown>): AgentEvent {
  return { runId: 'r', taskKey: 'a', sessionId: 's', ts: 1, kind, data };
}

describe('rateLimitSignal', () => {
  test('accepts the runner’s tagged session.error', () => {
    const signal = rateLimitSignal(
      event('session.error', {
        reason: 'rate limited',
        rateLimited: true,
        provider: 'opencode-go',
        retryAfterMs: 2_000,
      }),
    );
    expect(signal).toEqual({
      provider: 'opencode-go',
      retryAfterMs: 2_000,
      detail: 'rate limited',
    });
  });

  test('recognises an untagged 429 or the usual phrases', () => {
    expect(rateLimitSignal(event('session.error', { status: 429 }))).toBeDefined();
    expect(
      rateLimitSignal(event('session.error', { message: 'Provider overloaded, retry later' }))?.detail,
    ).toContain('overloaded');
    expect(
      rateLimitSignal(event('session.error', { details: { status: 503, retryAfterMs: 700 } }))?.retryAfterMs,
    ).toBe(700);
  });

  test('ignores every other kind and ordinary errors', () => {
    expect(rateLimitSignal(event('text', { message: 'rate limit' }))).toBeUndefined();
    expect(rateLimitSignal(event('session.error', { message: 'ENOENT' }))).toBeUndefined();
  });
});

describe('policy log payloads', () => {
  test('carry a stable code and keep the human message readable', () => {
    const payload = policyLogPayload('budget.stop', 'warn', policyMessage('budget.stop', 'cap hit'));
    expect(payload).toEqual({ level: 'warn', msg: '[budget.stop] cap hit', code: 'budget.stop' });
  });

  test('attach the task key only when there is one', () => {
    expect(policyLogPayload('stall.detected', 'warn', 'x', 'a').taskKey).toBe('a');
    expect(policyLogPayload('stall.detected', 'warn', 'x').taskKey).toBeUndefined();
  });
});
