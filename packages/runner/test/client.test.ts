import { afterEach, describe, expect, test } from 'bun:test';
import { StarlingError } from '@starling/core';
import { OpencodeClient } from '../src';
import { createFakeOpencodeServer } from './fake-opencode';
import { TEST_MODEL } from './helpers';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function setup(password = 'pw') {
  const server = createFakeOpencodeServer({ password, onPrompt: () => {} });
  cleanups.push(() => server.close());
  return { server, client: new OpencodeClient({ baseUrl: server.url, password }) };
}

describe('OpencodeClient', () => {
  test('creates a session with location, model and the directory header', async () => {
    const { server, client } = setup();
    const session = await client.createSession({
      directory: '/tmp/wt',
      title: 'CSV export',
      model: TEST_MODEL,
    });

    expect(session.id.startsWith('ses_')).toBe(true);
    const request = server.requests.find((entry) => entry.path === '/api/session');
    expect(request?.body).toEqual({
      title: 'CSV export',
      location: { directory: '/tmp/wt' },
      model: { providerID: 'deepseek', id: 'deepseek-v4.1-flash' },
    });
    expect(request?.headers['x-opencode-directory']).toBe('/tmp/wt');
  });

  test('prompts, reports active sessions and interrupts', async () => {
    const { server, client } = setup();
    const session = await client.createSession({ directory: '/tmp/wt' });

    await client.prompt(session.id, 'hello', '/tmp/wt');
    expect(server.prompts[0]).toEqual({
      sessionId: session.id,
      text: 'hello',
      directory: '/tmp/wt',
    });
    expect(await client.activeSessions()).toEqual({ [session.id]: { type: 'running' } });

    expect(await client.interrupt(session.id, '/tmp/wt')).toBe(true);
    expect(server.interrupts).toEqual([session.id]);
    expect(await client.interrupt(session.id)).toBe(false);
  });

  test('reads server info', async () => {
    const { client } = setup();
    expect(await client.serverInfo()).toMatchObject({ version: '2.1.2-fake', pid: process.pid });
  });

  describe('generateStateless', () => {
    test('answers without creating a session', async () => {
      const server = createFakeOpencodeServer({
        password: 'pw',
        onGenerateStateless: () => ({ text: '{"ok":true}' }),
      });
      cleanups.push(() => server.close());
      const client = new OpencodeClient({ baseUrl: server.url, password: 'pw' });

      const text = await client.generateStateless({
        prompt: 'Answer in JSON',
        providerID: 'opencode-go',
        modelID: 'deepseek-v4.1-flash',
        directory: '/tmp/wt',
      });

      expect(text).toBe('{"ok":true}');
      expect(server.sessions.size).toBe(0);
      const request = server.requests.find((entry) => entry.path === '/api/experimental/generate');
      expect(request?.body).toEqual({
        prompt: 'Answer in JSON',
        model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' },
      });
      expect(request?.headers['x-opencode-directory']).toBe('/tmp/wt');
      expect(request?.headers.authorization).toBe(`Basic ${btoa('opencode:pw')}`);
    });

    test('returns undefined on an older server that lacks the route', async () => {
      const { server, client } = setup();
      expect(
        await client.generateStateless({
          prompt: 'hi',
          providerID: 'opencode-go',
          modelID: 'deepseek-v4.1-flash',
        }),
      ).toBeUndefined();
      expect(server.requests.some((entry) => entry.path === '/api/experimental/generate')).toBe(true);
      expect(server.sessions.size).toBe(0);
    });

    test('returns undefined when the server refuses or answers without text', async () => {
      const refusing = createFakeOpencodeServer({
        onGenerateStateless: () => ({ status: 503 }),
      });
      cleanups.push(() => refusing.close());
      const refusingClient = new OpencodeClient({ baseUrl: refusing.url });
      expect(
        await refusingClient.generateStateless({
          prompt: 'hi',
          providerID: 'opencode-go',
          modelID: 'deepseek-v4.1-flash',
        }),
      ).toBeUndefined();

      const empty = createFakeOpencodeServer({ onGenerateStateless: () => ({}) });
      cleanups.push(() => empty.close());
      const emptyClient = new OpencodeClient({ baseUrl: empty.url });
      expect(
        await emptyClient.generateStateless({
          prompt: 'hi',
          providerID: 'opencode-go',
          modelID: 'deepseek-v4.1-flash',
        }),
      ).toBeUndefined();
      expect(empty.requests.map((entry) => entry.path)).toEqual(['/api/experimental/generate']);
    });

    test('returns an explicitly empty answer as text, not as a refusal', async () => {
      const server = createFakeOpencodeServer({ onGenerateStateless: () => ({ text: '' }) });
      cleanups.push(() => server.close());
      const client = new OpencodeClient({ baseUrl: server.url });
      expect(
        await client.generateStateless({
          prompt: 'hi',
          providerID: 'opencode-go',
          modelID: 'deepseek-v4.1-flash',
        }),
      ).toBe('');
    });

    test('throws a RUNNER_ERROR when the server cannot be reached', async () => {
      const client = new OpencodeClient({ baseUrl: 'http://127.0.0.1:1' });
      await expect(
        client.generateStateless({
          prompt: 'hi',
          providerID: 'opencode-go',
          modelID: 'deepseek-v4.1-flash',
        }),
      ).rejects.toMatchObject({ code: 'RUNNER_ERROR' });
    });
  });

  test('maps a non-2xx response to a StarlingError', async () => {
    const { client } = setup();
    await expect(client.prompt('ses_missing', 'hi')).rejects.toMatchObject({
      code: 'RUNNER_ERROR',
    });
  });

  test('rejects a wrong password', async () => {
    const { server } = setup('right');
    const client = new OpencodeClient({ baseUrl: server.url, password: 'wrong' });
    await expect(client.serverInfo()).rejects.toBeInstanceOf(StarlingError);
    expect(server.authFailures).toBeGreaterThan(0);
  });

  test('refuses to open the event stream when unauthorised', async () => {
    const { server } = setup('right');
    const client = new OpencodeClient({ baseUrl: server.url, password: 'wrong' });
    await expect(client.openEventStream(AbortSignal.timeout(1_000))).rejects.toBeInstanceOf(StarlingError);
  });

  test('reports malformed SSE frames instead of throwing', () => {
    const malformed: string[] = [];
    const client = new OpencodeClient({
      baseUrl: 'http://127.0.0.1:1',
      onMalformedFrame: (raw) => malformed.push(raw),
    });

    expect(client.parseEvent('not json')).toBeUndefined();
    expect(client.parseEvent('{"no":"type"}')).toBeUndefined();
    expect(malformed).toEqual(['not json', '{"no":"type"}']);
    expect(client.parseEvent('{"type":"session.idle","data":{}}')).toEqual({
      type: 'session.idle',
      data: {},
    });
  });
});
