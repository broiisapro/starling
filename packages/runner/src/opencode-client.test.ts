import { describe, expect, test } from 'bun:test';
import { StarlingError } from '@starling/core';
import { OpencodeClient, parseRetryAfterMs } from './opencode/client';

/** Bun's native fetch: apps/web's happy-dom global must not leak into an HTTP test (L26). */
const NATIVE_FETCH: typeof fetch = Bun.fetch;

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown>;
  authorization: string | null;
  directory: string | null;
}

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

function startFakeServer(handler: (call: Call) => Reply) {
  const calls: Call[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const url = new URL(request.url);
      let body: Record<string, unknown> = {};
      try {
        const parsed: unknown = await request.json();
        if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>;
      } catch {
        body = {};
      }
      const call: Call = {
        method: request.method,
        path: url.pathname,
        body,
        authorization: request.headers.get('authorization'),
        directory: request.headers.get('x-opencode-directory'),
      };
      calls.push(call);
      const reply = handler(call);
      return new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200,
        headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
      });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    calls,
    close: () => server.stop(true),
  };
}

describe('OpencodeClient — the one V2 client', () => {
  test('completes the throwaway-session recipe the LLM provider needs', async () => {
    const server = startFakeServer((call) => {
      if (call.method === 'POST' && call.path === '/api/session') {
        return { body: { data: { id: 'ses_9' } } };
      }
      if (call.path === '/api/session/ses_9/generate') return { body: { data: { text: 'answer' } } };
      if (call.method === 'GET' && call.path === '/api/session/ses_9') {
        return { body: { data: { tokens: { input: 12, output: 3, cache: { read: 2 } } } } };
      }
      if (call.method === 'DELETE') return { status: 204 };
      return { status: 500, body: { error: 'unexpected' } };
    });
    try {
      const client = new OpencodeClient({
        baseUrl: server.baseUrl,
        password: 'pw',
        fetch: NATIVE_FETCH,
      });
      const session = await client.createSession({
        title: 'probe',
        model: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' },
        agent: 'plan',
      });
      const text = await client.generate(session.id, { prompt: 'hello' });
      const info = await client.sessionInfo(session.id);
      await client.deleteSession(session.id);

      expect(session.id).toBe('ses_9');
      expect(text).toBe('answer');
      expect(info.tokens?.input).toBe(12);
      expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
        'POST /api/session',
        'POST /api/session/ses_9/generate',
        'GET /api/session/ses_9',
        'DELETE /api/session/ses_9',
      ]);
      expect(server.calls[0]?.body).toEqual({
        title: 'probe',
        model: { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' },
        agent: 'plan',
      });
      expect(server.calls[0]?.authorization).toBe(`Basic ${btoa('opencode:pw')}`);
    } finally {
      server.close();
    }
  });

  test('createSession scopes the session to a directory and sends the per-client header', async () => {
    const server = startFakeServer(() => ({ body: { data: { id: 'ses_1' } } }));
    try {
      const client = new OpencodeClient({ baseUrl: server.baseUrl, fetch: NATIVE_FETCH });
      await client.createSession({ directory: '/tmp/work', title: 't' });
      expect(server.calls[0]?.body.location).toEqual({ directory: '/tmp/work' });
      expect(server.calls[0]?.directory).toBe('/tmp/work');
    } finally {
      server.close();
    }
  });

  test('a 429 carries rateLimited and the server retry-after in the error details', async () => {
    const server = startFakeServer(() => ({
      status: 429,
      headers: { 'retry-after': '2' },
      body: { error: 'slow down' },
    }));
    try {
      const client = new OpencodeClient({ baseUrl: server.baseUrl, fetch: NATIVE_FETCH });
      let error: unknown;
      try {
        await client.createSession({ directory: '/tmp/work' });
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(StarlingError);
      if (error instanceof StarlingError) {
        expect(error.code).toBe('RUNNER_ERROR');
        expect(error.details?.status).toBe(429);
        expect(error.details?.rateLimited).toBe(true);
        expect(error.details?.retryAfterMs).toBe(2_000);
      }
    } finally {
      server.close();
    }
  });

  test('generate rejects a response that carries no text', async () => {
    const server = startFakeServer(() => ({ body: { data: {} } }));
    try {
      const client = new OpencodeClient({ baseUrl: server.baseUrl, fetch: NATIVE_FETCH });
      await expect(client.generate('ses_1', { prompt: 'x' })).rejects.toThrow(/no text/);
    } finally {
      server.close();
    }
  });

  test('parseRetryAfterMs understands seconds, HTTP dates and nonsense', () => {
    expect(parseRetryAfterMs('3', 0)).toBe(3_000);
    expect(parseRetryAfterMs('999999', 0)).toBe(120_000);
    expect(parseRetryAfterMs(null, 0)).toBeUndefined();
    expect(parseRetryAfterMs('not a date', 0)).toBeUndefined();
    const now = Date.parse('2026-10-27T12:00:00Z');
    expect(parseRetryAfterMs('Tue, 27 Oct 2026 12:00:05 GMT', now)).toBe(5_000);
  });
});
