import { afterEach, describe, expect, test } from 'bun:test';
import { StarlingError } from '@starling/core';
import type { OpencodeRunner } from '../src';
import { createOpencodeRunner } from '../src';
import type { FakeOpencodeServer, FakePromptHandler } from './fake-opencode';
import { createFakeOpencodeServer } from './fake-opencode';
import { collectEvents, delay, startArgs } from './helpers';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

function setup(
  options: {
    password?: string;
    onPrompt?: FakePromptHandler;
    textDebounceMs?: number;
    maxConcurrentPrompts?: number;
    reconnectMinMs?: number;
  } = {},
): { server: FakeOpencodeServer; runner: OpencodeRunner } {
  const password = options.password ?? 'test-pw';
  const server = createFakeOpencodeServer({ password, onPrompt: options.onPrompt });
  const runner = createOpencodeRunner({
    mode: 'attach',
    url: server.url,
    password,
    textDebounceMs: options.textDebounceMs ?? 20,
    maxConcurrentPrompts: options.maxConcurrentPrompts ?? 8,
    reconnect: { minMs: options.reconnectMinMs ?? 10, maxMs: 50 },
  });
  cleanups.push(async () => {
    await runner.close();
    server.close();
  });
  return { server, runner };
}

describe('createOpencodeRunner (attach mode, fake server)', () => {
  test('start creates a directory-scoped session, streams normalised events and idles', async () => {
    const { server, runner } = setup();
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    const { sessionId } = await runner.start(startArgs({ dir: '/tmp/wt-a', title: 'CSV export' }));
    expect(sessionId.startsWith('ses_')).toBe(true);

    await collector.waitFor('session.idle');

    expect(collector.kinds()).toEqual([
      'session.started',
      'text',
      'tool.call',
      'tool.result',
      'file.edited',
      'usage',
      'session.idle',
    ]);
    expect(collector.events.every((event) => event.runId === 'run_test')).toBe(true);
    expect(collector.events.every((event) => event.taskKey === 't01-test')).toBe(true);
    expect(collector.events.every((event) => event.sessionId === sessionId)).toBe(true);

    const create = server.requests.find(
      (request) => request.method === 'POST' && request.path === '/api/session',
    );
    expect(create?.body).toMatchObject({
      title: 'CSV export',
      location: { directory: '/tmp/wt-a' },
      model: { providerID: 'deepseek', id: 'deepseek-v4.1-flash' },
    });
    expect(create?.headers['x-opencode-directory']).toBe('/tmp/wt-a');
    expect(create?.headers.authorization?.startsWith('Basic ')).toBe(true);

    expect(server.prompts).toEqual([{ sessionId, text: 'do the thing', directory: '/tmp/wt-a' }]);
    expect(collector.events.find((event) => event.kind === 'usage')?.data).toEqual({
      input: 120,
      output: 30,
      cached: 5,
      costUsd: 0.0012,
    });
  });

  test('send continues the same session and produces a second idle', async () => {
    const { server, runner } = setup();
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    const { sessionId } = await runner.start(startArgs());
    const firstIdle = await collector.waitFor('session.idle');

    await runner.send(sessionId, 'now fix the audit');
    await collector.waitFor((event) => event.kind === 'session.idle' && event !== firstIdle);

    expect(server.prompts.map((prompt) => prompt.text)).toEqual(['do the thing', 'now fix the audit']);
    expect(collector.events.filter((event) => event.kind === 'session.idle')).toHaveLength(2);
    expect(collector.events.every((event) => event.sessionId === sessionId)).toBe(true);
  });

  test('abort interrupts the turn and unblocks with an idle', async () => {
    const { server, runner } = setup({
      onPrompt: ({ sessionId, emit, setActive }) => {
        emit({
          type: 'message.part.delta',
          data: { sessionID: sessionId, messageID: 'm', partID: 'p', field: 'text', delta: 'working' },
        });
        setActive(true);
      },
    });
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    const { sessionId } = await runner.start(startArgs());
    await collector.waitFor('text');

    await runner.abort(sessionId);
    await collector.waitFor('session.idle');

    expect(server.interrupts).toEqual([sessionId]);
    expect(server.active.has(sessionId)).toBe(false);
  });

  test('a session.error is surfaced and followed by an idle', async () => {
    const { runner } = setup({
      onPrompt: ({ sessionId, emit, setActive }) => {
        setActive(false);
        emit({
          type: 'session.error',
          data: {
            sessionID: sessionId,
            error: { name: 'ProviderAuthError', data: { message: 'invalid api key' } },
          },
        });
      },
    });
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    await runner.start(startArgs());
    const error = await collector.waitFor('session.error');
    expect(error.data).toEqual({ name: 'ProviderAuthError', message: 'invalid api key' });
    await collector.waitFor('session.idle');
  });

  test('maxConcurrentPrompts queues the second turn until the first idles', async () => {
    let releaseFirst: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const { server, runner } = setup({
      maxConcurrentPrompts: 1,
      onPrompt: async ({ sessionId, emit, setActive, server: fake }) => {
        if (fake.prompts.length === 1) await gate;
        setActive(false);
        emit({ type: 'session.idle', data: { sessionID: sessionId } });
      },
    });
    const collector = collectEvents(runner);
    cleanups.push(() => collector.close());

    await runner.start(startArgs({ runId: 'run_a', taskKey: 't-a' }));
    await runner.start(startArgs({ runId: 'run_b', taskKey: 't-b' }));

    await delay(40);
    expect(server.prompts).toHaveLength(1);

    releaseFirst();
    await collector.waitFor((event) => event.kind === 'session.idle' && event.taskKey === 't-b');
    expect(server.prompts).toHaveLength(2);
  });

  test('health reflects the server and a closed runner refuses new work', async () => {
    const { runner } = setup();
    expect(await runner.health()).toBe(true);

    await runner.close();
    expect(await runner.health()).toBe(false);
    await expect(runner.start(startArgs())).rejects.toBeInstanceOf(StarlingError);
  });

  test('attach mode requires a url', () => {
    expect(() => createOpencodeRunner({ mode: 'attach' })).toThrow(StarlingError);
  });

  test('unknown sessions are rejected by send and abort', async () => {
    const { runner } = setup();
    await expect(runner.send('ses_missing', 'hi')).rejects.toBeInstanceOf(StarlingError);
    await expect(runner.abort('ses_missing')).rejects.toBeInstanceOf(StarlingError);
  });
});
