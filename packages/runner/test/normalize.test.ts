import { describe, expect, test } from 'bun:test';
import type { AgentEventKind } from '@starling/core';
import { EventNormalizer } from '../src/opencode/normalize';
import type { OpencodeEventEnvelope } from '../src/opencode/types';
import type { ScheduledTask, Scheduler } from '../src/schedule';

interface ManualScheduler {
  schedule: Scheduler;
  runAll(): void;
  pending(): number;
  delays(): number[];
}

function manualScheduler(): ManualScheduler {
  let tasks: Array<{ task: ScheduledTask; fn: () => void; delayMs: number; cancelled: boolean }> = [];
  return {
    schedule(fn, delayMs) {
      const entry = {
        fn,
        delayMs,
        cancelled: false,
        task: { cancel: () => {} },
      };
      entry.task = {
        cancel: () => {
          entry.cancelled = true;
        },
      };
      tasks.push(entry);
      return entry.task;
    },
    runAll() {
      const current = tasks;
      tasks = [];
      for (const entry of current) if (!entry.cancelled) entry.fn();
    },
    pending() {
      return tasks.filter((entry) => !entry.cancelled).length;
    },
    delays() {
      return tasks.filter((entry) => !entry.cancelled).map((entry) => entry.delayMs);
    },
  };
}

interface Captured {
  sessionId: string;
  kind: AgentEventKind;
  data: Record<string, unknown>;
}

function setup(textDebounceMs = 500) {
  const scheduler = manualScheduler();
  const captured: Captured[] = [];
  const normalizer = new EventNormalizer({
    textDebounceMs,
    schedule: scheduler.schedule,
    emit: (sessionId, kind, data) => captured.push({ sessionId, kind, data }),
  });
  return { normalizer, scheduler, captured };
}

function event(type: string, data: Record<string, unknown>): OpencodeEventEnvelope {
  return { id: `evt_${type}`, type, data };
}

function delta(sessionId: string, text: string, partID = 'prt_1'): OpencodeEventEnvelope {
  return event('message.part.delta', {
    sessionID: sessionId,
    messageID: 'msg_1',
    partID,
    field: 'text',
    delta: text,
  });
}

describe('EventNormalizer', () => {
  test('register emits session.started immediately with title and model', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1', { title: 'Task', model: { provider: 'deepseek', model: 'v4' } });
    expect(captured).toEqual([
      {
        sessionId: 'ses_1',
        kind: 'session.started',
        data: { title: 'Task', model: { provider: 'deepseek', model: 'v4' } },
      },
    ]);
  });

  test('merges text deltas and emits at most one text event per debounce window', () => {
    const { normalizer, scheduler, captured } = setup(500);
    normalizer.register('ses_1');
    normalizer.markPromptSent('ses_1');
    normalizer.handle(delta('ses_1', 'hel'));
    normalizer.handle(delta('ses_1', 'lo'));
    expect(captured.map((entry) => entry.kind)).toEqual(['session.started']);
    expect(scheduler.delays()).toEqual([500]);

    scheduler.runAll();
    expect(captured.at(-1)).toMatchObject({ kind: 'text', data: { text: 'hello' } });

    normalizer.handle(delta('ses_1', ' world'));
    expect(scheduler.pending()).toBe(1);
    scheduler.runAll();
    expect(captured.at(-1)).toMatchObject({ kind: 'text', data: { text: ' world' } });
  });

  test('flushes pending text before idle', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1');
    normalizer.markPromptSent('ses_1');
    normalizer.handle(delta('ses_1', 'almost done'));
    normalizer.handle(event('session.idle', { sessionID: 'ses_1' }));
    expect(captured.map((entry) => entry.kind)).toEqual(['session.started', 'text', 'session.idle']);
    expect(captured[1]?.data).toEqual({ text: 'almost done' });
  });

  test('recovers text from part.updated when a server sends no deltas', () => {
    const { normalizer, scheduler, captured } = setup();
    normalizer.register('ses_1');
    normalizer.markPromptSent('ses_1');
    normalizer.handle(
      event('message.part.updated', {
        sessionID: 'ses_1',
        part: {
          id: 'prt_9',
          type: 'text',
          text: 'from parts',
          time: { start: 1, end: 2 },
        },
      }),
    );
    // The suffix was buffered, then the ended part flushed it immediately.
    expect(captured.at(-1)).toMatchObject({ kind: 'text', data: { text: 'from parts' } });
    expect(scheduler.pending()).toBe(0);
  });

  test('maps tool parts to tool.call and tool.result', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1');
    normalizer.handle(
      event('message.part.updated', {
        sessionID: 'ses_1',
        part: {
          id: 'prt_t',
          type: 'tool',
          callID: 'call_1',
          tool: 'bash',
          state: { status: 'running', input: { command: 'ls' } },
        },
      }),
    );
    normalizer.handle(
      event('message.part.updated', {
        sessionID: 'ses_1',
        part: {
          id: 'prt_t',
          type: 'tool',
          callID: 'call_1',
          tool: 'bash',
          state: { status: 'completed', input: { command: 'ls' }, output: 'a.txt' },
        },
      }),
    );
    expect(captured.slice(1)).toEqual([
      {
        sessionId: 'ses_1',
        kind: 'tool.call',
        data: { tool: 'bash', args: { command: 'ls' }, callId: 'call_1' },
      },
      {
        sessionId: 'ses_1',
        kind: 'tool.result',
        data: { tool: 'bash', ok: true, summary: 'a.txt', callId: 'call_1' },
      },
    ]);
  });

  test('a completed tool that was never announced still produces a call first', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1');
    normalizer.handle(
      event('message.part.updated', {
        sessionID: 'ses_1',
        part: {
          id: 'prt_t',
          type: 'tool',
          callID: 'call_2',
          tool: 'edit',
          state: { status: 'error', input: {}, error: 'permission denied' },
        },
      }),
    );
    expect(captured.map((entry) => entry.kind)).toEqual(['session.started', 'tool.call', 'tool.result']);
    expect(captured.at(-1)?.data).toMatchObject({ ok: false, summary: 'permission denied' });
  });

  test('emits usage from step-finish and file.edited from the dedicated event', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1', { directory: '/tmp/wt' });
    normalizer.handle(
      event('message.part.updated', {
        sessionID: 'ses_1',
        part: {
          id: 'prt_s',
          type: 'step-finish',
          cost: 0.002,
          tokens: { input: 100, output: 20, reasoning: 3, cache: { read: 40, write: 0 } },
        },
      }),
    );
    normalizer.handle({
      ...event('file.edited', { file: 'src/app.ts' }),
      location: { directory: '/tmp/wt' },
    });
    expect(captured.slice(1)).toEqual([
      {
        sessionId: 'ses_1',
        kind: 'usage',
        data: { input: 100, output: 20, cached: 40, costUsd: 0.002 },
      },
      { sessionId: 'ses_1', kind: 'file.edited', data: { path: 'src/app.ts' } },
    ]);
  });

  test('idle is emitted once per turn and resync fills a missed idle', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1');
    normalizer.markPromptSent('ses_1');
    normalizer.handle(event('session.idle', { sessionID: 'ses_1' }));
    normalizer.handle(event('session.idle', { sessionID: 'ses_1' }));
    expect(captured.filter((entry) => entry.kind === 'session.idle')).toHaveLength(1);

    normalizer.markPromptSent('ses_1');
    normalizer.resync(new Set());
    expect(captured.filter((entry) => entry.kind === 'session.idle')).toHaveLength(2);
    normalizer.resync(new Set());
    expect(captured.filter((entry) => entry.kind === 'session.idle')).toHaveLength(2);
  });

  test('an error ends the turn: session.error then session.idle', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1');
    normalizer.markPromptSent('ses_1');
    normalizer.handle(
      event('session.error', {
        sessionID: 'ses_1',
        error: { name: 'ProviderAuthError', data: { message: 'bad key' } },
      }),
    );
    expect(captured.slice(1)).toEqual([
      {
        sessionId: 'ses_1',
        kind: 'session.error',
        data: { name: 'ProviderAuthError', message: 'bad key' },
      },
      { sessionId: 'ses_1', kind: 'session.idle', data: {} },
    ]);
  });

  test('ignores sessions it never registered', () => {
    const { normalizer, captured } = setup();
    normalizer.handle(delta('ses_unknown', 'hi'));
    normalizer.handle(event('session.idle', { sessionID: 'ses_unknown' }));
    expect(captured).toEqual([]);
  });
});

/**
 * The live 2.1.2 vocabulary (captured from a real `opencode serve`): a turn streams
 * `session.text.*`, `session.step.*`, `session.tool.*` and `session.usage.updated` instead of the
 * `message.part.*` family the recorded fixtures use.
 */
describe('EventNormalizer (opencode 2.1.2 streaming events)', () => {
  test('session.text.delta produces debounced text, like message.part.delta', () => {
    const { normalizer, scheduler, captured } = setup(500);
    normalizer.register('ses_1');
    normalizer.markPromptSent('ses_1');
    normalizer.handle(event('session.text.delta', { sessionID: 'ses_1', delta: 'quack' }));
    expect(captured.map((entry) => entry.kind)).toEqual(['session.started']);
    scheduler.runAll();
    expect(captured.at(-1)).toMatchObject({ kind: 'text', data: { text: 'quack' } });
  });

  test('session.text.ended alone still lands the text after a reconnect', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1');
    normalizer.markPromptSent('ses_1');
    normalizer.handle(event('session.text.ended', { sessionID: 'ses_1', text: 'recovered' }));
    expect(captured.at(-1)).toMatchObject({ kind: 'text', data: { text: 'recovered' } });
  });

  test('session.usage.updated carries tokens, cost and the step model', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1');
    normalizer.handle(
      event('session.step.started', {
        sessionID: 'ses_1',
        model: { id: 'deepseek-v4.1-flash', providerID: 'opencode-go', variant: 'default' },
      }),
    );
    expect(captured.at(-1)).toMatchObject({
      kind: 'session.started',
      data: { model: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } },
    });

    normalizer.handle(
      event('session.usage.updated', {
        sessionID: 'ses_1',
        cost: 0.001,
        tokens: { input: 6742, output: 4, reasoning: 0, cache: { read: 1408, write: 0 } },
      }),
    );
    expect(captured.at(-1)).toMatchObject({
      kind: 'usage',
      data: {
        input: 6742,
        output: 4,
        cached: 1408,
        costUsd: 0.001,
        model: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
      },
    });
  });

  test('a step ending does not bill the turn twice', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1');
    const tokens = { input: 10, output: 2, cache: { read: 0, write: 0 } };
    normalizer.handle(event('session.usage.updated', { sessionID: 'ses_1', tokens, cost: 0 }));
    normalizer.handle(event('session.step.ended', { sessionID: 'ses_1', tokens, cost: 0 }));
    expect(captured.filter((entry) => entry.kind === 'usage')).toHaveLength(1);
  });

  test('session.tool.* maps to one tool.call and one tool.result', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1');
    normalizer.handle(
      event('session.tool.input.started', { sessionID: 'ses_1', id: 'call_1', name: 'shell' }),
    );
    normalizer.handle(
      event('session.tool.called', {
        sessionID: 'ses_1',
        id: 'call_1',
        name: 'shell',
        input: { command: 'ls' },
      }),
    );
    normalizer.handle(
      event('session.tool.success', {
        sessionID: 'ses_1',
        id: 'call_1',
        name: 'shell',
        content: [{ type: 'text', text: 'a.ts\nb.ts' }],
      }),
    );
    expect(captured.filter((entry) => entry.kind === 'tool.call')).toHaveLength(1);
    expect(captured.filter((entry) => entry.kind === 'tool.result')).toEqual([
      {
        sessionId: 'ses_1',
        kind: 'tool.result',
        data: { tool: 'shell', ok: true, summary: 'a.ts\nb.ts', callId: 'call_1' },
      },
    ]);
  });

  test('reasoning and step.streamed are not part of the vocabulary', () => {
    const { normalizer, captured } = setup();
    normalizer.register('ses_1');
    normalizer.handle(event('session.reasoning.delta', { sessionID: 'ses_1', delta: 'thinking' }));
    normalizer.handle(event('session.step.streamed', { sessionID: 'ses_1' }));
    expect(captured.map((entry) => entry.kind)).toEqual(['session.started']);
  });
});
