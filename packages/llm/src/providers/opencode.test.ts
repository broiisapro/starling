import { describe, expect, test } from 'bun:test';
import { StarlingError } from '@starling/core';
import { createOpencodeCompletionClient } from './opencode.ts';

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

function happyPath(req: OcRequest): OcReply {
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

const REQUEST = {
  system: 'You plan.',
  prompt: 'Goal: ship it',
  providerID: 'opencode-go',
  modelID: 'deepseek-v4.1-flash',
};

describe('createOpencodeCompletionClient (V2 REST)', () => {
  test('creates, generates, reads usage and deletes in order', async () => {
    const server = startFakeOpencode(happyPath);
    try {
      const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl, password: 'pw' });
      const result = await client.complete(REQUEST);

      expect(result.text).toBe('generated text');
      expect(result.usage).toEqual({ input: 10, output: 5, cached: 4 });
      expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        'POST /api/session',
        'POST /api/session/ses_1/generate',
        'GET /api/session/ses_1',
        'DELETE /api/session/ses_1',
      ]);
      expect(server.requests[0]?.body.model).toEqual({
        id: 'deepseek-v4.1-flash',
        providerID: 'opencode-go',
      });
      expect(server.requests[1]?.body.prompt).toBe('You plan.\n\nGoal: ship it');
      expect(server.requests[0]?.authorization).toBe(`Basic ${btoa('opencode:pw')}`);
    } finally {
      server.close();
    }
  });

  test('omits auth when no password is configured', async () => {
    const server = startFakeOpencode(happyPath);
    try {
      const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl });
      await client.complete(REQUEST);
      expect(server.requests[0]?.authorization).toBeNull();
    } finally {
      server.close();
    }
  });

  test('passes title, agent and directory through to the session', async () => {
    const server = startFakeOpencode(happyPath);
    try {
      const client = createOpencodeCompletionClient({
        baseUrl: server.baseUrl,
        title: 'probe',
        agent: 'plan',
        directory: '/tmp/work',
      });
      await client.complete(REQUEST);
      expect(server.requests[0]?.body.title).toBe('probe');
      expect(server.requests[0]?.body.agent).toBe('plan');
      expect(server.requests[0]?.body.location).toEqual({ directory: '/tmp/work' });
    } finally {
      server.close();
    }
  });

  test('still deletes the session when generation fails', async () => {
    const server = startFakeOpencode((req) => {
      if (req.method === 'POST' && req.path === '/api/session') return { body: { data: { id: 'ses_1' } } };
      if (req.path.endsWith('/generate')) return { status: 500, body: { error: 'boom' } };
      return { status: 204 };
    });
    try {
      const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl });
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
    const server = startFakeOpencode(() => ({ body: { data: {} } }));
    try {
      const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl });
      await expect(client.complete(REQUEST)).rejects.toThrow(/session id/);
      expect(server.requests).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  test('rejects missing token usage instead of reporting free tokens', async () => {
    const server = startFakeOpencode((req) => {
      if (req.method === 'POST' && req.path === '/api/session') return { body: { data: { id: 'ses_1' } } };
      if (req.path.endsWith('/generate')) return { body: { data: { text: 'hi' } } };
      if (req.method === 'GET') return { body: { data: {} } };
      return { status: 204 };
    });
    try {
      const client = createOpencodeCompletionClient({ baseUrl: server.baseUrl });
      await expect(client.complete(REQUEST)).rejects.toThrow(/token usage/);
      expect(server.requests.at(-1)?.method).toBe('DELETE');
    } finally {
      server.close();
    }
  });

  test('reports cleanup failures without failing a successful completion', async () => {
    const errors: unknown[] = [];
    const server = startFakeOpencode((req) =>
      req.method === 'DELETE' ? { status: 500, body: { error: 'nope' } } : happyPath(req),
    );
    try {
      const client = createOpencodeCompletionClient({
        baseUrl: server.baseUrl,
        onCleanupError: (err) => errors.push(err),
      });
      const result = await client.complete(REQUEST);
      expect(result.text).toBe('generated text');
      expect(errors).toHaveLength(1);
    } finally {
      server.close();
    }
  });
});
