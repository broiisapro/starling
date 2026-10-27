/**
 * ollama.test.ts — offline tests for the streaming client in ollama.ts.
 *
 * `fetch` is replaced with a stub that serves a ReadableStream of bytes, so the SSE line
 * buffering, JSON parsing, partial-stream handling, non-200 handling and timing maths are all
 * exercised without a network call and without loading a model.
 *
 *   bun test tools/local-models
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { type CallOptions, callNative, callV1, validateVerdict } from './ollama';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const OPTS: CallOptions = {
  host: 'http://stub.invalid',
  model: 'stub:1b',
  system: 'you are a stub',
  user: 'judge this',
  schema: { type: 'object' },
};

/** A complete, well-formed response body. */
function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

/** Delivers `chunks`, then fails the stream the way a dropped socket does. */
function brokenStream(chunks: string[], message: string): Response {
  const encoder = new TextEncoder();
  const failure = new Error(message);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      },
      pull(controller) {
        controller.error(failure);
      },
    }),
    { status: 200 },
  );
}

/** Replaces fetch, records the URLs called, and returns the recorder. */
function useFetch(handler: () => Response): { urls: string[]; bodies: string[] } {
  const urls: string[] = [];
  const bodies: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(url);
    if (typeof init?.body === 'string') bodies.push(init.body);
    return handler();
  }) as typeof fetch;
  return { urls, bodies };
}

/** One OpenAI-compatible SSE delta, as Ollama emits it. */
function v1Delta(content: string, completionTokens?: number): string {
  const event = {
    choices: [{ delta: { content } }],
    ...(completionTokens === undefined ? {} : { usage: { completion_tokens: completionTokens } }),
  };
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** One native /api/chat line. */
function nativeLine(content: string): string {
  return `${JSON.stringify({ message: { content }, done: false })}\n`;
}

describe('callV1 — OpenAI-compatible stream', () => {
  test('assembles deltas split across chunk boundaries and reports usage timing', async () => {
    const first = v1Delta('hello ');
    // Split a single SSE event into two transport chunks: the client must buffer the line.
    const second = v1Delta('world');
    const cut = second.indexOf('choices');
    const calls = useFetch(() =>
      streamResponse([
        first + second.slice(0, cut),
        second.slice(cut),
        `data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { completion_tokens: 7 } })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    );

    const result = await callV1(OPTS);

    expect(result.status).toBe(200);
    expect(result.text).toBe('hello world');
    expect(result.error).toBeUndefined();
    expect(result.timing.completionTokens).toBe(7);
    expect(result.timing.ttftMs).not.toBeNull();
    expect(result.timing.totalMs).toBeGreaterThanOrEqual(0);
    expect(result.timing.tokensPerSec).toBeGreaterThan(0);
    expect(result.timing.tokensPerSecSource).toBe('usage');
    expect(calls.urls[0]).toBe('http://stub.invalid/v1/chat/completions');
  });

  test('ignores a malformed chunk and keeps the valid deltas around it', async () => {
    useFetch(() =>
      streamResponse(['data: {not json at all\n\n', v1Delta('ok'), 'data: \n\n', 'data: [DONE]\n\n']),
    );

    const result = await callV1(OPTS);

    expect(result.text).toBe('ok');
    expect(result.error).toBeUndefined();
    expect(result.timing.completionTokens).toBeNull();
    expect(result.timing.tokensPerSec).toBeNull();
  });

  test('keeps partial text and reports an error when the stream dies midway', async () => {
    useFetch(() =>
      brokenStream([v1Delta('half'), 'data: {"choices":[{"delta":{"content":"tru'], 'socket hang up'),
    );

    const result = await callV1(OPTS);

    expect(result.text).toBe('half');
    expect(result.status).toBe(200);
    expect(result.error).toContain('stream ended early');
    expect(result.error).toContain('socket hang up');
  });

  test('reports a non-200 response without trying to parse the body', async () => {
    useFetch(() => new Response("model 'stub:1b' not found", { status: 404, statusText: 'Not Found' }));

    const result = await callV1(OPTS);

    expect(result.text).toBe('');
    expect(result.status).toBe(404);
    expect(result.error).toContain('404');
    expect(result.error).toContain('not found');
    expect(result.timing.tokensPerSec).toBeNull();
  });

  test('treats a thrown fetch as a status-0 transport error', async () => {
    globalThis.fetch = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;

    const result = await callV1(OPTS);

    expect(result.status).toBe(0);
    expect(result.text).toBe('');
    expect(result.error).toContain('connection refused');
  });
});

describe('callNative — /api/chat stream', () => {
  test('uses eval counters for exact tokens/s and the load time', async () => {
    const done = JSON.stringify({
      message: { content: '' },
      done: true,
      eval_count: 100,
      eval_duration: 2_000_000_000,
      load_duration: 500_000_000,
    });
    const calls = useFetch(() => streamResponse([nativeLine('won'), nativeLine('der'), `${done}\n`]));

    const result = await callNative(OPTS);

    expect(result.text).toBe('wonder');
    expect(result.error).toBeUndefined();
    expect(result.timing.completionTokens).toBe(100);
    expect(result.timing.tokensPerSec).toBe(50);
    expect(result.timing.tokensPerSecSource).toBe('api-chat-eval');
    expect(result.timing.loadDurationMs).toBe(500);
    expect(result.timing.ttftMs).not.toBeNull();
    expect(calls.urls[0]).toBe('http://stub.invalid/api/chat');
  });

  test('skips a malformed line, including the final done counters', async () => {
    useFetch(() => streamResponse(['{oops\n', nativeLine('fine'), '\n']));

    const result = await callNative(OPTS);

    expect(result.text).toBe('fine');
    expect(result.timing.completionTokens).toBeNull();
    expect(result.timing.tokensPerSec).toBeNull();
  });

  test('returns partial text plus an error when the stream dies midway', async () => {
    useFetch(() => brokenStream([nativeLine('part'), '{"message":{"cont'], 'read ECONNRESET'));

    const result = await callNative(OPTS);

    expect(result.text).toBe('part');
    expect(result.error).toContain('stream ended early');
    expect(result.error).toContain('ECONNRESET');
  });

  test('reports a non-200 response', async () => {
    useFetch(() => new Response('out of memory', { status: 500, statusText: 'Internal Server Error' }));

    const result = await callNative(OPTS);

    expect(result.text).toBe('');
    expect(result.status).toBe(500);
    expect(result.error).toContain('500');
    expect(result.error).toContain('out of memory');
  });
});

describe('request shapes', () => {
  test('streams with json_schema and include_usage on the compatible endpoint', async () => {
    const calls = useFetch(() => streamResponse([v1Delta('x'), 'data: [DONE]\n\n']));

    await callV1({ ...OPTS, think: false });

    const body = JSON.parse(calls.bodies[0] as string) as Record<string, unknown>;
    expect(body.model).toBe('stub:1b');
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.think).toBe(false);
    expect(body.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
    expect((body.messages as { role: string }[])[0]?.role).toBe('system');
  });

  test('omits think when it was not requested, and passes the schema as `format` natively', async () => {
    const calls = useFetch(() => streamResponse([nativeLine('x')]));

    await callNative(OPTS);

    const body = JSON.parse(calls.bodies[0] as string) as Record<string, unknown>;
    expect('think' in body).toBe(false);
    expect(body.format).toEqual({ type: 'object' });
    expect(body.stream).toBe(true);
    expect(body.keep_alive).toBe('5m');
  });
});

describe('validateVerdict', () => {
  test('accepts a fenced, correctly shaped failing verdict for the seeded diff', () => {
    const { parsed, checks } = validateVerdict(
      '```json\n{"pass":false,"summary":"no test","fixInstructions":"add one"}\n```',
    );

    expect(checks.every((c) => c.ok)).toBe(true);
    expect(parsed).toEqual({ pass: false, summary: 'no test', fixInstructions: 'add one' });
  });

  test('flags extra keys and a verdict that contradicts the expectation', () => {
    const { parsed, checks } = validateVerdict('{"pass":true,"summary":"looks fine","confidence":0.9}');
    const byName = (name: string) => checks.find((c) => c.name === name)?.ok;

    expect(parsed).toEqual({ pass: true, summary: 'looks fine' });
    expect(byName('no-extra-keys')).toBe(false);
    expect(byName('verdict-is-sane')).toBe(false);
  });

  test('reports unparseable output instead of throwing', () => {
    const { parsed, checks } = validateVerdict('I think it is fine.');

    expect(parsed).toBeNull();
    expect(checks).toHaveLength(1);
    expect(checks[0]?.name).toBe('json-parses');
    expect(checks[0]?.ok).toBe(false);
  });
});
