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
