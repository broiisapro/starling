import { describe, expect, test } from 'bun:test';
import { StarlingError } from '@starling/core';
import { createOpencodeCompletionClient, DEFAULT_COMPLETION_TIMEOUT_MS } from './opencode.ts';

/**
 * Bun's native fetch.
 *
 * These tests drive a real `Bun.serve` fake over real HTTP, so they must not go through whatever
 * test file ran first: `apps/web`'s happy-dom `GlobalRegistrator` swaps the global `fetch` for a
 * browser emulation that rejects Bun's responses ("Duplicate Content-Length"). The router always
 * accepts an explicit fetch, so the test hands one over instead of trusting the global.
 */
const NATIVE_FETCH: typeof fetch = Bun.fetch;

interface OcRequest {
  method: string;
  path: string;
  body: Record<string, unknown>;
  authorization: string | null;
}

interface OcReply {
  status?: number;
  body?: unknown;
}

interface FakeOpencode {
  baseUrl: string;
  requests: OcRequest[];
  close(): void;
}

function startFakeOpencode(
  handler: (req: OcRequest, index: number) => OcReply | Promise<OcReply>,
): FakeOpencode {
  const requests: OcRequest[] = [];
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
      const entry: OcRequest = {
        method: request.method,
        path: url.pathname,
        body,
        authorization: request.headers.get('authorization'),
      };
      requests.push(entry);
      const reply = await handler(entry, requests.length - 1);
      const status = reply.status ?? 200;
      return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    requests,
    close: () => server.stop(true),
  };
}

const STATELESS = '/api/experimental/generate';

/** A server *without* the experimental route: it answers like an older 2.x build. */
function sessionOnly(req: OcRequest): OcReply {
  if (req.method === 'POST' && req.path === STATELESS) {
    return { status: 404, body: { _tag: 'NotFound', message: 'no such route' } };
  }
  if (req.method === 'POST' && req.path === '/api/session') return { body: { data: { id: 'ses_1' } } };
  if (req.method === 'POST' && req.path === '/api/session/ses_1/generate') {
    return { body: { data: { text: 'generated text' } } };
  }
  if (req.method === 'GET' && req.path === '/api/session/ses_1') {
    return { body: { data: { tokens: { input: 10, output: 5, cache: { read: 4, write: 0 } } } } };
  }
  if (req.method === 'DELETE' && req.path === '/api/session/ses_1') return { status: 204 };
  return { status: 500, body: { error: 'unexpected' } };
}

/** A 2.1.2+ server: the stateless route answers and no session is ever created. */
function statelessOnly(req: OcRequest): OcReply {
  if (req.method === 'POST' && req.path === STATELESS) {
    return { body: { data: { text: '{"ok":true}' } } };
  }
  return { status: 500, body: { error: 'the session path must not be used' } };
}

const REQUEST = {
  system: 'You plan.',
  prompt: 'Goal: ship it',
  providerID: 'opencode-go',
  modelID: 'deepseek-v4.1-flash',
};

/** The session path is the fallback, so every case starts with one stateless probe. */
function sessionRequests(server: FakeOpencode): OcRequest[] {
  return server.requests.filter((request) => request.path !== STATELESS);
}

describe('createOpencodeCompletionClient (V2 REST)', () => {
  describe('stateless generate first', () => {
    test('prefers the stateless route, with no session at all', async () => {
      const server = startFakeOpencode(statelessOnly);
      try {
        const client = createOpencodeCompletionClient({
          baseUrl: server.baseUrl,
          password: 'pw',
          fetch: NATIVE_FETCH,
        });
        const result = await client.complete(REQUEST);

        expect(result.text).toBe('{"ok":true}');
        // No session means no totals: the numbers are zeros and the flag says "unreported".
        expect(result.usage).toEqual({ input: 0, output: 0, cached: 0 });
        expect(result.usageKnown).toBe(false);
        expect(server.requests).toHaveLength(1);
        expect(server.requests[0]?.path).toBe(STATELESS);
        expect(server.requests[0]?.body.prompt).toBe('You plan.\n\nGoal: ship it');
        expect(server.requests[0]?.body.model).toEqual({
          providerID: 'opencode-go',
          id: 'deepseek-v4.1-flash',
        });
        expect(server.requests[0]?.authorization).toBe(`Basic ${btoa('opencode:pw')}`);
      } finally {
        server.close();
      }
    });

    test('returns an empty stateless answer instead of quietly using a session', async () => {
      const server = startFakeOpencode((req) =>
        req.path === STATELESS ? { body: { data: { text: '' } } } : { status: 500 },
      );
      try {
        const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl, fetch: NATIVE_FETCH });
        const result = await client.complete(REQUEST);
        expect(result.text).toBe('');
        expect(server.requests).toHaveLength(1);
      } finally {
        server.close();
      }
    });

    test('falls back to the session path when the route is missing', async () => {
      const server = startFakeOpencode(sessionOnly);
      try {
        const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl, fetch: NATIVE_FETCH });
        const result = await client.complete(REQUEST);

        expect(result.text).toBe('generated text');
        expect(result.usage).toEqual({ input: 10, output: 5, cached: 4 });
        expect(result.usageKnown).toBe(true);
        expect(server.requests[0]?.path).toBe(STATELESS);
        expect(sessionRequests(server).map((r) => `${r.method} ${r.path}`)).toEqual([
          'POST /api/session',
          'POST /api/session/ses_1/generate',
          'GET /api/session/ses_1',
          'DELETE /api/session/ses_1',
        ]);
      } finally {
        server.close();
      }
    });

    test('falls back on a refusal and on an envelope without text', async () => {
      for (const reply of [
        { status: 503, body: { _tag: 'ServiceUnavailableError' } },
        { body: { data: {} } },
        { body: { nope: true } },
      ]) {
        const server = startFakeOpencode((req) => (req.path === STATELESS ? reply : sessionOnly(req)));
        try {
          const client = createOpencodeCompletionClient({
            baseUrl: server.baseUrl,
            fetch: NATIVE_FETCH,
          });
          const result = await client.complete(REQUEST);
          expect(result.text).toBe('generated text');
        } finally {
          server.close();
        }
      }
    });

    test('maps an unreachable server to a retryable LLM_ERROR instead of falling back', async () => {
      const client = createOpencodeCompletionClient({
        baseUrl: 'http://127.0.0.1:1',
        fetch: NATIVE_FETCH,
        timeoutMs: 2_000,
      });
      let error: unknown;
      try {
        await client.complete(REQUEST);
      } catch (err) {
        error = err;
      }
      expect(error instanceof StarlingError).toBe(true);
      if (error instanceof StarlingError) {
        expect(error.code).toBe('LLM_ERROR');
        expect(error.details?.reason).toBe('opencode');
      }
    });

    test('gives a generation more time than the client’s control-plane default', () => {
      // Regression guard: the shared client defaults to 10 s, which killed the first C2 run — a
      // planner completion takes longer. The provider must pass its own (120 s) default.
      expect(DEFAULT_COMPLETION_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    });

    test('honours an explicit per-call timeout', async () => {
      const server = startFakeOpencode(async (req) => {
        if (req.path === STATELESS) {
          await Bun.sleep(200);
          return { body: { data: { text: 'late but fine' } } };
        }
        return sessionOnly(req);
      });
      try {
        const patient = createOpencodeCompletionClient({
          baseUrl: server.baseUrl,
          fetch: NATIVE_FETCH,
        });
        expect((await patient.complete(REQUEST)).text).toBe('late but fine');

        const impatient = createOpencodeCompletionClient({
          baseUrl: server.baseUrl,
          fetch: NATIVE_FETCH,
          timeoutMs: 20,
        });
        await expect(impatient.complete(REQUEST)).rejects.toMatchObject({ code: 'LLM_ERROR' });
      } finally {
        server.close();
      }
    });
  });

  describe('session fallback', () => {
    test('creates, generates, reads usage and deletes in order', async () => {
      const server = startFakeOpencode(sessionOnly);
      try {
        const client = createOpencodeCompletionClient({
          baseUrl: server.baseUrl,
          password: 'pw',
          fetch: NATIVE_FETCH,
        });
        const result = await client.complete(REQUEST);

        expect(result.text).toBe('generated text');
        expect(result.usage).toEqual({ input: 10, output: 5, cached: 4 });
        expect(sessionRequests(server)[0]?.body.model).toEqual({
          providerID: 'opencode-go',
          id: 'deepseek-v4.1-flash',
        });
        expect(sessionRequests(server)[1]?.body.prompt).toBe('You plan.\n\nGoal: ship it');
        expect(sessionRequests(server)[0]?.authorization).toBe(`Basic ${btoa('opencode:pw')}`);
      } finally {
        server.close();
      }
    });

    test('omits auth when no password is configured', async () => {
      const server = startFakeOpencode(sessionOnly);
      try {
        const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl, fetch: NATIVE_FETCH });
        await client.complete(REQUEST);
        expect(server.requests[0]?.authorization).toBeNull();
        expect(sessionRequests(server)[0]?.authorization).toBeNull();
      } finally {
        server.close();
      }
    });

    test('passes title, agent and directory through to the session', async () => {
      const server = startFakeOpencode(sessionOnly);
      try {
        const client = createOpencodeCompletionClient({
          baseUrl: server.baseUrl,
          title: 'probe',
          agent: 'plan',
          directory: '/tmp/work',
          fetch: NATIVE_FETCH,
        });
        await client.complete(REQUEST);
        expect(sessionRequests(server)[0]?.body.title).toBe('probe');
        expect(sessionRequests(server)[0]?.body.agent).toBe('plan');
        expect(sessionRequests(server)[0]?.body.location).toEqual({ directory: '/tmp/work' });
      } finally {
        server.close();
      }
    });

    test('still deletes the session when generation fails', async () => {
      const server = startFakeOpencode((req) => {
        if (req.path === STATELESS) return { status: 404 };
        if (req.method === 'POST' && req.path === '/api/session') return { body: { data: { id: 'ses_1' } } };
        if (req.path.endsWith('/generate')) return { status: 500, body: { error: 'boom' } };
        return { status: 204 };
      });
      try {
        const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl, fetch: NATIVE_FETCH });
        let error: unknown;
        try {
          await client.complete(REQUEST);
        } catch (err) {
          error = err;
        }
        expect(error instanceof StarlingError).toBe(true);
        if (error instanceof StarlingError) {
          expect(error.code).toBe('LLM_ERROR');
          expect(error.details?.status).toBe(500);
        }
        expect(server.requests.at(-1)?.method).toBe('DELETE');
      } finally {
        server.close();
      }
    });

    test('rejects a session without an id and does not attempt a generate', async () => {
      const server = startFakeOpencode((req) =>
        req.path === STATELESS ? { status: 404 } : { body: { data: {} } },
      );
      try {
        const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl, fetch: NATIVE_FETCH });
        await expect(client.complete(REQUEST)).rejects.toThrow(/session id/);
        expect(sessionRequests(server)).toHaveLength(1);
      } finally {
        server.close();
      }
    });

    test('rejects missing token usage instead of reporting free tokens', async () => {
      const server = startFakeOpencode((req) => {
        if (req.path === STATELESS) return { status: 404 };
        if (req.method === 'POST' && req.path === '/api/session') return { body: { data: { id: 'ses_1' } } };
        if (req.path === '/api/session/ses_1/generate') return { body: { data: { text: 'hi' } } };
        if (req.method === 'GET') return { body: { data: {} } };
        return { status: 204 };
      });
      try {
        const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl, fetch: NATIVE_FETCH });
        await expect(client.complete(REQUEST)).rejects.toThrow(/token usage/);
        expect(server.requests.at(-1)?.method).toBe('DELETE');
      } finally {
        server.close();
      }
    });

    test('reports cleanup failures without failing a successful completion', async () => {
      const errors: unknown[] = [];
      const server = startFakeOpencode((req) => {
        if (req.path === STATELESS) return { status: 404 };
        if (req.method === 'DELETE') return { status: 500, body: { error: 'nope' } };
        return sessionOnly(req);
      });
      try {
        const client = createOpencodeCompletionClient({
          baseUrl: server.baseUrl,
          onCleanupError: (err) => errors.push(err),
          fetch: NATIVE_FETCH,
        });
        const result = await client.complete(REQUEST);
        expect(result.text).toBe('generated text');
        expect(errors).toHaveLength(1);
      } finally {
        server.close();
      }
    });
  });
});
