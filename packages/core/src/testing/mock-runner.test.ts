import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../clock';
import type { AgentEvent } from '../contracts';
import { immediateScheduler, MockRunner } from './mock-runner';

const model = { provider: 'deepseek', model: 'deepseek-v4.1-flash' };

function startOptions(overrides: Partial<Parameters<MockRunner['start']>[0]> = {}) {
  return {
    runId: 'run-1',
    taskKey: 'theme',
    dir: '/mock/worktrees/theme',
    prompt: 'do the thing',
    model,
    title: 'Theme',
    ...overrides,
  };
}

describe('MockRunner', () => {
  test('start emits a full scripted sequence ending in session.idle', async () => {
    const runner = new MockRunner();
    const events: AgentEvent[] = [];
    runner.onEvent((e) => events.push(e));
    const { sessionId } = await runner.start(startOptions());
    await runner.flush();
    expect(sessionId).toBe('ses_mock_1');
    expect(events.at(-1)?.kind).toBe('session.idle');
    expect(events.map((e) => e.kind)).toEqual([
      'session.started',
      'text',
      'tool.call',
      'tool.result',
      'file.edited',
      'usage',
      'session.idle',
    ]);
    expect(events.every((e) => e.runId === 'run-1' && e.taskKey === 'theme')).toBe(true);
  });

  test('works with the immediate scheduler and a FakeClock', async () => {
    const clock = new FakeClock(1000);
    const runner = new MockRunner({ clock, schedule: immediateScheduler });
    const events: AgentEvent[] = [];
    runner.onEvent((e) => events.push(e));
    await runner.start(startOptions());
    await runner.flush();
    expect(events).toHaveLength(7);
    expect(events.every((e) => e.ts === 1000)).toBe(true);
  });

  test('send emits the fixer script with pass 2 and records the prompt', async () => {
    const runner = new MockRunner();
    const events: AgentEvent[] = [];
    runner.onEvent((e) => events.push(e));
    const { sessionId } = await runner.start(startOptions());
    await runner.flush();
    events.length = 0;
    await runner.send(sessionId, 'fix the failing test');
    await runner.flush();
    expect(runner.sentPrompts).toEqual([{ sessionId, prompt: 'fix the failing test' }]);
    expect(events.some((e) => e.kind === 'text' && String(e.data.text).includes('pass 2'))).toBe(true);
  });

  test('custom scripts can use the context', async () => {
    const runner = new MockRunner({
      events: (ctx) => [
        { kind: 'text', data: { text: `${ctx.taskKey}:${ctx.pass}` } },
        { kind: 'session.idle' },
      ],
    });
    const seen: AgentEvent[] = [];
    runner.onEvent((e) => seen.push(e));
    await runner.start(startOptions());
    await runner.flush();
    expect(seen[0]?.data.text).toBe('theme:1');
  });

  test('abort emits session.error', async () => {
    const runner = new MockRunner();
    const events: AgentEvent[] = [];
    runner.onEvent((e) => events.push(e));
    const { sessionId } = await runner.start(startOptions());
    await runner.abort(sessionId);
    expect(events.at(-1)?.kind).toBe('session.error');
    expect(events.at(-1)?.data.reason).toBe('aborted');
  });

  test('unsubscribe stops delivery, close rejects new work', async () => {
    const runner = new MockRunner();
    const events: AgentEvent[] = [];
    const unsub = runner.onEvent((e) => events.push(e));
    unsub();
    await runner.start(startOptions());
    await runner.flush();
    expect(events).toHaveLength(0);
    await runner.close();
    await expect(runner.start(startOptions())).rejects.toThrow('closed');
  });

  test('unknown sessions and unknown prompts fail loudly', async () => {
    const runner = new MockRunner();
    await expect(runner.send('ses_nope', 'hi')).rejects.toThrow('Unknown session');
  });
});
