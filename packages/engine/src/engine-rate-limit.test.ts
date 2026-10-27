import { describe, expect, test } from 'bun:test';
import type { MockScriptContext } from '@starling/core/testing';
import { immediateScheduler, MockNode, makeTaskSpec } from '@starling/core/testing';
import { buildHarness, smallPlan } from './testing/harness';

const STARTED = { kind: 'session.started' as const, data: {} };

function rateLimitedNode(): MockNode {
  return new MockNode({
    id: 'hub',
    info: { kind: 'local', maxSessions: 8 },
    schedule: immediateScheduler,
    events: () => [
      STARTED,
      {
        kind: 'session.error',
        data: {
          reason: 'provider rate limit',
          rateLimited: true,
          provider: 'opencode-go',
          retryAfterMs: 1_500,
        },
      },
      { kind: 'session.idle', data: {} },
    ],
  });
}

describe('rate-limit policy (AIMD)', () => {
  test('halves effective parallelism on a provider rate limit and logs both actions', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [rateLimitedNode()],
      config: { maxParallel: 8 },
    });
    const run = await h.finish();

    expect(run.tasks.a?.status).toBe('merged');
    const backoff = h.policyLogs('rate-limit.backoff');
    expect(backoff).toHaveLength(1);
    expect(backoff[0]?.msg).toContain('opencode-go');
    expect(backoff[0]?.msg).toContain('1500 ms');

    const reduced = h.policyLogs('parallelism.reduced');
    expect(reduced).toHaveLength(1);
    expect(reduced[0]?.msg).toContain('8 → 4');
    // The provider has not been quiet for the recovery window yet.
    expect(h.policyLogs('parallelism.increased')).toHaveLength(0);
  });

  test('grows back by one per landed task after the quiet window', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [rateLimitedNode()],
      config: { maxParallel: 8 },
      policies: { rateLimitRecoverMs: 0 },
    });
    const run = await h.finish();
    expect(run.tasks.a?.status).toBe('merged');
    const increased = h.policyLogs('parallelism.increased');
    expect(increased).toHaveLength(1);
    expect(increased[0]?.msg).toContain('4 → 5');
  });

  test('an ordinary agent error does not shrink parallelism', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [
        new MockNode({
          id: 'hub',
          schedule: immediateScheduler,
          events: () => [
            STARTED,
            { kind: 'session.error', data: { name: 'ToolError', message: 'ENOENT' } },
            { kind: 'session.idle', data: {} },
          ],
        }),
      ],
    });
    await h.finish();
    expect(h.policyLogs('parallelism.reduced')).toHaveLength(0);
    expect(h.policyLogs('rate-limit.backoff')).toHaveLength(0);
  });

  test('a ScriptContext-shaped session.error without flags is still recognised by text', async () => {
    const h = buildHarness({
      plan: smallPlan([makeTaskSpec({ key: 'a' })]),
      nodes: [
        new MockNode({
          id: 'hub',
          schedule: immediateScheduler,
          events: (_ctx: MockScriptContext) => [
            STARTED,
            { kind: 'session.error', data: { message: '429 Too Many Requests' } },
            { kind: 'session.idle', data: {} },
          ],
        }),
      ],
      config: { maxParallel: 2 },
    });
    await h.finish();
    expect(h.policyLogs('rate-limit.backoff')).toHaveLength(1);
    expect(h.policyLogs('parallelism.reduced')[0]?.msg).toContain('2 → 1');
  });
});
