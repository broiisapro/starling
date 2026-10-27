/**
 * Real opencode, real model. Skipped unless `STARLING_LIVE=1` (AGENTS.md §4 / L23).
 * Not run in Wave 1 — kept as the smoke test for the day the runner meets a real agent.
 */
import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import type { AgentEvent } from '@starling/core';
import { createOpencodeRunner } from '../src';

const live = process.env.STARLING_LIVE === '1';

describe.skipIf(!live)('opencode runner (live)', () => {
  test('spawns opencode serve and completes one tiny prompt', async () => {
    const runner = createOpencodeRunner({
      mode: 'spawn',
      password: crypto.randomUUID(),
      startupTimeoutMs: 60_000,
      textDebounceMs: 200,
    });

    const events: AgentEvent[] = [];
    const idle = new Promise<AgentEvent>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('agent did not idle in 120 s')), 120_000);
      runner.onEvent((event) => {
        events.push(event);
        if (event.kind === 'session.idle' || event.kind === 'session.error') {
          clearTimeout(timer);
          resolve(event);
        }
      });
    });

    try {
      expect(await runner.health()).toBe(true);
      const { sessionId } = await runner.start({
        runId: 'run_live',
        taskKey: 't-live',
        dir: tmpdir(),
        prompt: 'Reply with the single word: pong. Do not use any tools.',
        model: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
        title: 'Live smoke test',
      });
      expect(sessionId.startsWith('ses')).toBe(true);

      const terminal = await idle;
      expect(terminal.kind).toBe('session.idle');
      expect(events.some((event) => event.kind === 'text')).toBe(true);
    } finally {
      await runner.close();
    }
  }, 180_000);
});
